---
title: 'Hour 12: Capstone — build the PR in miniature'
description: A global theme, per-window overrides, and a trait split in two. About 150 lines, no GPUI.
sidebar:
  order: 13
---

Everything in the previous eleven hours exists to make this hour possible.

You are going to build a tiny program with the same architecture as the 307-file
PR: a global theme, an override map keyed by window, a trait deliberately split so
that "the theme for this window" and "the theme from settings" are different
questions, and an accessor whose lifetime ties its result to the app rather than
the window.

No GPUI, no async, no editor. Just the shape.

## Step 1 — the data

```rust
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, PartialEq)]
pub struct Theme {
    pub name: String,
    pub background: u32,
}

impl Theme {
    fn new(name: &str, background: u32) -> Self {
        Self { name: name.to_string(), background }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WindowId(pub u64);

pub struct Window {
    pub id: WindowId,
    pub title: String,
    pub repaints: u32,
}

pub struct App {
    /// The theme from settings. One per app.
    configured: Arc<Theme>,
    /// Per-window overrides. Absence means "use the configured one".
    overrides: HashMap<WindowId, Arc<Theme>>,
}
```

`WindowId` is a newtype so it cannot be confused with any other `u64`, and it
derives `Hash + Eq` so it can key the map. `Arc<Theme>` because many windows share
one theme and none of them owns it.

## Step 2 — the split trait

This is the design decision the whole PR is about. Two traits, not one:

```rust
use std::sync::Arc;

pub struct Theme;
pub struct App;
pub struct Window;

/// "What does the settings file say?" — answerable without a window.
pub trait ConfiguredTheme {
    fn configured_theme(&self) -> &Arc<Theme>;
}

/// "What should THIS window render with?" — needs a window.
pub trait WindowTheme {
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme>;
}
```

The point of splitting is that the two questions have different answers, and code
that wants the global one should have to *say so*. In the real PR, the old
`ActiveTheme` trait answered both, and deleting it is what produced 1,800 compile
errors — each one a call site being asked "which did you actually mean?".

Note the lifetime on `WindowTheme::theme` — [hour 9](/crash/09-lifetimes/)'s
override. The result borrows `app`, not `self`.

## Step 3 — put it together

Here is the whole program. Type it, run it, then start breaking it.

```rust
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, PartialEq)]
pub struct Theme {
    pub name: String,
    pub background: u32,
}

impl Theme {
    fn new(name: &str, background: u32) -> Self {
        Self { name: name.to_string(), background }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WindowId(pub u64);

pub struct Window {
    pub id: WindowId,
    pub title: String,
    pub repaints: u32,
}

pub struct App {
    configured: Arc<Theme>,
    overrides: HashMap<WindowId, Arc<Theme>>,
}

pub trait ConfiguredTheme {
    fn configured_theme(&self) -> &Arc<Theme>;
}

pub trait WindowTheme {
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme>;
}

impl ConfiguredTheme for App {
    fn configured_theme(&self) -> &Arc<Theme> {
        &self.configured
    }
}

impl WindowTheme for Window {
    /// The resolution rule, in one line: this window's override, or the
    /// configured theme.
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme> {
        app.overrides
            .get(&self.id)
            .unwrap_or_else(|| app.configured_theme())
    }
}

impl App {
    pub fn new(configured: Theme) -> Self {
        Self { configured: Arc::new(configured), overrides: HashMap::new() }
    }

    pub fn set_window_theme(&mut self, id: WindowId, theme: Theme) {
        self.overrides.insert(id, Arc::new(theme));
    }

    pub fn clear_window_theme(&mut self, id: WindowId) {
        self.overrides.remove(&id);
    }

    /// Called when a window closes, so the map doesn't leak entries.
    pub fn on_window_closed(&mut self, id: WindowId) {
        self.clear_window_theme(id);
    }

    pub fn set_configured_theme(&mut self, theme: Theme) {
        self.configured = Arc::new(theme);
    }
}

/// A render pass: reads the theme, then mutates the window. This function only
/// compiles because `theme` borrows `app` rather than `window`.
fn render(window: &mut Window, app: &App) -> String {
    let theme = window.theme(app);
    let line = format!("{} -> {} (#{:06x})", window.title, theme.name, theme.background);
    window.repaints += 1;
    line
}

fn main() {
    let mut app = App::new(Theme::new("Ayu Dark", 0x0f1419));

    let mut production = Window { id: WindowId(1), title: "production".into(), repaints: 0 };
    let mut staging = Window { id: WindowId(2), title: "staging".into(), repaints: 0 };

    println!("{}", render(&mut production, &app));
    println!("{}", render(&mut staging, &app));

    // Give staging its own theme — the entire point of the feature.
    app.set_window_theme(staging.id, Theme::new("Rosé Pine Dawn", 0xfaf4ed));
    println!("--- after override ---");
    println!("{}", render(&mut production, &app));
    println!("{}", render(&mut staging, &app));

    // Changing settings moves the windows that have no override, and only those.
    app.set_configured_theme(Theme::new("One Dark", 0x282c34));
    println!("--- after settings change ---");
    println!("{}", render(&mut production, &app));
    println!("{}", render(&mut staging, &app));

    app.clear_window_theme(staging.id);
    println!("--- after clear ---");
    println!("{}", render(&mut staging, &app));

    println!("repaints: {} / {}", production.repaints, staging.repaints);
}
```

