---
title: Reading a render signature
description: Decode any line in the diff, symbol by symbol.
sidebar:
  order: 2
---

Most of the 307 files contain the same few shapes. Learn to read them once and the
diff stops being intimidating.

## The canonical render signature

```rust
fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement
```

Piece by piece:

| Fragment | Meaning |
|---|---|
| `&mut self` | Exclusive borrow of this view's state. It can mutate itself while rendering. |
| `window: &mut Window` | Exclusive borrow of the platform window. Mutable because rendering can change focus, request repaints, etc. |
| `cx: &mut Context<Self>` | The app context, specialised to this entity type. Derefs to `App`. |
| `-> impl IntoElement` | "Returns *some* type that can become an element" — the concrete type is unnameable (it's a deep generic tree), so it's existential. |

The parameter **order is a convention**: `self`, then `window`, then `cx`, then any
callbacks. You'll see it violated nowhere.

## The single most common diff line

```diff
- .bg(cx.theme().colors().editor_background)
+ .bg(window.theme(cx).colors().editor_background)
```

That's it. That is roughly 1,177 of the changed lines. Read it as: *"instead of
asking the app for the theme, ask this window for the theme, given the app."*

## The second most common

```diff
- fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
+ fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
```

An underscore parameter is **unnameable** — you literally cannot refer to it. So the
rename isn't cosmetic:

- The next person who needs the theme in that function must first rename the
  parameter, adding noise to *their* diff.
- A reviewer scanning for "does this function have a window available?" can't tell
  by grepping.

Naming every unused `Window` parameter `_window` makes window availability greppable
and makes future theme fixes one-line changes.

**They do inflate the diff, and they are the most obviously drive-by part of it.**
The right move is to say so first: *"the `_` → `_window` renames are separable into
their own commit if you'd prefer — I did them so window availability is greppable,
but I'll pull them out."* See [Design 02, Decision 4](/architecture/02-active-theme-split/).

## Styling chains

```rust
div()
    .h_full()
    .w(relative(size))
    .bg(window.theme(cx).colors().editor_background)
    .border_color(window.theme(cx).colors().pane_group_border)
    .when(centered_layout, |this| this.px_4())
    .child(some_child.render(window, cx))
```

Tailwind-like, chained by ownership: each method takes `self` and returns `Self`.
`.when(cond, closure)` is the conditional; `.when_some(option, closure)` is the
optional-value version.

Note that `window.theme(cx)` appears twice here without a clone. That's
[the lifetime signature](/rust/lifetimes/) doing its job — the borrow doesn't
conflict with the `&mut Window` needed by `.child(...)` on the last line.

## Closure parameter positions

GPUI callbacks receive their own contexts. The migration's most common trap:

```rust
.drag_over(|tab, event, window, cx| tab.bg(window.theme(cx).colors().drop_target_background))
//          ^^^  ^^^^^  ^^^^^^  ^^
//          the element being styled
//                 the drag event
//                         THIS window — use this one, not an outer capture
//                                 the app context
```

Before the migration, many of these were written `|tab, _, _, cx|` and reached for
an ambient theme. After, they must use their own `window` parameter — which is also
**semantically better**, because it's the window at invocation time.

## `cx.listener`

```rust
.on_click(cx.listener(|this: &mut Self, event, window, cx: &mut Context<Self>| {
    this.do_something(window, cx);
}))
```

`cx.listener` wraps a closure so it receives `&mut Self` when fired. Without it you'd
have to capture a `WeakEntity` and update it manually. It's the standard way to write
an event handler that mutates the view.

## `impl Render` vs `impl RenderOnce`

```rust
impl Render for ThemeSelector {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement
}

#[derive(IntoElement)]
struct Chip { ... }

impl RenderOnce for Chip {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement
    //        ^^^^ by value, consumed        ^^^^^^^ plain App, not Context<Self>
}
```

`RenderOnce` types get `#[derive(IntoElement)]` so they can be passed straight to
`.child()`. Because they receive `&mut App` rather than `&mut Context<Self>`, they
have no `cx.notify()` — they're stateless.

**Relevant to this PR:** `RenderOnce` components still receive a `window`, so they
migrate exactly like `Render` ones. A component with *no* window at all is where the
[gaps](/gaps/the-honest-list/) live.

## Reading the delegate pattern

The theme selector uses it heavily:

```rust
impl PickerDelegate for ThemeSelectorDelegate {
    fn placeholder_text(&self, window: &mut Window, cx: &mut App) -> Arc<str>;
    fn confirm(&mut self, secondary: bool, window: &mut Window, cx: &mut Context<Picker<Self>>);
    fn dismissed(&mut self, window: &mut Window, cx: &mut Context<Picker<Self>>);
    fn render_footer(&self, window: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement>;
}
```

A generic `Picker<D>` component asks a `D: PickerDelegate` what to display and what
to do. Strategy pattern. Note `Context<Picker<Self>>` — the context is specialised to
the *picker*, not the delegate, because the picker is the entity.

Several of these gained a `window` parameter (or promoted `_` to `window`) in this
branch, because the delegate now needs to apply and revert per-window themes. That's
[rewrite Shape 5b](/migration/shapes/#5b-the-callback-type-has-no-window--give-it-one).

## A worked example from the diff

```rust
fn render_footer(
    &self,
    window: &mut Window,                    // ← was `_: &mut Window`
    cx: &mut Context<Picker<Self>>,
) -> Option<gpui::AnyElement> {
    Some(
        h_flex()
            .border_t_1()
            .border_color(window.theme(cx).colors().border_variant)   // ← was cx.theme()
            .child(Button::new("docs", "View Theme Docs") ... )
            .into_any(),
    )
}
```

Three things happened: the parameter got a name, the theme read moved to the window,
and nothing else changed. That is the shape of ~95% of the diff.
