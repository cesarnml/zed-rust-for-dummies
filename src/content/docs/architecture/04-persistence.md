---
title: 04. Persistence by workspace id
description: One nullable column, two write paths, and the three-line sqlez change you should raise first.
sidebar:
  order: 5
---

**Code:** `crates/workspace/src/persistence.rs`, `crates/workspace/src/persistence/model.rs`,
`crates/workspace/src/workspace.rs`, `crates/sqlez/src/bindable.rs`
**Commits:** `f7cd40b816`, `56b9ac4223`
**Confidence:** High

## In plain English

The lookup table from [Design 01](/architecture/01-resolution/) only lives in memory —
close Zed and it's gone. For the feature to be useful, "this project is the red one"
has to survive a restart.

Zed already keeps a small local database of per-project state: window size and
position, which panels were open, whether centred layout was on. This adds one more
column to that same table, holding the theme's **name** — the text `"Ayu Dark"`, not
the colours themselves.

Storing the name rather than the colours is the main decision here, and it's right for
the same reason you'd store a font's name rather than a copy of the font file: if you
later edit that theme, or the theme ships an update, or you tweak colours in your
settings, the window picks up the change. A stored copy of the colours would be frozen
at the moment you picked it and would slowly drift.

The cost is that names go stale — uninstall the extension that provided the theme and
the stored name points at nothing. That's handled by falling back to your normal theme
and logging it, and it's the **same trade-off Zed already makes for your global theme
setting**, which also stores a name.

Two smaller decisions: the choice is written to disk *immediately* when you pick it
*as well as* during Zed's normal periodic save (so a crash doesn't lose it), and
restoring is split into two steps — remember the name while the window is being built,
actually apply the colours once it exists — which turns out to be what makes several
later fixes possible.

## What the code does

```rust
// crates/workspace/src/persistence.rs — appended to the migration list
sql!(ALTER TABLE workspaces ADD COLUMN theme_override TEXT;),
```

- `SerializedWorkspace` gains `theme_override: Option<String>`
- `Workspace` gains `theme_override: Option<SharedString>`
- Two write paths: a targeted `set_theme_override(workspace_id, Option<String>)` query
  for immediate writes, and the field riding along in the existing full-workspace
  upsert in `serialize_workspace_internal`.

## Decision 1 — Persist the theme *name*, not the resolved theme

**A — Serialize the resolved `Theme` struct.** Would survive an extension being
uninstalled and would pin exact colours. **Rejected decisively:** `Theme` is a large
nested struct with dozens of colour fields whose shape changes between Zed versions,
it is not `Serialize`, and persisting it would mean a window silently pinned to a
stale copy of a theme the user has since edited. Theme JSON edits and theme updates
should flow through to overridden windows; only the *choice* is user state.

**B — Persist `(theme_name, appearance)` so the override participates in light/dark
switching.** This is the interesting rejected option, and the one a maintainer is most
likely to push on. It would let an override mean "Ayu when the system is dark, Ayu
Light when light," matching how the global `ThemeSelection` works.

**Rejected as scope:** the global theme setting is a `ThemeSelection` enum with
`Static`/`Dynamic` variants and a whole mode-resolution path in `theme_settings`.
Reusing it per-window means **per-window `ThemeSettings`, not per-window `Theme`** —
a substantially bigger feature. The current behaviour (an override pins one concrete
theme and stops following system appearance) is documented in `docs/src/themes.md`, so
it's a stated limitation rather than a surprise.

**Confidence: high on (A), medium on (B).** (B) is a legitimate product question a
maintainer may answer differently, and the storage format chosen here (a bare `TEXT`
name) would need to become JSON to support it. That's a cheap migration if it comes to
that — say so, because "I chose the format that's cheap to migrate if you disagree" is
a much better position than "I chose the right format."

See [Light/dark following](/gaps/appearance/) for the full treatment.

## Decision 2 — Reuse the `workspaces` table rather than a new one

An override is exactly one nullable scalar attached to a workspace, with the same
lifetime as the workspace row. `centered_layout` — the closest existing analogue — is
stored the same way, and its restore path was the template for this one
(`workspace.centered_layout = ...` sits next to
`workspace.set_theme_override_name(...)` at all four construction sites).