Expected output:

```
production -> Ayu Dark (#0f1419)
staging -> Ayu Dark (#0f1419)
--- after override ---
production -> Ayu Dark (#0f1419)
staging -> Rosé Pine Dawn (#faf4ed)
--- after settings change ---
production -> One Dark (#282c34)
staging -> Rosé Pine Dawn (#faf4ed)
--- after clear ---
staging -> One Dark (#282c34)
repaints: 3 / 4
```

## What you just built, mapped to the diff

| Your line | The PR |
|---|---|
| `trait WindowTheme { fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme> }` | [The load-bearing signature](/rust/lifetimes/) |
| `trait ConfiguredTheme` | The half of `ActiveTheme` that survived on `App` |
| `overrides.get(&self.id).unwrap_or_else(...)` | [Window theme resolution](/architecture/01-resolution/) |
| `HashMap<WindowId, Arc<Theme>>` | The override map, keyed the same way |
| `on_window_closed` | [Lifecycle](/architecture/05-lifecycle/) — the leak this prevents |
| `render` reading the theme then mutating the window | ~1,800 call sites |

The real PR adds: persistence keyed by workspace rather than window, deferred
resolution for windows that open before settings load, layering of user
`theme_overrides` on top, and the small matter of rewriting 1,800 call sites. The
skeleton is what you just typed.

## Break it on purpose

These four experiments are worth more than another hour of reading.

**1. Remove the lifetime override.** Change the trait method to
`fn theme(&self, app: &App) -> &Arc<Theme>`. `render` stops compiling:

```
error[E0502]: cannot borrow `*window` as mutable because it is also borrowed as immutable
```

That is the entire argument for that annotation, reproduced in a program you
understand completely.

**2. Merge the traits back together.** Put both methods in one trait implemented for
`App`, and try to write `render` without a window parameter. You will find yourself
unable to express "this window's theme" — which is why the split exists.

**3. Delete `ConfiguredTheme`'s impl** and watch the compiler enumerate every use.
Count them. Now imagine that number is 1,800 and you have the migration.

**4. Swap `Arc<Theme>` for `Theme`.** The map now owns its themes, `theme()` cannot
return a reference into `app` without a fight, and every share becomes a deep copy.
This is the experiment that makes `Arc` stop feeling like ceremony.

## Extensions, if you have appetite

- Add `theme_overrides: HashMap<String, u32>` to `App` and apply it on top of the
  resolved theme before returning — that is
  [design 07](/architecture/07-layering/), and it will force you to return
  `Arc<Theme>` by value instead of `&Arc<Theme>`. Notice how much that changes.
- Add a `WorkspaceId` newtype and persist overrides by workspace instead of window,
  then reopen a "workspace" and restore. That is
  [design 04](/architecture/04-persistence/) and its whole bug class.
- Wrap `App` in `Arc<Mutex<App>>` and drive two windows from two threads.

## You are done

Go read [Rust, for a TypeScript brain](/rust/how-to-use/). It opens with five
questions you should now be able to answer out loud — and if you can, you can defend
the PR.
