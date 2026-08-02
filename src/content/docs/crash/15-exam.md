---
title: 'Hour 15: The exam'
description: Five questions, out loud, unaided. Passing means stop studying — and failing tells you exactly which hour to replay.
sidebar:
  order: 16
---

Every other hour in this course was input. This one is a measurement.

Five questions. Out loud, without notes, without the page open. They are the same
five that open [Rust, for a TypeScript brain](/rust/how-to-use/), and they are
there because they are what a reviewer will actually use to check whether a human
understands the patch.

:::caution[Say them, don't think them]
Recognition and recall feel identical from the inside and are not the same skill.
You will be typing your answers into a GitHub thread under someone else's
scrutiny, so rehearse in the mode you will perform in. If you cannot get through
a sentence out loud, you do not know it yet — and that is useful information,
which is the entire point of this hour.
:::

## The five

### 1. The lifetime

> Why does `fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>` put `'a` on `cx`
> and the return type, but **not** on `&self` — and what would break if it did?

A complete answer names where the theme actually lives, and describes the
borrow-checker error you would get in a render pass. You provoked that exact error
in [hour 13](/crash/13-capstone/).

### 2. The cheap clone

> Why is `.clone()` on an `Arc<Theme>` not expensive?

A complete answer says what is copied and what is not, and why the counter has to
be atomic rather than a plain integer.

### 3. The closure

> Why can a closure that captures `window` not be stored in a field typed
> `fn(&App) -> Hsla`?

A complete answer explains what a `fn` pointer is at runtime, and what `dyn Fn`
would buy instead. The strong answer goes one further and says why the diff
*didn't* reach for `dyn Fn` — it resolves the theme where the callback is invoked
rather than where it is created. This is [hour 12](/crash/12-closures/), and you
have typed the error.

### 4. The parameter type

> What does `&impl ActiveTheme` mean as a parameter type, and why was it chosen
> over `&Theme`?

A complete answer covers what the caller may pass, and why a leaf helper wants the
trait rather than the concrete type.

### 5. The deletion

> Why does deleting a trait impl produce 1,800 compile errors, and why is that the
> *point*?

A complete answer treats the compiler as a work-enumeration tool, and says what
the smaller version of this PR would have gotten wrong. It should also concede
what the compiler did **not** do — it found the call sites; it did not decide which
of them wanted the window theme and which wanted the configured one.

## Scoring

There is no partial credit and there is no rubric, because the real one is a
maintainer's follow-up question.

| Result | What it means |
|---|---|
| All five, fluently | **Stop studying.** More preparation now has negative return |
| Four | Replay the one hour that question maps to, retake |
| Three or fewer | Go back to [hour 14](/crash/14-reading-the-diff/) and read the diff again with the stall list |

That first row is the one people ignore. Past this bar, the only remaining source
of new information is a reviewer, and no amount of re-reading produces it. The
course is over; the conversation is the next thing.

## If you fail a question

That is what the hour is for. A failed question is a pointer, and it is a much
better pointer than a feeling of general unreadiness:

| Failed | Replay |
|---|---|
| 1 | [Hour 9 — Lifetimes](/crash/09-lifetimes/) |
| 2 | [Hour 10 — Box, Rc, Arc](/crash/10-smart-pointers/) |
| 3 | [Hour 12 — Storing closures](/crash/12-closures/) |
| 4 | [Hour 8 — Traits and generics](/crash/08-traits/) |
| 5 | [Hour 13 — Capstone](/crash/13-capstone/), experiment 3 |

The exam is cheap to retake. Take it again in a week having done nothing, and see
what survived — recall that decays is worth knowing about *before* you are asked
in public.

## One more, unscored

Not on the list, but worth being able to answer, because it is the question a
reviewer reaches for when the code checks out:

> Where does this feature **not** apply, and how do you know that list is complete?

The answer is a `grep`, and it is
[the honest list](/gaps/the-honest-list/). Being able to hand someone the
boundaries of your own change is the single thing that most separates a patch that
gets merged from one that gets a long thread.

## You are done

Sixteen hours ago you had not written Rust. Go to
[Defending it](/defending/process/) and have the conversation.
