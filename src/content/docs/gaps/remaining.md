---
title: The remaining seven
description: Gaps 03, 05, 06, 07, 08, 09, and 10 — smaller, but each with a maintainer question attached.
sidebar:
  order: 5
---

The three big ones have their own pages:
[02 syntax highlighting](/gaps/syntax-highlighting/),
[01 mermaid](/gaps/mermaid/), [04 light/dark](/gaps/appearance/). These are the rest.

---

## Gap 03 — `theme_overrides` don't live-reload

**Severity:** Low. Affects only users who both use `theme_overrides` *and* have a window
override active, and it self-corrects on the next apply.

[Design 07](/architecture/07-layering/) layers your `theme_overrides` onto per-window
themes at four apply points, so a per-window theme looks the same as that theme
configured globally.

But nothing recomputes the layered theme when the overrides themselves change:

| | On editing `theme_overrides` in settings |
|---|---|
| Non-overridden windows | `GlobalTheme` is re-resolved → they repaint correctly |
| **Overridden windows** | The live `WindowThemeOverrides` entry still holds the theme layered with the **old** override values |

It stays stale until the next `apply_window_theme` — a workspace switch, a re-selection,
or a restart.

The settings observer in `main.rs` *does* update the window background appearance per
window (that was [the Design 05 fix](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset)),
but it doesn't rebuild the theme.

### Why it wasn't fixed

