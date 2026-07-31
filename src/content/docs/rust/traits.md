---
title: 2. Traits
description: Interfaces, but they can be implemented on types you don't own — which is the entire mechanism of this PR.
sidebar:
  order: 3
---

## The one-paragraph version

A trait is an interface. You declare a capability, then you say which types have it.

```rust
pub trait ActiveTheme {
    fn theme(&self) -> &Arc<Theme>;
}

impl ActiveTheme for App {
    fn theme(&self) -> &Arc<Theme> { GlobalTheme::theme(self) }
}
```

That's TypeScript's

```ts
interface ActiveTheme { theme(): Theme }
```

with one enormous difference: **in Rust you can implement a trait for a type you
didn't define.** `App` lives in the `gpui` crate; `ActiveTheme` and this `impl` live
in the `theme` crate. `gpui` knows nothing about it.

That single capability is why this entire PR is possible without touching GPUI —
the constraint the maintainer explicitly imposed.

## What this PR does with traits

Before, there was one trait with one implementation:

```rust
trait ActiveTheme { fn theme(&self) -> &Arc<Theme>; }
impl ActiveTheme for App { ... }        // ← cx.theme() worked everywhere
```

After, there are three traits and four implementations:

```rust
// 1. The window-scoped one — the new default.
pub trait WindowTheme {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
}
impl WindowTheme for Window { ... }

// 2. The app-scoped one — deliberately renamed so it can't be reached by accident.
pub trait ConfiguredTheme {
    fn configured_theme(&self) -> &Arc<Theme>;
}
impl ConfiguredTheme for App { ... }

// 3. ActiveTheme survives, but its App impl is GONE. It now exists to be a
//    *bound* on helper functions, and is implemented on the theme itself.
impl ActiveTheme for Arc<Theme> {
    fn theme(&self) -> &Arc<Theme> { self }
}
```

### Why `impl ActiveTheme for App` had to die

Because it was ambient. `Context<T>` dereferences to `App`, so `cx.theme()` was
available in essentially every function in the codebase and was used ~1,800 times.
Adding `window.theme(cx)` alongside it would have changed nothing — every existing
site would keep returning the global theme, and an overridden window would render as
a patchwork.

Deleting the impl converts *"did we miss a call site?"* from a review question into
a build error. That is [the central argument of the PR](/migration/why-big/).

### The weird one: `impl ActiveTheme for Arc<Theme>`

This is the line a sharp reviewer will circle, so understand it properly.

```rust
impl ActiveTheme for Arc<Theme> {
    fn theme(&self) -> &Arc<Theme> { self }
}
```

A trait implemented on a *smart pointer*, whose method returns *itself*. It looks
like a tautology, and in a sense it is. Here's why it exists.

Leaf helpers like `Color::color` used to take a context and fetch the theme
internally:

```rust
// before
pub fn color(&self, cx: &App) -> Hsla {
    match self { Color::Default => cx.theme().colors().text, ... }
}
```

They now take the theme as a value:

```rust
// after
pub fn color(&self, theme: &impl ActiveTheme) -> Hsla {
    match self { Color::Default => theme.theme().colors().text, ... }
}
```

Now: `window.theme(cx)` returns `&Arc<Theme>`. If the parameter were `&Theme`, every
one of several hundred call sites would need `&**window.theme(cx)` or
`window.theme(cx).as_ref()`. Making `Arc<Theme>` itself implement the trait means
the call site is just:

```rust
Color::Muted.color(window.theme(cx))
```

No deref, no `.as_ref()`, no `.clone()`. **Three lines of trait impl bought
several hundred lines of call-site noise.** That's the answer.

There's a secondary benefit worth mentioning if pressed: the trait bound leaves room
for other theme providers later — a preview theme, a test fixture — without
changing any of those signatures again.

## `&impl Trait` as a parameter type

```rust
fn shadow(self, theme: &impl ActiveTheme) -> Vec<BoxShadow>
```

Read this as: *"a reference to any type that implements `ActiveTheme`."* It is
shorthand for a generic:

