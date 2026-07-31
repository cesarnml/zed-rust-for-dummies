---
title: 03. Scoping the theme selector
description: One picker, two scopes, four exits — and the subtlest bug on the branch.
sidebar:
  order: 4
---

**Code:** `crates/theme_selector/src/theme_selector.rs`, `crates/zed_actions/src/lib.rs`
**Commits:** `f7cd40b816`, `56b9ac4223`, `04b9f24065`
**Confidence:** High

## In plain English

Zed's theme picker already does something slightly clever: as you arrow up and down
the list, the whole app repaints in each theme so you can see it before committing.
Hit Enter and it writes your choice to `settings.json`; hit Escape and it puts
everything back.

This branch adds a second picker that looks identical but writes somewhere else — to
this window only, not to your settings file. Rather than build a second picker, the
existing one was taught which of the two it currently is, and the handful of places
that actually *write* something branch on that.

The interesting part is what "put everything back" now has to mean, because there are
more states to keep straight. Two examples:

**The one that would have silently corrupted settings.** You set window A to Ayu
Dark. Later, in window A, you open the *normal* theme picker and immediately hit Enter
without moving. The picker starts out pointing at "whatever theme I'm currently
showing" — which in window A is Ayu Dark, the window override. So confirming would
write `"theme": "Ayu Dark"` into your settings file. **You opened and closed a picker
and your global settings changed.**

**The one where preview stops working.** A window with a custom theme ignores your
settings, so the normal picker's preview — which works by temporarily changing
settings — would do nothing at all in that window. You'd scroll through forty themes
watching a completely static screen.

## What the code adds

```rust
// crates/zed_actions/src/lib.rs
pub struct ToggleWindowTheme { pub themes_filter: Option<Vec<String>> }
pub struct ClearWindowTheme;

// crates/theme_selector/src/theme_selector.rs
#[derive(Clone, Copy, PartialEq, Eq)]
enum ThemeSelectorScope { Global, Window }
```

`ThemeSelectorDelegate` gains three fields:

```rust
/// Window-scope: theme that was active for this window before the picker opened.
original_window_theme: Arc<Theme>,
/// Window-scope: whether the window already had an override before the picker opened.
original_had_window_override: bool,
/// Whether this picker writes a window override or global settings.
scope: ThemeSelectorScope,
```

Every mutation path — `set_theme`, `confirm`, `revert_theme` — branches on `scope`.

## Decision 1 — One delegate with a scope enum, not two picker types

**A — A separate `WindowThemeSelector` type.** Clean separation, no branching.
**Rejected:** the two selectors share ~90% of their behaviour — fuzzy matching over
the same `ThemeRegistry`, live preview on selection change, appearance-aware sorting,
the docs-link footer, selection restoration on empty filter. Duplicating that is a
maintenance trap where a fix to one silently misses the other.

**B — A `window_scoped: bool` field.** Same thing, worse. The enum reads correctly at
match sites and leaves room for a third scope later (a project scope has been
suggested upstream).

**C — Scope as a field on the existing `Toggle` action**, e.g.
`Toggle { scope: "window" }`. **Rejected** for two reasons: keymap and
command-palette entries are per-action, and users need two distinct, discoverable,
individually-bindable commands. And the action carries `#[serde(deny_unknown_fields)]`,
so changing its schema breaks round-trips for nobody's benefit.

**Confidence: high.**

## Decision 2 — What the global selector is seeded with

:::danger[The subtlest bug on the branch]
This was found by reasoning about the state machine, not by testing. Commit
`56b9ac4223`.
:::

```rust
let original_theme = match scope {
    // The global selector edits `settings.json`, so it must be seeded
    // with the configured theme rather than this window's effective
    // theme; otherwise, in a window that has a per-window override,
    // confirming without navigating would write the override theme
    // into the global settings.
    ThemeSelectorScope::Global => cx.configured_theme().clone(),
    ThemeSelectorScope::Window => original_window_theme.clone(),
};
```

**The failure it prevents:** a user sets window A to "Ayu Dark" while `settings.json`
says "One Dark." Later, in window A, they open the *normal* theme selector and hit
Enter without moving the cursor. `new_theme` was seeded from `cx.theme()` — which,
post-migration, resolves to the window's effective theme — so confirming writes
`"theme": "Ayu Dark"` into `settings.json`.

The user did nothing but open and close a picker, and their global settings changed.

**The rule:** seed each selector from the thing it *writes to*. The global selector
from configured settings, the window selector from the window's effective theme.

**Confidence: very high.** Keep the comment. The next person to touch seeding will
otherwise "simplify" it back — it looks redundant until you know the failure.

:::tip[Use this in review]
This is a good thing to volunteer unprompted. It demonstrates that the state machine
was reasoned about rather than shipped on first green build, and it's a concrete,
checkable claim rather than a general assurance.
:::

## Decision 3 — Live preview when a window override is already present

