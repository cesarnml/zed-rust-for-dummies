---
title: 06. Deferred resolution
description: The startup race that silently lost every extension theme, and the one-line predicate that fixes it without stomping previews.
sidebar:
  order: 7
---

**Code:** `crates/zed/src/main.rs` (`reapply_pending_window_theme_overrides`)
**Commit:** `265d9d7a23` — the most recent on the branch
**Confidence:** Medium-high

## In plain English

There's a race at startup. Zed reopens your projects, and for each one it looks up the
theme name you saved — but themes that come from extensions or from your own themes
folder are still loading in the background at that moment. The lookup fails, Zed logs
a line nobody reads, and the window opens with your normal theme. A second later the
themes finish loading, and nothing goes back to check.

The practical effect: **if your window theme came from the extension store — which is
where basically every interesting theme comes from — you lose it on every single
restart.** It works perfectly when you set it and is gone the next morning.

The fix is a small repair pass. Whenever the set of loaded themes changes, walk the
open windows and look for one specific inconsistency: a project that *says* it wants a
custom theme, next to a window that doesn't *have* one. That combination can only mean
the earlier lookup failed, so retry it. Everything else is left alone.

That "everything else is left alone" is the load-bearing part. The obvious version of
this — just reapply every window's saved theme whenever themes change — is **actively
worse than the bug**. If you happen to have the theme picker open and are previewing
themes, a background settings save would yank the preview out from under you
mid-scroll. Only repairing the specific broken combination means the pass can never
interfere with anything that's working.

## The problem, precisely

On startup:

1. Zed restores workspaces and calls `apply_window_theme`.
2. `ThemeRegistry::global(cx).get("Some Extension Theme")` **fails** — extension themes
   and user themes in `~/.config/zed/themes` load asynchronously and haven't arrived.
3. The error is logged, `clear_for_window` runs, the window renders with the configured
   theme.
4. Themes finish loading a moment later. **Nothing re-checks.**

This is not an edge case. Themes from the extension store are the *common* case for
people who care enough about themes to want per-window ones.

## The fix

```rust
cx.observe_global::<GlobalTheme>(reapply_pending_window_theme_overrides).detach();
```

```rust
/// Reapplies per-window theme overrides that could not be resolved when their
/// workspace was first restored — for example, an override pointing at an
/// extension theme that had not finished loading yet.
///
/// Only windows whose live override is currently missing are touched, so this
/// never disturbs a correctly-applied override or a theme selector's in-progress
/// preview (both of which leave a live override in place).
fn reapply_pending_window_theme_overrides(cx: &mut App) {
    for window in cx.windows() {
        window.update(cx, |_, window, cx| {
            let Some(workspace) = workspace::Workspace::for_window(window, cx) else { return };
            let window_id = window.window_handle().window_id();
            let has_pending_override = workspace.read(cx).theme_override().is_some()
                && theme::WindowThemeOverrides::override_for(window_id, cx).is_none();
            if has_pending_override {
                workspace.update(cx, |workspace, cx| workspace.apply_window_theme(window, cx));
            }
        }).ok();
    }
}
```

## Decision 1 — Trigger on `GlobalTheme` change, not a registry event

`GlobalTheme` is observed because it's the global that already changes when the theme
world is re-resolved: loading user themes and extension themes both end with the
configured theme being re-resolved and `GlobalTheme` updated.

### Alternatives

**A — A new event on `ThemeRegistry`.** More precise: it would fire exactly when themes
are added rather than piggybacking on a related global. **Rejected as scope** —
`ThemeRegistry` currently emits nothing, so this means adding an event type, an
`EventEmitter` impl, and emissions at every registration site, in a crate several other
features read from. Meanwhile `GlobalTheme` is *already* observed twice in `main.rs`
for adjacent reasons (language registry theme, telemetry), so a third observer is a
two-line change following local precedent.

**B — Retry on a timer.** Rejected outright. Polling for a state change that has a
perfectly good notification.

**C — Make `apply_window_theme` async and await theme loading.** Rejected: it turns a
synchronous, infallible-feeling call into a task, and it *still* needs a "themes are
done loading" signal — which is the thing that doesn't exist.

**Confidence: medium-high**, and here's the honest framing to give a reviewer:

> (A) is the *more correct* trigger and you may prefer it. The practical difference is
> that `GlobalTheme` might not fire in some path where themes are registered without
> the resolved theme changing — in which case the override stays unresolved until the
> next settings change. That's the same failure as today's behaviour, so this is
> strictly an improvement even in its imprecise form.

Volunteering the imprecision is much stronger than defending it.

## Decision 2 — The "pending" predicate

```rust
workspace.theme_override().is_some() && override_for(window_id, cx).is_none()
```

This is the load-bearing line, and the doc comment says why.

**Naively reapplying every workspace's override on each `GlobalTheme` change would be a
live bug, not just waste.** If the user has the window theme selector open and is
previewing "Ayu Light," the live map holds the preview. A settings save at that moment
— autosave, another window, an extension install — fires the observer, which stomps the
preview back to the persisted theme mid-interaction.

Gating on *"wants an override but doesn't have one"* makes the function a **pure repair
pass over an inconsistent state** — a state that cannot be entered by any of the normal
flows:

| Situation | Wants override? | Has live override? | Touched? |
|---|---|---|---|
| No override configured | No | No | No |
| Override applied correctly | Yes | Yes | No |
| Selector previewing | Yes or no | **Yes** (the preview) | No |
| Restore failed — theme not loaded | **Yes** | **No** | ✅ **Yes** |

Only the last row matches.

This is only expressible because intent (name on `Workspace`) and live state (entry in
`WindowThemeOverrides`) are stored separately — see
[Design 04, Decision 4](/architecture/04-persistence/#decision-4--set_theme_override_name-is-separate-from-apply_window_theme).
It's idea #3 from [the overview](/architecture/overview/#3-intent-and-live-state-are-stored-separately),
cashing out.

**Confidence: high.**

## Decision 3 — Where the function lives

In `crates/zed/src/main.rs`, alongside the other `GlobalTheme` observers, rather than in
`workspace` or `theme`.

It needs `theme` (the override map), `workspace` (the entity and its restore logic), and
GPUI's window enumeration. `crates/zed` is the crate that already depends on all three
and already owns the startup wiring.

- Putting it in `theme` would require `theme` to depend on `workspace` — it does not,
  and should not.
- Putting it in `workspace` would require `workspace` to own a global app observer,
  which is startup wiring by another name.

**Confidence: high.**

## Residual risk

**No bound on how long a window renders with the wrong theme.** If themes never load (a
broken extension), the window silently stays on the configured theme and the only record
is the `log::error!` from `apply_window_theme`. There's no user-visible signal.

A maintainer may want a notification. It was deliberately not added, because a toast on
every startup for a user with one broken theme extension is its own annoyance — and the
deferred-reapply pass means a transient failure at restore is usually repaired within a
second, so the toast would frequently fire for a problem that fixes itself. The honest
middle ground would be to notify only if the override is *still* unresolved some time
after startup settles, which needs a "startup settled" signal that doesn't cleanly exist.

**`window.update(...).ok()` discards a `Result`.** This is the established idiom for
iterating `cx.windows()` (a window can close between enumeration and update), and the
failure is genuinely uninteresting. But it *is* an `.ok()` on a `Result` in a codebase
whose [rules call those out](/rust/pointers/#this-repositorys-rules-about-errors).
Know it's there; be ready to add a one-line comment if flagged.

**Cost:** O(windows) per `GlobalTheme` change, with one entity read per window.
`GlobalTheme` changes are rare (theme setting change, theme file reload). Non-issue.
