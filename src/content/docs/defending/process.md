---
title: The process gate
description: The rule that killed a sibling PR without any code review, and how to not trip it.
sidebar:
  order: 2
---

The biggest risk to this work is **not** technical. It's procedural.

## What happened to #58861

[PR #58861](https://github.com/zed-industries/zed/pull/58861) — per-*terminal* theme
overrides, by the same author as #58755 — was closed on 2026-07-01 by `smitbarmase`, a
Zed team member, **without any code review at all**:

> Thanks for putting this together. However, as mentioned in our CONTRIBUTING.md, larger
> feature requests like this should first go through a GitHub Discussion.
>
> Once there is enough community engagement and approval from a team member, we can
> convert that discussion into a GitHub issue and move forward from there.

The code was never assessed. The gate is:

1. GitHub **Discussion** first
2. **Community engagement** *and* **approval from a team member**
3. Converted into an **issue**
4. *Then* a PR

**So community demand alone is not standing.** All those upvoted issues
([133 👍 on #13300](https://github.com/zed-industries/zed/issues/13300)) do not, by
themselves, get a large feature PR read.

## Where per-window themes stands against that gate

**On paper, imperfectly:**

- The issues #58755 links (#19510, #22370) are **closed**.
- #32293 is a **discussion**, not an approved issue.
- There is no "converted into an issue with team-member approval" artefact.

**In practice, much better than #58861:**

- **#58755 was not closed for process.** It's still open.
- A core maintainer (`osiewicz`) invested a **substantive architecture review** and
  requested specific changes.

That is materially different treatment, and it's the strongest available signal that the
feature has team engagement **on the merits**. A maintainer does not spend time
prescribing an implementation strategy for a feature they intend to reject on process
grounds.

**That review is your standing.** Protect it.

## The three rules that follow

### 1. Do not open a cold, brand-new PR

A fresh PR with no thread history resets you to #58861's position: a large unsolicited
feature with no team-member approval on record. It invites a process close before anyone
reads a line of code.

**The open PR with an engaged maintainer *is* the standing this feature has.**

### 2. Coordinate on #58755 first, and wait for a real acknowledgment

#58755 is `42piratas`'s PR, on `42piratas/zed:per-window-theme`. You have no push access,
and your branch shares no history with theirs. So there are exactly two routes, and
**it's their call which one**:

- They pull your branch into that PR's head (a history replacement — only with their
  explicit OK, and **they** do the push, not you).
- You open a successor PR framed as implementing the review, linking back in both
  directions.

Post a short comment on #58755 laying out both options. Then **wait for an actual
response.** Do not open a successor on silence.

:::caution[Write this comment yourself]
Three to five sentences, in your own voice. See
[Etiquette](/defending/etiquette/) — there is a specific reason this matters more in
this thread than it normally would.
:::

The substance to convey, in whatever words you'd actually use:

- You've implemented the requested changes on a fresh branch — window-resolved theme
  reads instead of draw-time global swapping, no gpui changes, persistence keyed by
  workspace id rather than `WindowId`.
- It's a ground-up rewrite, not a push to their branch, because you don't have push
  access and the two share no history.
- It's their PR, so you don't want to step on it: happy to prep the branch for them to
  pull in, or to open a successor linking back — whichever they and the maintainers
  prefer.

### 3. Frame the PR as *responding to review*, not proposing a feature

This is the single most important framing decision, and it should be visible in the
**first paragraph** of the body — not buried in a "background" section.

Structure:

1. What the feature is (two sentences).
2. **"This is a ground-up implementation of the changes requested on #58755."**
3. The three review requirements, each with what was done. See
   [Where the PR actually stands](/start/standing/#requirement-by-requirement).
4. Design, in brief.
5. Why the diff is large — **and the staged alternative you're offering**.
6. Known limitations.
7. Relationship to #58755, stated plainly.
8. `Release Notes:` as the final section.

## PR hygiene the repo actually enforces

From `CLAUDE.md`. A reviewer will notice if you get these wrong, and they're free to get
right.

| Rule | Applied here |
|---|---|
| Clear, imperative, correctly capitalised title | `Add per-window theme overrides` |
| **No** conventional-commit prefix (`feat:`, `fix:`) | ✅ |
| **No** trailing punctuation | ✅ |
| Optional crate prefix when one crate is the clear scope | **Omit** — this spans `theme`, `workspace`, `theme_selector`, `zed` |
| `Release Notes:` as the **final** section | Required |
| One bullet: `- Added ...` / `- Fixed ...` / `- Improved ...` / `- N/A` | `- Added support for setting and restoring a theme for an individual window.` |
| Blank line after the `Release Notes:` heading | Required |

And the rules-hygiene policy:

> If you discover a non-obvious pattern that would help future sessions, include a
> **"Suggested .rules additions"** heading in your PR description with the proposed text.
> Do **not** edit `.rules` inline during normal feature/fix work.

You have exactly one worth proposing — the
[theme-overrides layering rule](/architecture/07-layering/#the-suggested-rules-addition).
Proposing it *correctly* (in the description, for reviewers to accept or reject) rather
than committing it is itself a signal you read the contributing docs.

## The pre-publish checklist

Before posting anything:

- [ ] Intent comment posted on #58755, **and acknowledged**.
- [ ] `42piratas` has said which route they prefer.
- [ ] `./script/clippy` passes (not `cargo clippy`).
- [ ] `cargo test` passes for the touched crates.
- [ ] `git diff main...HEAD --stat -- crates/gpui` is **empty** — verify this yourself.
- [ ] Title has no prefix and no trailing period.
- [ ] `Release Notes:` is the final section, blank line after the heading, one bullet.
- [ ] Links to #58755 / #13300 / #32293 / #19510 / #22370 present.
- [ ] The three shape-determining questions are asked explicitly in the body.
- [ ] **Every word of prose is yours.**

## If it gets closed on process anyway

It might. If so, the response is not to argue — it's to do the thing they asked for:

> Understood. I'll open a Discussion for this and link the branch there, so there's
> something concrete to react to. The implementation follows the direction @osiewicz gave
> on #58755, so I'd rather not lose that thread of the conversation — happy to link both
> ways.

Then open the Discussion, link the branch, link #58755, and let it accumulate
engagement. Annoying, and slower. But the work doesn't evaporate, and a Discussion with a
working implementation attached is a much stronger artefact than a Discussion with an
idea.