A separate `window_themes` table would add a join to the already-large
`workspace_for_roots` query and gain nothing.

**Confidence: very high.**

## Decision 3 — Two write paths (this is not redundancy)

```rust
cx.background_spawn(async move {
    db.set_theme_override(database_id, Some(theme_name)).await
})
.detach_and_log_err(cx);
```

*and* the field is written by the periodic / at-quit full workspace serialization.

Both are required:

- **Only full serialization** → risk losing the choice if the app terminates
  abnormally before the next serialize.
- **Only the targeted write** → the upsert would write `NULL` over it.
  `serialize_workspace_internal` writes **every** column, so omitting the field would
  actively clear it.

`.detach_and_log_err(cx)` rather than `let _ =` follows
[the repo's error rules](/rust/pointers/#this-repositorys-rules-about-errors) — a
failed persist isn't worth surfacing mid-session but must not vanish.

**Confidence: high.** If asked "why write it twice?", the second bullet is the answer,
and it's a satisfying one.

## Decision 4 — `set_theme_override_name` is separate from `apply_window_theme`

Restore is deliberately two steps:

```rust
workspace.set_theme_override_name(theme_override);   // records the name, paints nothing
// ...later, once the window and entity are both live...
workspace.apply_window_theme(window, cx);            // resolves + applies to the window
```

**The immediate reason is ordering.** `Workspace::new` runs inside
`cx.new(|cx| ...)`, where the entity doesn't exist yet and where applying a theme to
the window would be a side effect from inside a constructor. The name is recorded
during construction (cheap, infallible); application happens once both exist.

**The reason that turned out to matter more:** the split is what makes the
[deferred-reapply pass](/architecture/06-deferred/) possible. It distinguishes *"this
workspace **wants** an override"* (name set) from *"this window **has** one"* (live map
entry) — and that distinction only exists because the two are stored separately.

This is idea #3 from [the overview](/architecture/overview/#3-intent-and-live-state-are-stored-separately),
and it's worth being able to state as a principle rather than an accident.

**Confidence: high.** The cost is that a caller can set the name and forget to apply.
There are five call sites for each. The remote path (`open_remote_project_inner`)
relies on `MultiWorkspace::activate` to apply — which it does, but only transitively.
**Worth a reviewer's eye, and worth flagging yourself.**

## Decision 5 — Extending `sqlez` to 11-tuples

```rust
impl_tuple_row_traits!(t1: T1, ..., t10: T10, t11: T11);
```

The `workspace_for_roots` query already selected a 10-column tuple — exactly the
macro's ceiling. Adding `theme_override` needed an 11th.

| Alternative | Why not |
|---|---|
| Bundle columns into a struct with a manual `Column` impl | Restructures an existing, working, heavily-used query for no benefit; the struct would be a one-off |
| A second query for the theme column | An extra round trip on every workspace restore, to avoid a three-line macro invocation |
| **Extend the macro** ✅ | Purely additive, follows nine identical predecessors, unblocks the next person who needs an 11th column |

**Confidence: very high.** The only real note is that **this is a change to a shared
crate inside a feature PR**, which always looks like scope creep unless you raise it
first. One sentence in the PR description defuses it entirely — see
[Generics and macros](/rust/generics/#impl_tuple_row_traits--the-one-youll-be-asked-about).

## Decision 6 — `Option<SharedString>` in memory, `Option<String>` on the wire

`Workspace::theme_override` is `SharedString` because `Theme::name` is a
`SharedString` and `set_window_theme` receives an `Arc<Theme>` — storing it as
`SharedString` is a refcount bump rather than an allocation. The DB and
`SerializedWorkspace` layers use `String` because that's what `sqlez` binds and what
the rest of `SerializedWorkspace` uses.

The conversions are explicit and appear four times total. Fine.

## Migration safety

The migration is a **nullable `ADD COLUMN` with no default** — the most conservative
form available.

- Existing rows read back `NULL` → `None` → no override.
- Downgrading to an older Zed leaves the column present and ignored.
- `sqlez`'s domain migration list is append-only, so the new entry must stay **last**.
  It does.

Persistence tests cover targeted write, full-upsert write, and clear.

**Confidence: very high.** This is the least contentious part of the branch and you
should be able to dispatch questions about it in one sentence each.
