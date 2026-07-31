---
title: 4. Arc, Option, Result
description: Shared ownership, absent values, and the error-handling rules this repo enforces.
sidebar:
  order: 5
---

## `Arc<T>` — shared ownership

**A**tomically **R**eference **C**ounted pointer. The closest thing Rust has to a
normal TypeScript object reference.

```rust
let theme: Arc<Theme> = ...;
let another = theme.clone();   // both now point at the same Theme
```

- `.clone()` bumps an atomic counter. It does **not** copy the theme.
- When the last `Arc` is dropped, the `Theme` is freed.
- It's thread-safe (that's the "atomic" part). The single-threaded version is `Rc`.

### Why it's everywhere in this diff

The override map is `HashMap<WindowId, Arc<Theme>>`. Several windows can share the
same theme instance. `window.theme(cx)` hands out `&Arc<Theme>`. Cloning it out of
the map to hold across a mutation is cheap.

**The reviewer question:** *"isn't cloning the theme on every render expensive?"*

**The answer:** it isn't a theme copy — `Theme` is behind an `Arc`, so `.clone()` is
one atomic increment (a few nanoseconds). And in the common case there's no clone at
all, because [the lifetime signature](/rust/lifetimes/) lets call sites hold the
borrow directly.

### `Arc` versus `&`

| | `Arc<Theme>` | `&Theme` |
|---|---|---|
| Owns the data? | Yes, shared | No, borrowed |
| Can outlive the source? | Yes | No |
| Can go in a struct field? | Yes | Only with a lifetime parameter (painful) |
| Cost | Refcount on clone/drop | Free |

The diff uses `&Arc<Theme>` for reads and `Arc<Theme>` for storage. When a helper
just wants to read colours, it takes `&impl ActiveTheme` — which resolves to
`&Arc<Theme>` — so nothing is cloned.

### `SharedString`

Zed's string type: either a `&'static str` or an `Arc<str>`. Same idea as `Arc`,
applied to strings, so passing a theme name around doesn't allocate.

```rust
pub struct Workspace {
    theme_override: Option<SharedString>,
}
```

Why `SharedString` here? `Theme::name` is already a `SharedString`, and
`set_window_theme` receives an `Arc<Theme>`. Storing it as `SharedString` is a
refcount bump rather than a heap allocation. The database layer uses `String`
because that's what `sqlez` binds — so you'll see `.to_string()` at the boundary,
four times in the whole branch.

## `Option<T>` — the absent value

```rust
enum Option<T> { Some(T), None }
```

TypeScript's `T | undefined`, except **you cannot forget to handle the absent case**
— the compiler makes you unwrap it explicitly.

### In this diff

```rust
pub fn override_for(window_id: WindowId, cx: &App) -> Option<&Arc<Theme>> {
    cx.try_global::<Self>()
        .and_then(|this| this.themes.get(&window_id))
}
```

`try_global` returns `Option` (the global may not be set yet); `.and_then` is
exactly TypeScript's optional chaining — if it's `None`, stop; if it's `Some`, run
the closure.

### The important design decision around `Option` here

`WindowThemeOverrides` has **two** lookups, deliberately:

```rust
// Infallible — used by every render site. Falls back internally.
pub fn theme(window_id: WindowId, cx: &App) -> &Arc<Theme> {
    if let Some(theme) = Self::override_for(window_id, cx) { theme }
    else { GlobalTheme::theme(cx) }
}

