---
title: 5. Closures and fn pointers
description: Why one rewrite shape exists at all — and why you cannot put a window in a stored callback.
sidebar:
  order: 6
---

In TypeScript, every arrow function can close over any variable in scope, and
there's exactly one function type. Rust has **four**, and the distinctions are
load-bearing in this diff.

## The four kinds

| Kind | Captures? | Callable | TS analogy |
|---|---|---|---|
| `fn(&Theme) -> Hsla` | **Never** | Many times | A named top-level function only |
| `impl Fn(...)` | Yes, by reference | Many times | A normal arrow function |
| `impl FnMut(...)` | Yes, mutably | Many times | An arrow function that mutates outer state |
| `impl FnOnce(...)` | Yes, by move | **Once** | A function that consumes what it captured |

The critical one is the first. A lowercase `fn` is a **bare function pointer** —
the type system *guarantees* it captures nothing. It's a raw code address, one
machine word.

And here's the rule that produces a whole rewrite shape:

> **A capturing closure is a different type and will not coerce to `fn`.**

In TypeScript, `(x) => x + captured` and `function f(x) { return x + 1 }` have the
same type. In Rust they don't. Each closure gets its own anonymous compiler-generated
type; only a non-capturing one can become an `fn`.

## Shape 4: where this bites

The editor's row and gutter highlight system stores its colour resolvers as bare
function pointers:

```rust
// before
color: fn(&App) -> Hsla
```

The obvious migration would be to pass a closure that captures the window:

```rust
color: |cx| window.theme(cx).colors().editor_debugger_active_line_background
//     ^^^^ captures `window` → not an `fn` → compile error
```

Two problems, and both are worth knowing:

1. **It doesn't coerce.** A capturing closure isn't an `fn`.
2. **Even if it did, it would be unsound.** These descriptors are stored on the
   editor and outlive any particular render pass. A captured `&mut Window` loan
   cannot live that long.

### The fix: change what the callback *receives*

```rust
// stored type:  fn(&Theme) -> Hsla        ← still capture-free
// construction: |theme| theme.colors().editor_debugger_active_line_background
// invocation:   (highlight.color)(window.theme(cx))
```

The callback stops **fetching** the theme and starts **receiving** it. Resolution
moves to paint time, where the window is known.

**Precedent to cite in review:** `BackgroundHighlight` in the same file already used
this shape. The change makes row and gutter highlights consistent with a pattern the
codebase had already chosen — that's a much stronger position than "I invented a new
convention."

**Alternative rejected:** turn every stored `fn` into `Arc<dyn Fn(...)>` so it *can*
capture. That adds an allocation and dynamic dispatch per highlight, complicates
debugging and equality, and *still* risks capturing a stale window or theme. Changing
the input type preserves the zero-capture, zero-allocation design.

**The review invariant:** resolve the theme at the point the callback is
**invoked**, not when the descriptor is **created**. A descriptor may outlive a
theme change or be rendered in a different window.

## `'static` and `Send`: Shape 5

Some closures must be stored (tooltips kept in a struct, list-row renderers, drag
handlers) or sent to another thread (background tasks). Those carry bounds:

- **`'static`** — contains no borrowed references at all.
- **`Send`** — safe to move between threads.

A `&mut Window` is a loan on UI-thread state. It satisfies neither. **You can never
put a window in a stored or sent closure.** Full stop.

The TypeScript analogy that actually maps: it's like trying to use a DOM node inside
a Web Worker. The structured-clone boundary won't let the node through — so you send
the *data you derived from it* instead.

The diff handles this three ways, in strict order of preference.

### 5a. The callback already gets its own window — use it

Many GPUI callbacks are *handed* a fresh `&mut Window` when invoked later: list-row
processors, `drag_over`, `Tooltip::element`, `ContextMenu::build`. The recurring bug
the migration exposed was closures whose window parameter was bound as `_` while the
body reached for the outer one:

```rust
.drag_over(|tab, _, _, cx|      tab.bg(window.theme(cx)...))   // ✗ captures outer loan
.drag_over(|tab, _, window, cx| tab.bg(window.theme(cx)...))   // ✓ uses its own
```

This is also **semantically better**, not just a workaround: the parameter is the
window at invocation time, which is the one actually being painted.

### 5b. The callback type has no window — give it one

`DocumentationAside.render` stored `Fn(&mut App) -> AnyElement`. It's only ever
invoked from window-aware render code, so its type became
`Fn(&mut Window, &mut App) -> AnyElement`, and every constructor gained the
parameter.

This is "change the callback prop's signature, update all callers" — mechanical in
any language, just visible in the diff.

### 5c. Truly detached — move the *values*, not the loan

The single-line-editor `"\n"` fold placeholder is built inside a closure that must be
`Send + Sync`. No loan can go in. But colours are plain four-float values (`Hsla` is
`Copy`), so resolve them *before* the boundary:

```rust
let hint_background = window.theme(cx).status().hint_background;   // resolve now
let hint_border     = window.theme(cx).status().hint;
... Arc::new(move |_, _, cx| div().bg(hint_background).border_color(hint_border) ...)
```

**Trade-off to volunteer:** the colour is fixed at fold-creation time until the next
refold. Acceptable for a transient decoration. Saying it unprompted is worth more
than being caught.

### How to choose among the three

1. Use an invocation-time window already in the callback (5a).
2. If none exists but the callback is only ever invoked from a window-aware path,
   add it to the contract (5b).
3. Only snapshot derived values when a window genuinely cannot cross the boundary (5c).

That ordering minimises stale values, and being able to state it is a strong signal
you did this deliberately rather than by trial and error.

**Alternatives rejected across the board:** capturing `Window`, `&Window`,
`WeakEntity<Window>`, or a raw `WindowId` just to recover colours. These either fail
`'static`/`Send`, invent unsafe ownership, or turn a narrow styling callback into a
side-table client. And **never** fall back to the configured theme for convenience —
it compiles and it silently breaks the feature.

## The `move` keyword

```rust
cx.background_spawn(async move { db.set_theme_override(id, Some(name)).await })
```

`move` means "take ownership of everything captured" rather than borrowing it. It's
mandatory for anything that outlives the current scope — which is every spawned task.

The idiom `CLAUDE.md` prescribes, and which appears in this branch, is to shadow a
clone right at the boundary so the lifetime of the borrow is obvious:

```rust
cx.background_spawn({
    let theme_name = theme.name.to_string();
    async move { db.set_theme_override(id, Some(theme_name)).await }
});
```

## The five-second answer

**"Why did you change the highlight callback's signature instead of just capturing
the window?"**

> Those are bare `fn` pointers — the type guarantees no captures, so a capturing
> closure won't coerce. And even if it would, the descriptor outlives the render
> pass, so holding a window loan in it would be unsound. Changing what the callback
> receives from `&App` to `&Theme` keeps it capture-free and moves resolution to
> paint time, where the window is actually known. `BackgroundHighlight` in the same
> file already worked that way, so this makes them consistent.
