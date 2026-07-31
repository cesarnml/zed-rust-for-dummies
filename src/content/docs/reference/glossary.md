---
title: Glossary
description: Every Rust, GPUI, and Zed term used on this site, defined for a TypeScript reader.
sidebar:
  order: 1
---

Skim once. Come back when something is unfamiliar.

## Rust

**`Arc<Theme>`** — a shared, reference-counted pointer to a `Theme`. Closest TS analogy:
a normal object reference several places can hold at once. Rust has no garbage
collector, so "who owns this" is explicit; `Arc` means "shared ownership, freed when the
last holder drops it." Cloning an `Arc` bumps a counter — it does not copy the theme.

**Borrow (`&T`, `&mut T`)** — a temporary loan of access rather than a copy or a
transfer. `&Theme` is read-only, `&mut Theme` is exclusive read-write. The compiler
enforces "many readers **or** one writer, never both." This is why some functions in the
diff had to be restructured: a closure wanted a loan it wasn't allowed to hold.

**`Copy`** — so cheap to duplicate that Rust does it implicitly on assignment. `Hsla`,
`usize`, `bool`, `WindowId` are `Copy`. You never write `.clone()` on these.

**`Clone`** — duplication is explicit because it might cost something. `String`, `Vec`,
and `Arc` are `Clone` but not `Copy`.

**Lifetime (`'a`)** — an annotation saying "this returned reference stays valid only as
long as *that* input does." In `fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>`, the
`'a` appears on `cx` and the return type but **not** on `&self` — so the result is tied
to `cx`'s validity, not the window's. That's the whole trick.
→ [Lifetimes](/rust/lifetimes/)

**`'static`** — "valid for the whole program," or for owned types, "contains no borrowed
references at all." Required of anything stored in a struct for later use or sent across
threads. A `&mut Window` can never be `'static`.

**`Send`** — safe to move between threads. Another bound a window loan can't satisfy.

**Trait** — an interface. `trait WindowTheme { fn theme(&self, cx) -> ... }` declares a
capability; `impl WindowTheme for Window` says `Window` has it. Unlike TS interfaces, you
can implement a trait for a type you didn't define.

**`&impl SomeTrait`** (as a parameter) — "a reference to any type implementing this
interface," resolved at compile time via monomorphisation. No runtime cost.

**`dyn Trait`** — the runtime-dispatched version. One pointer indirection per call; one
copy of the code total.

**Marker trait** — a trait with no methods, implemented empty (`impl Global for T {}`).
It grants permission rather than behaviour.

**Extension trait** — adding methods to someone else's type via a trait (`StyledExt`).
Type-safe monkey-patching, scoped to wherever the trait is imported.

**Smart pointer impl** — `impl ActiveTheme for Arc<Theme>` means the *pointer type
itself* implements the interface, returning itself. Unusual, and it exists purely so call
sites can pass `window.theme(cx)` without dereferencing.

**`Option<T>`** — a value that may be absent: `Some(x)` or `None`. TS's `T | undefined`,
but you cannot forget to handle the absent case.

**`Result<T, E>`** — success or failure: `Ok(x)` or `Err(e)`. Rust has no exceptions.

**`?` operator** — early-return on error. `foo()?` means "if this failed, return the
error from this function immediately."

**`let ... else`** — destructure or bail. `let Some(x) = opt else { return };`