The obvious fix — reapply every window's override on settings change — **collides with
theme-selector previews**, exactly as described in
[Design 06, Decision 2](/architecture/06-deferred/#decision-2--the-pending-predicate). If
the user is arrowing through themes and a settings write lands (autosave, an extension
install, another window), a blind reapply stomps the preview mid-interaction.

So the fix needs a guard, and the guard needs a way to know "a preview is in progress."
Today that state lives in `ThemeSelectorDelegate` and isn't visible to `main.rs`. Three
options:

1. **A "preview in progress" flag on `WindowThemeOverrides`** — set by the selector,
   checked by both repair passes. Cleanest, but adds mutable coordination state to the
   theme crate for one consumer.
2. **Reapply only when the resolved override differs from what's live** — doesn't help;
   a preview *does* differ, so it would still get stomped.
3. **Have the selector re-derive its preview from the new settings** rather than being
   stomped — arguably most correct, and most work.

None is obviously right, and the bug is minor and self-healing. Left for a follow-up
rather than guessed at.

**Recommendation:** follow-up PR, not a merge blocker. Option (1) is probably where it
lands, and it would also let the deferred-reapply pass drop its structural guard in
favour of an explicit one.

**Open question:** is a "preview in progress" concept in the theme crate acceptable, or
should the selector own reconciliation?

---

## Gap 05 — Windows without a workspace

**Severity:** Low–medium, depending on sub-case.

### 5A — Auxiliary windows use the configured theme

Zed opens several windows that have no `Workspace`:

| Site | Window |
|---|---|
| `settings_ui/src/settings_ui.rs:878` | Settings window |
| `zed/src/zed.rs:413` | Standalone windows opened via `zed` entry points |
| `miniprofiler_ui/src/miniprofiler_ui.rs:153` | Miniprofiler |
| `settings_ui/src/pages/audio_test_window.rs` | Audio test window |

Each computes `window_background: cx.configured_theme().window_background_appearance()`
at open time, and each renders through `window.theme(cx)` — which, with no override in
the map, resolves to the configured theme. **So they are internally consistent**; they
just don't inherit the parent window's override.

**Is that wrong?** Arguably not — the settings window edits *global* settings and
arguably *should* show the global theme. But a user who set a window to a high-contrast
theme and opens settings from it will see a jarring switch.

**A fix** would thread the opening window's theme into `WindowOptions` and seed the new
window's override from it. Mechanically small. The hard part is deciding **which**
auxiliary windows should inherit — a design call, not an implementation one.

### 5B — The window theme selector in a workspace-less window

`ThemeSelectorDelegate::confirm` handles this:

```rust
} else {
    // No workspace to persist through; still layer configured
    // overrides so the preview and confirm look identical.
    let effective = Self::with_configured_overrides(theme, cx);
    theme::WindowThemeOverrides::apply_to_window(window, effective, cx);
}
```

The theme applies for the session but is **not persisted, silently**. The user gets no
signal that their choice won't survive a restart.

Options: (1) leave it silent, (2) show a toast, (3) hide/disable the action in
workspace-less windows. (3) is probably right but requires context-sensitive action
availability — more plumbing than the case currently deserves.

### 5C — `ClearWindowTheme` routes through `with_active_or_new_workspace`

Both new actions register with `with_active_or_new_workspace`, matching the existing
global `Toggle` action. That helper will **open a new workspace** if none is active. For
`ClearWindowTheme` in particular, "clear the window theme" opening a workspace is odd —
even though it's inherited from the existing pattern and unreachable in practice for a
user who has a window to clear.

Left consistent with the surrounding code rather than special-cased, on the principle
that deviating from an established local pattern needs a stronger reason than a
hypothetical. **That's a defensible position and worth stating as one** — "I followed the
existing pattern; happy to special-case it if you'd rather."

**Recommendation:** 5A is the only one worth a decision now, and it's a product one.

**Open question:** should auxiliary windows inherit the opening window's theme?

---

## Gap 06 — Multi-workspace tab-switch semantics

**Severity:** Medium — not a bug, a design choice that will surprise some users.

Zed's multi-workspace mode puts several workspaces in one platform window. The override
is stored **per workspace** but applied **per window**, so `MultiWorkspace::activate`
reapplies on every switch:

```rust
self.active_workspace.update(cx, |workspace, cx| {
    workspace.refresh_window_state(window, cx);
    workspace.apply_window_theme(window, cx);
});
```

**Consequence:** a window holding a "production" workspace (red-tinted) and a "docs"
workspace (no override) will visibly change its entire appearance — chrome, background,
panels — every time the user switches between them.

### Why per-workspace rather than per-window

The user model is *"this project gets this theme."* Storing per window instead would
mean:

- The theme wouldn't follow a project when it moves to a different window.
- Two windows showing the same project could have different themes, which makes the
  "tell production from staging" use case **unreliable**.
- There is **no stable window identity to persist against** — `WindowId` is a runtime
  value ([Design 01, Decision 3](/architecture/01-resolution/#decision-3--keying-by-runtime-windowid-not-workspace-id)).
  You'd have to invent one.

So per-workspace is the right storage. The tab-switch repaint is the price.

### Where it gets ambiguous

Multi-workspace mode blurs the "one project per window" assumption the feature is built
on. Reasonable people can want:

| | Behaviour | Assessment |
|---|---|---|
| **(A)** | Window adopts the active workspace's theme | ✅ Shipped. Consistent with how window title and edited-indicator already work via `refresh_window_state` |
| **(B)** | First-workspace-wins — the window keeps the theme it opened with | Stabler, but then a workspace's theme depends on which window you happened to open it in |
| **(C)** | Chrome-only — frame follows the active workspace, panels don't | Probably worst of both |

(A) shipped because it follows the existing precedent **in the same function** and
preserves the per-project meaning. But it means a full-window repaint on tab switch,
which in a window with many workspaces is a fairly loud UI event.

**Recommendation:** confirm (A) is intended. If maintainers want (B), the change is to
apply once in `MultiWorkspace::new` and drop the `activate` call — **a two-line diff**.
Say that; a two-line escape hatch makes the decision cheap for them.

**Open question:** in a multi-workspace window, should switching the active workspace
repaint with that workspace's theme?

---

## Gap 07 — Theme lifecycle and extensions

**Severity:** Low frequency, but the failure modes are silent.

### 7A — Extension theme not yet loaded at restore (mitigated ✅)

This *was* a real bug and is **fixed** by
[Design 06](/architecture/06-deferred/).

Residual risk: the trigger is `GlobalTheme` changing, not the registry gaining entries.
If themes are registered in a path that doesn't re-resolve `GlobalTheme`, the override
stays unresolved until the next settings change — the same failure as before the fix, so
strictly an improvement, but not a guarantee.

### 7B — Extension uninstalled while a window uses its theme

The window holds an `Arc<Theme>` in the map. Uninstalling removes it from the registry
but doesn't touch the live map, so the window **keeps rendering the theme** until closed
or cleared. On next restart, `apply_window_theme` fails the lookup, logs, and falls back.

Arguably the *better* failure mode — no mid-session visual snap — but it's **unhandled
rather than chosen**. Nothing invalidates the map on registry removal, and the user gets
no notification their persisted override is now dangling.

A fix needs an invalidation signal from the theme registry (the same signal Design 06
wanted and didn't have), plus a decision about notifying.

### 7C — Theme renamed

The override persists a name. If a theme is renamed between versions, the override
silently becomes dangling and the window reverts on next restart, with a log line.

There's no migration path and no reasonable one — nothing maps old names to new. This is
the accepted cost of persisting by name rather than content
([Design 04, Decision 1](/architecture/04-persistence/#decision-1--persist-the-theme-name-not-the-resolved-theme)),
and **the same cost already applies to the global `"theme"` setting**. Not a new class
of problem — say that.

### 7D — Silent failure

All three fail via:

```rust
Err(error) => {
    log::error!("failed to load window theme override {}: {}", theme_name, error);
}
```

then fall through to `clear_for_window`. The user sees their window revert with no
explanation.

A notification was **deliberately** not added: a toast on every startup for a user with
one broken theme extension is its own annoyance, and the deferred-reapply pass means a
transient failure at restore is usually repaired within a second — so the toast would
frequently fire for a problem that fixes itself.

The honest middle ground would be to notify only if the override is still unresolved
some time after startup settles. That needs a "startup settled" signal, which doesn't
cleanly exist.

**Recommendation:** no action needed to merge. If maintainers want theme-registry
invalidation events, **that single addition would improve this gap, Gap 01, and Design
06 simultaneously** — the highest-leverage follow-up on the list.

**Open question:** should a dangling window theme override notify the user, or stay
log-only?

---

## Gap 08 — Telemetry, settings surface, and discoverability

**Severity:** Non-blocking, but each needs a maintainer answer.

### 1. New telemetry event name

```rust
telemetry::event!("Window Theme Changed", value = theme_name);
```

The global path fires `"Settings Changed", setting = "theme"`. Reusing it would pollute
that series — a per-window choice is explicitly *not* a settings change, and mixing them
inflates the "users change their theme" metric with a different behaviour.

But event names are a **data-team concern**: naming conventions, whether the event is
wanted at all, and whether `value` should carry the theme name (a user-visible string
that could be a custom user theme name — arguably lower-sensitivity than a file path,
but it *is* user-authored text leaving the machine).

**Open question:** is `"Window Theme Changed"` the right name and shape, and should the
theme name be included? Easy to change or drop — say so.

### 2. No settings-file representation

A per-window theme lives **only** in the workspace DB. There's no way to express "this
project always uses this theme" in `settings.json` or `.zed/settings.json`.

That's a defensible v1 boundary — per-window theme is *window state*, like window size
and centred layout, not configuration. But the adjacent feature request is obvious, and
these are genuinely different features with different semantics that can coexist.

:::danger[This is one of the three shape-determining questions]
**If maintainers want the project-settings version instead, this whole branch is the
wrong shape** — and that should be known before review effort is spent on it. Ask early.
:::

**Open question:** is window-scoped *state* the intended model, or would maintainers
rather have project-scoped *configuration*?

### 3. Discoverability

The only entry points are two command-palette actions. No default keybinding (correct —
the keymap is crowded). No menu entry. **No indication anywhere in the UI that a window
*has* an override**, so a user who forgets they set one has no way to discover why this
window looks different other than trying `ClearWindowTheme`.

Possible surfaces, none implemented:

- A menu entry alongside the existing theme selector.
- An indicator in the title bar or status bar when an override is active.
- Showing the override state in the existing theme selector's footer.

All are small. None were added because **adding UI chrome to shared surfaces (title bar,
status bar) is exactly the sort of thing maintainers have opinions about**, and guessing
wrong wastes review cycles. That's the right reason to not do something, and it's worth
stating as the reason.

**Open question:** what UI surface, if any, should indicate an active window override?

### 4. Docs

`docs/src/themes.md` gained a "Per-Window Themes" section covering both actions, the
persistence behaviour, and the light/dark limitation. That's the minimum, and it's done.

**Not documented:** the interaction with `theme_overrides` — that a per-window theme
still gets your configured colour patches. It's the least-surprising behaviour so it may
not need saying, but it *is* a documentable guarantee.

---

## Gap 09 — Terminal OSC colour queries

**Severity:** Low. Affects a specific TUI behaviour, not normal terminal rendering.

`crates/terminal/src/terminal.rs:1584`, in the handler for a terminal colour-query escape
sequence (OSC 4 / OSC 10–11, where a program asks "what colour is palette index N?"):

```rust
let color = self.term.lock().colors()[index].unwrap_or_else(|| {
    to_vte_rgb(get_color_at_index(index, cx.configured_theme().as_ref()))
});
self.write_to_pty(format(color).into_bytes());
```

So a program running in a terminal inside an overridden window is told the **configured**
theme's ANSI colours, while the terminal visibly paints with the **window's** theme. A
TUI that adapts its palette to the reported terminal colours (vim, some pagers, some
prompt frameworks) would adapt to the wrong palette.

:::note[Be precise about the scope]
This is **only** the query-response path. Terminal *rendering* goes through
`terminal_view/src/terminal_element.rs`, which **was** migrated to `window.theme(cx)` and
is correct. Making that distinction shows you traced it rather than assumed it.
:::

### Why it wasn't fixed

`Terminal` is a **model entity, not a view**. It's updated from PTY events on background
tasks, and the escape-sequence handler runs in `Terminal::process_event` with only
`&mut Context<Terminal>` — no `Window`. Same structural shape as
[Gap 01](/gaps/mermaid/).

A `Terminal` also isn't strictly tied to one window — a terminal item can be moved
between panes, and terminals in the terminal panel belong to a workspace that may be
shown in a multi-workspace window.

**Fix options:**

1. **Have `TerminalView` push the current theme's ANSI palette down into `Terminal`**
   whenever it renders or when the theme changes. Small, and mirrors how the terminal
   already receives other view-side state. **Most likely correct answer.**
2. Give `Terminal` a `WindowId` and look up the override directly. Works, but bakes a
   window identity into a model that doesn't otherwise have one.
3. Leave it.

**Recommendation:** not a merge blocker; the visible terminal is themed correctly. Option
1 is **the smallest of all the gaps on this list** and a good first follow-up. Offering
to do it as a scoped follow-up PR is a cheap way to demonstrate the list isn't a
graveyard.

**No open question** — this one just needs doing, unless maintainers prefer option 2.

---

## Gap 10 — Icon themes

**Severity:** Very low. Intentionally excluded.

```rust
pub struct GlobalTheme {
    theme: Arc<Theme>,
    icon_theme: Arc<IconTheme>,
}
```

`WindowThemeOverrides` overrides only the first. `GlobalTheme::icon_theme(cx)` has no
window-scoped equivalent, and `icon_theme_selector` was left untouched apart from one
render-path conversion. So an overridden window uses the globally-configured icon theme.

### Why excluded

1. **It's a separate axis.** Icon themes are chosen independently of colour themes today.
   Per-window colour themes exist to make windows visually distinguishable; per-window
   *icon* themes serve no part of that use case.
2. **Doubling the surface for no demand.** It means a second override map, a second
   persisted column, a second selector scope, a second clear action, and a second set of
   lifecycle call sites — roughly duplicating the whole feature for something nobody has
   asked for.
3. **Icon themes are lower-contrast.** Nobody identifies a window at a glance by its file
   icons.

### If it were wanted

Worth saying, because it means excluding it now costs nothing later:

- `WindowThemeOverrides` gains `icon_themes: HashMap<WindowId, Arc<IconTheme>>` (or
  becomes a struct-valued map holding both).
- A `WindowIconTheme` trait mirroring `WindowTheme`.
- An `icon_theme_override` column alongside `theme_override`.
- `ToggleWindowIconTheme` / `ClearWindowIconTheme` following the same scope-enum pattern.
- A call-site migration for `GlobalTheme::icon_theme` consumers — a much smaller set.

**The architecture chosen for colour themes accommodates it without change.** That's the
sentence to use if asked.

**Recommendation:** exclude. Revisit only if requested.

**Open question:** any objection to colour-only scope?
