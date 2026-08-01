---
title: 'Hour 5: Structs, enums, and Option'
description: Your own types, methods, and the enum that replaces null.
sidebar:
  order: 6
---

## Structs

```rust
struct Theme {
    name: String,
    background: u32,
    dark: bool,
}

fn main() {
    let theme = Theme {
        name: String::from("Ayu Dark"),
        background: 0x0f1419,
        dark: true,
    };
    println!("{} {:#08x} {}", theme.name, theme.background, theme.dark);
}
```

Two other shapes exist and both appear in real code:

```rust
struct WindowId(u64);        // tuple struct — a named wrapper
struct Marker;               // unit struct — no data, used as a type-level tag
```

The tuple struct is the **newtype** pattern and is everywhere in Rust. `WindowId(u64)`
is a distinct type from `u64`, so you cannot accidentally pass a workspace id where
a window id belongs. The diff leans on exactly this — its persistence is keyed by
`WorkspaceId` while its runtime map is keyed by `WindowId`, and the type system is
what stops those being confused.

## `impl` blocks

Methods live in an `impl` block, not in the struct.

```rust
struct Theme {
    name: String,
    dark: bool,
}

impl Theme {
    /// An associated function — no `self`. This is the constructor convention.
    fn new(name: &str, dark: bool) -> Self {
        Self { name: name.to_string(), dark }
    }

    /// Borrows self immutably.
    fn label(&self) -> String {
        format!("{} ({})", self.name, if self.dark { "dark" } else { "light" })
    }

    /// Borrows self mutably.
    fn rename(&mut self, name: &str) {
        self.name = name.to_string();
    }

    /// Consumes self.
    fn into_name(self) -> String {
        self.name
    }
}

fn main() {
    let mut theme = Theme::new("Ayu Dark", true);
    println!("{}", theme.label());
    theme.rename("Ayu Mirage");
    println!("{}", theme.into_name());   // theme is moved here, gone after
}
```

The first parameter tells you the whole contract:

| First parameter | Means | Caller can still use the value after |
|---|---|---|
| `&self` | Read | Yes |
| `&mut self` | Mutate | Yes |
| `self` | Consume | **No** |
| none | Associated function, call as `Theme::new(...)` | n/a |

`Self` (capital) is the type the `impl` is for. `self.name = name.to_string()` also
shows the `&str` → `String` conversion you will type a thousand times.

## Enums are the good part

Rust enums are **sum types**: each variant can carry different data.

```rust
enum ThemeSelection {
    Fixed(String),
    System { light: String, dark: String },
    None,
}

fn describe(selection: &ThemeSelection) -> String {
    match selection {
        ThemeSelection::Fixed(name) => format!("always {name}"),
        ThemeSelection::System { light, dark } => format!("{light} by day, {dark} by night"),
        ThemeSelection::None => "unset".to_string(),
    }
}
```

That `match` destructures in the pattern — `name`, `light` and `dark` are bound to
the variant's contents. And it is exhaustive: add a fourth variant and every
`match` over this enum stops compiling until you handle it.

Coming from TypeScript, this is a discriminated union with the ergonomics fixed and
the exhaustiveness checking guaranteed rather than opt-in.

## `Option<T>` replaces null

```rust
enum Option<T> {
    Some(T),
    None,
}
```

That is the whole definition, and it is in the standard library rather than the
language. There is no `null`. A value that might be absent has a *different type*
from one that cannot be, so you cannot forget to check.

```rust
fn find_theme(name: &str) -> Option<&'static str> {
    match name {
        "ayu" => Some("Ayu Dark"),
        "one" => Some("One Dark"),
        _ => None,
    }
}

fn main() {
    match find_theme("ayu") {
        Some(full) => println!("found {full}"),
        None => println!("not found"),
    }

    if let Some(full) = find_theme("one") {
        println!("also found {full}");
    }

    // The combinator style, which you will use more than match:
    let label = find_theme("nope").unwrap_or("default");
    println!("{label}");
}
```

The methods worth memorising now:

| Method | Does |
|---|---|
| `unwrap_or(x)` | The value, or `x` |
| `unwrap_or_else(\|\| ...)` | The value, or compute a fallback lazily |
| `unwrap_or_default()` | The value, or `T::default()` |
| `map(\|v\| ...)` | Transform the inside if present |
| `and_then(\|v\| ...)` | Like `map` but the closure returns another `Option` |
| `is_some()` / `is_none()` | Predicates |
| `unwrap()` / `expect("msg")` | The value, or **panic** |

`unwrap()` in application code is a bug waiting for a bad day. `expect("why this
cannot be None")` is acceptable when you can articulate the invariant. Zed's own
`CLAUDE.md` has rules about this, and the diff's error handling is graded against
them.

The PR's central lookup is exactly this shape — `override_for` returns
`Option<Arc<Theme>>`, and the fallback is
`.unwrap_or_else(|| cx.configured_theme())`: use this window's override if there is
one, otherwise the global theme. You now have everything you need to read that
line.

## Build: shape areas

```rust
enum Shape {
    Circle { radius: f64 },
    Rectangle { width: f64, height: f64 },
    Triangle { base: f64, height: f64 },
}

impl Shape {
    fn area(&self) -> f64 {
        match self {
            Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
            Shape::Rectangle { width, height } => width * height,
            Shape::Triangle { base, height } => 0.5 * base * height,
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Shape::Circle { .. } => "circle",
            Shape::Rectangle { .. } => "rectangle",
            Shape::Triangle { .. } => "triangle",
        }
    }
}

fn main() {
    let shapes = [
        Shape::Circle { radius: 1.0 },
        Shape::Rectangle { width: 2.0, height: 3.0 },
        Shape::Triangle { base: 4.0, height: 5.0 },
    ];
    for shape in &shapes {
        println!("{}: {:.3}", shape.name(), shape.area());
    }
}
```

`{ .. }` in a pattern means "and the rest, which I don't care about".

## Exercises

1. Add `Shape::Square { side }` and let the compiler show you every place that
   needs updating. This is the PR's whole mechanism at 1/1000 scale — notice that
   you did not have to *find* the call sites.
2. Write `fn largest(shapes: &[Shape]) -> Option<&Shape>` returning the
   biggest by area, or `None` for an empty slice.
3. Give `Theme` a `fn is_readable(&self) -> bool` and call it from `label`.

<details>
<summary>Solution to 2</summary>

Add this to the `impl`-block program above:

<!-- rust:skip -->
```rust
fn largest(shapes: &[Shape]) -> Option<&Shape> {
    shapes
        .iter()
        .max_by(|a, b| a.area().total_cmp(&b.area()))
}
```

`max_by` returns `Option` for you, because an empty slice has no maximum.
`total_cmp` compares floats without the `NaN` problem that stops `f64` from
implementing `Ord`. Iterators are [hour 7](/crash/07-collections/).

</details>

## What you should be able to do now

Define a struct with methods, define an enum with data, and use `Option` without
reaching for `unwrap`. Next hour: the other enum, `Result`.
