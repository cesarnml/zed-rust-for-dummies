---
title: Etiquette and the AI policy
description: A maintainer has already raised this concern in the exact thread your work lands in. Read this before you type anything.
sidebar:
  order: 3
---

:::danger[This page matters more than the technical ones]
The single fastest way to lose a review that is going well is to sound like a model.
That has already happened once in this thread, to the previous author, with the
maintainer you'll be talking to.
:::

## What happened

On 2026-06-22, immediately after leaving a substantive architecture review on #58755,
`osiewicz` posted:

> I am concerned that you're using LLMs to interact with me within this thread. Is it
> the case? Have you read [CONTRIBUTING.md](https://github.com/zed-industries/zed/blob/main/CONTRIBUTING.md#ai-policy)
> and specifically this excerpt:
>
> > We welcome the use of LLMs for coding, but we hold a high bar for all contributions,
> > and we expect a human in the loop who genuinely understands the work an LLM produces
> > on their behalf. For that reason, we don't accept contributions from autonomous
> > agents. Pull requests that appear to violate this may be closed, sometimes without
> > notice.
> >
> > Don't rely on LLMs to write the whole thing for you when communicating with the
> > maintainers (meaning replies to comments, PR descriptions, and alike). The readers
> > are humans, and we'd like to hear from you, not from a model (we have models at
> > home).

The author replied:

> Yes, I was indeed using it to speed up the comms - but glad to message you personally
> from now on. I'm sorry, I wasn't aware of that particular restriction.

**That is the thread your work lands in.** The maintainer has flagged engagement quality
once and will be reading with that in mind.

## What the policy actually says

Parse it carefully, because it's more permissive than a skim suggests:

| Allowed | Not allowed |
|---|---|
| ✅ Using LLMs to write code | ❌ Contributions from autonomous agents |
| ✅ Using LLMs to understand a codebase | ❌ LLM-written replies to maintainers |
| ✅ Non-native speakers using a model to edit for clarity | ❌ LLM-written PR descriptions |
| | ❌ Shipping work you can't explain |

The bar is: **a human in the loop who genuinely understands the work.**

You are allowed to have used AI heavily. You are not allowed to be absent from the
conversation.

## What this means for this site

Everything here is **material to understand, not text to paste**.

The design notes, the objection answers, the walkthrough script — all of it is written to
be *internalised and then said in your own words*. If you paste any of it verbatim into a
GitHub comment, you will produce exactly the register that got flagged, in the exact
thread where it got flagged.

**The test:** can you explain a section out loud, without reading it, to someone who
hasn't seen the code? If not, you're not ready to be asked about that section. Go read it
again.

## How to actually write the comments

### Keep them short

The previous author's flagged comment was long, structured, and had bullet points with
bolded lead-ins. Three to five sentences is plenty for a status update. If you need
structure, you're probably answering three questions at once — answer one.

### Sound like a person with a specific opinion

Models hedge symmetrically and cover every case. People have a view.

**Model-shaped:**

> This approach offers several advantages. It provides compile-time guarantees while
> maintaining backward compatibility. However, it does introduce a larger diff, which
> may present review challenges. There are trade-offs to consider in either direction.

**Person-shaped:**

> I went with deleting the `App` impl because I couldn't think of another way to be sure
> I'd caught every call site. The diff is horrible, and I'd understand if you want it
> staged.

### Say "I don't know"

Nothing reads as more human, and nothing is more useful to a reviewer. Then go find out.

> I'm not sure what `ToggleMode` should do in an overridden window, honestly. Right now
> it toggles the global setting based on the window's appearance, which is weird. What
> would you want?

### Be specific about what you did and didn't do

> I didn't touch syntax highlighting. `LanguageRegistry` has one `SyntaxTheme` for the
> whole process and buffers are shared across windows, so it's a data-model change, not a
> call-site one. That felt like your call rather than mine.

That paragraph does three things at once: demonstrates you traced the actual constraint,
states a boundary, and defers appropriately. No model wrote it, because a model wouldn't
have committed to "that felt like your call rather than mine."

### Don't over-apologise, don't over-explain

One sentence of acknowledgment, then the substance. A wall of preamble reads as either
anxiety or generation.

## The disclosure question

Should you say you used AI heavily?

**You don't have to volunteer it, and you shouldn't perform it either way.** The policy
permits LLM-assisted code. What it prohibits is absence and incomprehension.

**But if you're asked directly, answer honestly and immediately.** The previous author
did, and the thread continued. Denying it or dodging would have ended it.

A good shape for that answer:

> Yeah, I used Claude heavily on the implementation and on working through the design
> trade-offs — I'm not a Rust developer by background. I've gone through the whole thing
> since and I can walk you through any of it. The comments here are mine.

**That last sentence has to be true.** It's the whole reason this site exists rather than
a folder of drafts to copy from.

## Practical checklist before you post anything

- [ ] Did I write these words, or edit generated words? (Editing is not writing.)
- [ ] Is it under six sentences?
- [ ] Does it contain at least one thing I'd only say if I'd actually read the code?
- [ ] Are the hedges *my* uncertainties, or symmetric coverage of every case?
- [ ] Could I defend every claim in it if pushed?
- [ ] Have I said "I don't know" anywhere I actually don't?

## The thing to hold onto

The technical work is genuinely good, and it is genuinely what the maintainer asked for.
The way to lose it is to sound like nobody's home.

Learn the material, close the tab, and write like yourself.
