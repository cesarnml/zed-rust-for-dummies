---
title: Read this first
description: The situation, honestly assessed — including the part of your worry that turns out to be wrong.
sidebar:
  order: 1
---

You said, roughly: *"I don't feel confident defending this PR because my Rust
knowledge is minimal. The maintainers will be hostile because it touches so many
files, and if they'd wanted this feature it would already exist."*

Three claims. One is true, one is half true, and one is **factually wrong in your
favour** — and it happens to be the one that determines whether the review goes
well. Take them in reverse order.

## Claim 3: "If they'd wanted this, it would already be supported"

**This is wrong, and you can disprove it with a link.**

On 2026-06-22, `osiewicz` — a Zed core team member — reviewed
[PR #58755](https://github.com/zed-industries/zed/pull/58755), the previous
attempt at per-window themes, and left a `CHANGES_REQUESTED` review that says:

> Hey, thanks for submitting a PR. I believe you've went great lenghts to avoid
> making a complex change (as you've noticed, we're grabbing a theme from cx which
> won't fly with per-window overrides) by resorting to a way more complex solution
> instead (introducing APIs and swapping out global state underneath observers).
> Off the top of my head, it seems like the "simplest" solution would be to move
> `ActiveTheme` onto window - you'd need a window to grab the active theme, but I
> think that's ok. Yes, this will result in more code being changed, but ultimately
> I feel like that'd be way more correct and straightforward to reason about. You
> should not have to touch gpui at all to make this change.

Read that last paragraph again, then read the summary of your branch:

| What osiewicz asked for | What `cesar/per-window-theme` does |
|---|---|
| "move `ActiveTheme` onto window" | `trait WindowTheme { fn theme(&self, cx: &App) -> &Arc<Theme> }`, implemented for `Window` |
| "you'd need a window to grab the active theme" | `impl ActiveTheme for App` is **deleted**; app-level access is renamed `configured_theme()` |
| "this will result in more code being changed" | 307 files, ~1,800 call sites |
| "you should not have to touch gpui at all" | **Zero lines changed in `crates/gpui`** |

And in the same review, an inline comment on `crates/workspace/src/workspace.rs`:

> Window ids are not guaranteed to be stable. You should not use them to identify
> windows across restarts.

Your branch keys the *live* map by `WindowId` and persists by `WorkspaceId`, and
the doc comment on `WindowThemeOverrides` says so explicitly:

```rust
/// Per-window theme overrides keyed by runtime [`WindowId`].
///
/// Persistence is keyed by workspace id separately; this map is only the live
/// lookup used while painting a window.
```

**So the framing of your PR is not "here is a feature I think you should want."
It is "here is the change you asked for."** That is a completely different
conversation, and it is the single strongest asset you have. Lead with it. Details
in [Where the PR actually stands](/start/standing/).

## Claim 2: "The maintainers will be hostile because it touches so many files"

**Half true — and the half that's true is worth taking seriously.**

The true half: a 307-file diff is genuinely painful. It conflicts with everything
in flight, it is unreviewable line-by-line, and a reviewer's first instinct will be
"can this be smaller?" That instinct is correct and you should not be defensive
about it.

The half that isn't true: the size is not a surprise to them. The reviewer
predicted it in the review quoted above (*"yes, this will result in more code being
changed"*) and accepted it in advance as the price of correctness. The previous
author even asked, on 2026-06-21:

> Are you fine with a migration of that size, or did you have a narrower idiom in
> mind? e.g. keeping a `cx.theme()`-style accessor that resolves against the window
> the context belongs to

That question was never answered on the merits — the thread went sideways into a
process discussion instead (see [Etiquette](/defending/etiquette/)). **So the size
question is genuinely open**, and the right move is to answer it proactively rather
than wait to be asked:

> Most of the diff is one mechanical rewrite. If you'd rather have it staged, the
> natural split is: (1) introduce `WindowTheme` + `ConfiguredTheme` while keeping
> `impl ActiveTheme for App`, (2) migrate crate by crate, (3) delete the `App` impl
> last. I'm happy to do that; it's more PRs but each is trivially reviewable.

Offering the staged version *before* they demand it converts "this contributor
doesn't understand review economics" into "this contributor thought about it."
Full treatment in [Why it is that big](/migration/why-big/).

## Claim 1: "My Rust knowledge is minimal"

**True, and it's the fixable one.** That's what the rest of this site is for.

The good news is that the surface area is small and bounded. This PR does not
require you to understand Rust in general. It requires you to understand **eight
things**, and every one of them shows up in the diff at a specific line you can
point at:

1. **Ownership and borrowing** — why half the diff has the shape it has.
2. **Traits** — the entire mechanism of the change is one trait swap.
3. **Lifetimes** — one line (`fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>`)
   is what made a 2,900-line migration mechanical instead of impossible.
4. **`Arc<T>`** — why `.clone()` appears everywhere and why it isn't expensive.
5. **`Option` / `Result` / `?`** — the error handling the repo's rules mandate.
6. **Closures vs `fn` pointers** — why one rewrite shape exists at all.
7. **`'static` and `Send`** — why stored callbacks can't just capture the window.
8. **Macros** — one three-line addition to `sqlez` you'll be asked about.

That's the whole list. [Start here](/rust/how-to-use/).

## The uncomfortable thing you should know going in

There is a fourth fact you didn't mention, and it matters more than any of the
above.

On 2026-06-22, in the same review thread, `osiewicz` wrote:

> I am concerned that you're using LLMs to interact with me within this thread. Is
> it the case?

The previous author confirmed it. Zed's `CONTRIBUTING.md` has an explicit AI policy:
they accept LLM-assisted code, they do **not** accept contributions from autonomous
agents, and they specifically ask you not to use a model to write your replies to
maintainers.

That thread is the thread your work lands in. A maintainer who has already flagged
engagement quality once will be reading your comments with that in mind.

**Practical consequence:** everything on this site is material for you to
*understand*, not text to paste. Write every PR comment in your own words, from
your own understanding, with your own hedges and your own typos. If you can't
explain a section of this site out loud without reading it, you are not ready to
be asked about that section — go back and read it again.

That is not a limitation of the work. It is the entire reason this site exists.

See [Etiquette and the AI policy](/defending/etiquette/) for the full treatment.