**Type-erased / `dyn Any` / downcast** — storing a value with its concrete type
forgotten, then checking and recovering it at runtime. What you'd need if GPUI stored a
theme without knowing what a theme is. Costs a runtime check and loses compile-time
safety — which is why it was rejected in
[Design 01](/architecture/01-resolution/#decision-1--where-does-the-override-live).

**Macro (`sql!`, `impl_tuple_row_traits!`)** — code that generates code at compile time.
`impl_tuple_row_traits!(t1: T1, ..., t11: T11)` generates the database row-reading logic
for an 11-column result.

**Derive macro (`#[derive(Default)]`)** — auto-implements a trait for your type.

**Tuple** — a fixed-length, mixed-type list, like TS's `[string, number, boolean]`.
Zed's database layer reads a query result into one.

**Monomorphisation** — the compiler emitting a specialised copy of a generic function for
each concrete type used. Why `impl Trait` has no runtime cost.

**Turbofish (`::<T>`)** — explicitly supplying a type argument, as in
`cx.global::<GlobalTheme>()`. Needed when the return type is what varies.

**`move` (on a closure)** — take ownership of captured values rather than borrowing.
Mandatory for anything outliving the current scope.

## GPUI

**`App` / `cx`** — the application-wide context, passed to nearly every function. Holds
global state. Explicit dependency injection instead of module-level singletons.

**`Window`** — one platform window's state. Passed as `window`, **always immediately
before `cx`** in signatures.

**`WindowId`** — the runtime id of a platform window. **Not stable across restarts.**

**Global** — a singleton stored on `App`, fetched by type: `cx.global::<GlobalTheme>()`.
`WindowThemeOverrides` is one. **There is no per-window equivalent** — that absence is the
constraint the whole design works around.

**`Entity<T>`** — a handle to framework-managed mutable state. Read with `.read(cx)`,
mutate with `.update(cx, |thing, cx| ...)`. Roughly a store/atom with explicit access.

**`WeakEntity<T>`** — the non-owning version. Methods return `Result` because the entity
may be gone. Used to break reference cycles.

**Render path / paint path** — the code that runs to draw a frame. A function "has a
`Window` in scope" if it's on this path. Anything *not* on it — background tasks, model
entities, parsing — has no window, which is the root cause of most of
[the gaps](/gaps/the-honest-list/).

**View / `Render`** — an entity that knows how to draw itself.

**`RenderOnce`** — a lighter component consumed when drawn; receives `&mut App` rather
than `&mut Context<Self>`. Roughly a function component.

**Delegate** — the object supplying behaviour to a generic UI component.
`ThemeSelectorDelegate` tells the generic `Picker` what the rows are and what to do on
confirm. Strategy pattern.

**Action** — a named, dispatchable command (`theme_selector::ToggleWindowTheme`). Appears
in the command palette and can be key-bound. Doc comments on actions are user-facing.

**`cx.observe_global::<T>(...)`** — run this callback whenever that global changes. Used
in [Design 06](/architecture/06-deferred/) to notice when themes finish loading.

**`cx.background_spawn(...)`** — run work off the UI thread. Returns a `Task` that is
**cancelled if dropped**, hence `.detach_and_log_err(cx)` — "let it run, log if it fails."

**`cx.notify()`** — "my state changed, re-render me." Also fires `cx.observe` callbacks.

**`window.refresh()`** — force a repaint.

**`set_background_appearance`** — tells the OS whether the window is opaque, transparent,
or blurred. **Separate from anything drawn inside the window**, which is why forgetting it
is its own class of bug ([Design 05](/architecture/05-lifecycle/)).

**`update_in`** — like `update`, but also hands you the `Window`. The async-context form.

## Zed

**`Theme`** — the resolved colour set. Not the JSON file — the loaded, ready-to-use
struct.

**`GlobalTheme`** — the app-wide theme resolved from `settings.json`. Called the
"configured theme" throughout this site. Also holds the icon theme
([Gap 10](/gaps/remaining/#gap-10--icon-themes)).

**`ThemeRegistry`** — the catalogue of all known themes, by name. Populated
**asynchronously** as built-in, user, and extension themes load — that async part is what
[Design 06](/architecture/06-deferred/) exists for.

**`theme_overrides`** — a settings block letting users patch individual colours of
whatever theme they use. [Design 07](/architecture/07-layering/) makes per-window themes
respect it.

**`ThemeSelection`** — the settings-level theme choice, either static ("Ayu Dark") or
dynamic ("Ayu Light when the system is light"). A per-window override is deliberately
**not** one of these — see [Light/dark following](/gaps/appearance/).

**`SyntaxTheme`** — the colours for syntax highlighting. Held once, globally, by
`LanguageRegistry` — which is [Gap 02](/gaps/syntax-highlighting/).

**`Workspace`** — one open project.

**`MultiWorkspace`** — the container that can hold several workspaces in one platform
window.

**`WorkspaceId`** — the stable, persisted database id of a workspace. Contrast
`WindowId`, which is not stable. [Design 01](/architecture/01-resolution/) and
[04](/architecture/04-persistence/) turn on that difference.

**`SharedString`** — either a `&'static str` or an `Arc<str>`. Zed's string type, so
passing names around doesn't allocate.

**`sqlez`** — Zed's SQLite layer. Its `impl_tuple_row_traits!` macro is why the branch
touches a shared crate.

**Override vs. configured** — throughout this site, "override" means the per-window theme
this feature adds; "configured" means the theme from `settings.json`. The code uses the
same two words for the same two things.
