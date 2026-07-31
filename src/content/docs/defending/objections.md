---
title: Objections and answers
description: Every objection a reviewer will realistically raise, with an answer you can say out loud.
sidebar:
  order: 1
---

Each answer here is written to be **said**, not pasted. Read it, then say it in your own
words. If you can't, go read the linked page.

---

## "This is still an enormous diff"

> Yeah, it is, and I don't think that's avoidable while keeping it correct. The feature
> is about 200 lines across seven files. The other 2,900 are one mechanical rewrite:
> `cx.theme()` becomes `window.theme(cx)`. I did it that way because I deleted
> `impl ActiveTheme for App` — so the compiler enumerates every call site instead of me
> auditing them. Any version that leaves the old accessor in place ships a feature that
> only works in the panels I happened to remember.
>
> If you'd rather have it staged, the split is: introduce the traits while keeping the
> `App` impl, migrate crate by crate, delete the impl last. More PRs, each trivially
> reviewable. Happy to do that.

→ [Why it is that big](/migration/why-big/)

---

## "Why couldn't you just add `window.theme(cx)` alongside `cx.theme()`?"

> Because that's the failure mode I was trying to prevent. Both accessors coexist, sites
> migrate whenever someone remembers, and an overridden window renders as a patchwork —
> and the broken half is invisible until a user files a bug about one panel. There's also
> no end state: every new `cx.theme()` anyone writes is a fresh latent bug, and nothing
> catches it, because the call looks completely normal.

---

## "A clippy lint would have been more idiomatic"

> Honestly, you're right that it's the more idiomatic Rust answer, and I'd take it as a
> supplement. The reason I didn't use it as the primary mechanism is that a lint still
> lets `cx.theme()` compile locally for anyone who hasn't run `./script/clippy`, and the
> correct replacement is context-dependent — sometimes `window.theme(cx)`, sometimes
> `cx.configured_theme()`, sometimes threading a `&Theme` into a helper. A lint can
> complain but it can't do the rewrite.
>
> If you'd rather keep `cx.theme()` for compatibility, I'd be glad to add a
> `disallowed_methods` entry instead of the deletion.

---

## "Why is `WindowThemeOverrides` an app global if globals were the problem?"

> The problem was never that a global existed — it was that there was **one** theme for
> **all** windows. This global is a map keyed by window, so the resolution is still
> per-window. It's the storage location, not the resolution model.
>
> And it's behind a single choke point: `WindowTheme::theme` is the only way anything
> reads it. If you'd rather it live somewhere else later, that's a change to one
> function and zero call sites.

---

## "Why not put the theme directly on GPUI's `Window`?"

> Two reasons. First, you asked me not to touch gpui, and I agree with that —
> `Window` is theme-agnostic by design; it knows `Hsla` and
> `WindowBackgroundAppearance` but nothing about Zed's `Theme` struct, and `theme`
> depends on `gpui`, not the reverse. Adding the field means either inverting that
> dependency or storing it type-erased as `Option<Arc<dyn Any>>` and downcasting on
> every read — a runtime cast in the renderer's hottest path.
>
> Second, `Window` already exposes `window_handle().window_id()`, so a side table gets
> the same result with a three-line trait impl and zero gpui changes.

