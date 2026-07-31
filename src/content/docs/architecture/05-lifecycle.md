---
title: 05. Lifecycle and background
description: Five apply sites, one cleanup hook, and the bug that justifies the whole migration.
sidebar:
  order: 6
---

**Code:** `crates/workspace/src/workspace.rs`, `crates/workspace/src/multi_workspace.rs`,
`crates/zed/src/main.rs`, `crates/theme/src/theme.rs`
**Commits:** `f7cd40b816`, `04b9f24065`
**Confidence:** High on placement, medium on the multi-workspace product semantics

## In plain English

Picking a theme is the easy part. Keeping it applied is where the work is, because a
window's contents change over its life and other code is busy resetting window state
for its own reasons.

Three problems, three fixes:

**Applying it at the right moments.** There are several ways a project ends up on
screen — opened fresh, restored at startup, opened by id, or switched to as a tab
inside a window already holding other projects. Each needs to repaint with the right
theme. That last case is notable: Zed can put several projects in one window, and
since the theme belongs to the *project*, switching tabs repaints the whole window.
That's intentional, but it's a loud visual event and maintainers should confirm they
want it.

**Cleaning up.** The lookup table would otherwise keep an entry for every window
you've ever closed, holding a theme nobody can see. Worse, if the system ever reuses a
window's internal number, a brand-new window could inherit a dead one's theme. One
four-line hook fixes it.

**Stopping unrelated code from undoing it.** This one was a real bug — and it's the
best evidence on the branch for why the enormous migration earned its size.

## Decision 1 — Where `apply_window_theme` is called

Five sites:

| Site | Why |
|---|---|
| `MultiWorkspace::new` (`multi_workspace.rs:351`) | Every window that gets a workspace at construction |
| `MultiWorkspace::activate` (`multi_workspace.rs:1529`) | Switching the active workspace *within* a window |
| `Workspace::open_workspace`, new-window path (`workspace.rs:2108`) | Restore into a freshly opened window |
| `open_workspace_by_id`, new-window path (`workspace.rs:10517`) | Same, for the by-id entry point |
| `reapply_pending_window_theme_overrides` (`main.rs:1863`) | Late resolution — [Design 06](/architecture/06-deferred/) |

### The `activate` call is the interesting one

Zed's multi-workspace mode puts several workspaces in one platform window. The
override is stored **per workspace** but applied **per window**, so switching the
active workspace must repaint with the incoming workspace's theme.

```rust
self.active_workspace.update(cx, |workspace, cx| {
    workspace.refresh_window_state(window, cx);
    workspace.apply_window_theme(window, cx);
});
```

It's placed next to the existing `refresh_window_state` call, which exists for exactly
the analogous reason — window title and edited-indicator are per-window but owned by
the active workspace. **The pattern was already established**, so following it is both
correct and legible to a reviewer. That's a good thing to point at: you didn't invent
a convention, you extended one.

**Alternative considered:** store the override per *window* rather than per workspace,
so switching tabs doesn't change the theme. **Rejected** because the user model is
"this project gets this theme" — the whole point is telling a production checkout from
a staging one, and if the theme doesn't follow the project into a shared window the
feature stops distinguishing anything.

