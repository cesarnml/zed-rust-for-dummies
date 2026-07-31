---
title: The honest list
description: Ten known limitations, deliberately deferred rather than discovered late.
sidebar:
  order: 1
---

Everything on this list is **known and deliberately deferred**, not discovered late.
Each entry states what the behaviour is, why it wasn't fixed on this branch, what a fix
would cost, and — where relevant — the open question a maintainer needs to answer.

:::tip[Why this list is an asset, not a liability]
A reviewer who finds an unlisted gap concludes you didn't understand your own change. A
reviewer who reads a list you wrote concludes you did. **Ship this list in the PR
description.** It is the single highest-leverage paragraph you can write.
:::

## The shared principle

This branch delivers per-window theming for **everything that resolves colour at paint
time with a `Window` in scope**.

Anything that resolves colour *outside* the paint path — background renderers, model
entities, app-level registries — still uses the configured theme. And crucially, **each
such site is marked in code with an explicit `cx.configured_theme()` call** rather than
being left ambiguous.

That's what makes the list enumerable at all:

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v "tests\|fixtures\|examples"
```

Before [the ActiveTheme split](/architecture/02-active-theme-split/), the equivalent
question — *"where does this feature not apply?"* — had no answer. Now it has a grep.

## The list

| # | Gap | Severity | Needs a maintainer decision? |
|---|---|---|---|
| [01](/gaps/mermaid/) | Mermaid diagrams and other window-less renderers | Visible | **Yes** — blocker or v1 limitation? |
| [02](/gaps/syntax-highlighting/) | Syntax highlighting is global | **High visibility** | **Yes** — is it in scope at all? |
| [03](/gaps/remaining/#gap-03--theme_overrides-dont-live-reload) | `theme_overrides` edits don't live-reload | Low | Yes — where does preview state live? |
| [04](/gaps/appearance/) | Overridden windows stop following light/dark | Medium | **Yes** — pin vs. per-window settings |
| [05](/gaps/remaining/#gap-05--windows-without-a-workspace) | Auxiliary windows don't inherit the override | Low–medium | Yes — should they inherit? |
| [06](/gaps/remaining/#gap-06--multi-workspace-tab-switch-semantics) | Theme changes when switching workspace tabs | Medium | **Yes** — confirm intended semantics |
| [07](/gaps/remaining/#gap-07--theme-lifecycle-and-extensions) | Uninstalled/renamed themes, stale `Arc<Theme>` | Low frequency, silent | Yes — notify or log-only? |
| [08](/gaps/remaining/#gap-08--telemetry-settings-surface-and-discoverability) | Telemetry name, settings surface, UI indicator | Non-blocking | Yes — several |
| [09](/gaps/remaining/#gap-09--terminal-osc-colour-queries) | Terminal OSC colour queries use configured theme | Low | No — just needs doing |
| [10](/gaps/remaining/#gap-10--icon-themes) | Icon themes are not per-window | Very low | Only to confirm scope |

## The single highest-leverage follow-up

**A theme-registry invalidation/registration event.**

It would improve [Gap 01](/gaps/mermaid/) and
[Gap 07](/gaps/remaining/#gap-07--theme-lifecycle-and-extensions) simultaneously, and it
would let the [deferred-reapply pass](/architecture/06-deferred/) trigger on the precise
signal instead of piggybacking on `GlobalTheme`.

If a maintainer asks "what's the one thing that would most improve this," that's the
answer. Having a ready answer to that question is worth having.

## The three questions that most affect the shape of the PR

Get answers to these **before** investing further review effort. They matter more than
closing any individual gap, because two of them could invalidate the branch's shape
entirely.

### 1. Is chrome-only per-window theming the intended feature?

Or does "per-window theme" imply syntax highlighting too? If maintainers consider
mismatched syntax colours unacceptable for v1, the honest sequence is to do per-window
syntax resolution first, as its own PR, and land this on top.

→ [Gap 02](/gaps/syntax-highlighting/)

### 2. Window state, or project configuration?

This branch stores the override as **window state** in the workspace DB. The adjacent
feature — a `"theme"` key in `.zed/settings.json` that any window opening that project
picks up — is a *different* feature with different security properties.

If maintainers want that one instead, **this branch is the wrong shape**, and finding
that out costs one comment rather than one review cycle.

→ [Gap 08](/gaps/remaining/#gap-08--telemetry-settings-surface-and-discoverability)

### 3. Is the 2,900-line migration acceptable in one PR?

Or should it be staged? You should
[offer the staged path proactively](/migration/why-big/#the-concession-to-offer-first)
rather than wait for the question.

→ [Design 02](/architecture/02-active-theme-split/)

## How to phrase the gap list in the PR

Don't paste the table. Write two short paragraphs:

> **Out of scope / known limitations.** A window override pins one concrete theme, so it
> doesn't follow system light/dark switching until cleared (documented in `themes.md`).
> Native OS chrome follows the system appearance. LSP semantic-token colours, terminal
> OSC colour-query responses, and rendered mermaid diagrams still read the configured
> theme — each is a windowless render path, and each is marked with an explicit
> `configured_theme()` call rather than left ambiguous. Syntax highlighting is likewise
> still global; making it per-window is a data-model change to `LanguageRegistry` that's
> larger and riskier than everything else here combined, so I'd rather it be your design
> than my unilateral refactor of the editor's hot path.
>
> There are ten of these in total and I've written them all up. Happy to paste the full
> list here or in a follow-up issue — tell me which you'd prefer.

That last sentence matters. It offers the detail without dumping it, and it signals the
work exists.
