---
title: 'Hour 8: Traits and generics'
description: Interfaces you can implement for types you don't own — the mechanism the whole PR turns on.
sidebar:
  order: 9
---

If you only get two hours of this course right, make them this one and
[hour 9](/crash/09-lifetimes/). The PR's entire design is a trait being split in
two.

## A trait is a set of methods a type can implement

```rust
trait Describe {
    fn describe(&self) -> String;

    /// Traits can supply defaults, which implementors may override.
    fn shout(&self) -> String {
        self.describe().to_uppercase()
    }
}

struct Theme {
    name: String,
}

impl Describe for Theme {
    fn describe(&self) -> String {
        format!("theme {}", self.name)
    }
}

fn main() {
    let theme = Theme { name: "Ayu Dark".to_string() };
    println!("{}", theme.describe());
    println!("{}", theme.shout());
}
```

So far this is an interface. Two things make it more than that.

**You can implement your trait for types you did not define:**

```rust
trait Describe {
    fn describe(&self) -> String;
}

impl Describe for u32 {
    fn describe(&self) -> String {
        format!("the number {self}")
    }
}

impl Describe for String {
    fn describe(&self) -> String {
        format!("the string {self:?}")
    }
}

fn main() {
    println!("{}", 42u32.describe());
    println!("{}", "hi".to_string().describe());
}
```

You cannot do that in TypeScript without patching a prototype. The rule limiting it
is **coherence**, also called the orphan rule: for `impl Trait for Type`, either the
trait or the type must be defined in your crate. It stops two crates defining
conflicting impls.

**And implementations are the unit the compiler tracks.** Delete one and every call
site that relied on it fails to compile — by name, with a location. That is the
entire mechanism of the 2,900-line migration: removing `impl ActiveTheme for App`
turns "find all the places that read the global theme" from an audit into a
compiler worklist.

## Deriving

Many traits can be implemented mechanically, so the compiler will do it:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
struct WindowId(u64);

fn main() {
    let a = WindowId(1);
    let b = a.clone();
    println!("{a:?} {} {:?}", a == b, WindowId::default());
}
```

| Derive | Gives you |
|---|---|
| `Debug` | `{:?}` formatting. Derive it on everything |
| `Clone` | An explicit `.clone()` |
| `Copy` | Implicit copying instead of moving (requires `Clone`) |
| `PartialEq` / `Eq` | `==` |
| `Hash` | Usable as a `HashMap` key (needs `Eq`) |
| `Default` | `T::default()` |
| `PartialOrd` / `Ord` | `<`, sorting |

`#[derive(...)]` is a macro. `#[serde(deny_unknown_fields)]` in the diff's settings
code is the same syntax driving a different one.

## Generics

```rust
fn largest<T: PartialOrd>(items: &[T]) -> Option<&T> {
    let mut iter = items.iter();
    let mut best = iter.next()?;
    for item in iter {
        if item > best {
            best = item;
        }
    }
    Some(best)
}

fn main() {
    println!("{:?}", largest(&[3, 7, 2]));
    println!("{:?}", largest(&["a", "c", "b"]));
    println!("{:?}", largest::<i32>(&[]));
}
```

`<T: PartialOrd>` is a **bound**: this works for any `T` that can be compared.
Without the bound, `item > best` would not compile — generics in Rust are checked
when the generic function is compiled, not when it is instantiated. That is the
opposite of C++ templates and much friendlier.

`where` clauses say the same thing with room to breathe:

```rust
use std::fmt::{Debug, Display};

fn show<T>(value: T)
where
    T: Debug + Display,
{
    println!("{value} / {value:?}");
}

fn main() {
    show(42);
}
```

Generics are **monomorphised**: the compiler generates a separate copy per concrete
type. Fast at runtime, and part of why Rust builds are slow.

## `impl Trait`

In argument position, `impl Trait` is shorthand for a generic parameter:

```rust
trait Describe {
    fn describe(&self) -> String;
}

// These two signatures mean the same thing.
fn print_one<T: Describe>(value: &T) {
    println!("{}", value.describe());
}

fn print_two(value: &impl Describe) {
    println!("{}", value.describe());
}
```

