---
title: Where the PR actually stands
description: The lineage — four issues, three PRs, one maintainer review, and one process close.
sidebar:
  order: 3
---

Your instinct was that this feature has community demand but no maintainer
support. The first half is right. The second half is wrong, and this page is the
evidence.

## The timeline

| Date | Event |
|---|---|
| Dec 2024 | [Issue #22370](https://github.com/zed-industries/zed/issues/22370) — "Support for Per-Window Theme Customization" |
| — | [Issue #13300](https://github.com/zed-industries/zed/issues/13300) — "Per-project themes (multiple active themes)" — **still open, 133 👍, 35 comments** |
| Dec 2025 | [PR #40418](https://github.com/zed-industries/zed/pull/40418) — "Workspace Settings Profiles". Closed. Self-described by its author as *"100% vibecoded and I don't understand most of it."* |
| 2026-06-06 | [PR #58755](https://github.com/zed-industries/zed/pull/58755) opened by `42piratas` — per-window themes via draw-time global swapping. 9 files, +480/−39. |
| 2026-06-08 | [PR #58861](https://github.com/zed-industries/zed/pull/58861) opened by `42piratas` — per-*terminal* theme overrides. 7 files. |
| 2026-06-21 | `42piratas` asks osiewicz whether a ~1,245-call-site migration is acceptable. |
| **2026-06-22** | **`osiewicz` (MEMBER) leaves `CHANGES_REQUESTED` on #58755 prescribing the `ActiveTheme`-on-window design.** |
| 2026-06-22 | `osiewicz` also raises the AI-policy concern in the same thread. |
| 2026-07-01 | `smitbarmase` (MEMBER) closes #58861 on **process** grounds — no GitHub Discussion first. Code never reviewed. |
| — | Issues #58381, #57311, #19510, #19503, #22370 all closed as "completed" by triage as duplicates of the above. |

## The review that changes everything

This is the thing to internalise. `osiewicz`'s review on #58755, in full:

> Hey, thanks for submitting a PR. I believe you've went great lenghts to avoid
> making a complex change (as you've noticed, we're grabbing a theme from cx which
> won't fly with per-window overrides) by resorting to a way more complex solution
> instead (introducing APIs and swapping out global state underneath observers).
> Off the top of my head, it seems like the "simplest" solution would be to move
> `ActiveTheme` onto window - you'd need a window to grab the active theme, but I
> think that's ok. Yes, this will result in more code being changed, but ultimately
> I feel like that'd be way more correct and straightforward to reason about. You
> should not have to touch gpui at all to make this change.

Plus one inline comment on `crates/workspace/src/workspace.rs`:

> Window ids are not guaranteed to be stable. You should not use them to identify
> windows across restarts.

### Requirement-by-requirement

Four things were asked for. Four things were done. This table is the backbone of
your PR description.

#### 1. "Move `ActiveTheme` onto window"

```rust
// crates/theme/src/theme.rs
pub trait WindowTheme {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
}

impl WindowTheme for Window {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme> {
        WindowThemeOverrides::theme(self.window_handle().window_id(), cx)
    }
}
```

✅ Done. And ~1,177 call sites now read `window.theme(cx)`.

#### 2. "You'd need a window to grab the active theme"

`impl ActiveTheme for App` is **deleted**. `cx.theme()` no longer compiles anywhere
in the codebase. The app-level accessor still exists but is renamed to
`configured_theme()` on a separate trait, with a doc comment that states the intent
outright:

```rust
/// Use this only in contexts where no [`Window`] exists (app startup, menus,
/// tests). UI that renders into a window must use [`WindowTheme`] instead;
/// deliberately, `cx.theme()` does not exist so per-window overrides cannot be
/// silently bypassed.
```

✅ Done, and stronger than asked: it is not merely possible to use the window, it
is impossible not to.

#### 3. "Yes, this will result in more code being changed"

307 files. The reviewer said this would happen and accepted it. You are not
smuggling in a large diff; you are delivering the one that was quoted to you.

✅ Acknowledged in advance by the reviewer.

#### 4. "You should not have to touch gpui at all"

```bash
git diff main...HEAD --stat -- crates/gpui
```

Empty. The override lives in a `theme`-crate side table keyed by `WindowId`, which
`Window` already exposes via `window_handle().window_id()`.

✅ Zero GPUI changes. Verify this yourself before the review; it is the cheapest
credibility you will ever buy.

#### 5. The `WindowId`-stability comment

`WindowId` is used **only** as the key of the in-memory map, which is rebuilt from
scratch each run. Persistence uses `WorkspaceId`, the stable database id.

```rust
/// Per-window theme overrides keyed by runtime [`WindowId`].
///
/// Persistence is keyed by workspace id separately; this map is only the live
/// lookup used while painting a window.
```

✅ Directly addressed, with a comment placed so the next reader doesn't
"simplify" the two keys back together.

## The uncomfortable half: the process gate

This is real and you should plan for it.

**PR #58861** — the sibling per-terminal-theme PR — was closed by `smitbarmase`
without any code review, quoting `CONTRIBUTING.md`:

> larger feature requests like this should first go through a GitHub Discussion.
> Once there is enough community engagement and approval from a team member, we can
> convert that discussion into a GitHub issue and move forward from there.

So the bar is not "community wants it." It is **"a team member approved it, in a
discussion, converted to an issue, before the PR."** On paper, per-window themes
does not have a clean paper trail: the linked issues are closed, and #32293 is a
discussion, not an approved issue.

**But #58755 was not closed for process.** A core maintainer invested a substantive
architecture review and requested specific changes. That is materially different
treatment from #58861, and it is the strongest standing this feature has.

### What follows from that

1. **Do not open a cold, brand-new PR.** That resets you to #58861's position and
   invites a process close before anyone reads a line. The existing open PR with an
   engaged maintainer *is* your standing.
2. **Coordinate on #58755 first.** It is `42piratas`'s PR on their fork; you have no
   push access and your branch shares no history with theirs. Post a short comment
   there explaining you've implemented the requested changes and offering both routes
   (they pull your branch, or you open a successor that links back). Then **wait for
   an actual acknowledgment.**
3. **Frame the eventual PR as responding to review**, not as proposing a feature.
   The first line of the body should be the osiewicz quote and what you did about it.

Full playbook in [The process gate](/defending/process/).

## What this means for your confidence

You are not walking in cold with an unsolicited 307-file refactor. You are walking
in with:

- a maintainer-prescribed design, implemented as prescribed,
- an explicit inline review comment, directly addressed,
- a constraint ("don't touch gpui") satisfied exactly,
- ~200 lines of feature and ~2,900 lines of compiler-enforced mechanical change,
- a written, honest list of ten known gaps, and
- an offer to stage the migration if they want it smaller.

The remaining risk is process, not merit — and process risk is managed by
coordinating before opening, not by writing better code.
