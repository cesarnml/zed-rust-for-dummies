---
title: What the feature does
description: The user-visible feature in one page, before any Rust appears.
sidebar:
  order: 2
---

Before any code: what a user actually gets, and what they don't.

## The pitch

Zed's theme is one setting shared by the whole application. If you have four
windows open on four projects, they all look identical. There is nothing to grab
onto visually, so you tab into the wrong window, start editing the wrong repo, and
lose your place.

This feature lets **each window use its own theme**, chosen from a window-scoped
theme picker, remembered per project across restarts, and **never written to
`settings.json`**.

The canonical use case: a production checkout tinted red, a staging checkout in
your normal theme. You know which is which before you read a single character.

VS Code users know this idea as
[Peacock](https://github.com/johnpapa/vscode-peacock) — over a million installs —
which does it by writing `workbench.colorCustomizations` into each project's
`.vscode/settings.json`.

## How a user uses it

Two new commands in the command palette:

| Command | Effect |
|---|---|
| `theme_selector: toggle window theme` | Opens a picker that looks exactly like the normal theme selector, but the choice applies to **this window only** |
| `theme_selector: clear window theme` | Removes this window's override; it goes back to your configured theme |

Neither has a default keybinding. The picker previews as you arrow through the
list, exactly like the global one, and escaping reverts.

The choice is stored in Zed's local workspace database — the same place your window
size, panel layout, and centered-layout flag already live. It survives a restart.
It does not appear in `settings.json`, and it does not appear in any project's
`.zed/settings.json`.

## The three properties that are load-bearing

These are the design commitments. If a reviewer challenges the feature's *shape*
rather than its code, these are what you're defending.

### 1. It is window state, not configuration

A per-window theme is stored alongside window size and dock layout, not alongside
your font size and keymap. That is a deliberate categorisation with two
consequences:

- It is **user-side**. It cannot be committed to a repository, so it cannot leak
  your personal colour preferences to your teammates. The discussion under a
  previous attempt at this feature ([PR #40418](https://github.com/zed-industries/zed/pull/40418))
  converged on exactly this point, citing VS Code's `.vscode/settings.json`
  leaking personal themes into version control as the anti-pattern to avoid.
- It is **not something an untrusted repository can set**. A repo you clone cannot
  restyle your editor.

The adjacent feature — a `"theme"` key in `.zed/settings.json` that any window
opening that project picks up — is a *different* feature with different security
properties. They can coexist. But if maintainers want that one instead, this branch
is the wrong shape, and that is worth finding out early. See
[Gap 08](/gaps/remaining/#gap-08--telemetry-settings-surface-and-discoverability).

### 2. It is per-project, not per-window-handle

The override is stored against the **workspace** (the project), not the window.
This has a visible consequence in Zed's multi-workspace mode, where several
projects live as tabs in one platform window: switching tabs repaints the whole
window.

That is intentional. The point of the feature is "this *project* is the red one."
If the theme didn't follow the project, it would stop distinguishing anything. But
it is a loud UI event and maintainers should confirm they want it. See
[Gap 06](/gaps/remaining/#gap-06--multi-workspace-tab-switch-semantics).

### 3. It pins one concrete theme

Your global theme setting can be *dynamic* — "Ayu Light when the system is in light
mode, Ayu Dark when dark." A per-window override cannot. It is one theme, full stop.

So an overridden window stops following system light/dark switching until you clear
it. This is documented in the user docs the branch ships:

> Because a window-scoped theme pins one concrete theme, it does not follow the
> system's light/dark mode switching until you clear it.

This is a real limitation, deliberately chosen because supporting the alternative
means per-window *theme settings* rather than per-window *theme* — a substantially
larger feature. See [Light/dark following](/gaps/appearance/).

## What a user does **not** get

Say these before a reviewer finds them. The full list is in
[Known gaps](/gaps/the-honest-list/), but the two that a user will actually notice:

- **Syntax highlighting stays global.** The window chrome, panels, tabs, and
  backgrounds use the override; the coloured code inside the buffer uses your
  configured theme. This is the largest functional gap in the feature and it is not
  a small fix. [Details](/gaps/syntax-highlighting/).
- **Mermaid diagrams stay global.** A rendered diagram in a markdown preview uses
  the configured theme's colours. [Details](/gaps/mermaid/).

Both have the same root cause, which is worth internalising because it explains the
whole gap list: **they resolve colours outside the paint path**, where no `Window`
exists to ask.

## The one-sentence version

> The feature is: each window can pin its own theme, stored as window state keyed
> by project, applied to everything that resolves colour at paint time.

Everything on this site is either how that sentence is implemented, or an honest
accounting of where "everything that resolves colour at paint time" falls short of
"everything."