It does mean the window's chrome colour changes on tab switch, which is a deliberate,
visible consequence. **Surface it to maintainers rather than hoping they don't
notice.** See [Gap 06](/gaps/remaining/#gap-06--multi-workspace-tab-switch-semantics).

### Residual risk worth naming

`refresh_window_state` and `apply_window_theme` are two separate calls at the switch
site. Anyone adding a third piece of per-window state owned by the active workspace
will need to remember a third call.

Folding `apply_window_theme` into `refresh_window_state` was **considered and
rejected** because `refresh_window_state` is called from other places where a theme
reapply would be wasted work — but it's a legitimate thing for a reviewer to prefer,
and conceding it is cheap.

## Decision 2 — Cleanup on window close

```rust
// registered once in theme::init
cx.on_window_closed(|cx, window_id| {
    WindowThemeOverrides::clear(window_id, cx);
}).detach();
```

Without it, `WindowThemeOverrides.themes` grows by one entry per closed overridden
window for the process lifetime, each holding a strong `Arc<Theme>` — a slow leak, and
worse, **a correctness hazard if GPUI ever recycles `WindowId` values** (a new window
could inherit a dead window's theme).

### Alternatives

**A — Prune lazily on lookup.** Would require the read path to know the live window
set and would put a scan in the render path. No.

**B — Prune on each `set`.** Cheaper than (A) but still O(open windows) per set, and
only runs when someone sets a theme — a session that sets one override then opens and
closes 50 windows never prunes.

**C — Explicit clear at every window teardown site.** Fragile; there are several paths
a window can die by, including crashes of the workspace entity.

`on_window_closed` is the event that exists precisely for this, registered at the one
place that owns the map.

**Confidence: very high.** One acknowledged cost: registering it in `theme::init` means
`theme` now subscribes to window lifecycle, a small widening of that crate's
responsibility. The alternative is exporting the cleanup and hoping callers run it.

## Decision 3 — The settings-observer background reset

:::tip[Your best single anecdote in review]
This bug is the concrete answer to "why is this diff so big." Learn it well enough to
tell it conversationally.
:::

**The bug.** `main.rs` has a global settings observer that loops over **every** window
and reapplies the window background appearance. It read the *configured* theme:

```rust
// before
for &mut window in cx.windows().iter_mut() {
    let background_appearance = cx.theme().window_background_appearance();
    window.update(cx, |_, window, _| window.set_background_appearance(background_appearance)).ok();
}
```

So **any settings change at all** — editing a keybinding, toggling a setting, a theme
file reloading — would reset every overridden window's background to the configured
theme's appearance. If the override was opaque and the configured theme transparent
(or vice versa), the window visibly changed and stayed wrong until something else
repainted it.

**The fix** resolves per window:

```rust
// Resolve each window's effective theme (honoring any per-window override) so an
// unrelated settings change does not reset an overridden window's background to
// the configured theme.
let background_appearance =
    theme::WindowThemeOverrides::theme(window.window_id(), cx)
        .window_background_appearance();
```

### Why this is the argument for the migration's size

Read the shape of that call site carefully:

- **It is not a render function.** No audit of "the drawing code" would include it.
- **It has no `Window` in scope.** It iterates `cx.windows()` and holds only
  `WindowId` values.
- **It looked completely normal.** `cx.theme().window_background_appearance()` is an
  unremarkable line.

A migration that rewrote `cx.theme()` → `window.theme(cx)` *where a `Window` happened
to be in scope* would have sailed straight past it. It was found because **deleting
`impl ActiveTheme for App` made it fail to compile**, forcing a human to read it and
decide what it should do.

That's the case for [Design 02](/architecture/02-active-theme-split/), made concrete.
"The compiler enumerates the work" isn't an abstraction — it produced this fix.

**Alternative considered:** have `apply_to_window` re-assert the background on a timer
or every frame. **Rejected** — the correct fix is for the code that resets the
background to compute the right value, not to fight it.

**Confidence: very high.**

## Decision 4 — `apply_to_window` bundles the background appearance

Covered in [Design 01, Decision 5](/architecture/01-resolution/#decision-5--apply_to_window--clear_for_window-as-the-mutation-api),
restated here because it's the other half of Decision 3.

The reason `set_background_appearance` lives *inside* `apply_to_window` is precisely
that forgetting it produces the class of bug above. The two changes were made in the
same commit (`04b9f24065`) for that reason — one is the fix, the other is the
prophylactic.

## Residual risk

- **Windows opened *from* an overridden window** — the settings window, prompt windows
  — do not inherit the override. See
  [Gap 05](/gaps/remaining/#gap-05--windows-without-a-workspace).
- **The two-call pattern at `activate`**, discussed under Decision 1.
