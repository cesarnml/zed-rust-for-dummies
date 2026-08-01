---
title: How this crash course works
description: Twelve focused hours to get from zero Rust to reading the diff without flinching. Hands on a keyboard, no Zed anywhere.
sidebar:
  order: 1
---

The [next section](/rust/how-to-use/) teaches the eight Rust concepts this PR
touches, each anchored to a real line in the diff. It assumes you can already
read Rust.

This section is how you get there. Twelve hours, at a keyboard, writing programs
that have nothing to do with Zed.

## Why not just read the diff

Because you will learn ownership faster from a 20-line program that refuses to
compile than from a 307-file one. When the borrow checker rejects your own toy,
the error is about *your* code and you can change one thing and re-run. When it
rejects a line in `theme.rs`, you are debugging Rust and GPUI and the PR's design
simultaneously, and you cannot tell which one you don't understand.

Get the reflexes on small code. Then read the diff.

## The shape of the twelve hours

Each page is one focused hour. They are cumulative — hour 7 assumes hour 3.

| Hour | What you build | Why it's here |
|---|---|---|
| [1](/crash/01-setup/) | Toolchain, `cargo new`, hello world | You cannot learn Rust by reading |
| [2](/crash/02-values/) | A unit converter | Bindings, functions, `match` |
| [3](/crash/03-ownership/) | Programs that deliberately fail | **Ownership.** The big one |
| [4](/crash/04-borrowing/) | A word counter | **Borrowing**, `&mut`, the one rule |
| [5](/crash/05-structs-enums/) | A shape area calculator | Structs, enums, `impl`, `Option` |
| [6](/crash/06-errors/) | A config parser | `Result`, `?`, error types |
| [7](/crash/07-collections/) | A word-frequency report | `Vec`, `HashMap`, iterators, closures |
| [8](/crash/08-traits/) | A pluggable renderer | **Traits**, generics, `impl Trait`, `dyn` |
| [9](/crash/09-lifetimes/) | A borrowing parser | **Lifetimes**, and why they appear |
| [10](/crash/10-smart-pointers/) | A shared cache | **`Arc`**, `Rc`, `RefCell`, `Mutex`, `Send` |
| [11](/crash/11-modules-tests/) | A multi-file crate with tests | Modules, `cargo test`, derive macros |
| [12](/crash/12-capstone/) | **A miniature of this PR** | Everything, assembled |

Bold rows are the ones the diff leans on hardest. If you have less than twelve
hours, do 3, 4, 8, 9, 10, and 12, and accept that the others will bite you later.

## The capstone is the point

Hour 12 builds a tiny program with a global theme, a per-window override map, a
trait split into "the configured one" and "the one for this window", and an
accessor whose lifetime ties its result to the app rather than the window.

That is the architecture of the 307-file PR, in about 150 lines you write
yourself, with no GPUI in the way. If you do nothing else in this section, do
hour 12 — but it will only make sense if you have done 3, 4, 8, 9 and 10 first.

## Rules

**Type the code. Do not paste it.** The muscle memory of `&mut` and `.clone()`
and `match` is most of what you are buying with these twelve hours.

**Run everything.** Every snippet here compiles (there is a script in the repo
that checks it). When a snippet is *supposed* to fail, the page says so and shows
you the error — type those too. Reading a borrow-check error you provoked on
purpose is worth an hour of prose.

**Do the exercises before the solutions.** They are short on purpose.

**Let the compiler teach.** Rust's errors are unusually good. When one appears,
read the whole thing, including the `help:` line. Then run
`cargo clippy` and read those too.

:::tip[Don't fight the borrow checker in week one]
If you are stuck on an ownership error for more than ten minutes, `.clone()` it
and move on with a `// TODO: revisit` comment. Getting the program working
teaches you more than winning the argument. You can come back once you have
hour 10's vocabulary — and half the time the answer turns out to be "clone an
`Arc`, it's an atomic increment", which is exactly what the PR does.
:::

## What this deliberately skips

Async and `Future`, unsafe, FFI, trait-object safety rules in depth, `Pin`,
declarative macro authorship beyond reading them, and most of the standard
library. Zed uses async heavily, but this PR barely touches it, and it is the
single fastest way to spend four hours and learn nothing about the diff.

When you finish hour 12, go to
[Rust, for a TypeScript brain](/rust/how-to-use/) and the code will look like
code rather than punctuation.
