---
title: 'Hour 9: Lifetimes'
description: Not durations — relationships. And the signature this entire PR turns on.
sidebar:
  order: 10
---

Lifetimes are the part of Rust that looks like line noise and is actually the
simplest idea in the language, stated awkwardly.

## What a lifetime is

Every reference is valid for some region of the program. Usually the compiler works
that region out alone. When a function has more than one reference and returns one,
it cannot guess, so you tell it — **not how long the reference lives, but which
input the output came from**.

```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

fn main() {
    let x = String::from("window");
    let y = String::from("theme");
    println!("{}", longer(&x, &y));
}
```

`'a` is a name for a region. The signature says: the returned reference is valid for
as long as *both* inputs are. You are not creating anything; you are stating a
constraint the compiler then enforces at every call site.

Watch it do that:

<!-- rust:expect-fail -->
```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}

fn main() {
    let x = String::from("window");
    let result;
    {
        let y = String::from("theme");
        result = longer(&x, &y);
    }
    println!("{result}");
}
```

```
error[E0597]: `y` does not live long enough
```

`y` dies at the closing brace but `result` might point into it. The compiler caught
a use-after-free at compile time, with no runtime cost.

## Elision: why you rarely write them

Three rules let the compiler infer lifetimes in the common cases:

1. Each input reference gets its own lifetime parameter.
2. If there is exactly **one** input lifetime, it is assigned to all outputs.
3. If one of the inputs is `&self` or `&mut self`, **`self`'s lifetime** is assigned
   to all outputs.

Rule 2 is why `fn first_word(text: &str) -> &str` needs no annotation. Rule 3 is
why methods returning references from `self` need none either — and it is also the
rule that makes the PR's central signature interesting, because it is a case where
you must *override* the default.

## The signature this PR turns on

Here it is, with GPUI's types renamed to nothing in particular so you can read it
as plain Rust:

```rust
struct App;
struct Theme;
struct Window;
use std::sync::Arc;

trait WindowTheme {
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme>;
}
```

Read the annotation aloud: **the returned reference borrows `app`, not `self`.**

Elision rule 3 would have given you `&self`'s lifetime — that is the default for a
method. Writing `'a` explicitly on `app` and the return type *overrides* that
default, and the whole design depends on the override.

Why it matters, concretely. `self` here is the window, and callers hold it as
`&mut Window`. If the returned theme borrowed `self`, then this would be illegal:

```rust
use std::sync::Arc;

struct Theme {
    name: String,
}
struct App {
    theme: Arc<Theme>,
}
struct Window {
    repaints: u32,
}

trait WindowTheme {
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme>;
}

impl WindowTheme for Window {
    fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme> {
        &app.theme
    }
}

fn repaint(window: &mut Window) {
    window.repaints += 1;
}

fn render(window: &mut Window, app: &App) -> String {
    let theme = window.theme(app);   // borrows `app`, not `window`
    repaint(window);                 // so taking &mut Window here is legal
    theme.name.clone()               // and `theme` is still alive
}

fn main() {
    let app = App { theme: Arc::new(Theme { name: "Ayu Dark".into() }) };
    let mut window = Window { repaints: 0 };
    println!("{} after {} repaint", render(&mut window, &app), window.repaints);
}
```

That compiles. Now change the trait method to `fn theme(&self, app: &App) -> &Arc<Theme>`
— elision rule 3 ties the result to `&self` — and `render` stops compiling with
`cannot borrow *window as mutable because it is also borrowed as immutable`. One
annotation is the difference.

Because the theme borrows `app` rather than `window`, the caller can hold the theme
*and* keep mutating the window. If the lifetime came from `self`, every call site
that reads the theme and then touches the window would be a borrow-check error —
and in the real codebase that is most of them.

One annotation on one line is what makes ~1,800 call sites compile. That is why
[the lifetimes page](/rust/lifetimes/) calls it the load-bearing line of the diff,
and why it is the question a reviewer is most likely to ask.

## Structs that hold references

```rust
struct Excerpt<'a> {
    text: &'a str,
}

impl<'a> Excerpt<'a> {
    fn new(text: &'a str) -> Self {
        Self { text }
    }

    fn first_sentence(&self) -> &str {
        self.text.split('.').next().unwrap_or(self.text)
    }
}

fn main() {
    let source = String::from("One. Two. Three.");
    let excerpt = Excerpt::new(&source);
    println!("{}", excerpt.first_sentence());
}
```

`Excerpt<'a>` cannot outlive the string it points into. The `impl<'a>` line declares
the parameter before using it, exactly like a generic type parameter — because that
is what it is.

Most of the time, the fix for "this struct needs a lifetime and it is getting
painful" is to own the data instead (`String` rather than `&'a str`), or to share it
(`Arc<T>`, next hour). Lifetimes in structs are a real tool but they are not the
first one to reach for.

## `'static`

`'static` means "valid for the whole program". Two different things wear it:

```rust
fn main() {
    let literal: &'static str = "lives in the binary";
    println!("{literal}");
}
```

- **`&'static T`** — a reference that lives forever. String literals are the common
  case.
- **`T: 'static`** as a *bound* — "this type contains no references that could
  expire". A `String` satisfies `T: 'static` despite being dropped, because it owns
  everything inside it.

That second meaning is the confusing one, and it is the one the diff uses. When a
closure is stored in a struct or sent to a background task, it must be `'static`:
not "immortal", but "borrowing nothing that might die first". Combine it with
`Send` (safe to move between threads) and you have the bounds on the PR's stored
callbacks.

## Exercises

1. Write `fn longest_line<'a>(text: &'a str) -> &'a str` returning the longest line.
   Then delete the annotations and confirm elision handles it.
2. Make this compile by changing only the signature:

   <!-- rust:expect-fail -->
   ```rust
   fn pick(a: &str, b: &str) -> &str {
       if a.len() > b.len() { a } else { b }
   }
   ```

3. Write a `Parser<'a>` struct holding `&'a str` and a `position: usize`, with a
   method `fn rest(&self) -> &'a str` returning everything from `position` onward.
   Note that the return borrows the *original text*, not `self` — the same override
   the PR makes.

<details>
<summary>Solution to 3</summary>

```rust
struct Parser<'a> {
    text: &'a str,
    position: usize,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Self { text, position: 0 }
    }

    /// Returns a slice of the ORIGINAL text, not of `self` — so the caller may
    /// keep the result and go on mutating the parser.
    fn rest(&self) -> &'a str {
        &self.text[self.position..]
    }

    fn advance(&mut self, by: usize) {
        self.position = (self.position + by).min(self.text.len());
    }
}

fn main() {
    let source = String::from("theme override");
    let mut parser = Parser::new(&source);
    let tail = parser.rest();
    parser.advance(6);            // legal: `tail` doesn't borrow `parser`
    println!("{tail} / {}", parser.rest());
}
```

Change `-> &'a str` to `-> &str` and the `parser.advance(6)` line stops compiling,
because elision rule 3 would tie the result to `&self`. That is the PR's design
decision in eleven lines — worth typing twice.

</details>

## What you should be able to do now

Explain that a lifetime names a relationship rather than a duration, recite the
elision rules, and say why `fn theme<'a>(&self, app: &'a App) -> &'a Arc<Theme>`
puts `'a` where it does. That last one is item 1 on
[the contract](/rust/how-to-use/).
