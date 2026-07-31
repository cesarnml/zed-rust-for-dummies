---
title: 'Gap 01: Mermaid and windowless renderers'
description: Your suspicion was right — mermaid diagrams fall back to the configured theme. Here is exactly why, and what a fix costs.
sidebar:
  order: 3
---

**Status:** Known, deliberately out of scope pending maintainer input.
**Severity:** Visible to users.
**Needs a maintainer decision:** Yes — blocker or v1 limitation?

:::note
You flagged this one yourself as a suspected gap. You were right, and it's worth
knowing that the code *already records* that it's deliberate — which turns "I missed
something" into "I marked it."
:::

## What's actually happening

`crates/markdown/src/mermaid.rs`:

```rust
use theme::ConfiguredTheme;   // ← this import was added on purpose

fn build_mermaid_theme(cx: &Context<Markdown>) -> mermaid_render::MermaidTheme {
    let colors = cx.configured_theme().colors();
    let theme_settings = ThemeSettings::get_global(cx);
    let is_dark = !cx.configured_theme().appearance.is_light();
    let players = cx.configured_theme().players();
    // ...
    error_color: cx.configured_theme().status().error,
    warning_color: cx.configured_theme().status().warning,
}
```

Those `configured_theme()` calls are **not oversights**. They were converted from
`cx.theme()`, and the `ConfiguredTheme` import was added specifically to make them
compile. They are marks left by
[the compiler-enforced migration](/architecture/02-active-theme-split/) saying:

> *this site was reviewed and could not be fixed.*

That's a meaningfully different thing to say in review than "I didn't get to it."

## Why it's structural, not lazy

`build_mermaid_theme` takes `&Context<Markdown>` and is called from
`MermaidState::update`, which is driven by markdown **parsing**, not painting.

A mermaid block is rendered to an image by `mermaid_render` on a background task and
cached. The theme has to be baked into that render **before there is any element tree**.
And `Context<Markdown>` carries no `Window` — because `Markdown` entities are updated
from subscriptions and tasks that fire outside a window update. That's why the signature
is `Context<Markdown>` in the first place.

This is the general shape of every gap on the list: **colour resolved outside the paint
path**.

## Why it wasn't fixed here

Three routes exist. None is small.

### 1. Thread a `Window` into markdown's update path

`Markdown::update` and the mermaid state machine would need `&mut Window`. But
`Markdown` entities are updated from subscriptions and tasks that fire outside a window
update. Changing that is a markdown-crate refactor with its own review surface.

### 2. Capture the resolved theme on the `Markdown` entity at creation

The entity *is* created inside a window, so it could capture `window.theme(cx)`.

This works, but introduces a **staleness problem**: the captured theme must be
invalidated when the window's theme changes, which means the `Markdown` entity needs to
observe theme changes and re-render every cached mermaid image.

Doable, but it's a cache-invalidation design, not a one-liner.

### 3. Key the mermaid render cache by theme

Pass the theme in at render-request time from a site that *does* have a window. Probably
the correct long-term answer. Also the largest.

**All three are markdown-crate work that is independent of whether per-window themes
exist.** Bundling any of them into an already-2,900-line PR makes it strictly harder to
land.

## The same shape elsewhere

Complete inventory of deliberate `configured_theme()` calls in non-test, non-example
code:

| Site | What's affected | Gap |
|---|---|---|
| `markdown/src/mermaid.rs` | Mermaid diagram colours | This one |
| `editor/src/editor.rs:3728`, `document_symbols.rs`, `semantic_tokens.rs`, `bracket_colorization.rs` | Syntax highlighting | [02](/gaps/syntax-highlighting/) |
| `terminal/src/terminal.rs:1584` | Terminal OSC colour queries | [09](/gaps/remaining/#gap-09--terminal-osc-colour-queries) |
| `miniprofiler_ui.rs:153`, `settings_ui.rs:878`, `zed/src/zed.rs:413` | New-window background appearance | [05](/gaps/remaining/#gap-05--windows-without-a-workspace) |
| `workspace/src/theme_preview.rs:92` | Theme preview tool | Arguably correct as-is |
| `zed/src/main.rs` | Language registry, telemetry | **Correct as-is** — genuinely global |

`markdown/examples/*.rs` also use `configured_theme()`; those are standalone example
binaries with no workspace and are correct.

Reproduce this table yourself before the review:

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v "tests\|fixtures\|examples"
```

## Recommendation for maintainers

**Ship per-window themes with mermaid on the configured theme, documented as a known
limitation**, and treat the markdown refactor as a follow-up.

The alternative — blocking the feature on a markdown caching redesign — trades a small
visible inconsistency for an indefinite delay.

**If maintainers disagree and want it fixed before merge:** route 2 (capture at entity
creation + observe theme changes) is the smallest complete fix and would land in
`crates/markdown` alone. Offering that as a scoped follow-up PR is a reasonable
compromise to have in your pocket.

## The open question

> Is a mermaid diagram that doesn't match its window a blocker, or an acceptable v1
> limitation?

## Related follow-up

This gap, [Gap 07](/gaps/remaining/#gap-07--theme-lifecycle-and-extensions), and
[Design 06's imprecise trigger](/architecture/06-deferred/#decision-1--trigger-on-globaltheme-change-not-a-registry-event)
would **all** be improved by a single addition: a theme-registry invalidation and
registration event. That's the highest-leverage follow-up on the whole list, and it's
worth naming as such if a maintainer asks what to do next.
