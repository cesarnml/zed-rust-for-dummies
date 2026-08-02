---
title: 'Hour 14: Reading the real diff'
description: Stop writing synthetic Rust. Open theme.rs, 115 lines, and say what each one does out loud.
sidebar:
  order: 15
---

No new syntax this hour. No exercises to type. This is where the practice stops
and the actual artifact starts.

You have written the architecture yourself, in [hour 13](/crash/13-capstone/).
Now read the version that has GPUI in it.

## The one command

With the branch checked out:

```bash
git diff main...HEAD -- crates/theme/src/theme.rs
```

That is about 115 lines and it contains the entire feature. The other 306 files
are either a consequence of it or a supporting cast member. If you only ever read
one part of this PR, read this one.

## How to read it

**Out loud.** Not metaphorically — actually say it, to a rubber duck, a partner,
or an empty room. Silent reading lets you skim past the line you don't understand;
your mouth will not let you, because it has to produce a word.

For each line, say two things: what it does, and why it is there rather than the
obvious alternative.

Where you stall, write the line down. **That list is your syllabus.** It is more
accurate than any reading order this site could have guessed for you, because it
is measured on you rather than on a hypothetical reader.

Almost every stall maps to an hour you have already done:

| If you stall on | Go back to |
|---|---|
| `&'a Arc<Theme>` and where the lifetime sits | [Hour 9](/crash/09-lifetimes/) |
| Why there are two traits instead of one | [Hour 8](/crash/08-traits/) |
| `Arc` vs `Rc` vs a plain `Theme` | [Hour 10](/crash/10-smart-pointers/) |
| A stored callback that won't take `window` | [Hour 12](/crash/12-closures/) |
| `HashMap<WindowId, Arc<Theme>>` and its entry API | [Hour 7](/crash/07-collections/) |
| `impl Global for WindowThemeOverrides {}` | [Hour 8](/crash/08-traits/) — a trait with no methods, implemented for your own type |

## The four anchors

Four things in that file carry everything else. Find each one and be able to
point at it.

1. **`trait WindowTheme`** — one method, `fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>`.
   The lifetime is on `cx` and the return, not on `&self`. You built this exact
   signature in hour 13 and broke it on purpose; here it is in production.
2. **`WindowThemeOverrides`** — the `HashMap<WindowId, Arc<Theme>>` behind a
   global. The override map, keyed the same way as your capstone.
3. **The deletion.** `impl ActiveTheme for App` is *removed*. This is the line
   that produces the other 306 files, and it is the design decision the whole PR
   is arguing for.
4. **`configured_theme()`** — the renamed app-level accessor. Every call site
   that genuinely wants the global theme now has to say so in writing, which is
   what makes the gap list enumerable by `grep`.

## Then read outward, in this order

Once `theme.rs` makes sense, the rest is downhill. Read the design notes with the
files open beside them:

1. [Window theme resolution](/architecture/01-resolution/) — the one choke point.
2. [Splitting ActiveTheme](/architecture/02-active-theme-split/) — why the
   deletion, and why the diff is 307 files.
3. [Persistence by workspace id](/architecture/04-persistence/) — the column, and
   the `sqlez` 11-tuple you will be asked about.
4. [The seven rewrite shapes](/migration/shapes/) — what the 2,900 mechanical
   lines actually look like, including the two that are hour 12's material.

## What you are checking for

Not that you can reproduce it. That you can **answer a question about it that you
have not seen in advance** — which is the only thing a review actually tests.

A useful self-check while reading: for any line, could you say what would break if
it were written the obvious way instead? If yes for most of the file, you are
ready for [hour 15](/crash/15-exam/).

## What you should be able to do now

Open `crates/theme/src/theme.rs`, read the diff top to bottom without a reference,
and name which of the previous hours each unfamiliar construct belongs to.

One hour left, and it is the only one with a pass mark.
