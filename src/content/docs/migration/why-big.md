---
title: Why it is that big
description: The size argument, with the numbers, the anecdote, and the concession to offer first.
sidebar:
  order: 1
---

This is the objection you will definitely get. Have the numbers, the anecdote, and the
concession ready — in that order.

## The numbers

```bash
git diff main...HEAD --stat | tail -1
# 307 files changed, 4701 insertions(+), 3078 deletions(-)
```

Broken down:

| Category | Files | Roughly | What it is |
|---|---|---|---|
| **The feature** | ~7 | ~200 lines | `theme.rs`, `theme_selector.rs`, `workspace.rs`, `persistence.rs`, `main.rs`, `zed_actions`, `themes.md` |
| **API shape changes** | ~10 | ~300 lines | Leaf helpers moving from `&App` to `&impl ActiveTheme` |
| **Mechanical churn** | ~290 | ~2,900 lines | `cx.theme()` → `window.theme(cx)`, `_:` → `_window:` |

Two numbers worth being able to quote:

```bash
git grep -c "window\.theme(cx)" -- 'crates/**/*.rs' | awk -F: '{s+=$2} END {print s}'
# 1177

git grep -c "cx\.theme()" -- 'crates/**/*.rs' | awk -F: '{s+=$2} END {print s}'
# 49  — all of which are inside crates/agent/src/tools/evals/fixtures/, i.e. test
#        fixtures that are snapshots of old code, not live call sites
```

That second command is a good one to run *in front of* a reviewer's question. It shows
the migration is complete, not partial.

## The one-sentence argument

> The feature is ~200 lines. The other 2,900 exist because I deleted the old accessor
> so the compiler would enumerate every call site, and any smaller version of this PR
> is a feature that only works in the panels I happened to remember.

## The anecdote that makes it concrete

Abstractions don't persuade; a found bug does. Use this one.

In `crates/zed/src/main.rs` there is a settings observer that loops over every open
window and reapplies its background appearance:

```rust
// before
for &mut window in cx.windows().iter_mut() {
    let background_appearance = cx.theme().window_background_appearance();
    ...
}
```

**Any settings change at all** — a keybinding edit, a toggled preference, a theme file
reload — would reset every overridden window's background to the configured theme's
appearance. If your override was opaque and your configured theme was transparent, the
window visibly changed and stayed wrong.

Now look at why no audit would have caught it:

- It is **not a render function**. "Check the drawing code" doesn't reach it.
- It has **no `Window` in scope**. It iterates `cx.windows()` and holds only
  `WindowId` values, so a search for "places with a window that read the theme" misses
  it.
- It **looked completely normal**. `cx.theme().window_background_appearance()` is an
  unremarkable line of code.

It was found because deleting `impl ActiveTheme for App` **made it fail to compile**,
forcing a human to read it and decide what it should do. That is what the 2,900 lines
bought.

→ [Design 05, Decision 3](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset)

## Why the alternatives are worse

A reviewer will propose at least one of these. Have the answer.

### "Just add `window.theme(cx)` and migrate opportunistically"

This is the silent-bypass failure mode. Both accessors coexist; the feature ships
half-working; the broken half is invisible until a user files a bug about one panel not
matching. And there's **no end state** — the codebase sits permanently mixed, and every
new `cx.theme()` anyone writes is a fresh latent bug that nothing catches.

### "Use `#[deprecated]` instead of deleting"

The compiler *does* enumerate — as warnings. But Zed's builds aren't warning-free across
the whole tree, 1,800 warnings are unreadable, a warning doesn't prevent new
occurrences, and the deprecated symbol stays in the `theme` crate's public API forever.

### "Add a clippy `disallowed_methods` lint"

**This is the strongest alternative and you should concede it as such.** It's arguably
the most idiomatic Rust answer.

Why it wasn't the primary mechanism: a lint still lets `cx.theme()` compile locally for
anyone who hasn't run `./script/clippy`, and the correct replacement is
context-dependent — `window.theme(cx)`, `cx.configured_theme()`, or threading a
`&Theme`, depending on the site. A lint can complain but can't do the rewrite.

It remains a **good supplement**, and offering it that way is a genuine good-faith move:
*"if you'd rather keep `cx.theme()` for compatibility, a `disallowed_methods` entry
pointed at it would cover new code — I'd be happy to add that instead of the deletion."*

### "Make `cx.theme()` resolve against the window the context belongs to"

The previous author asked osiewicz about exactly this on #58755, and **never got an
answer**. So it's genuinely open, and you should raise it yourself rather than pretend
it isn't.

The honest assessment: a `Context<T>` doesn't reliably know its window. `Context<T>`
derefs to `App` and is used from background tasks, model entities, and subscriptions
that have no window at all — that's precisely why the
[gap list](/gaps/the-honest-list/) exists. A magic accessor would have to fall back to
the global theme in those cases, which reintroduces the silent-bypass bug at exactly
the sites hardest to notice. Making the fallback explicit (`configured_theme()`) is
what makes those sites greppable.

But say it as an assessment, not a verdict. The reviewer may know something about
`Context<T>` that you don't.

## The concession to offer first

Do not wait to be told the diff is too big. Offer the staged version in the PR
description:

> Most of this is one mechanical rewrite. If you'd prefer it staged, the natural split
> is:
>
> 1. Introduce `WindowTheme` and `ConfiguredTheme` while **keeping**
>    `impl ActiveTheme for App`. Small, additive, no behaviour change.
> 2. Migrate crate by crate — `ui`, then `editor`, then the rest. Each is
>    independently reviewable and independently revertible.
> 3. Delete the `App` impl last, at which point the remaining errors are the sites
>    nobody got to.
>
> That's more PRs and more total work, but each one is trivially reviewable. Happy to
> do it that way if you prefer.

Two reasons this is the right move:

1. **It's true.** The split works, and it's how you'd do it if the diff had to land
   over a release cycle.
2. **It changes the frame.** "Contributor doesn't understand review economics" becomes
   "contributor thought about review economics and has a plan." That is worth more than
   any argument about why the big version is fine.

## Also offer to drop the renames

The `_:` → `_window:` parameter renames are a meaningful share of the noise and they're
**trivially separable**. Say so:

> The `_` → `_window` renames are separable into their own commit or dropped entirely.
> I did them so window availability is greppable and so the next person needing a theme
> in one of those functions has a one-line change instead of a two-line one — but
> that's a preference, not a requirement.

Conceding a genuinely optional point early buys credibility for the ones that aren't
optional.

## What not to do

- **Don't be defensive about the size.** It *is* painful. Acknowledge it in the first
  paragraph of the PR description.
- **Don't claim it's unavoidable.** It's avoidable — by staging. Claim it's *correct*,
  and offer the staged path.
- **Don't bury the feature.** A reviewer's first question is "which files do I actually
  read?" Answer it in the description with a list of the seven files that carry logic.
  See [File map](/reference/file-map/).
