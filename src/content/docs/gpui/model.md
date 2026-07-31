---
title: The mental model
description: GPUI's four nouns, and the one missing feature that shaped this entire design.
sidebar:
  order: 1
---

GPUI is Zed's own UI framework. It handles rendering, state, and concurrency. You
need four nouns and one absence.

## `App` — the application context

Passed almost everywhere as `cx`. Holds global state and gives access to everything
else.

```rust
cx.global::<GlobalTheme>()          // fetch a singleton by type
cx.set_global(GlobalTheme { ... })  // install one
cx.try_global::<T>()                // Option version — may not be set yet
cx.default_global::<T>()            // get or insert Default::default()
cx.observe_global::<T>(callback)    // run this when that global changes
cx.windows()                        // enumerate open windows
cx.on_window_closed(callback)       // lifecycle hook
```

Think of it as explicit dependency injection instead of module-level singletons.
Everything that would be a module global in TypeScript is a **type-keyed global** on
`App` here.

There are several context types that all deref to `App`:

| Type | Where it comes from | Notes |
|---|---|---|
| `App` | The root | |
| `Context<T>` | `entity.update(cx, ...)` | Derefs to `App`; also lets you `notify`, `emit`, `subscribe` |
| `AsyncApp` | `cx.spawn(...)` | Can be held across `await` |
| `AsyncWindowContext` | `cx.spawn_in(...)` | Same, plus window access |

**The consequence that made this PR necessary:** because `Context<T>` derefs to
`App`, `cx.theme()` was reachable from essentially every function in Zed. That is
what made the old accessor ambient, and what made deleting it produce ~1,800 errors.

## `Window` — one platform window

Passed as `window`, and **always immediately before `cx`** in signatures. That
ordering is a hard convention in this codebase.

```rust
window.window_handle().window_id()          // → WindowId
window.set_background_appearance(appearance) // tell the OS opaque/transparent/blurred
window.refresh()                             // force a repaint
window.dispatch_action(action.boxed_clone(), cx)
```

`window_handle().window_id()` is the line the whole feature turns on: it's how the
`WindowTheme` trait gets a key without GPUI needing to know what a theme is.

## `Entity<T>` — managed mutable state

A handle to state the framework owns. Roughly a store or atom, with explicit access.

```rust
thing.read(cx)                                  // → &T
thing.update(cx, |thing: &mut T, cx| { ... })   // mutate
thing.update_in(cx, |thing, window, cx| { ... })// mutate, with window (async contexts)
thing.downgrade()                               // → WeakEntity<T>
```

Two rules that produce real bugs if forgotten:

1. **Inside the closure, use the inner `cx`,** not the outer one. Otherwise you have
   two live borrows and it won't compile.
2. **Never update an entity while it's already being updated.** That panics.

`WeakEntity<T>` is the non-owning version; its methods return `Result` because the
entity may be gone. Used to break reference cycles — the theme selector holds a
`WeakEntity<ThemeSelector>` for exactly this reason.

An `Entity<T>` where `T: Render` is called a **view**.

## `Render` and `RenderOnce`

```rust
impl Render for Workspace {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().bg(window.theme(cx).colors().background)
    }
}
```

`Render` is for stateful views. `RenderOnce` is for lightweight components — it
takes `self` by value and receives `&mut App` instead of `&mut Context<Self>`.
Roughly: class component vs function component.

Styling methods mirror Tailwind (`.bg()`, `.border_1()`, `.rounded_lg()`,
`.flex_col()`). Conditionals use `.when(cond, |this| ...)` and
`.when_some(opt, |this, v| ...)`.

**The important property for this PR:** because views build their style **live,
inside `render`**, resolving the theme from the window at that moment restyles the
entire UI with no additional plumbing. Everything on the paint path gets the right
theme automatically once its call site is migrated.

Everything *not* on the paint path does not — and that is exactly the
[gap list](/gaps/the-honest-list/).

## Actions

Named, dispatchable commands. They appear in the command palette and can be bound to
keys.

```rust
#[derive(PartialEq, Clone, Default, Debug, Deserialize, JsonSchema, Action)]
#[action(namespace = theme_selector)]
#[serde(deny_unknown_fields)]
pub struct ToggleWindowTheme {
    /// A list of theme names to filter the theme selector down to.
    pub themes_filter: Option<Vec<String>>,
}
```

Doc comments on actions are shown to users, so they're user-facing copy, not just
developer notes.

Handlers register via `cx.on_action(|action, cx| ...)` or on an element with
`.on_action(cx.listener(|this, action, window, cx| ...))`.

This branch adds two: `ToggleWindowTheme` and `ClearWindowTheme`.

## `cx.notify()` and events

- `cx.notify()` — "my state changed, re-render me." Also fires `cx.observe`
  callbacks.
- `cx.emit(event)` + `cx.subscribe(other, callback)` — typed pub/sub between
  entities. Subscriptions are `Subscription` values that deregister when dropped, so
  they're typically stored in a `_subscriptions: Vec<Subscription>` field.

## The absence that shaped the design

:::danger[The constraint that determined everything]
**GPUI has app-level globals. It has no window-level globals.**

`cx.set_global::<T>()` exists. There is no `window.set_global::<T>()`.
:::

That single missing feature is why the override lives in an `App` global keyed by
`WindowId` rather than "on the window," where it conceptually belongs. Four options
existed:

| Option | Verdict |
|---|---|
| **A.** A `theme` field on GPUI's `Window` struct | ❌ Puts a `theme`-crate type into `gpui`, which is deliberately theme-agnostic. Would require inverting the dependency, or storing it type-erased as `Option<Arc<dyn Any>>` and downcasting on every read — a runtime cast in the renderer's hottest path. Also violates the maintainer's "don't touch gpui" constraint. |
| **B.** A GPUI window-scoped global namespace | ❌ Doesn't exist. Building it is a GPUI feature in its own right. |
| **C.** Thread `Arc<Theme>` down through render calls | ❌ The render tree isn't one call chain. Themes are read from `RenderOnce` components, `Element::paint`, delegates, and `'static` tooltip/context-menu closures invoked later. Threading means hundreds of public signature changes *and* capturing themes into stored closures where they'd go stale. |
| **D.** App global keyed by `WindowId` | ✅ Chosen. `Window` already exposes `window_handle().window_id()`, so the trait impl is three lines and GPUI is untouched. |

Costs of (D), stated honestly: one hash lookup per theme read, and manual lifecycle
management — the map would leak an `Arc<Theme>` per closed window without the
`on_window_closed` hook.

**And note that option (C) wasn't wholly rejected** — it's used at the *leaves*
(`Color::color`, `ElevationIndex::bg`), where the value is consumed immediately and
never stored. The design uses lookup at the boundary and threading below it. Being
able to say that distinction precisely is worth a lot in review.

Full treatment in [Design 01](/architecture/01-resolution/).
