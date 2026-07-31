---
title: 'Overview: three pieces'
description: The whole feature in one page, plus the three ideas that carry the design.
sidebar:
  order: 1
---

The feature is three pieces and about 200 lines. Everything else in the 307 files is
the consequence of piece one.

## Piece 1 — Resolution (`crates/theme`)

A trait that answers "what theme paints this window?", and a map to answer it from.

```rust
pub trait WindowTheme {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
}

impl WindowTheme for Window {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme> {
        WindowThemeOverrides::theme(self.window_handle().window_id(), cx)
    }
}

#[derive(Default)]
pub struct WindowThemeOverrides {
    themes: HashMap<WindowId, Arc<Theme>>,
}
impl Global for WindowThemeOverrides {}
```

Plus the deletion that makes it stick: `impl ActiveTheme for App` is removed, and
app-level access is renamed `configured_theme()`.

→ [Design 01](/architecture/01-resolution/) · [Design 02](/architecture/02-active-theme-split/)

## Piece 2 — Persistence (`crates/workspace`)

One nullable column on the existing `workspaces` table, holding a theme **name**.

```rust
sql!(ALTER TABLE workspaces ADD COLUMN theme_override TEXT;)
```

`Workspace` gains `theme_override: Option<SharedString>` and two methods:
`set_window_theme` (apply + persist) and `clear_window_theme` (clear + persist).
Restore is split in two — record the name during construction, apply it once the
window and entity are both live.

→ [Design 04](/architecture/04-persistence/) · [Design 05](/architecture/05-lifecycle/)

## Piece 3 — Entry points (`crates/theme_selector`, `crates/zed_actions`)

Two new actions, and a `scope` enum threaded through the existing picker delegate.

```rust
pub struct ToggleWindowTheme { pub themes_filter: Option<Vec<String>> }
pub struct ClearWindowTheme;

enum ThemeSelectorScope { Global, Window }
```

The picker isn't duplicated — it's taught which of two things it currently is, and
the handful of places that actually *write* something branch on that.

→ [Design 03](/architecture/03-selector/)

## The three ideas that carry the design

If you can only remember three things going into review, these are them.

### 1. Resolution has exactly one choke point

Every themed pixel goes through `WindowTheme::theme`, which resolves
override-or-global. That means:

- Changing *where* overrides live later is a change to **one function**.
- Adding a per-frame cache (if the hash lookup ever measures badly) is a change to
  **one function**, with zero call-site churn.
- There is no second path by which a theme can be resolved.

**Say this when someone questions the storage choice.** The design isn't betting on
`HashMap<WindowId, _>` being the right answer forever; it's betting on that decision
being cheap to revisit.

### 2. The compiler enumerates the work

Deleting `impl ActiveTheme for App` turns *"did we miss a call site?"* from a review
question into a build error.

This is what makes a 307-file diff trustworthy rather than reckless. And it isn't
theoretical — it **found a real bug** that no render-path audit would have caught:

```rust
// crates/zed/src/main.rs — a settings observer looping over ALL windows
- let background_appearance = cx.theme().window_background_appearance();
+ let background_appearance = theme::WindowThemeOverrides::theme(window.window_id(), cx)
+     .window_background_appearance();
```

That site isn't a render function. It has no `Window` in scope — it iterates
`cx.windows()` and has only `WindowId`. Any migration strategy that rewrote
`cx.theme()` → `window.theme(cx)` *where a window happened to be in scope* would have
sailed straight past it. It was found because deleting the impl forced a human to
look at every single site and decide.

**This is your best single anecdote in review.** It converts "why is this diff so
big" into "here is what the size bought."

→ [Design 05, Decision 3](/architecture/05-lifecycle/)

### 3. Intent and live state are stored separately

The **workspace** records *which theme it wants* (a name, `Option<SharedString>`).
The **override map** records *what the window has* (a resolved `Arc<Theme>`).

Every repair and guard on the branch is expressible only because those two are
distinct:

- The [deferred reapply pass](/architecture/06-deferred/) finds windows that *want*
  an override but don't *have* one — a state that can only mean the earlier lookup
  failed.
- That same narrowness is what stops it stomping an in-progress theme-selector
  preview, which *does* leave a live override in place.
- The [preview/restore machinery](/architecture/03-selector/) can tell "this window
  had an override before the picker opened" from "this window is currently showing a
  preview."

If you unified them, none of those would be expressible.

## The commit stack

Seven commits, in a deliberate order:

| Commit | What |
|---|---|
| `24a6c23d4d` | Add per-window theme overrides via `WindowTheme` — the core trait, the map, the split |
| `8cf39e90b2` | Migrate render-path theme reads to `WindowTheme` — the bulk |
| `f7cd40b816` | Add window theme selector entry point, tests, and docs |
| `0068b0ae48` | Enforce window-scoped theme resolution |
| `56b9ac4223` | Fix per-window theme restore and global selector seeding |
| `04b9f24065` | Apply configured overrides to window themes and fix background resets |
| `265d9d7a23` | Reapply per-window theme overrides after themes finish loading |

The last three are bug fixes found *after* the feature worked, and they're worth
pointing at during review: they're evidence the state machine was reasoned about
rather than shipped on first green build. Two of them
([the selector seeding bug](/architecture/03-selector/#decision-2--what-the-global-selector-is-seeded-with)
and [the background reset](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset))
were found by reasoning, not by testing.

## Where to expect pushback

Ranked by likelihood, with links to the answers:

1. **The size of the migration** — and whether it should be staged.
   → [Why it is that big](/migration/why-big/)
2. **The `_:` → `_window:` renames** — separable, and you should offer that.
   → [Design 02, Decision 4](/architecture/02-active-theme-split/)
3. **The `sqlez` 11-tuple** — a shared-crate change inside a feature PR.
   → [Design 04, Decision 5](/architecture/04-persistence/)
4. **Multi-workspace tab-switch semantics** — a product call, not an implementation
   one. → [Gap 06](/gaps/remaining/#gap-06--multi-workspace-tab-switch-semantics)
5. **Syntax highlighting being out of scope** — the largest functional gap.
   → [Gap 02](/gaps/syntax-highlighting/)