// Fallible — used by exactly two places that need to distinguish.
pub fn override_for(window_id: WindowId, cx: &App) -> Option<&Arc<Theme>> { ... }
```

The alternative — return `Option` and make every call site write
`.unwrap_or_else(|| cx.configured_theme())` — would be both noisier *and* a
correctness hazard: one missed site silently ignores overrides.

**Infallible by default, narrow escape hatch for the two callers that genuinely
need the distinction** (the selector's save/restore logic, and the
[deferred reapply scan](/architecture/06-deferred/)). That's the pattern, and it's
worth being able to articulate.

### Idioms you'll see

```rust
self.theme_override.as_ref()                        // Option<T> → Option<&T>
theme_override.map(SharedString::from)              // transform the inner value
serialized.as_ref().and_then(|w| w.theme_override.clone())  // chain
workspace.theme_override().is_some()                // just a boolean
let Some(workspace) = Workspace::for_window(window, cx) else { return };  // let-else
```

That last one — `let ... else` — is Rust's early-return destructuring. It appears in
`reapply_pending_window_theme_overrides` and reads as: "bind it, or bail."

## `Result<T, E>` and `?`

```rust
enum Result<T, E> { Ok(T), Err(E) }
```

Rust has no exceptions. Fallible functions return `Result`, and `?` is the
early-return operator:

```rust
let theme = registry.get(name)?;   // if Err, return that error from this function
```

TS analogy: `?` is roughly `await` on a promise that can reject, if `await`
propagated rejections by returning them instead of throwing.

### This repository's rules about errors

`CLAUDE.md` in the Zed repo is explicit, and a reviewer may well check you against
it:

> Never silently discard errors with `let _ =` on fallible operations.
> - Propagate errors with `?` when the calling function should handle them
> - Use `.log_err()` or similar when you need to ignore errors but want visibility
> - Use explicit error handling with `match` or `if let Err(...)` when you need
>   custom logic

The branch follows this at every error site. The three patterns it uses:

**1. Propagate.** Not much of this in the branch — most theme paths are infallible.

**2. Log and continue.** The registry lookup on restore:

```rust
match ThemeRegistry::global(cx).get(theme_name) {
    Ok(theme) => { ...; return; }
    Err(error) => {
        log::error!("failed to load window theme override {}: {}", theme_name, error);
    }
}
WindowThemeOverrides::clear_for_window(window, cx);   // fall back to configured
```

A missing theme isn't fatal — fall back to the configured theme and record why.

**3. Detach with logging.** The database writes:

```rust
cx.background_spawn(async move { db.set_theme_override(database_id, Some(name)).await })
    .detach_and_log_err(cx);
```

This is the idiom `CLAUDE.md` prescribes. `.detach()` alone would discard the error;
`.detach_and_log_err(cx)` lets the task run to completion and logs any failure. A
failed persist isn't worth interrupting the user mid-session, but it must not vanish.

:::caution[One place a reviewer may flag]
`reapply_pending_window_theme_overrides` ends with `.ok()`:

```rust
window.update(cx, |_, window, cx| { ... }).ok();
```

This discards a `Result` — exactly what the repo rules call out. The defence: it's
the established idiom for iterating `cx.windows()`, because a window can close
between enumeration and update, and that failure is genuinely uninteresting. But
know it's there, and be ready to add a one-line comment if asked. Don't be
surprised by it.
:::

## `HashMap`

```rust
use collections::HashMap;   // Zed's re-export, not std's

pub struct WindowThemeOverrides {
    themes: HashMap<WindowId, Arc<Theme>>,
}
```

Standard hash map. Zed re-exports its own from the `collections` crate (usually a
faster hasher). Methods used in the branch: `.get(&key)`, `.insert(key, value)`,
`.remove(&key)`.

**The performance question you should expect:** *"you added a hash lookup to the
render path — did you measure it?"*

**The honest answer:** no, it wasn't measured. The reasoning is that this replaces a
`TypeId`-keyed global fetch with a `TypeId`-keyed global fetch **plus** one probe
into a map whose size equals the number of open windows — typically one to five, keyed
on a `u64`. That's very likely noise. If a maintainer wants it gone, the fix is to
cache the resolved `Arc<Theme>` on the window's frame state at the start of paint,
which changes zero call sites because `WindowTheme::theme` is the only entry point.

Saying "I didn't measure it, here's why I think it's fine, and here's the fix if
it isn't" is a much better answer than a confident guess.
