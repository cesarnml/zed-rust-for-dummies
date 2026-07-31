---
title: The seven rewrite shapes
description: Every non-trivial rewrite in the diff falls into one of seven categories. This is what reviewers probe.
sidebar:
  order: 2
---

Most of the diff is the trivial one-line swap. The interesting rewrites are where
Rust's ownership rules made the trivial swap **impossible**.

Know these seven. For each: what changed, and — more importantly — **why the naive
version doesn't compile**. That "why" is what a reviewer will use to test whether a
human did this work.

---

## Shape 1 — Trivial (the majority)

Any function that already receives the window.

```diff
- .bg(cx.theme().colors().editor_background)
+ .bg(window.theme(cx).colors().editor_background)
```

**TS analogy:** `getColors()` reading a module global becomes `getColors(window)` —
same expression, explicit source.

**Alternatives rejected:** passing a `WindowId` alongside `cx` would expose the storage
mechanism at every call site. Passing a cloned `Arc<Theme>` everywhere creates needless
plumbing and can snapshot too early. Asking the live `Window` is both the semantic
dependency and the least invasive signature.

**Review invariant:** the `window` used must be the one supplied to the *current*
render/event invocation, not a window captured at construction time.

---

## Shape 2 — The window was there but discarded

```diff
- fn render(&mut self, _: &mut Window, cx: ...) 
+ fn render(&mut self, window: &mut Window, cx: ...)
```

**In English:** the code never needed to know which window it painted into, because the
theme was ambient. Under dependency inversion the window *is* the dependency, so the
parameter gets a name. **This is the whole PR in miniature.**

