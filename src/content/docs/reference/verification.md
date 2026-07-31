---
title: Verification commands
description: Run these before the review so every claim you make is one you have checked.
sidebar:
  order: 3
---

Every claim on this site is checkable. Check them yourself — a claim you verified an hour
ago is one you can state without hedging, and hedging is what gets probed.

All commands assume `cwd` is your Zed checkout with `cesar/per-window-theme` checked out.

## The headline numbers

```bash
git diff main...HEAD --stat | tail -1
```

Expect: `307 files changed, 4701 insertions(+), 3078 deletions(-)`

```bash
git log --oneline main..HEAD
```

Expect seven commits.

## The constraint the maintainer imposed

```bash
git diff main...HEAD --stat -- crates/gpui
```

**Expect: empty output.** This is the single cheapest credibility check available. Run it
before you write the PR description.

## Migration completeness

```bash
git grep -c "window\.theme(cx)" -- 'crates/**/*.rs' | awk -F: '{s+=$2} END {print s}'
```

Expect ~1,177.

```bash
git grep -n "cx\.theme()" -- 'crates/**/*.rs'
```

Expect: **only** hits inside `crates/agent/src/tools/evals/fixtures/`, which are
snapshots of old code used as test fixtures, not live call sites. Plus one hit in
`crates/theme/src/theme.rs` — inside the doc comment that says `cx.theme()` deliberately
doesn't exist.

If this returns anything else, the migration is incomplete and you need to know before a
reviewer does.

## The gap inventory

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v "tests\|fixtures\|examples"
```

Expect a short list you can explain site by site:

- `markdown/src/mermaid.rs` → [Gap 01](/gaps/mermaid/)
- `editor/src/{editor,document_symbols,semantic_tokens,bracket_colorization}.rs` →
  [Gap 02](/gaps/syntax-highlighting/)
- `terminal/src/terminal.rs` → [Gap 09](/gaps/remaining/#gap-09--terminal-osc-colour-queries)
- `miniprofiler_ui`, `settings_ui`, `zed/src/zed.rs` →
  [Gap 05](/gaps/remaining/#gap-05--windows-without-a-workspace)
- `workspace/src/theme_preview.rs` → arguably correct
- `zed/src/main.rs` → language registry + telemetry, **genuinely global**
- `theme_selector.rs` → the deliberate global-scope seeding
  ([Design 03, Decision 2](/architecture/03-selector/#decision-2--what-the-global-selector-is-seeded-with))
- `vim/src/helix.rs` → tests

**Running this in front of a reviewer's question is worth more than any explanation.**

## Build and lint

```bash
./script/clippy
```

Use this, **not** `cargo clippy` — the repo's `CLAUDE.md` says so explicitly, and the
script sets flags the bare command doesn't.

```bash
cargo check --workspace
```

## Tests

```bash
cargo test -p theme_selector
```

Expect `test_window_theme_selection_and_clear` and
`test_window_theme_dismiss_reverts_preview` to pass.

```bash
cargo test -p workspace persistence
cargo test -p theme
```

## The manual two-window acceptance test

Do this at least once before the review. It's what you'd be asked to demo.

1. Open two Zed windows on two different folders.
2. In window A: command palette → `theme_selector: toggle window theme`.
3. Arrow through several themes — **window A previews, window B does not change.**
4. Press Escape — **window A reverts.**
5. Repeat, and press Enter this time — window A is now visibly different.
6. **Open `settings.json`. Confirm no `theme` key was written or changed.** ← the point
7. In window A: `theme_selector: clear window theme` → window A returns to normal.
8. Set it again. Quit Zed entirely. Relaunch. **Both windows return as they were.**
9. Set window A to an **extension** theme (from the extension store, not built-in). Quit.
   Relaunch. It should still be there — this is
   [Design 06](/architecture/06-deferred/) working.
10. With window A overridden, change any unrelated setting (a keybinding). **Window A's
    background appearance must not change** — this is
    [Design 05, Decision 3](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset).
11. With window A overridden, open the **global** theme selector in window A. Arrow
    around — **the preview must be visible**. Escape — window A's override must come
    back. This is
    [Design 03, Decision 3](/architecture/03-selector/#decision-3--live-preview-when-a-window-override-is-already-present).
12. Same setup: open the **global** selector in window A and press Enter **without
    moving**. **`settings.json` must not gain window A's override theme.** This is
    [the settings-corruption bug](/architecture/03-selector/#decision-2--what-the-global-selector-is-seeded-with).

Steps 10, 11, and 12 are the ones that exercise the three subtlest fixes on the branch. If
any of them fails, you have a regression and you want to find it before a reviewer does.

## Confirming the review lineage

```bash
gh api "repos/zed-industries/zed/pulls/58755/reviews" \
  --jq '.[] | "\(.user.login) [\(.state)]: \(.body)"'
```

```bash
gh api "repos/zed-industries/zed/pulls/58755/comments" \
  --jq '.[] | "\(.user.login) on \(.path): \(.body)"'
```

These print the `CHANGES_REQUESTED` review and the `WindowId` inline comment. Read them
directly rather than trusting this site's quotations — you're about to build a PR
description around them.

## Before you post anything

```bash
git diff main...HEAD --stat -- crates/gpui   # must be empty
./script/clippy                               # must pass
cargo test -p theme_selector -p workspace     # must pass
git grep -n "cx\.theme()" -- 'crates/**/*.rs' # fixtures + one doc comment only
```

Four commands. Run them, then write the description knowing every claim in it is true.