→ [Design 01, Decision 1](/architecture/01-resolution/#decision-1--where-does-the-override-live)

---

## "You're using `WindowId` — those aren't stable"

> Right, and that was your comment on the earlier PR. I use `WindowId` **only** as the
> key of the in-memory map, which is rebuilt from scratch every run. Persistence is
> keyed by `WorkspaceId`, the stable database id. The doc comment on
> `WindowThemeOverrides` says so explicitly, so nobody unifies the two keys later.
>
> The reason the live map isn't keyed by workspace id is that the render path only ever
> holds a `Window` — resolving a workspace id from it would mean walking to the
> `MultiWorkspace` root and reading an entity during paint, and it's impossible in
> windows that have no workspace at all.

→ [Design 01, Decision 3](/architecture/01-resolution/#decision-3--keying-by-runtime-windowid-not-workspace-id)

---

## "That lifetime signature looks like you're fighting the borrow checker"

> The opposite, actually — it's the accurate signature. The theme lives in an app-level
> global, so `window.theme(cx)` uses the window only to compute a `WindowId`, then
> returns a reference into `cx`. Annotating the return with `cx`'s lifetime rather than
> the window's is just describing what's true.
>
> It matters because most render functions build children afterwards, which needs
> `&mut Window`. If the returned theme kept the window borrowed, every one of those
> sites would need a `.clone()`. That one line is what kept the migration mechanical.

→ [Lifetimes](/rust/lifetimes/)

---

## "Why does `Arc<Theme>` implement `ActiveTheme`? That looks like a hack"

> It's three lines and it exists purely for call-site ergonomics. The leaf helpers —
> `Color::color`, the elevation helpers, `StyledExt` — take `&impl ActiveTheme`. Since
> `window.theme(cx)` returns `&Arc<Theme>`, making the `Arc` itself implement the trait
> means call sites read `Color::Muted.color(window.theme(cx))` with no deref and no
> `.as_ref()`. With a plain `&Theme` parameter, several hundred sites would need
> `&**window.theme(cx)`.

→ [Traits](/rust/traits/#the-weird-one-impl-activetheme-for-arctheme)

---

## "Why preserve configured-theme access at all?"

> Because some things genuinely have no window — app startup, dock menus, the language
> registry, telemetry, tests. Those need *a* theme, and the configured one is the right
> answer. Removing it would just push each of those into inventing its own fallback.
>
> The point of naming it `configured_theme()` is that each of those sites now says so out
> loud. That's what makes the limitation list enumerable — you can grep for it and get
> the complete inventory of everywhere this feature doesn't reach.

---

## "Why is an override one concrete theme instead of a light/dark pair?"

> Scope. The global theme setting is a `ThemeSelection` with static and dynamic variants
> and a whole mode-resolution path in `theme_settings`. Doing that per window means
> per-window *theme settings*, not per-window *theme* — bigger storage, mode resolution
> in the render path or a subscription, and a per-window picker that'd have to be more
> capable than the global one, which is backwards.
>
> So it pins, and that's documented in `themes.md`. I chose the storage format —
> a bare `TEXT` name — specifically because migrating it to a JSON selection later is
> cheap if you decide you want the fuller version.
>
> One thing I should flag: `workspace::ToggleMode` in an overridden window currently
> toggles the *global* setting based on the *window's* appearance, which is confusing.
> I didn't resolve that because I wasn't sure what you'd want it to do.

→ [Light/dark following](/gaps/appearance/)

---

## "What happens if an extension providing the saved theme is removed?"

> On restart, the registry lookup fails, it logs, and the window falls back to your
> configured theme. Mid-session, nothing invalidates the live map, so the window keeps
> rendering the theme until it's closed or cleared — which is arguably the better failure
> mode, but I'll be honest that it's unhandled rather than chosen.
>
> There's a related one I did fix: extension themes load asynchronously, so a restore at
> startup would often fail and silently lose the override on every restart. There's now
> a repair pass on `GlobalTheme` change that reapplies only for windows that want an
> override but don't have one live — narrow specifically so it can't stomp a
> theme-selector preview.

→ [Design 06](/architecture/06-deferred/) · [Gap 07](/gaps/remaining/#gap-07--theme-lifecycle-and-extensions)

---

## "Why not project settings, like Peacock?"

> They're different features with different properties, and I think this one is the safer
> default. Storing it in `.zed/settings.json` means it's committable — your personal
> window tint follows the repo to your teammates, which is the specific Peacock
> complaint people have. It also means a repo you clone can restyle your editor.
>
> This is user-side window state, next to window size and centred layout. I don't think
> the two conflict — a project-settings version could be layered on later. But if you'd
> rather have *that* feature instead of this one, this branch is the wrong shape, and I'd
> rather know now.

---

## "Can the call-site migration go stale immediately?"

> Not silently, no — that's the point of deleting the `App` impl. A new `cx.theme()`
> doesn't compile. Someone could write `cx.configured_theme()` in a render path, but
> that's visible in review in a way `cx.theme()` never was.
>
> Merge conflicts are a real cost though. Any in-flight PR touching UI will conflict on
> theme reads. That's an argument for landing it quickly if you want it, or for staging
> it if you don't.

---

## "Why is `crates/sqlez` in this diff?"

> The `workspace_for_roots` query already selected exactly 10 columns, which was the
> `impl_tuple_row_traits!` macro's ceiling. Adding the theme column made it 11, so
> there's one more macro invocation following the nine identical ones already there.
> Purely additive.
>
> The alternatives were restructuring a working, heavily-used query into a struct with a
> manual `Column` impl, or a second query on every workspace restore. Neither seemed
> worth it for three lines.

→ [Design 04, Decision 5](/architecture/04-persistence/#decision-5--extending-sqlez-to-11-tuples)

---

## "Did you measure the added hash lookup in the render path?"

> No, I didn't. My reasoning is that it replaces a `TypeId`-keyed global fetch with the
> same fetch plus one probe into a map whose size is the number of open windows —
> typically one to five, keyed on a `u64`. I'd expect that to be noise, but I'm guessing.
>
> If it does measure badly, the fix is to cache the resolved `Arc<Theme>` on the window's
> frame state at the start of paint. That's one function and zero call sites, because
> `WindowTheme::theme` is the only entry point.

---

## "Your test coverage is thin for a change this size"

> It is, and I'd rather say where. There are two selector tests — window-scope confirm
> plus clear, and dismiss-reverts-preview — and persistence tests for the targeted write,
> the full upsert, and the clear.
>
> What's not covered: global-scope confirm inside an overridden window, which is the
> trickiest path and the most likely place for a residual bug; the no-workspace fallback
> branch; and two windows with different overrides open simultaneously. The first one is
> cheap to add and I'll do it if you want it before merge.
>
> The 2,900 mechanical lines aren't really testable as such — the compiler is the test
> there.

---

## "Why are there `_window` renames all over the diff?"

> Those are separable and I'll pull them out if you'd prefer. The reason I did them: an
> anonymous `_` parameter is unnameable, so the next person who needs a theme in that
> function has to rename it first, and you can't grep for "does this function have a
> window available." Naming them makes future theme fixes one-line changes.
>
> It's a preference, not a requirement, and it does inflate the diff.

---

## "Syntax highlighting doesn't follow the window theme"

> Correct, and it's the biggest gap. `LanguageRegistry` holds one `SyntaxTheme` for the
> whole process, and buffers are shared across windows — the same buffer open in two
> windows would need two different highlight styles for the same text. That means
> highlight resolution has to move out of the buffer layer entirely, which is a
> data-model change to the editor's hottest path.
>
> I didn't attempt it because it's bigger and riskier than everything else in this branch
> combined, and I don't think a contributor should unilaterally refactor that. If you
> want the complete feature, the right sequence is probably that work first, as your
> design, with this landing on top.
>
> Worth noting the chrome-only version already covers the main use cases — telling
> production from staging, and the accessibility case in #58381 is explicitly about
> window-level colour blocks rather than syntax colours.

→ [Gap 02](/gaps/syntax-highlighting/)

---

## The meta-answer

If you're asked something you genuinely don't know:

> I don't know — let me look.

Then open the file and read it. That is a **better** answer than a confident guess, and
in a thread where a maintainer has already raised concerns about LLM-generated replies,
it is also the most credible thing you can say. A human who says "I'm not sure, give me
a minute" is unmistakably a human.
