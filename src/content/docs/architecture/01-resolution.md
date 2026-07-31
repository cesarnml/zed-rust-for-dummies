---
title: 01. Window theme resolution
description: WindowTheme, WindowThemeOverrides, and the five decisions inside 60 lines of code.
sidebar:
  order: 2
---

**Code:** `crates/theme/src/theme.rs`
**Commits:** `24a6c23d4d`, `0068b0ae48`
**Confidence:** High

## In plain English

Zed used to have exactly one answer to "what colours should I draw with?" — the
theme from your settings file. Every part of the UI asked the same question and got
the same answer.

To let one window look different from another, something has to remember "window #3
wants Ayu Dark," and every drawing routine has to start asking a slightly different
question: not *"what's the theme?"* but *"what's the theme **for this window**?"*

So this part of the branch adds two things. First, a lookup table — a list of
window-to-theme pairs, one entry per window with a custom theme. Second, a new way
to ask: instead of `cx.theme()` ("give me the theme"), every drawing routine now
says `window.theme(cx)` ("give me the theme for this window"). That call checks the
table; if this window is in it you get the custom theme, otherwise you get the normal
settings theme. Windows with no custom theme behave exactly as before.

The rest of this page is about *where* to keep that table, and why the apparently
trivial detail of how the lookup function is **declared** turned out to be the
difference between a manageable change and an unmanageable one.

## What the code does

```rust
pub trait WindowTheme {
    /// Returns this window's effective theme (override, or configured global).
    ///
    /// The returned reference borrows only `cx` (the theme is stored in an app
    /// global), so the window remains usable while the theme is held.
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
}

impl WindowTheme for Window {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme> {
        WindowThemeOverrides::theme(self.window_handle().window_id(), cx)
    }
}

/// Per-window theme overrides keyed by runtime [`WindowId`].
///
/// Persistence is keyed by workspace id separately; this map is only the live
/// lookup used while painting a window.
#[derive(Default)]
pub struct WindowThemeOverrides {
    themes: HashMap<WindowId, Arc<Theme>>,
}
impl Global for WindowThemeOverrides {}
```

with five associated functions: `theme` (infallible), `override_for` (`Option`),
`set`, `clear`, `apply_to_window`, `clear_for_window`.

And cleanup, registered once in `theme::init`:

```rust
cx.on_window_closed(|cx, window_id| {
    WindowThemeOverrides::clear(window_id, cx);
}).detach();
```

## Decision 1 — Where does the override live?

