---
title: 6. Generics, macros, modules
description: The remaining syntax you'll be asked about — including the three-line sqlez change.
sidebar:
  order: 7
---

## Generics

```rust
fn shadow<T: ActiveTheme>(self, theme: &T) -> Vec<BoxShadow>
fn shadow(self, theme: &impl ActiveTheme) -> Vec<BoxShadow>   // same thing, shorter
```

TypeScript generics with two differences: constraints are mandatory (you can only
call methods the bound guarantees), and they're **monomorphised** — the compiler
emits a specialised copy per concrete type, so there's no runtime cost. TypeScript
erases generics; Rust specialises them.

### Turbofish

```rust
cx.global::<GlobalTheme>()
cx.try_global::<Self>()
cx.observe_global::<GlobalTheme>(callback)
```

`::<T>` supplies a type argument explicitly. It appears when the compiler can't
infer it from the arguments — here, because the *return type* is what varies.
GPUI's global system is type-keyed: `cx.global::<T>()` means "fetch the singleton
whose type is `T`."

You'll write `WindowThemeOverrides` and `GlobalTheme` in turbofish position
throughout this branch.

## Macros

Code that generates code at compile time. Two matter here.

### `sql!`

```rust
sql!(ALTER TABLE workspaces ADD COLUMN theme_override TEXT;)
```

Zed's SQL macro — validates the SQL at compile time and produces the migration
entry. You just add one line to the migration list.

**Migration safety, which a reviewer will check:** this is a nullable `ADD COLUMN`
with no default — the most conservative form available. Existing rows read back
`NULL` → `None` → no override. Downgrading to an older Zed leaves the column present
and ignored. And `sqlez`'s domain migration list is append-only, so the new entry
must stay last — it does.

### `impl_tuple_row_traits!` — the one you'll be asked about

```rust
impl_tuple_row_traits!(t1: T1, t2: T2, ..., t10: T10, t11: T11);
```

This is a **change to a shared crate inside a feature PR**, which always looks like
scope creep unless you explain it first. So explain it first.

**What it is:** `sqlez` generates the "read a database row into a tuple" logic via
this macro, once per arity. There were ten invocations, so the ceiling was a
10-column result.

**Why it was needed:** the existing `workspace_for_roots` query already selected
exactly 10 columns. Adding `theme_override` made it 11.

**The alternatives, and why they lost:**

| Option | Why not |
|---|---|
| Bundle columns into a struct with a manual `Column` impl | Restructures an existing, working, heavily-used query for no benefit; the struct would be a one-off |
| A second query just for the theme column | An extra round trip on every workspace restore, to avoid a three-line macro call |
| **Extend the macro** ✅ | Purely additive, follows nine identical predecessors, unblocks the next person who needs an 11th column |

**How to raise it in the PR:** one sentence in the description —

> `crates/sqlez` gains an 11-tuple `impl_tuple_row_traits!` invocation because
> `workspace_for_roots` was already at the macro's 10-column ceiling. It is purely
> additive and follows the nine existing invocations.

That converts a "why are you touching sqlez?" question into a non-question.

### Derive macros

```rust
#[derive(Default)]
pub struct WindowThemeOverrides { themes: HashMap<WindowId, Arc<Theme>> }

#[derive(PartialEq, Clone, Default, Debug, Deserialize, JsonSchema, Action)]
#[action(namespace = theme_selector)]
pub struct ToggleWindowTheme { pub themes_filter: Option<Vec<String>> }
```

`#[derive(X)]` auto-implements trait `X`. `Default` gives you `::default()`;
`Deserialize` gives JSON parsing; `Action` is Zed's own derive that registers the
type as a dispatchable command visible in the command palette.

`#[serde(deny_unknown_fields)]` makes unrecognised JSON keys an error rather than
silently ignored — which is why adding a `scope` field to the *existing* `Toggle`
action would have been a breaking change, and why the branch adds two new actions
instead. That's [Design 03, Decision 1](/architecture/03-selector/).

## Modules and visibility

```rust
pub fn theme(...)        // public to everyone
pub(crate) fn set(...)   // public within this crate only
fn helper(...)           // private to this module
```

The Zed repo's `CLAUDE.md` bans `mod.rs` files — modules are `src/some_module.rs`,
not `src/some_module/mod.rs`. And new crates specify `[lib] path = "..."` explicitly
so the root file has a descriptive name (`gpui.rs`, not `lib.rs`).

Neither affects this branch, but knowing the conventions signals you read the rules.

### One visibility choice a reviewer might question

`WindowThemeOverrides::set` and `::clear` are `pub` even though the intended API is
`apply_to_window` / `clear_for_window`. The reason: `on_window_closed` needs `clear`
without a `Window` (the window is already gone).

They *could* be tightened to `pub(crate)` — the closure that needs them lives inside
the same impl block. It was left `pub` because `theme` has no other internal consumer
and the distinction is documented. **If a reviewer objects, agreeing immediately is
the right move**; it's a one-word change and conceding a genuinely optional point
buys credibility for the ones that aren't.

## Doc comments

```rust
/// Returns this window's effective theme (override, or configured global).
///
/// The returned reference borrows only `cx` (the theme is stored in an app
/// global), so the window remains usable while the theme is held.
fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
```

`///` is a doc comment; `[`Window`]` in one links to that item's docs. Zed enforces
`#![deny(missing_docs)]` in some crates — including `theme` — which is why every
public item added by this branch has one.

That's not incidental politeness. It means **the doc comments are part of the diff a
reviewer reads**, and several of them are carrying real design rationale:

- The `ConfiguredTheme` comment states that `cx.theme()` deliberately doesn't exist.
- The `WindowThemeOverrides` comment states that persistence is keyed separately.
- The `WindowTheme::theme` comment states why the lifetime is on `cx`.
- The `reapply_pending_window_theme_overrides` comment states why the predicate is
  narrow.

If you're asked "where is this decision recorded?", the answer is usually "in the doc
comment on the thing itself." That's a good answer.

## Async, briefly

```rust
cx.background_spawn(async move { ... }).detach_and_log_err(cx);
```

- `cx.spawn(...)` — foreground (UI thread).
- `cx.background_spawn(...)` — off-thread.
- Both return a `Task<R>`. **A dropped task is a cancelled task**, so you must either
  await it, `.detach()` it, or store it in a field.
- `.detach_and_log_err(cx)` = let it run, log any error. This is the repo-prescribed
  form and what the branch uses for its database writes.

Inside an async task you cannot hold a window loan across an `await`. GPUI gives you
closure forms that hand the window back for a synchronous slice:

```rust
editor.update_in(cx, |editor, window, cx| ...)   // re-acquire entity + window
cx.update(|window, cx| ...)
```

TS analogy: you can't hold a lock across an `await`, so you re-acquire it in the
continuation. That's [rewrite Shape 7](/migration/shapes/#shape-7--async-rendezvous).