```rust
fn shadow<T: ActiveTheme>(self, theme: &T) -> Vec<BoxShadow>
```

The compiler generates a specialised copy of the function for each concrete type
used (this is called monomorphisation). **There is no runtime cost** — no vtable, no
dynamic dispatch. It compiles down to the same machine code as if you'd hardcoded
the type.

The TS analogy is a generic constrained by an interface:

```ts
function shadow<T extends ActiveTheme>(theme: T): BoxShadow[]
```

except TypeScript erases it at runtime and Rust specialises it at compile time.

### `impl Trait` versus `dyn Trait`

You'll see both in the codebase. The distinction comes up if a reviewer asks about
performance:

| | `&impl Trait` / `<T: Trait>` | `&dyn Trait` |
|---|---|---|
| Resolved | Compile time | Runtime |
| Cost | Zero — inlined, specialised | One pointer indirection per call |
| Binary size | One copy per concrete type | One copy total |
| TS analogy | Generic with constraint | An interface-typed variable |

This PR uses `impl Trait` everywhere because the call sites are in the render hot
path and the set of concrete types is tiny (`Arc<Theme>`, basically).

## Traits you'll meet in the diff

| Trait | Meaning | Where |
|---|---|---|
| `WindowTheme` | "I can resolve a theme for a window" | Implemented on `Window` |
| `ConfiguredTheme` | "I can give you the settings theme" | Implemented on `App` |
| `ActiveTheme` | "I *am* a theme provider" | Bound on ~15 leaf helpers |
| `Global` | "I can be stored as an app singleton" | `impl Global for WindowThemeOverrides {}` — a marker trait, no methods |
| `Render` | "I know how to draw myself" | Every view |
| `RenderOnce` | Same, but consumed when drawn | Every lightweight component |
| `Default` | "There's a sensible empty value" | `#[derive(Default)]` on `WindowThemeOverrides` |
| `Styled` | GPUI's styling methods (`.bg()`, `.border_1()`) | Extended by Zed's `StyledExt` |

### Marker traits

```rust
impl Global for WindowThemeOverrides {}
```

An empty impl of a method-less trait. It doesn't add behaviour; it *grants
permission*. `Global` is GPUI's way of saying "this type may be stored as an app
singleton and fetched by type." The TS equivalent would be a branded type used as a
registry key.

Worth knowing because it's the line that makes `cx.global::<WindowThemeOverrides>()`
compile, and someone may ask what it does.

### Extension traits

`StyledExt` is the pattern where you add methods to someone else's type:

```rust
pub trait StyledExt: Styled + Sized {
    fn elevation_1(self, theme: &impl ActiveTheme) -> Self { ... }
    fn border_muted(self, theme: &impl ActiveTheme) -> Self { ... }
}
```

Any type that is `Styled` automatically gets these. This diff changes all of them
from `cx: &App` to `theme: &impl ActiveTheme` — same rewrite as `Color::color`, same
reason.

The TS analogy is monkey-patching a prototype, except it's type-safe, scoped to
wherever the trait is imported, and has no runtime cost.

## The five-second answers

**"What is `ActiveTheme` now?"**
> A bound on leaf styling helpers. It used to be a context extension; the context
> implementation is deleted. `Arc<Theme>` implements it so call sites can pass
> `window.theme(cx)` directly.

**"Why three traits instead of one with two methods?"**
> Because they're implemented on different types with different capabilities.
> `Window` can resolve a window theme, `App` can only give you the configured one,
> and a `Theme` is one. One trait would either need a `Window` parameter everywhere
> or would let `App` silently answer a window question — which is the bug the whole
> PR is preventing.

**"Why keep app-level access at all?"**
> Because some things genuinely have no window: app startup, dock menus, the
> language registry, telemetry, tests. Removing it entirely would be dishonest —
> those sites need *a* theme, and the configured one is the right answer. Naming it
> `configured_theme()` makes each such site say so out loud, which is what makes the
> [gap list](/gaps/the-honest-list/) enumerable at all.