The global selector previews by mutating in-memory settings
(`store.override_global(...)`). But a window with an override **ignores global
settings entirely** — so on that window, the global selector's preview shows nothing.
The user arrows through 40 themes watching a static window, then confirms and sees no
change (correctly — the override still wins).

The fix layers a *temporary* window override on top during preview and restores the
real one afterwards:

```rust
// A window override would mask the preview, so temporarily
// paint the previewed theme over it; it is restored on
// confirm or dismiss.
if self.original_had_window_override {
    let effective = Self::with_configured_overrides(new_theme.clone(), cx);
    theme::WindowThemeOverrides::apply_to_window(window, effective, cx);
}
```

with `restore_window_override` called on both `confirm` and `revert_theme`.

### Alternatives

**A — Disable preview in overridden windows.** Simplest. **Rejected:** preview *is*
the value of the theme selector; silently losing it in some windows is worse than the
bug.

**B — Clear the override for the picker's duration, restore on close.** Equivalent in
visible effect and slightly simpler (a clear + restore instead of a temporary set).
**Rejected** because it makes the window flash to the configured theme the instant the
picker opens, before the user has selected anything — a visible artefact for a picker
they might immediately dismiss.

**C — Refuse to open the global selector in an overridden window.** Hostile.

**Confidence: high on approach, medium on completeness.** The state machine now has
**four exits** — `confirm` (Global), `confirm` (Window), `dismissed`, and
`on_before_dismiss` — and each must leave the window consistent. They all funnel
through `revert_theme` / `restore_window_override`, and two tests cover the
window-scope confirm and dismiss paths.

:::caution[Know your weakest spot]
The **global-scope confirm inside an overridden window** path is exercised only by
reading the code. A test for it would be cheap and it is the most likely place for a
residual bug. If a reviewer asks about test coverage, name this yourself — it's better
than being told.
:::

## Decision 4 — `selection_completed` as the revert guard

`revert_theme` early-returns when `selection_completed` is set; `confirm` sets it
first thing. This existed before the branch but now guards more state, because
`ModalView::on_before_dismiss` *also* calls `revert_theme`. So on a confirm the
sequence is: `confirm()` sets the flag and applies, then `on_before_dismiss()` sees
the flag and does nothing.

Without it, confirming would immediately undo itself.

The branch restructured `revert_theme` from `if !completed { ...; completed = true }`
to a guard clause plus a `match`, which is what makes the two-scope bodies readable.
Behaviourally identical.

**Confidence: very high.**

## Decision 5 — Confirm routes through `Workspace`, with a fallback

```rust
if let Some(workspace) = Workspace::for_window(window, cx) {
    workspace.update(cx, |workspace, cx| workspace.set_window_theme(theme, window, cx));
} else {
    // No workspace to persist through; still layer configured
    // overrides so the preview and confirm look identical.
    let effective = Self::with_configured_overrides(theme, cx);
    theme::WindowThemeOverrides::apply_to_window(window, effective, cx);
}
```

The selector deliberately **does not persist anything itself**. `Workspace` owns the
`WorkspaceId` and the DB handle, so persistence belongs there
([Design 04](/architecture/04-persistence/)). The selector's job ends at "apply to this
window."

The `else` branch matters: the window theme selector *can* be dispatched in a window
with no workspace. Rather than doing nothing (confusing) or erroring (hostile), it
applies for the session and simply doesn't persist. That's the right degradation —
though it is currently **silent**, and a maintainer might reasonably want a toast.
Noted in [Gap 05](/gaps/remaining/#gap-05--windows-without-a-workspace).

## Decision 6 — Telemetry event name

```rust
telemetry::event!("Window Theme Changed", value = theme_name);
```

The global path fires `"Settings Changed", setting = "theme"`. Reusing it for window
scope would **corrupt the existing metric** — a window theme is explicitly *not* a
settings change, and mixing them inflates the "users change their theme" series with a
different behaviour.

**Confidence: medium** — the reasoning is sound, the naming is a guess at upstream
conventions. New telemetry event names are a product/privacy decision, not an
engineering one. Flag it for maintainers rather than defending it.
See [Gap 08](/gaps/remaining/#gap-08--telemetry-settings-surface-and-discoverability).

## Test coverage as written

```rust
#[gpui::test]
async fn test_window_theme_selection_and_clear(cx: &mut TestAppContext)
```
Confirm applies to the window, does **not** touch the configured theme, and records
`theme_override` on the workspace. `ClearWindowTheme` restores and clears both.

```rust
#[gpui::test]
async fn test_window_theme_dismiss_reverts_preview(cx: &mut TestAppContext)
```
Preview applies on selection change; dismiss reverts it.

**Not covered**, in rough priority order — say these before you're asked:

1. Global-scope confirm inside an overridden window (Decision 3).
2. The no-workspace fallback branch (Decision 5).
3. Two windows with different overrides open simultaneously.
