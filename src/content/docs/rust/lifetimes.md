---
title: 3. Lifetimes
description: One annotation on one function is the reason a 2,900-line migration was mechanical instead of impossible.
sidebar:
  order: 4
---

:::tip[If you only learn one thing from this site]
This page. The signature below is the highest-leverage line in the patch, and it is
the most likely thing a Rust-literate reviewer will use to check whether you
understand your own diff.
:::

## The one-paragraph version

A lifetime annotation answers: *"this function returns a reference — a reference
**into what**?"*

Rust needs to know, because it has to guarantee the thing you're referencing is
still alive. So when a function takes two references and returns one, you have to
say which input the output borrows from.

```rust
fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme>;
```

Read it as: **"the returned reference is valid for as long as `cx` is valid."**
Note what's *missing*: there is no `'a` on `&self`. The output is not tied to the
window's lifetime at all.

## Why this specific signature

### The obvious alternative, and why it breaks everything

The signature you'd write by default:

```rust
fn theme<'a>(&'a self, cx: &'a App) -> &'a Arc<Theme>;
//           ^^ note the 'a here too
```

This says "the output lives as long as *both* inputs" — which, to the borrow
checker, means the output keeps **both** `self` and `cx` borrowed.

Now look at the most common pattern in the entire diff:

```rust
fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let theme = window.theme(cx);            // borrows window (immutably)
    div()
        .bg(theme.colors().editor_background)
        .child(self.child.render(window, cx))  // ← needs &mut Window. ERROR.
}
```

With the wrong signature, `theme` holds a shared borrow of `window`, and line 5
wants an exclusive borrow. **Many readers or one writer, never both.** Compile error.

The fix at each site would be to clone:

```rust
let theme = window.theme(cx).clone();
```

That works. It also means adding `.clone()` at **hundreds of call sites** —
inflating the diff further, adding refcount traffic in the render hot path, and
turning a find-and-replace into a judgement call at every site.

### Why the chosen signature is legitimate, not a trick

Here's the part that makes it correct rather than clever:

```rust
impl WindowTheme for Window {
    fn theme<'a>(&self, cx: &'a App) -> &'a Arc<Theme> {
        WindowThemeOverrides::theme(self.window_handle().window_id(), cx)
    }
}
```

The window is used to compute a **`WindowId`** — a `Copy` value, ~8 bytes. That id
is then used to look up in a map that lives in an **app global**, i.e. inside `cx`.

So the returned reference genuinely points into `cx`'s memory. The window was
consulted, not borrowed-from. The lifetime annotation is *describing reality*, not
circumventing the borrow checker.

The doc comment in the source says exactly this:

```rust
/// The returned reference borrows only `cx` (the theme is stored in an app
/// global), so the window remains usable while the theme is held.
```

**This is the answer to give if asked.** Not "it makes the borrow checker happy" —
that sounds like a hack. The real answer is: *the theme lives in the app, not in
the window, so borrowing only the app is the honest signature. That truthfulness is
what kept the migration mechanical.*

### The constraint it does *not* remove

`window.theme(cx)` takes `&App`. You still cannot hold the result across a use of
`&mut App`. When that happens, the pattern in the diff is:

```rust
let theme = window.theme(cx).clone();
```

which matches the pre-existing `cx.theme().clone()` idiom exactly. So the clone
still appears — just at the dozens of sites that genuinely need it, not the
hundreds that don't.

## Lifetime elision — why most functions have no annotations

You will read thousands of lines of this codebase without seeing a `'a`. That's
because Rust infers them in the common cases:

```rust
fn colors(&self) -> &ThemeColors            // one input ref → output borrows it
fn colors<'a>(&'a self) -> &'a ThemeColors  // what the compiler actually sees
```

The rules, informally:

1. Each input reference gets its own lifetime.
2. If there's exactly one input reference, the output borrows from it.
3. If one input is `&self`, the output borrows from `self`.

Rule 3 is why `WindowTheme::theme` needs an explicit annotation: it has `&self` and
`&App`, so elision would pick `self` — precisely the wrong answer. The annotation
exists to *override the default*, which is a good thing to be able to say.

## `'static` — the special one

`'static` means "this reference is valid for the entire program" or, for owned
types, "this value contains no borrowed references at all."

It shows up as a **bound**:

```rust
Arc<dyn Fn(&mut Window, &mut App) -> AnyElement + 'static>
```

which means "this stored closure captures nothing borrowed." Since `&mut Window` is
a loan on UI-thread state, you can never put one inside a `'static` value.

That constraint is the entire reason
[rewrite Shape 5](/migration/shapes/#shape-5--static--send-boundaries) exists. See
[Closures](/rust/closures/) for the three ways the diff works around it.

## Practising the explanation

Try saying this out loud until it's fluent:

> The theme lives in an app-level global map, keyed by window id. So when you call
> `window.theme(cx)`, the window is only used to compute the key — the reference we
> hand back points into `cx`. Annotating the return with `cx`'s lifetime rather than
> the window's is therefore just accurate. And it's what makes the migration
> tractable: without it, every one of the ~1,800 rewritten sites that keeps using
> the window afterwards — which is most of them, since render functions build
> children — would have needed a `.clone()`.

If a reviewer asks *"is this signature sound?"*, that paragraph is the answer.

## Anchor line

```bash
git diff main...HEAD -- crates/theme/src/theme.rs
```

Search for `pub trait WindowTheme`. Read the doc comment above `fn theme`. It is
four lines and it is the design.
