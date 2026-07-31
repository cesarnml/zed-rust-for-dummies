---
title: 'Gap 02: Syntax highlighting'
description: The largest functional gap. Buffer text keeps the configured theme's colours even when the chrome uses the override.
sidebar:
  order: 2
---

**Status:** Known, out of scope. Arguably the largest functional gap in the feature.
**Severity:** High visibility.
**Needs a maintainer decision:** Yes — is it in scope at all?

## What a user sees

Set a window to a red-tinted theme. The title bar, tabs, panels, and background all turn
red. **The code in the buffer keeps your configured theme's syntax colours.**

That's the gap, and it's the first thing anyone will notice.

## Why it happens

Syntax highlighting does **not** read the theme at paint time. It resolves
`HighlightId`s against a `SyntaxTheme` that is pushed into the language layer **once,
globally**:

```rust
// crates/zed/src/main.rs
app_state.languages.set_theme(cx.configured_theme().clone());
cx.observe_global::<GlobalTheme>({
    let languages = app_state.languages.clone();
    move |cx| languages.set_theme(cx.configured_theme().clone());
}).detach();
```

`LanguageRegistry` is an **app-level singleton shared by every buffer in every window**.
There is exactly one `SyntaxTheme` in the process.

Downstream, several editor subsystems capture syntax styles the same way:

| Site | What it does |
|---|---|
| `editor.rs:3728` | `let syntax = cx.configured_theme().syntax().clone();` — outline symbols on a background task |
| `document_symbols.rs:53,219,942,1002` | Symbol label highlighting |
| `semantic_tokens.rs:304` | LSP semantic token colours |
| `bracket_colorization.rs:1746,1773,1774` | Bracket pair colours — **and it caches by theme *name***, so two windows on different themes would collide in the cache key |

:::note[A nuance worth knowing — the editor is partly correct]
`EditorStyle` construction *does* use the window theme:

```rust
// crates/editor/src/editor.rs:10897 and :11995
syntax: window.theme(cx).syntax().clone(),
```

So the editor's own style path is migrated. The gap is the **language registry** feeding
highlight data that was resolved globally, plus the four subsystems above that snapshot
the syntax theme outside a render pass. Being precise about this distinction is worth a
lot if a reviewer probes — it shows you traced the actual data flow rather than assuming.
:::

## What a per-window fix would require

This is **not a call-site migration; it is a data-model change.** `SyntaxTheme`
resolution would have to move from "one global, baked into the language registry" to
"resolved per window at highlight time." Concretely:

1. **`LanguageRegistry::set_theme` would have to stop being the source of truth**, or
   become per-window — but it is shared across windows by construction, and *buffers are
   shared across windows too*.
2. **`HighlightId` → style resolution would have to take a theme parameter** through the
   chunk-iteration path (`Chunk::syntax_highlight_id` → `theme.syntax().get(id)`). This
   already happens at some sites — `vim/src/state.rs` was converted exactly this way on
   this branch, taking `&theme::Theme` instead of `&App` in `from_chunks`.
3. **`bracket_colorization`'s cache would need a real key**, not a theme name.

**Point (1) is the hard one.** A buffer open in two windows with different themes needs
two different highlight styles for the *same text*. That means highlight styles cannot be
resolved at buffer level at all — they have to resolve during rendering. Some of the
editor already does this. The language registry path does not.

## Why it wasn't attempted

Three reasons, and you should give all three:

1. **It is bigger and riskier than the entire rest of this branch.** A 307-file
   mechanical migration is verifiable by inspection. Redesigning how highlight styles
   resolve is not.
2. **It touches the hottest path in the editor.** Chunk iteration runs on every frame of
   every visible buffer.
3. **It is orthogonal to per-window *chrome* theming**, which is what this feature
   delivers. Attempting it inside this PR would guarantee the PR is unreviewable.

## The argument that makes this acceptable

**The two most common use cases are satisfied without it.**

- Distinguishing a production checkout from a staging one at a glance.
- Distinguishing two windows in a screen-share.

Both work off window chrome and background — the parts that *are* themed.

And notably, [the accessibility issue (#58381)](https://github.com/zed-industries/zed/issues/58381)
that makes the strongest case for this feature is explicitly about **window-level colour
blocks** — title bar, tabs, panels — not about syntax colours inside the buffer:

> Text labels in a title bar are the exact thing my brain slides off of, I don't really
> read them, but a block of color I lock onto instantly.

So the feature as shipped fully satisfies the use case with the strongest justification
behind it. That's a genuinely good answer to "but your feature is incomplete," and it's
better than any technical argument you could make.

## Recommendation for maintainers

Document it and ship. If maintainers consider mismatched syntax colours unacceptable for
v1, the honest options are:

| Option | Assessment |
|---|---|
| **(a)** Restrict per-window themes to themes sharing a syntax theme | Not meaningful in practice |
| **(b)** Do the per-window syntax resolution work first, as its own PR, and land this on top | The right long-term sequence *if* they want the complete feature |
| **(c)** Ship as-is with a documented limitation | ✅ Recommended |

**(c)** is the recommendation. **(b)** is right if they want completeness — but it should
be **their call and their design**, not a contributor's unilateral refactor of the
editor's hot path. Saying that explicitly is important: it's the difference between "I
couldn't do it" and "I deliberately didn't, because this belongs to you."

## The open question to put to maintainers

> Is per-window syntax highlighting in scope for the concept of "per-window themes" at
> all, or is chrome-only the intended feature?

Ask this **early**, not after review. It's one of
[the three questions](/gaps/the-honest-list/#the-three-questions-that-most-affect-the-shape-of-the-pr)
that could change the shape of the whole PR, and getting it answered costs one comment.