Four plausible homes. The full comparison is in
[the GPUI mental model](/gpui/model/#the-absence-that-shaped-the-design); the short
version:

**A. A field on GPUI's `Window`** — conceptually cleanest, and `window.theme()` would
need no `cx` at all. **Rejected:** it puts a `theme`-crate type into `gpui`, which is
deliberately theme-agnostic (it knows `Hsla`, fonts, and
`WindowBackgroundAppearance`, but nothing about Zed's `Theme`). `theme` depends on
`gpui`, not the reverse. You'd have to invert the dependency or store it type-erased
as `Option<Arc<dyn Any>>` and downcast on every read — a runtime cast in the hottest
path in the renderer. And it violates the maintainer's explicit "you should not have
to touch gpui at all."

**B. A GPUI window-scoped global** — **rejected:** doesn't exist. App globals exist;
per-window globals don't. Building one is a GPUI feature in its own right.

**C. Thread `Arc<Theme>` down through render calls** — the most functional design,
zero global state. **Rejected:** the render tree is not a single call chain. Themes
are read from `RenderOnce` components, from `Element::paint`, from delegates like
`PickerDelegate::render_match`, and from tooltip and context-menu builders that are
constructed as `'static` closures and invoked later. Threading through all of those
means changing hundreds of public component signatures *and* capturing themes into
stored closures where they'd go stale on theme change.

**D. App global keyed by `WindowId`** ✅ **Chosen.** `Window` already exposes
`window_handle().window_id()`, so the trait impl is three lines and no GPUI change is
required.

:::note[The nuance worth stating in review]
Option C wasn't wholly rejected — it's applied at the **leaves**. `Color::color`,
`ElevationIndex::bg`, and the `StyledExt` helpers all take `&impl ActiveTheme` now.
The design is *lookup at the window boundary, threading below it*, because at the
leaves the value is consumed immediately and never stored.
:::

**Costs of D, stated honestly:** one hash lookup per theme read, and manual lifecycle
management (the map would leak an `Arc<Theme>` per closed window without the hook).
Both acceptable — the lookup is a probe on a `u64`-backed key against a map whose size
equals the number of open windows, typically one to five.

**Migration path if a maintainer disagrees:** `WindowTheme::theme` is the single choke
point. Moving to a `Window` field, or adding a per-frame cache, changes that one
function and zero call sites.

## Decision 2 — The lifetime signature

This is the highest-leverage line in the patch, and it has
[its own page](/rust/lifetimes/). The short version:

```rust
fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
//           ^^^^^ no 'a here — the output does NOT borrow the window
```

Because the theme actually lives in an app global, borrowing only `cx` is **truthful**,
not a trick. And it means the window stays usable while the theme is held:

```rust
let theme = window.theme(cx);
div().bg(theme.colors().editor_background)
     .child(child.render(window, cx))     // needs &mut Window — fine
```

Had the output borrowed `self`, that last line would be a borrow-checker error at
hundreds of sites, each needing a `.clone()`.

**Confidence: very high.** This one detail is what kept a ~2,900-line migration
mechanical.

## Decision 3 — Keying by runtime `WindowId`, not workspace id

The live map is keyed by `WindowId` — a runtime handle, **not stable across
restarts**. Persistence is keyed separately by `WorkspaceId`
([Design 04](/architecture/04-persistence/)).

This directly answers osiewicz's inline review comment on #58755:

> Window ids are not guaranteed to be stable. You should not use them to identify
> windows across restarts.

**Why not key the live map by `WorkspaceId` too?** Because the render path only ever
has a `Window`. Resolving a `WorkspaceId` from a `Window` requires walking to the
`MultiWorkspace` root view and reading its active workspace entity, which is (a) an
entity read in the render path, and (b) **impossible** in windows that have no
workspace at all — the settings window, prompt windows, the audio test window.

Keying live state by the thing the render path actually holds, and translating once
at the persistence boundary, is the correct split. The doc comment says so explicitly
so a future reader doesn't try to unify the two keys.

## Decision 4 — Fallback inside the lookup, not at the call site

```rust
pub fn theme(window_id: WindowId, cx: &App) -> &Arc<Theme> {
    if let Some(theme) = Self::override_for(window_id, cx) { theme }
    else { GlobalTheme::theme(cx) }
}
```

Returns `&Arc<Theme>`, never `Option`. The fallback is baked in. `override_for`
exposes the raw `Option` for the **two** places that genuinely need to distinguish
"has an override" from "resolves to a theme": the theme selector's save/restore logic
and the deferred reapply scan.

The alternative — return `Option` and make every call site write
`.unwrap_or_else(|| cx.configured_theme())` — would be noisier *and* a correctness
hazard: one missed site silently ignores overrides.

**Infallible by default plus a narrow escape hatch.** Confidence: very high.

## Decision 5 — `apply_to_window` / `clear_for_window` as the mutation API

Setting an override requires **three** things together:

```rust
pub fn apply_to_window(window: &mut Window, theme: Arc<Theme>, cx: &mut App) {
    window.set_background_appearance(theme.window_background_appearance());  // 1
    Self::set(window.window_handle().window_id(), theme, cx);                // 2
    window.refresh();                                                        // 3
}
```

1. Tell the OS whether the window is opaque, transparent, or blurred.
2. Update the map.
3. Force a repaint.

Step 1 is the one that's easy to forget, and forgetting it produces a specific class
of bug: a transparent-or-blurred window suddenly turning opaque.
[Design 05, Decision 3](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset)
is exactly that bug, found in unrelated code.

Bundling all three means there is **exactly one correct way** to change a window's
theme. The lower-level `set`/`clear` stay public because `on_window_closed` needs
`clear` without a `Window` — the window is already gone by then.

**The wart, and how to handle it:** `set`/`clear` being public means they can be
misused. They *could* be `pub(crate)`, since the closure that needs them lives in the
same impl block. If a reviewer objects, **agree immediately** — it's a one-word change
and conceding a genuinely optional point buys credibility elsewhere.

## Residual risk

Name these before a reviewer does.

**Lookup cost in the paint loop — not measured.** A `HashMap<WindowId, _>` with ≤5
entries, probed once per theme read. Very likely noise against the
`cx.global::<GlobalTheme>()` lookup it replaces (both are `TypeId`-keyed global
fetches; this adds one small hash probe). If it ever measures badly, the fix is to
cache the resolved `Arc<Theme>` on the window's frame state at the start of paint —
one function, zero call sites.

**`Arc<Theme>` retention.** Each override holds a strong reference to a theme that may
have been removed from the registry (extension uninstalled). The window keeps
rendering with it until closed or cleared. That's arguably the *better* failure mode
— no mid-session visual snap — but it's a deliberate choice, not an accident.
See [Gap 07](/gaps/remaining/#gap-07--theme-lifecycle-and-extensions).