Where the parameter still isn't used, it becomes `_window` rather than `_` — see
[Design 02, Decision 4](/architecture/02-active-theme-split/#decision-4--the-_--_window-renames)
for why that's deliberate and why it's separable.

**Alternatives rejected:** suppressing the warning while continuing to read the global
theme leaves a correctness hole. Adding a *second* window parameter is redundant — the
GPUI callback signature already carries the capability; this rewrite just stops
discarding it.

**Review trap:** an unused-variable diagnostic after the migration may be stale
rust-analyzer state — but verify with `cargo check` before assuming that. If the
compiler agrees the variable is unused, either the intended theme read was missed or the
name should stay `_window`.

---

## Shape 3 — Style helpers become theme-parameterized

Shared styling helpers used to take `cx` and read the global inside:

```rust
// before — fetches ambient state internally
fn color(&self, cx: &App) -> Hsla { cx.theme().colors().text }

// after — receives the theme as a value
fn color(&self, theme: &impl ActiveTheme) -> Hsla { theme.theme().colors().text }
```

**Affected:** `Color::color`, the elevation helpers (`shadow`, `bg`, `on_elevation_bg`,
`darker_bg`), the `StyledExt` elevation and border methods, `theme_is_transparent`,
`ColorScaleSet::step`, `all_theme_colors`, and the whole `ButtonStyle` / `TintColor`
family.

The button code is the clearest example: it resolves the theme **once** at the top of
render —

```rust
let theme = window.theme(cx).clone();
```

— and passes it down. Remember `.clone()` on an `Arc` is a refcount bump, not a deep
copy.

**TS analogy:** `function buttonColors(ctx)` that internally did `ctx.getGlobalTheme()`
becomes `function buttonColors(theme)`. A pure function of its inputs; the caller
decides which theme.

**Why `&impl ActiveTheme` and not `&Theme`?** Because `window.theme(cx)` returns
`&Arc<Theme>`, and `impl ActiveTheme for Arc<Theme>` lets call sites pass it directly —
no deref, no `.as_ref()`. Several hundred call sites stayed clean because of three lines
of trait impl. Full reasoning in
[Design 02, Decision 2](/architecture/02-active-theme-split/#decision-2--impl-activetheme-for-arctheme-and-impl-activetheme-parameters).

**Alternatives rejected:**

| Option | Why not |
|---|---|
| Pass `&Window` into every style primitive | Couples pure colour math to GPUI; forces a window through code that only needs colours |
| Keep `&App` and add a window id | Preserves ambient lookup and spreads side-table details through UI APIs |
| Clone the whole theme into every primitive | `Arc` clones are cheap, but a borrow is clearer when no ownership is needed |
| Make helpers read `ConfiguredTheme` | Silently wrong in an overridden window |

**The boundary rule:** resolve at the nearest window-aware render boundary, then pass
the narrowest value downstream — `&Theme` / `&impl ActiveTheme` when a helper needs many
tokens, a concrete `Hsla` when it needs one colour.

---

## Shape 4 — Function-pointer callbacks can't capture

The editor's row and gutter highlight system stores its colour resolvers as **plain
function pointers**: `fn(&App) -> Hsla`.

**Why the obvious fix fails.** These are C-style bare functions — the type system
guarantees they capture nothing. In TypeScript every arrow function can close over
variables; in Rust a capturing closure is a **different type** that will not coerce to
`fn`. So:

```rust
|cx| window.theme(cx).colors().x    // ✗ captures `window` → not an fn → compile error
```

And even if it did coerce, it would be unsound: the descriptor outlives the render pass,
so a captured window loan couldn't live that long.

**The fix — change what the callback *receives*:**

```rust
// stored type:  fn(&Theme) -> Hsla          ← still capture-free
// construction: |theme| theme.colors().editor_debugger_active_line_background
// paint time:   (highlight.color)(window.theme(cx))
```

The callback stops *fetching* and starts *receiving*. Resolution moves to paint time,
where the window is known.

**Precedent to cite:** `BackgroundHighlight` in the same file **already used** this
shape. The change makes row and gutter highlights consistent with a pattern the codebase
had already chosen — a much stronger position than "I invented a convention."

**Alternatives rejected:** turn every stored `fn` into `Arc<dyn Fn(...)>` so it can
capture. Adds allocation and dynamic dispatch, complicates equality and debuggability,
and *still* risks capturing a stale window or theme. Passing a `WindowId` into the
callback is the same abstraction leak.

**Review invariant:** resolve the theme at the point the callback is **invoked**, not
when the descriptor is **created**.

---

## Shape 5 — `'static` / `Send` boundaries

Closures stored for later (tooltips kept in a struct, list-row renderers, drag handlers,
background tasks) must be `'static` — self-contained, no borrowed loans inside — and
sometimes `Send`. **A `&mut Window` is a loan on UI-thread state and can be neither
stored nor sent.**

**The TS analogy that actually maps:** it's like trying to use a DOM node inside a Web
Worker callback. The structured-clone boundary won't let the node through, so you send
the *data you derived from it* instead.

Three sub-cases, in strict order of preference.

### 5a. The callback already receives a window — use its own parameter

Many GPUI callbacks are *given* a fresh `&mut Window` when invoked later: list-row
processors, `drag_over`, `Tooltip::element`, `ContextMenu::build`. The recurring bug the
sweep exposed:

```rust
.drag_over(|tab, _, _, cx|      tab.bg(window.theme(cx)...))   // ✗ captures outer loan
.drag_over(|tab, _, window, cx| tab.bg(window.theme(cx)...))   // ✓ uses its own
```

Using the parameter is also **semantically more correct** — it's the window at
invocation time.

### 5b. The callback type has no window — give it one

`DocumentationAside.render` (the side panel of docs next to a context-menu item) stored
`Fn(&mut App) -> AnyElement`. It's only ever invoked from window-aware render code, so
its signature became `Fn(&mut Window, &mut App) -> AnyElement` and every constructor
gained the parameter.

"Change the interface of the callback prop, update all the callers" — mechanical in any
language, just visible in the diff.

### 5c. Truly detached work — move derived values, not the loan

The single-line-editor `"\n"` fold placeholder is built inside a callback that must be
`Send + Sync`. You can't put a window loan in it — but colours are plain four-float
values (`Hsla` is `Copy`). Resolve them *before* crossing the boundary:

```rust
let hint_background = window.theme(cx).status().hint_background;   // resolve now
let hint_border     = window.theme(cx).status().hint;
... Arc::new(move |_, _, cx| div().bg(hint_background) ...)         // move values in
```

**Trade-off to volunteer if asked:** the colour is fixed at fold-creation time until the
next refold. Acceptable for a transient decoration.

### How to choose

1. Use an invocation-time window already in the callback (5a).
2. If none exists but the callback is invoked exclusively from a window-aware path, add
   it to the contract (5b).
3. Only snapshot derived values when a window genuinely cannot cross the
   storage/thread boundary (5c).

This ordering minimises stale values, and being able to state it is strong evidence the
work was deliberate.

**Alternatives rejected across the board:** capturing `Window`, `&Window`,
`WeakEntity<Window>`, or a raw `WindowId` merely to recover colours. Those either fail
`'static`/`Send`, invent unsafe ownership, or turn a narrow styling callback into a
side-table client. And **never** resolve the configured global as a convenient fallback
— it compiles while violating the feature.

---

## Shape 6 — Contexts that embed their own window

Editor block decorations receive a `BlockContext` that *contains* window and app handles
as fields. Inside such a callback the outer `window` variable is out of reach (it's a
`'static` closure), but the context's own fields are right there:

```rust
background: cx.window.theme(cx.app).system().transparent,
```

**TS analogy:** the event object carries `event.currentTarget` — use it instead of a
variable captured from an outer scope.

**Alternatives rejected:** thread an additional outer window into the block factory, or
precompute a whole theme at factory creation. The context exists to describe the actual
paint invocation and stays correct if the block is reused.

**Review invariant:** use `cx.window` and `cx.app` as a **matched pair** from the same
`BlockContext`. Don't mix an embedded window with an unrelated app borrow.

---

## Shape 7 — Async rendezvous

Inside spawned async tasks you can't hold a window loan across `await`s. GPUI's async
contexts offer closure forms that hand the window back for a synchronous slice:

```diff
- editor.update(cx, |editor, cx| ...)
+ editor.update_in(cx, |editor, window, cx| ...)
```

```rust
cx.update(|window, cx| ...)          // async ctx hands the window back
this.update_in(cx, |this, window, cx| ...)
```

**TS analogy:** you can't hold a lock across an `await`; you re-acquire it in the
continuation. `update_in` is "re-acquire entity + window together."

This appears in the theme selector's `update_matches`, which had to become `update_in`
so the post-search preview could apply to the right window.

**Alternatives rejected:** clone a theme *before* the async task — it may be stale by the
time the task resumes. Holding a window borrow across `await` is disallowed for good
reason. Falling back to the configured theme inside the task produces cross-window bugs.

**Review invariant:** do background work without UI state, then re-enter the
foreground/window context only to read the current theme and update entities.

---

## What still legitimately reads the configured theme

Not every site should be migrated. These are correct as-is:

- **Tests, example binaries, the visual test runner.** No windows, or synthetic ones.
- **App startup, app/dock menus.** Genuinely windowless.
- **The language registry and telemetry** in `main.rs`. Process-wide by construction.
- **OS-drawn chrome** — traffic lights, native menus, the macOS tab overview — follows
  the *system* light/dark appearance. Making that per-window would need a new GPUI
  platform API and is explicitly out of scope.

Everything *else* that still reads `configured_theme()` is a
[known gap](/gaps/the-honest-list/), and it's enumerable with one grep:

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v "tests\|fixtures\|examples"
```

That grep returning a short, explicable list is the payoff of
[Design 02](/architecture/02-active-theme-split/). Before the split, the equivalent
question had no answer at all.