In return position it means "some concrete type implementing this, and I am not
telling you which":

```rust
fn evens(limit: u32) -> impl Iterator<Item = u32> {
    (0..limit).filter(|n| n % 2 == 0)
}

fn main() {
    println!("{:?}", evens(10).collect::<Vec<_>>());
}
```

That is how you return an iterator or a closure without naming its unspeakable
type.

The diff uses `&impl ActiveTheme` for parameters, which is worth understanding
precisely: it accepts anything implementing the trait, monomorphised per call site,
with no runtime cost — and it reads better than `&T` plus a `where` clause.

## `dyn Trait` — the other choice

```rust
trait Describe {
    fn describe(&self) -> String;
}

struct Theme;
struct Window;

impl Describe for Theme {
    fn describe(&self) -> String { "theme".to_string() }
}
impl Describe for Window {
    fn describe(&self) -> String { "window".to_string() }
}

fn main() {
    // A Vec can only hold one type — so hold trait objects.
    let items: Vec<Box<dyn Describe>> = vec![Box::new(Theme), Box::new(Window)];
    for item in &items {
        println!("{}", item.describe());
    }
}
```

| | `impl Trait` / generics | `dyn Trait` |
|---|---|---|
| Dispatch | Static, at compile time | Dynamic, via a vtable |
| Cost | None | A pointer indirection |
| Code size | One copy per type | One copy total |
| Can mix types in a collection | No | Yes |

Rule of thumb: generics by default, `dyn` when you need a heterogeneous collection
or want to keep compile times and binary size down. The diff's
`Arc<dyn Fn(...)>` fields are `dyn` for exactly the first reason — different call
sites store different closures in the same field.

## Build: a pluggable renderer

```rust
trait Render {
    fn render(&self) -> String;
    fn name(&self) -> &'static str {
        "anonymous"
    }
}

struct Button {
    label: String,
}

struct Divider;

impl Render for Button {
    fn render(&self) -> String {
        format!("[ {} ]", self.label)
    }
    fn name(&self) -> &'static str {
        "button"
    }
}

impl Render for Divider {
    fn render(&self) -> String {
        "-".repeat(20)
    }
}

/// Static dispatch: one copy per concrete type.
fn render_twice(item: &impl Render) -> String {
    format!("{}{}", item.render(), item.render())
}

/// Dynamic dispatch: any mix of types.
fn render_all(items: &[Box<dyn Render>]) -> Vec<String> {
    items.iter().map(|item| format!("{}: {}", item.name(), item.render())).collect()
}

fn main() {
    let button = Button { label: "Save".to_string() };
    println!("{}", render_twice(&button));

    let screen: Vec<Box<dyn Render>> = vec![
        Box::new(Button { label: "Open".to_string() }),
        Box::new(Divider),
    ];
    for line in render_all(&screen) {
        println!("{line}");
    }
}
```

Note `Divider` does not implement `name`, so it gets the default. That is the
mechanism behind the PR's `ConfiguredTheme` trait having a blanket default while
`WindowTheme` requires an explicit impl.

## Exercises

1. Add `impl Render for String` so a bare string renders as itself. (Coherence
   allows it: `Render` is yours.)
2. Add a `Panel` struct holding `Vec<Box<dyn Render>>` and implement `Render` for
   it so panels nest.
3. Change `render_twice` to take `&dyn Render` and note what changes at the call
   site — and what stops being possible.

<details>
<summary>Answer to 3</summary>

The call site is unchanged (`&button` coerces). What you lose is inlining and
monomorphisation — the call now goes through a vtable. What you gain is one copy of
the function instead of one per type. For a two-line formatter this is
irrelevant; for something called 1,800 times in a render loop it is the kind of
thing a reviewer will ask about, which is why the diff uses `&impl ActiveTheme`
rather than `&dyn ActiveTheme`.

</details>

## What you should be able to do now

Define a trait, implement it for a foreign type, and say when you would reach for
`dyn` instead of a generic. Next hour: lifetimes, and the single most important
line in the PR.
