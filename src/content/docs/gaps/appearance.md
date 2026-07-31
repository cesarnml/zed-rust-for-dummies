---
title: 'Gap 04: Light/dark following'
description: An overridden window pins one theme and stops following the system. Deliberate, documented, and a genuine product question.
sidebar:
  order: 4
---

**Status:** Known, documented in user docs, deliberate for v1.
**Severity:** Medium — a real behaviour change users will notice, but it's stated up
front rather than discovered.
**Needs a maintainer decision:** Yes — pin vs. per-window settings.

## What's happening

Your global theme setting is a `ThemeSelection`, which can be **`Dynamic`** — a light
theme and a dark theme, switched by system appearance. `ThemeSettings` owns that mode
resolution.

A per-window override is **a single theme name resolved to a single `Arc<Theme>`**. It
has no appearance mode. So when the OS flips to dark mode, the overridden window keeps
rendering the theme the user picked.

This is stated in `docs/src/themes.md`, which the branch ships:

> Because a window-scoped theme pins one concrete theme, it does not follow the system's
> light/dark mode switching until you clear it.

**Shipping the limitation in the user docs is the important part.** It converts a
surprise into a stated behaviour, and it's the kind of thing a reviewer checks for.

## Why it's like this

Making the override appearance-aware means the override is not a `Theme` but a
`ThemeSelection` — i.e. **per-window *theme settings*, not per-window *theme***. That
changes four things at once.

### Storage

The `theme_override TEXT` column becomes JSON, or two columns
(`theme_override_light`, `theme_override_dark`) plus a mode.

→ [Design 04, Decision 1, alternative B](/architecture/04-persistence/#decision-1--persist-the-theme-name-not-the-resolved-theme)

### Resolution

`WindowThemeOverrides` would either store an **unresolved selection** and resolve it
against `SystemAppearance` on every read — putting mode resolution in the render path —
or store a resolved theme **plus a subscription** that re-resolves on appearance change.

Neither is terrible. Both are more machinery than a `HashMap<WindowId, Arc<Theme>>`.

### UI

The window theme selector would need to express "pick a light theme *and* a dark theme."

**The global selector doesn't do that either** — dynamic themes are settings-file-only
today. So the per-window UI would end up *more capable* than the global one, which is
backwards. That's a genuinely awkward outcome and worth raising.

### `workspace::ToggleMode`

The existing light/dark toggle action edits **global settings**. In an overridden window
it currently reads:

```rust
match window.theme(cx).appearance() {
    theme::Appearance::Light => ThemeAppearanceMode::Dark,
    theme::Appearance::Dark  => ThemeAppearanceMode::Light,
}
```

— so it toggles the **global** setting based on the **window's** appearance, which is at
best confusing.

:::caution[Be ready for this one]
This interaction is **not resolved** on the branch. It's the sharpest concrete
consequence of the pin design, and a thorough reviewer may well find it. Naming it
yourself is much better than being shown it.
:::

## The narrower question maintainers should answer first

Is a per-window theme meant to be:

**(A) A pin** — "this window is Ayu Dark, full stop."

Current behaviour. Simple, predictable, and it matches the "mark this window as
production" use case, where the user wants it visually distinct **regardless** of system
appearance. Arguably *more* correct for that use case: if you tinted a window red to
mean "production," you don't want it to stop being red at sunset.

**(B) A per-window theme setting** — participating fully in mode switching.

A coherent, larger feature that would subsume (A).

## Why choosing (A) now doesn't foreclose (B)

This is the important structural point, and it's the reason (A) is defensible rather
than merely convenient:

- The storage migration from a `TEXT` name to a JSON selection is straightforward.
- `WindowThemeOverrides` would **keep its `Arc<Theme>` value type**; the resolution just
  moves one layer up.
- `WindowTheme::theme` — the single choke point — is where that layer would go.

So (B) is a strict extension, not a rewrite. Being able to say "I chose the format
that's cheap to migrate if you disagree" is a much stronger position than "I chose the
right format."

## Recommendation for maintainers

Ship (A), documented. Revisit (B) if users ask for it.

## The open questions

1. Is pinning acceptable, or must per-window themes follow system appearance?
2. What should `workspace::ToggleMode` do in a window that has an override — nothing,
   clear the override, or keep editing global settings as it does today?

Question 2 is the one you should raise proactively. It's a small, concrete, answerable
thing, and asking it demonstrates you traced the feature's interactions rather than just
its happy path.
