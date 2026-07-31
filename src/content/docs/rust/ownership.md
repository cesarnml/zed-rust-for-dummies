---
title: 1. Ownership and borrowing
description: The memory model TypeScript doesn't have, and why a third of this diff has the shape it has.
sidebar:
  order: 2
---

## The one-paragraph version

In TypeScript, every value is a reference and the garbage collector decides when
it dies. In Rust, every value has exactly one **owner**, and when the owner goes
out of scope the value is freed. You can hand a value to someone else in three
ways:

| Rust | What it means | TS analogy |
|---|---|---|
| `theme` (bare) | **Move.** You give it away. You can't use it again. | Handing over the only copy |
| `&theme` | **Shared borrow.** A read-only loan. Many at once. | `readonly` reference |
| `&mut theme` | **Exclusive borrow.** A read-write loan. Only one, and no shared borrows at the same time. | A lock |

The rule the compiler enforces: **many readers, or one writer, never both.**

That rule is why a lot of this diff looks the way it does.

## Why it matters here, concretely

Consider the most common line in the entire branch:

```rust
.bg(window.theme(cx).colors().editor_background)
```

`window` is `&mut Window`. `cx` is `&App`. `window.theme(cx)` needs to borrow both.
And then the *result* — a `&Arc<Theme>` — is held while you keep building the
element, which very often needs `&mut Window` again:

```rust
let theme = window.theme(cx);
div()
    .bg(theme.colors().editor_background)
    .child(self.some_child.render(window, cx))   // ← needs &mut Window
```

If the returned theme reference kept `window` borrowed, that second line would be a
compile error: you'd be trying to take `&mut Window` while a `&Window` loan is
still alive. Many readers **or** one writer.

That exact problem is what
[the lifetime signature](/rust/lifetimes/) solves, and it is the reason that one
line of the patch is the most important line in it.

## The three things that break, and what the diff does about them

### Break 1 — "I need this value after I gave it away"

```rust
fn set_window_theme(&mut self, theme: Arc<Theme>, ...) {
    self.theme_override = Some(theme.name.clone());
    let effective = ThemeSettings::get_global(cx).apply_theme_overrides(theme.clone());
    WindowThemeOverrides::apply_to_window(window, effective, cx);
}
```

`theme` arrives by value (it's *moved* in — the caller gave it up). The function
needs it twice: once to read `.name`, once to pass to `apply_theme_overrides`,
which also takes it by value. So it `.clone()`s.

**In TS you'd never write `.clone()` here** because there's nothing to clone —
you'd just use the reference twice. In Rust the clone is mandatory, and because
this is an `Arc`, it costs a single atomic increment.
[Why that's cheap](/rust/pointers/#arct--shared-ownership).

**Reviewer question you should be ready for:** *"why is there a clone here?"*
Answer: `apply_theme_overrides` takes ownership of the `Arc`, and we still need the
name. It's a refcount bump, not a theme copy.

### Break 2 — "I want to hold the theme across a mutation"

```rust
let theme = window.theme(cx).clone();     // ← note the .clone()
```

This pattern appears throughout the diff, most notably in
`crates/ui/src/components/button/button_like.rs`, which resolves the theme once at
the top of `render` and passes it down through the whole button styling chain.

Why the clone? `window.theme(cx)` takes `&App`. If you need `&mut App` later in
the same function — and render functions frequently do — you can't still be holding
a `&App`-derived reference. Cloning the `Arc` turns a *borrow* into an *owned
value*, which severs the connection to `cx`.

This is not new to the branch. The pre-existing code did `cx.theme().clone()` for
the same reason. You are following the established idiom, which is a good thing to
be able to say.

### Break 3 — "The compiler says I can't put a loan in here"

Some values must be `'static` — meaning "contains no borrowed references at all."
Anything stored in a struct and used later, or sent to another thread, has this
requirement. A `&mut Window` is a loan on UI-thread state and can never be `'static`.

This is the root of [rewrite Shape 5](/migration/shapes/#shape-5--static--send-boundaries),
and the fix pattern is always the same: **resolve the value you need *before* the
boundary and move the value across, not the loan.**

```rust
// Colors are plain 4-float values (Hsla is Copy). Resolve now...
let hint_background = window.theme(cx).status().hint_background;
let hint_border     = window.theme(cx).status().hint;
// ...then move the values into the 'static closure.
Arc::new(move |_, _, cx| div().bg(hint_background).border_color(hint_border) ...)
```

**Trade-off to volunteer if asked:** that colour is now fixed at the moment the
closure was created and won't update if the theme changes before the next refold.
For a transient decoration that's acceptable. Saying so unprompted is worth more
than being caught.

## `Copy` versus `Clone`

You'll see both. The distinction is small but it comes up:

- **`Copy`** — the type is so cheap to duplicate that Rust does it implicitly on
  assignment. `Hsla` (four floats) is `Copy`. `usize`, `bool`, `WindowId` are `Copy`.
  You never write `.clone()` on these.
- **`Clone`** — duplication is explicit because it might cost something. `String`,
  `Vec<T>`, and `Arc<T>` are `Clone` but not `Copy`.

`Arc<T>` is the interesting case: cloning it is *cheap* (a refcount bump) but it's
still not `Copy`, because the compiler wants the refcount change to be visible in
the source. That's why `.clone()` litters this diff without implying expense.

## The mental reframe that helps most

Coming from TypeScript, the instinct is to read `&` as noise. Don't. Read it as a
**capability declaration**:

- `&App` — "I will read app state."
- `&mut App` — "I will change app state, and nothing else may touch it meanwhile."
- `&Window` — "I will read this window."
- `&mut Window` — "I will change this window."

Once you read signatures that way, the diff's shape becomes obvious. The whole PR
is: *functions that used to declare "I will read app state" now declare "I will
read this window and app state."* Every awkward rewrite in the diff is a place
where that upgraded declaration collided with something else's declaration, and had
to be restructured.

That sentence is a genuinely good answer to "walk me through why this is so big."

## Anchor lines in the diff

Open these and read them with the above in mind:

- `crates/theme/src/theme.rs` — `apply_to_window` takes `&mut Window` *and*
  `&mut App`, because it mutates both.
- `crates/ui/src/components/button/button_like.rs` — the `let theme = ...clone()`
  at the top of render, then `&impl ActiveTheme` all the way down.
- `crates/workspace/src/workspace.rs`, `set_window_theme` — the `.clone()` in
  Break 1 above.
