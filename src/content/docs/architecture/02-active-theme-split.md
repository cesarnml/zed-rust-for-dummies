---
title: 02. Splitting ActiveTheme
description: The most contentious decision on the branch — deleting an accessor so the compiler enumerates 1,800 call sites.
sidebar:
  order: 3
---

**Code:** `crates/theme/src/theme.rs`, `crates/ui/src/prelude.rs`,
`crates/ui/src/styles/{color,elevation,appearance}.rs`,
`crates/ui/src/traits/styled_ext.rs`, `crates/theme/src/scale.rs`,
`crates/theme/src/styles/colors.rs`, and ~290 call-site files
**Commits:** `24a6c23d4d`, `8cf39e90b2`
**Confidence:** High on the mechanism, **medium on upstream acceptance**

This is the largest and most contentious part of the branch: roughly 2,900 changed
lines across 300 files, almost all mechanical. The design question is not *"what do
the rewrites look like"* but *"what forces them to be complete."*

## In plain English

There were about 1,800 places in Zed that asked for the theme the old way. Adding a
new, better way to ask doesn't fix any of them — they all keep working, and they all
keep returning the *global* theme. So a window with a custom theme would come out
looking like a patchwork: the parts of the UI that were updated use the custom
colours, everything else uses the old ones.

Finding all 1,800 by hand is hopeless. And even if you managed it, the next person to
write a new panel would use the old way out of habit and quietly reintroduce the
problem. Nothing would catch it — the old call looks completely normal.

