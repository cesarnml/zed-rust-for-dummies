---
title: How to use this section
description: The eight Rust concepts this PR actually requires, and nothing else.
sidebar:
  order: 1
---

This is not a Rust tutorial. It is the **specific subset of Rust that appears in
this diff**, in the order the diff needs it, with a TypeScript analogy for every
concept and a real line from the branch as the anchor.

## The contract

If you can do the following out loud, without notes, you can defend the PR:

1. Explain why `fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>` puts `'a` on
   `cx` and the return type but **not** on `&self` — and what would break if it did.
2. Explain why `.clone()` on an `Arc<Theme>` is not expensive.
3. Explain why a closure that captures `window` cannot be stored in a field typed
   `fn(&App) -> Hsla`.
4. Explain what `&impl ActiveTheme` means as a parameter type and why it was chosen
   over `&Theme`.
5. Explain why deleting a trait impl produces 1,800 compile errors and why that is
   the *point*.

Everything else is detail you can look up during a review. Those five are the ones
a reviewer will use to check whether a human understands the patch.

## The eight concepts

| # | Concept | Where it shows up | Page |
|---|---|---|---|
| 1 | Ownership, borrowing, moves | Why helpers take `&Theme` instead of `&App` | [Ownership](/rust/ownership/) |
| 2 | Traits | The entire mechanism: `ActiveTheme` → `WindowTheme` + `ConfiguredTheme` | [Traits](/rust/traits/) |
| 3 | Lifetimes | `WindowTheme::theme`'s signature — the load-bearing line | [Lifetimes](/rust/lifetimes/) |
| 4 | `Arc<T>`, `SharedString`, `HashMap` | `Arc<Theme>` everywhere; the override map | [Arc, Option, Result](/rust/pointers/) |
| 5 | `Option` / `Result` / `?` | `override_for` returns `Option`; error rules in `CLAUDE.md` | [Arc, Option, Result](/rust/pointers/) |
| 6 | Closures vs `fn` pointers | Rewrite Shape 4 — the editor's highlight callbacks | [Closures](/rust/closures/) |
| 7 | `'static` and `Send` bounds | Rewrite Shape 5 — stored tooltips, drag handlers, background tasks | [Closures](/rust/closures/) |
| 8 | Macros, generics, modules | The `sqlez` 11-tuple; `&impl Trait`; `pub(crate)` | [Generics, macros, modules](/rust/generics/) |

## A note on how Rust will feel to you

You come from TypeScript and functional programming. That's a good starting point
for this codebase and a bad one for two specific things.

**Good:** Rust's `Option`/`Result`, exhaustive `match`, immutability by default,
traits-as-interfaces, and iterator chains will all feel familiar. GPUI's
`Entity<T>` is basically a store/atom with explicit access. Elements compose like
JSX. You will read a lot of this code without effort.

**Bad, part 1 — ownership.** TypeScript has one memory model: everything is a
reference, the GC cleans up, you never think about it. Rust makes you say, for
every value, whether you're *giving it away* (move), *lending it read-only*
(`&T`), or *lending it exclusively* (`&mut T`). About a third of the interesting
rewrites in this diff exist because a naive change violated one of those rules.

**Bad, part 2 — the compiler is a participant.** In TypeScript the type checker is
advisory; you can `any` your way past it. In Rust it is load-bearing. This PR's
central design decision — delete `impl ActiveTheme for App` so every call site
breaks — only makes sense if you accept that "the compiler enumerates the work" is
a legitimate engineering strategy rather than a nuisance. Internalise that and the
diff stops looking reckless and starts looking careful.

## How to read the code alongside this

Keep the branch checked out and open files as you go. Every page names real paths.
The single highest-value thing you can do is:

```bash
git diff main...HEAD -- crates/theme/src/theme.rs
```

That is ~115 lines and it contains the entire feature's core. Everything else in the
307 files is either a consequence of it or a supporting cast member.
