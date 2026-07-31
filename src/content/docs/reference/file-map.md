---
title: File map
description: Which of the 307 files carry logic, and which you can skim or trust the compiler on.
sidebar:
  order: 2
---

A reviewer's first question is *"which files do I actually have to read?"* Answer it in
the PR description. This is the answer.

## Read every line — the actual feature (~7 files, ~200 lines)

| File | What's in it |
|---|---|
| `crates/theme/src/theme.rs` | **The whole core.** `WindowTheme` trait, `WindowThemeOverrides` map, `ConfiguredTheme` split, `on_window_closed` cleanup. ~115 lines. |
| `crates/theme_selector/src/theme_selector.rs` | Scope enum, preview/revert state machine, both new action handlers, two tests. |
| `crates/workspace/src/workspace.rs` | `theme_override` field, `set_window_theme`, `clear_window_theme`, `apply_window_theme`, `set_theme_override_name`, restore wiring at four construction sites. |
| `crates/workspace/src/persistence.rs` | The migration, the `theme_override` column in both queries, `set_theme_override`, persistence tests. |
| `crates/workspace/src/persistence/model.rs` | One field on `SerializedWorkspace`. |
| `crates/zed/src/main.rs` | The per-window background fix, and `reapply_pending_window_theme_overrides`. |
| `crates/zed_actions/src/lib.rs` | `ToggleWindowTheme`, `ClearWindowTheme`. |
| `docs/src/themes.md` | User-facing docs, including the stated light/dark limitation. |
| `crates/multi_workspace` (in `workspace`) | `apply_window_theme` at `new` and `activate`. |

If a reviewer reads only `crates/theme/src/theme.rs`, they've seen the design.

## Read carefully — API shape changes (~10 files, ~300 lines)

These are [Shape 3](/migration/shapes/#shape-3--style-helpers-become-theme-parameterized)
and [Shape 4](/migration/shapes/#shape-4--function-pointer-callbacks-cant-capture): the
places where a signature changed rather than a call.

| File | Change |
|---|---|
| `crates/ui/src/styles/color.rs` | `Color::color(&App)` → `Color::color(&impl ActiveTheme)` |
| `crates/ui/src/styles/elevation.rs` | All four `ElevationIndex` helpers |
| `crates/ui/src/styles/appearance.rs` | `theme_is_transparent` |
| `crates/ui/src/traits/styled_ext.rs` | All six `StyledExt` methods |
| `crates/theme/src/scale.rs` | `ColorScaleSet::step`, `step_alpha` — take `&Theme` |
| `crates/theme/src/styles/colors.rs` | `all_theme_colors` — takes `&Theme` |
| `crates/ui/src/prelude.rs` | Three trait re-exports |
| `crates/ui/src/components/button/button_like.rs` | The largest single-file rewrite (~277 lines): resolves the theme once, threads it through the whole button styling chain |
| `crates/editor/src/editor.rs`, `element.rs` | Highlight callbacks: `fn(&App) -> Hsla` → `fn(&Theme) -> Hsla` |
| `crates/vim/src/state.rs` | `from_chunks` takes `&theme::Theme` instead of `&App` (~309 lines) |
| `crates/sqlez/src/bindable.rs` | The 11-tuple macro invocation |

## Skim, or trust the compiler — the bulk (~290 files, ~2,900 lines)

Everything else is one of two patterns:

```diff
- .bg(cx.theme().colors().editor_background)
+ .bg(window.theme(cx).colors().editor_background)
```

```diff
- fn render(&mut self, _: &mut Window, ...)
+ fn render(&mut self, _window: &mut Window, ...)
```

The largest by line count, for reference — these look alarming in the stat output and are
entirely mechanical:

| File | Lines | Why so many |
|---|---|---|
| `crates/agent_ui/src/conversation_view/thread_view.rs` | 431 | Large view, many theme reads |
| `crates/editor/src/element.rs` | 218 | The editor's paint path |
| `crates/editor/src/editor.rs` | 180 | Plus the highlight callback change |
| `crates/git_ui/src/commit_tooltip.rs` | 177 | Tooltips — several are Shape 5a |
| `crates/git_ui/src/git_panel.rs` | 167 | Large panel |
| `crates/workspace/src/workspace.rs` | 158 | Feature + migration mixed |

## Verify the constraint yourself

The one the maintainer explicitly imposed:

```bash
git diff main...HEAD --stat -- crates/gpui
```

Empty output. Run it before the review so you can state it as fact rather than intent.

## The commit stack

```bash
git log --oneline main..HEAD
```

| Commit | What | Reviewable alone? |
|---|---|---|
| `24a6c23d4d` | Add per-window theme overrides via `WindowTheme` | The core — yes |
| `8cf39e90b2` | Migrate render-path theme reads to `WindowTheme` | The bulk — skim |
| `f7cd40b816` | Add window theme selector entry point, tests, and docs | Yes |
| `0068b0ae48` | Enforce window-scoped theme resolution | Yes |
| `56b9ac4223` | Fix per-window theme restore and global selector seeding | **Yes — the settings-corruption fix** |
| `04b9f24065` | Apply configured overrides to window themes and fix background resets | **Yes — two real bugs** |
| `265d9d7a23` | Reapply per-window theme overrides after themes finish loading | **Yes — the startup race** |

The last three are bug fixes found *after* the feature worked. Point at them: they're
evidence the state machine was reasoned about rather than shipped on first green build.

## Suggested reviewer note for the PR description

> **Where to look.** The feature is `crates/theme/src/theme.rs` (~115 lines — that's the
> whole design), plus `theme_selector.rs`, `workspace.rs`, `persistence.rs`, and the two
> new functions in `main.rs`. The `ui`/`editor`/`vim` signature changes are worth a read.
> Everything else is `cx.theme()` → `window.theme(cx)` and `_:` → `_window:`, which the
> compiler verified for me.
