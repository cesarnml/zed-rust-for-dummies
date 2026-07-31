---
title: A walkthrough script
description: The order to present the change in, and what to say at each stop.
sidebar:
  order: 4
---

If a reviewer asks you to walk them through it — in a comment, a call, or a video — this
is the order. It goes from *why* to *what* to *how*, and it front-loads the things that
build credibility.

## Stop 0 — The framing (30 seconds)

> This implements the changes @osiewicz requested on #58755: `ActiveTheme` moved onto
> `Window`, no gpui changes, persistence keyed by workspace id rather than `WindowId`.
> It's a ground-up rewrite rather than a push to that branch — I don't have push access
> and the two share no history.

Say this **first**, every time. It converts the whole conversation from "evaluate this
proposal" to "check this delivery."

## Stop 1 — `crates/theme/src/theme.rs` (the whole feature)

```bash
git diff main...HEAD -- crates/theme/src/theme.rs
```

~115 lines. Everything else is a consequence of this file.

Four things to point at, in order:

**1. The trait, and its lifetime.**

```rust
fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
```

> The returned reference borrows `cx`, not the window — which is accurate, because the
> theme lives in an app global. That's what lets call sites hold the theme and still use
> `&mut Window` afterwards, which is most of them.

**2. The split.**

> `impl ActiveTheme for App` is gone. `cx.theme()` doesn't compile anywhere. App-level
> access is `configured_theme()` now, so the sites that genuinely want the global theme
> say so out loud.

**3. The map, and its doc comment.**

> Keyed by `WindowId` because that's what the render path holds. Persistence is keyed by
> workspace id — the comment says so, so nobody unifies them later.

**4. `apply_to_window`.**

> Three things have to happen together: the map, the OS background appearance, and a
> repaint. Forgetting the background appearance is its own bug class, so they're bundled.

→ [Design 01](/architecture/01-resolution/)

## Stop 2 — The bug that justifies the diff size

```bash
git diff main...HEAD -- crates/zed/src/main.rs
```

> There's a settings observer that loops over every window and resets its background
> appearance. It read the configured theme, so any settings change — a keybinding edit,
> anything — would reset an overridden window's transparency and leave it wrong.
>
> That site isn't a render function and has no `Window` in scope; it iterates
> `cx.windows()` with only ids. No audit of the drawing code would have found it. It
> turned up because deleting the `App` impl made it fail to compile.

**This is your strongest single moment.** It's concrete, it's checkable, and it converts
"why is this so big" into "here's what the size bought."

→ [Design 05, Decision 3](/architecture/05-lifecycle/#decision-3--the-settings-observer-background-reset)

## Stop 3 — The selector, and the settings-corruption bug

```bash
git diff main...HEAD -- crates/theme_selector/src/theme_selector.rs
```

> One picker, two scopes. The interesting part is what "revert" has to mean now.
>
> The bug worth showing: the global selector used to seed itself from the current theme.
> In a window with an override, that's the *override's* theme — so opening the normal
> theme picker and hitting Enter without moving would have written the window's override
> into `settings.json`. Now each selector seeds from the thing it writes to.
>
> The other one: a window with an override ignores global settings, so the global
> selector's preview would do nothing at all in that window. It now paints the preview
> over the override temporarily and restores it on confirm or escape.

Both were found by reasoning about the state machine, not by testing. Say that — it's
evidence of how the work was done.

→ [Design 03](/architecture/03-selector/)

## Stop 4 — Persistence

```bash
git diff main...HEAD -- crates/workspace/src/persistence.rs crates/sqlez/src/bindable.rs
```

> One nullable column on the existing `workspaces` table, holding a theme name. Names
> rather than colours, so theme edits and updates flow through — same trade-off the
> global `"theme"` setting already makes.
>
> Written twice: immediately on change, and in the periodic full serialization. Both are
> needed — the full upsert writes every column, so omitting it there would `NULL` it out.
>
> `sqlez` gets an 11-tuple because `workspace_for_roots` was already at the macro's
> 10-column ceiling. Purely additive.

→ [Design 04](/architecture/04-persistence/)

## Stop 5 — The migration, by shape

Don't walk the 290 files. Walk the **categories**:

> About 95% is `cx.theme()` → `window.theme(cx)`. The ones that needed thought fall into
> a few shapes:
>
> - Style helpers took `&App` and read the global; they take `&impl ActiveTheme` now, so
>   the caller decides.
> - The editor's highlight callbacks are bare `fn` pointers, which can't capture — so I
>   changed what they receive from `&App` to `&Theme`. `BackgroundHighlight` in the same
>   file already worked that way.
> - Stored closures and background tasks can't hold a window loan, so either they use
>   the window they're handed at invocation, or the callback type gains one, or — for
>   genuinely detached work — I resolve the `Hsla` first and move the value in.

Offer the detail rather than dumping it: *"happy to go through any of those in detail."*

→ [The seven rewrite shapes](/migration/shapes/)

## Stop 6 — The gaps, unprompted

> There are ten things this doesn't cover, and I've written them all up. The two that
> matter: syntax highlighting is still global, because `LanguageRegistry` holds one
> `SyntaxTheme` for the whole process and buffers are shared across windows — that's a
> data-model change, not a call-site one. And mermaid diagrams render on a background
> task with no window, so they use the configured theme.
>
> Each of those sites is marked with an explicit `configured_theme()` call rather than
> left ambiguous, so the whole list is greppable.

Then run it:

```bash
git grep -n "configured_theme()" -- 'crates/**/*.rs' | grep -v "tests\|fixtures\|examples"
```

**Doing this before you're asked is the single best move available to you.** It
demonstrates you know the boundaries of your own change.

→ [The honest list](/gaps/the-honest-list/)

## Stop 7 — The three questions

Close by asking, not asserting:

> Three things I'd rather get your call on before doing more work:
>
> 1. Is chrome-only the intended feature, or does "per-window theme" imply syntax
>    highlighting too?
> 2. Is window state the right model, or would you rather this were project
>    configuration in `.zed/settings.json`? If it's the latter, this branch is the wrong
>    shape.
> 3. Is the migration acceptable in one PR, or should I stage it? The split would be:
>    add the traits keeping the old impl, migrate crate by crate, delete the impl last.

Ending on questions rather than a defence does three things: it signals you know which
decisions aren't yours, it gives the reviewer something cheap to respond to, and it makes
the next round of work theirs to direct.

## The demo

If you record anything, keep it to 30 seconds:

1. Two windows, two projects, identical.
2. Command palette → `theme_selector: toggle window theme` in one. Arrow through a few
   themes — the preview follows.
3. Enter. One window is now visibly different.
4. Open `settings.json` — **unchanged**. This is the point.
5. Quit. Relaunch. Both windows come back as they were.

Step 4 is the one that matters. The "never written to settings" property is the design
commitment that distinguishes this from Peacock, and it's much more convincing shown
than described.
