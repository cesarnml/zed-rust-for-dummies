---
title: 07. Layering theme_overrides
description: The rule that makes the feature unsurprising — a per-window theme looks exactly like that theme set globally.
sidebar:
  order: 8
---

**Code:** `crates/theme_selector/src/theme_selector.rs` (`with_configured_overrides`),
`crates/workspace/src/workspace.rs` (`apply_window_theme`, `set_window_theme`)
**Commit:** `04b9f24065`
**Confidence:** High

## In plain English

Zed lets you patch individual colours of whatever theme you're using — "I like One
Dark but I want the editor background a bit darker" — via a `theme_overrides` block in
your settings. Those patches get applied on top of the theme every time Zed resolves
it.

The per-window path originally skipped that step. It grabbed the theme straight out of
the catalogue and used it as-is. So if you had personal colour patches and you set a
window to the *same theme you already use*, the window would look subtly different —
your patches were gone. Confusing enough that it reads as a rendering bug rather than a
missing feature.

The fix is one line applied in four places: run the per-window theme through the same
patching step the global theme goes through. The rule this settles on is simple and
easy to explain to users:

> **A per-window theme looks exactly like that theme would look if you'd set it
> globally.**

One subtlety worth keeping straight: the *saved* value is still just the plain theme
name, and the patching happens fresh each time the theme is applied. So if you later
edit your colour patches, overridden windows pick that up too — the patches aren't
baked in at the moment you chose the theme. (They're not picked up *instantly*, which
is a known small gap — [Gap 03](/gaps/remaining/#gap-03--theme_overrides-dont-live-reload).)

## The problem

Zed users can patch any theme from settings:

```jsonc
{
  "theme_overrides": { "editor.background": "#101014" },
  "experimental.theme_overrides": { /* ... */ }
}
```

`ThemeSettings::apply_theme_overrides(theme)` applies those patches, and the global
theme path runs every resolved theme through it — **deep inside `configured_theme()`**,
which is exactly why it's easy to miss.

The per-window path pulled the raw theme straight out of `ThemeRegistry` and applied
it. A user with `theme_overrides` set would find that picking the *same theme*
per-window looked different from having it configured globally.

## The fix

One helper, applied at every place a window theme is resolved:

```rust
/// Layers the user's configured theme overrides (`theme_overrides` /
/// `experimental_theme_overrides`) onto a raw registry theme, so a per-window
/// theme matches what the same theme looks like when configured globally.
fn with_configured_overrides(theme: Arc<Theme>, cx: &App) -> Arc<Theme> {
    ThemeSettings::get_global(cx).apply_theme_overrides(theme)
}
```

Four call sites:

| Site | Why |
|---|---|
| `ThemeSelectorDelegate::set_theme` | So the **preview** is layered |
| `ThemeSelectorDelegate::confirm` (no-workspace fallback) | So confirm matches the preview |
| `Workspace::set_window_theme` | The live apply |
| `Workspace::apply_window_theme` | The restore-from-disk apply |

Every one carries a comment to the same effect.

## Decision 1 — Layer configured overrides rather than ignoring them

The alternative reading is defensible on its face: `theme_overrides` is scoped to "the
theme you configured," and a per-window theme is a *different* theme, so the patches
shouldn't apply.

**Rejected.** In practice, `theme_overrides` is how users express personal colour
preferences they want *everywhere* — a dimmer editor background, a different accent.
Dropping them the moment a window gets its own theme means the feature actively fights
the user's existing configuration.

The principle chosen — *a per-window theme should look exactly like that theme would
look if you set it globally* — is the least surprising rule and the easiest to
document.

**The counter-case, acknowledged:** a user whose `theme_overrides` are tuned to one
specific theme may find they look broken on another. That's real, **but it already
exists today** — those same overrides apply if the user switches themes globally, or
when Zed switches between light and dark. Per-window themes don't introduce that
problem, they inherit it.

**Confidence: high.** This is the kind of decision that reads as obvious after the fact
but was a genuine bug for two commits.

## Decision 2 — Persist the raw name, apply the layered theme

`set_window_theme` is explicit about the asymmetry:

```rust
self.theme_override = Some(theme.name.clone());
// Persist the raw theme name, but paint the window with the user's
// configured overrides layered on (matching the global theme path).
let effective_theme = ThemeSettings::get_global(cx).apply_theme_overrides(theme.clone());
WindowThemeOverrides::apply_to_window(window, effective_theme, cx);
```

The stored identity is the **choice** ("Ayu Dark"); the layering is a **derivation**
applied fresh each time. That means editing `theme_overrides` in settings takes effect
on overridden windows too — on the next apply — rather than being frozen at the moment
the user picked the theme.

The alternative (persist the layered result) is the same mistake as persisting a
serialized `Theme` — see
[Design 04, Decision 1](/architecture/04-persistence/#decision-1--persist-the-theme-name-not-the-resolved-theme).

**Confidence: very high.**

## Decision 3 — Duplicated helper vs shared utility

`with_configured_overrides` exists as a private associated function on
`ThemeSelectorDelegate`, and `workspace.rs` inlines the identical
`ThemeSettings::get_global(cx).apply_theme_overrides(theme)` call twice.

**That is three copies of a one-line expression across two crates.**

It was left that way rather than adding a shared helper because the shared home would
have to be `theme_settings` (which both depend on), and adding public API surface there
for a one-line composition is more surface than it saves.

**If a fourth site appears**, promoting it to
`ThemeSettings::themed_for_window(name, cx) -> Option<Arc<Theme>>` would be the right
move — returning the registry lookup *and* the layering, folding in the
`ThemeRegistry::global(cx).get(...)` step that `apply_window_theme` currently does
separately.

**Confidence: medium.** Defensible either way; a reviewer preferring the shared helper
is not wrong. **Flag it as an intentional choice rather than an oversight** — that's the
difference between "I thought about this" and "I didn't notice."

## Residual risk

The layering does **not** currently reapply when `theme_overrides` themselves change in
settings.

The settings observer in `main.rs` recomputes background appearance per window
([Design 05](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset))
but does not rebuild the overridden window's theme. So editing `theme_overrides` while
an overridden window is open updates the non-overridden windows and leaves the
overridden one **stale until the next apply** — a workspace switch, a restart, or a
re-selection.

This is a known gap rather than an unknown one, and it didn't make the cut because the
fix has a subtlety: reapplying on every settings change would collide with an
in-progress theme-selector preview in exactly the way described in
[Design 06, Decision 2](/architecture/06-deferred/#decision-2--the-pending-predicate),
so it needs the same kind of guard — and that guard needs a "preview in progress"
concept that doesn't exist yet.

Recorded as [Gap 03](/gaps/remaining/#gap-03--theme_overrides-dont-live-reload).

## The suggested `.rules` addition

This design produced the one repo-rule proposal worth making. Per Zed's rules-hygiene
policy, it goes in the **PR description under "Suggested .rules additions"** — never
edited into `.rules` inline during feature work.

For `crates/theme/.rules` or `crates/theme_settings/.rules`:

> A theme fetched from `ThemeRegistry` is raw. Pass it through
> `ThemeSettings::apply_theme_overrides` before using it as an active theme, or the
> user's `theme_overrides` / `experimental_theme_overrides` are silently dropped. The
> global path applies them deep inside `configured_theme()`, so new code paths that
> resolve a theme by name look correct and are not.

It meets the repo's three criteria, and you should be able to say why:

1. **Non-obvious** — the layering is buried in `configured_theme()`, not at the
   registry boundary.
2. **Repeatedly encountered** — hit at four separate call sites while building this
   feature.
3. **Specific enough to act on** — a concrete instruction, not a principle.

Proposing it correctly (in the description, for reviewers to accept or reject) rather
than committing it is itself a signal you read `CLAUDE.md`.
