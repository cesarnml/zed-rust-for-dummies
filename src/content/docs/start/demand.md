---
title: Who asked for this
description: The community demand paper trail — including the accessibility argument you should not skip.
sidebar:
  order: 4
---

You said the community wants this. They do, and it's worth having the specifics at
hand, because "users want it" is only persuasive when you can name them.

## The primary artefact

**[Issue #13300 — "Per-project themes (multiple active themes)"](https://github.com/zed-industries/zed/issues/13300)**

- **Open.** Not closed, not marked duplicate.
- **133 👍**
- **35 comments**

This is the one to cite. Everything else is a duplicate of it, and the triage bot
has been closing the duplicates as "completed" while #13300 itself stays open —
which is worth understanding, because at a glance the closed duplicates look like
maintainers rejecting the feature, and they aren't. They're deduplication.

## The duplicates, and what each adds

| Issue | State | What it contributes |
|---|---|---|
| [#22370](https://github.com/zed-industries/zed/issues/22370) | Closed as dup | The original framing. Explicitly names the VS Code extension precedent. |
| [#19510](https://github.com/zed-industries/zed/issues/19510) | Closed as dup | "Customisable per window colors" |
| [#19503](https://github.com/zed-industries/zed/issues/19503) | Closed as dup | "Local Theme override" |
| [#57311](https://github.com/zed-industries/zed/issues/57311) | Closed as dup | The most detailed technical writeup — names Peacock, cites its 1M+ installs, and enumerates exactly why `ProjectSettings` can't express it today. |
| [#58381](https://github.com/zed-industries/zed/issues/58381) | Closed as dup | The accessibility argument. See below. |
| #32293 | Discussion | Referenced by #58755 as the discussion thread. |

## The accessibility argument

[#58381](https://github.com/zed-industries/zed/issues/58381) is the one you should
read in full and be prepared to quote, because it reframes the feature from
"cosmetic nicety" to something with a different weight. Its author opens by
acknowledging it's a duplicate and saying they're filing anyway:

> I'm adding more noise on purpose, because I don't think the accessibility angle
> has really been said out loud yet.

Their argument, condensed:

> These days I never have just one window open. It's usually 4-5 projects at once,
> plus agents running. And every Zed window looks exactly the same. […] I'm
> dyslexic and have ADHD. Color isn't a nice extra for me, it's how I find things.
> Text labels in a title bar are the exact thing my brain slides off of, I don't
> really read them, but a block of color I lock onto instantly.

This matters for your defence in two specific ways:

**One:** it answers "isn't this just sprinkles?" — which is the framing you
yourself reached for. Visual differentiation of windows is a low-cost affordance
with a real accessibility payoff for a population that is not small. You do not
have to oversell it; you just have to not undersell it.

**Two:** it supports the *chrome-only* scope of this branch. The argument is about
window-level colour blocks — title bar, tabs, panels, background — not about syntax
colours inside the buffer. So the feature as shipped, with
[syntax highlighting still global](/gaps/syntax-highlighting/), fully satisfies the
use case that has the strongest justification behind it. That is a genuinely good
answer to "but your feature is incomplete."

:::note[Do not lead with this]
The accessibility angle is a strong *supporting* argument and a weak *opening* one.
Leading with it can read as leverage rather than reasoning, and this maintainer team
has already had one bad-faith-adjacent interaction in this thread. Lead with the
review compliance ([Standing](/start/standing/)); bring this out if the feature's
worth is questioned.
:::

## The cross-editor precedent

[Peacock](https://github.com/johnpapa/vscode-peacock) for VS Code — over one million
installs — does exactly this by writing `workbench.colorCustomizations` into each
project's `.vscode/settings.json`.

There are two things to say about it, and the second is the more useful one:

1. **Demand is proven.** A million people installed a third-party extension to get
   this. It is not a hypothetical want.

2. **Zed can do it better, and this branch does.** Peacock's mechanism has a real
   flaw that Zed users have complained about: it writes personal colour preferences
   into a file that gets committed, so your teammates inherit your window tint. The
   discussion under [PR #40418](https://github.com/zed-industries/zed/pull/40418)
   called this out directly, and credited Zed for not having made that mistake.

   This branch stores the override **user-side, in the workspace database**. It
   cannot be committed. That is a deliberate improvement on the precedent, and it is
   worth one sentence in the PR description — it shows you understood the prior art
   rather than just copying it.

## How to use this in the PR

One short paragraph, not a wall of links:

> Related: #13300 (open, 133 👍) is the primary request; #22370, #19510, #19503,
> #57311 and #58381 are closed duplicates of it. #58381 makes the accessibility
> case specifically. VS Code's Peacock extension (1M+ installs) is the cross-editor
> precedent; this implementation deliberately stores the override user-side rather
> than in project settings, which avoids Peacock's habit of leaking personal colour
> choices into version control.

And then stop. The demand is not the contested part of this PR — the diff size and
the process gate are. Do not spend your reviewer's attention on the easy half.