The trick used here is to **delete the old way entirely**. Not deprecate it, not warn
about it — remove it, so the code no longer compiles. The compiler then prints an
error for every one of the 1,800 places, and the work becomes a checklist you
literally cannot finish while any site is missed. The old functionality still exists,
under a new and deliberately awkward name (`configured_theme`, "the theme from
settings"), so the handful of places that genuinely want the global theme have to say
so out loud.

That's the whole idea. It is also why this branch is ~2,900 lines: almost all of it is
mechanical fallout from one deletion. The upside is that the diff is boring and
verifiable. The downside is that it's enormous and conflicts with everything in
flight.

## The problem, stated precisely

Before:

```rust
impl ActiveTheme for App {
    fn theme(&self) -> &Arc<Theme> { GlobalTheme::theme(self) }
}
```

Because `Context<T>` derefs to `App`, `cx.theme()` was available in essentially every
function in the codebase, and was used ~1,800 times.

Introducing `window.theme(cx)` does nothing on its own. Every existing `cx.theme()`
call keeps returning the global theme, so an overridden window renders with a chaotic
mix.

Worse, this isn't a one-time problem. Every future PR that writes `cx.theme()` in a
render path silently reintroduces the bug, and nothing catches it — not the compiler,
not tests, not review, because `cx.theme()` looks completely normal.

## Decision 1 — Delete `impl ActiveTheme for App` entirely

```rust
pub trait ConfiguredTheme {
    fn configured_theme(&self) -> &Arc<Theme>;
}
impl ConfiguredTheme for App { ... }
```

with a doc comment that states the intent outright:

> Use this only in contexts where no `Window` exists (app startup, menus, tests). UI
> that renders into a window must use `WindowTheme` instead; **deliberately,
> `cx.theme()` does not exist so per-window overrides cannot be silently bypassed.**

### Alternatives considered

**A — Keep `cx.theme()` and add `window.theme(cx)` alongside.**
Smallest possible diff; sites migrate opportunistically. **Rejected:** this is
precisely the silent-bypass failure mode. The feature ships half-working with the
broken half invisible until a user files a bug about one panel not matching. There's
also no migration end-state — the codebase sits in a permanently mixed condition, and
every new `cx.theme()` written by anyone is a fresh latent bug.

**B — Deprecate `cx.theme()` with `#[deprecated]`.**
Produces warnings, so the compiler *does* enumerate. **Rejected:** Zed's builds aren't
warning-free-enforced across the whole tree, 1,800 warnings are unreadable, and a
warning doesn't prevent new occurrences. It also leaves the deprecated symbol in the
`theme` crate's public API indefinitely.

**C — A clippy lint (`disallowed_methods`).**
Genuinely the most idiomatic Rust answer, and worth conceding as such. **Rejected as
the primary mechanism** because a lint still lets `cx.theme()` compile locally for
anyone who hasn't run `./script/clippy`, and because the correct replacement is
context-dependent (`window.theme(cx)` vs `cx.configured_theme()` vs threading a
`&Theme`) — a lint can complain but can't do the rewrite. It remains a good
*supplementary* idea if maintainers prefer to keep `cx.theme()` for compatibility, and
offering it as such is a good-faith move.

**D — Rename `App::theme()` to something ugly.**
Same effect, worse name. `configured_theme()` was chosen because it says what it
*returns* (the theme from settings) rather than what it isn't.

### On upstream acceptance

**Confidence: high on the mechanism, medium on acceptance.** A 2,900-line mechanical
diff is exactly the kind of PR maintainers push back on — not because it's wrong but
because it conflicts with everything in flight.

The counter-argument to have ready:

> The diff is almost entirely `cx.theme()` → `window.theme(cx)` plus `_:` →
> `_window:` renames. It's verifiable by inspection, and any *smaller* version of
> this PR is a feature that doesn't actually work.

And the concession to offer **before it's demanded**:

> If you'd rather have it staged: (1) introduce `WindowTheme` + `ConfiguredTheme`
> while keeping `impl ActiveTheme for App`, (2) migrate crate by crate, (3) delete the
> `App` impl last. More PRs, but each trivially reviewable.

See [Why it is that big](/migration/why-big/) for the full argument.

## Decision 2 — `impl ActiveTheme for Arc<Theme>` and `&impl ActiveTheme` parameters

Some theme consumers aren't render functions and have no `Window`:

```rust
// before — take a context purely to fetch the theme and read one field
pub fn color(&self, cx: &App) -> Hsla { ... cx.theme().colors().text ... }
pub fn shadow(self, cx: &App) -> Vec<BoxShadow> { ... }
pub fn step(&self, cx: &App, step: ColorScaleStep) -> Hsla { ... }
pub fn all_theme_colors(cx: &mut App) -> Vec<(Hsla, SharedString)> { ... }
```

These are **leaf helpers**. They were rewritten to take the theme itself, in two
deliberately different shapes:

| Shape | Used for | Why |
|---|---|---|
| `&impl ActiveTheme` | `ui` public API: `Color::color`, `ElevationIndex::{bg, shadow, on_elevation_bg, darker_bg}`, all of `StyledExt` | Call sites can pass `window.theme(cx)` directly |
| `&Theme` | `theme`-internal helpers: `ColorScaleSet::step`, `all_theme_colors` | No genericity needed, no external call sites |

### Why `&impl ActiveTheme` rather than plain `&Theme` at the `ui` boundary

Because `window.theme(cx)` returns `&Arc<Theme>`. With a `&Theme` parameter, every one
of several hundred call sites would need `&**window.theme(cx)` or `.as_ref()`. Backing
the parameter with `impl ActiveTheme for Arc<Theme>` makes the call site:

```rust
Color::Muted.color(window.theme(cx))
```

No deref, no `.as_ref()`, no `.clone()`. **Three lines of trait impl bought several
hundred lines of call-site noise.**

The trait also leaves the door open for other theme providers later — a preview
theme, a test fixture — without touching those signatures again.

**Alternative rejected:** keep `cx: &App` and add `window: Option<&Window>`. That
pushes the resolution decision down into every leaf helper, which then has to decide
what to do when `window` is `None` — and the answer is always "fall back to global,"
i.e. the silent-bypass bug re-implemented once per helper.

**Confidence: high.** The `Arc<Theme>` impl is a slightly unusual trick (a trait whose
impl on a smart pointer returns the pointer itself), but it's three lines, documented,
and it makes the ergonomics work. A reviewer might reasonably ask for
`impl ActiveTheme for Theme` too — that wasn't added because no call site needed it,
and adding unused API surface to satisfy symmetry is its own smell.

## Decision 3 — Re-export all three traits from `ui::prelude`

```rust
pub use theme::ActiveTheme;
pub use theme::ConfiguredTheme;
pub use theme::WindowTheme;
```

All three go in the prelude so the common cases need no imports:
`window.theme(cx)`, `Color::Muted.color(theme)`, and the rare `cx.configured_theme()`.
`ActiveTheme` stays because it's now the *bound* on leaf helpers, not a context
extension.

**The cost, acknowledged:** `ConfiguredTheme` is in scope everywhere, so writing
`cx.configured_theme()` in a render path is still easy.

**Why that's accepted:** the point of the split isn't to make the wrong thing
impossible — it's to make it *visible and deliberate* rather than invisible and
default. A reviewer reading `cx.configured_theme()` inside a `render` method has an
obvious question to ask. A reviewer reading `cx.theme()` had none.

That property is what makes [the gap list](/gaps/the-honest-list/) enumerable at all:
you can grep for `configured_theme()` and get the complete inventory of every place
that deliberately reads the global theme.

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v tests
```

## Decision 4 — The `_:` → `_window:` renames

A large share of the diff's noise lines:

```diff
- fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
+ fn render(&mut self, _window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
```

**These aren't incidental.** An anonymous `_` parameter is unnameable, so the next
person who needs the theme in that function must first rename it — and a reviewer
scanning for "does this function have a window available?" can't tell by grepping.
Naming every unused `Window` parameter `_window` makes window availability greppable
and makes future theme fixes one-line changes.

**They do inflate the diff, and they are the most obviously drive-by part of it.**

**Confidence: medium-high on value, low on whether reviewers want them in this PR.**
Call this out proactively as separable. Offering to pull them into their own commit
before being asked is one of the cheapest good-faith signals available.

## What this decision buys, restated

After the split, the *only* ways to render a wrong-theme pixel are:

1. Explicitly calling `cx.configured_theme()` in a render path — **visible in review**.
2. Rendering somewhere that genuinely has no `Window` — **enumerated in
   [the gaps](/gaps/the-honest-list/)**.

Both are enumerable. Before the split, neither was.

That is the whole argument, and it is worth having as a single sentence you can say
without hesitating.
