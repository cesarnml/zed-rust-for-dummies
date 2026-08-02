---
title: 'Hour 11: Modules, crates, and tests'
description: How a Rust project is laid out, and the test harness you get for free.
sidebar:
  order: 12
---

You can now write Rust. This hour is about shipping more than one file of it.

## Modules

A module is a namespace. `mod` declares one; the compiler looks for it in a file of
the same name.

```
src/
├── main.rs
├── theme.rs
└── registry/
    ├── mod.rs        (or registry.rs alongside the folder — both work)
    └── cache.rs
```

<!-- rust:skip -->
```rust
// main.rs
mod theme;

fn main() {
    let t = theme::Theme::new("Ayu Dark");
    println!("{}", t.name);
}
```

<!-- rust:skip -->
```rust
// theme.rs
pub struct Theme {
    pub name: String,
}

impl Theme {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_string() }
    }
}
```

Everything is **private by default**, including struct fields. `pub` exposes an
item; `pub(crate)` exposes it within your crate but not to users of it. The diff
uses `pub(crate)` deliberately in places, and a reviewer will read that as a
statement about intended API surface.

Paths:

| Path | Means |
|---|---|
| `crate::theme::Theme` | Absolute, from this crate's root |
| `self::cache` | Relative, this module |
| `super::Theme` | Parent module |
| `theme::Theme` | Relative to here |

`use` imports a path so you can write the short name:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};      // group with braces
use std::fmt::Write as _;         // import a trait for its methods only

fn main() {
    let mut map: HashMap<u8, Arc<Mutex<String>>> = HashMap::new();
    map.insert(1, Arc::new(Mutex::new(String::new())));
    let mut out = String::new();
    let _ = write!(out, "{} entries", map.len());
    println!("{out}");
}
```

That last form — `use Trait as _` — imports a trait so its methods are callable
without bringing the name into scope. You will see it and wonder; that is what it
does.

Inline modules work too, and are how tests are usually written:

```rust
mod theme {
    pub struct Theme {
        pub name: String,
    }

    impl Theme {
        pub fn new(name: &str) -> Self {
            Self { name: name.to_string() }
        }
    }
}

fn main() {
    println!("{}", theme::Theme::new("Ayu Dark").name);
}
```

## Crates and dependencies

```toml
[package]
name = "hello"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
anyhow = "1"

[dev-dependencies]
pretty_assertions = "1"
```

`cargo add serde --features derive` edits this for you. `[dev-dependencies]` are
only compiled for tests and examples.

A **workspace** shares one lockfile and target directory across many packages:

```toml
[workspace]
members = ["crates/*"]
resolver = "2"
```

That is Zed's layout, and why every path in the diff starts with `crates/`.

## Tests

The harness is built in. `#[test]` marks a function; `cargo test` runs every one.

```rust
pub fn celsius_to_fahrenheit(c: f64) -> f64 {
    c * 9.0 / 5.0 + 32.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn freezing() {
        assert_eq!(celsius_to_fahrenheit(0.0), 32.0);
    }

    #[test]
    fn boiling() {
        assert_eq!(celsius_to_fahrenheit(100.0), 212.0);
    }

    #[test]
    fn negative() {
        assert!(celsius_to_fahrenheit(-40.0) < 0.0);
    }

    #[test]
    #[should_panic(expected = "nope")]
    fn panics() {
        panic!("nope");
    }
}
```

Three conventions worth copying exactly:

- `#[cfg(test)]` means the module is only compiled during tests — zero cost in
  release builds.
- `use super::*;` pulls in everything from the parent module, so tests can reach
  private items. **Unit tests in Rust can test private functions**, because they
  live inside the module.
- `assert_eq!` prints both values on failure. Prefer it to `assert!(a == b)`.

Integration tests go in `tests/` at the package root, get compiled as separate
crates, and can only see your public API — which makes them a genuine check on
whether that API is usable.

```rust
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tests returning Result can use `?`.
    #[test]
    fn parses() -> Result<(), std::num::ParseIntError> {
        let n: i32 = "41".parse()?;
        assert_eq!(add(n, 1), 42);
        Ok(())
    }
}
```

Useful flags: `cargo test freezing` runs tests matching a substring;
`cargo test -- --nocapture` shows `println!` output, which is otherwise swallowed
for passing tests.

## Documentation

`///` is a doc comment, written in Markdown, and its code blocks are **compiled and
run** as tests.

```rust
/// Converts Celsius to Fahrenheit.
///
/// ```
/// assert_eq!(hello::celsius_to_fahrenheit(0.0), 32.0);
/// ```
pub fn celsius_to_fahrenheit(c: f64) -> f64 {
    c * 9.0 / 5.0 + 32.0
}
```

`cargo doc --open` builds and opens the docs; `cargo test` runs the examples. Doc
examples that cannot rot are a genuinely excellent feature, and `//!` at the top of
a file documents the module itself — which is the style the diff's design comments
use.

## Macros, as a reader

You will not write macros this hour, but you must read them.

**Declarative** macros are pattern matching over syntax:

```rust
macro_rules! theme_names {
    ($($name:expr),* $(,)?) => {
        vec![$($name.to_string()),*]
    };
}

fn main() {
    let names = theme_names!["Ayu Dark", "One Light",];
    println!("{names:?}");
}
```

`$name:expr` captures an expression; `$(...),*` repeats it comma-separated;
`$(,)?` permits a trailing comma. That is 90% of what you need to *read* one. The
diff's `impl_tuple_row_traits!` is this shape, generating an impl per tuple size —
which is why adding a twelfth column meant touching a macro invocation rather than
writing a twelfth impl by hand.

**Procedural** macros are Rust programs that take a token stream and return one.
`#[derive(Debug)]`, `#[derive(Serialize)]` and `#[tokio::main]` are all this. You
use them constantly and will almost certainly never write one.

## Exercises

1. Split your hour-10 registry into `main.rs` and `registry.rs`, making only
   `Registry` and its methods `pub`.
2. Write three tests for `Registry::get_or_insert`, including one asserting
   `Arc::ptr_eq` for a repeated name.
3. Add a doc comment with a runnable example to `get_or_insert` and confirm
   `cargo test` executes it.
4. Run `cargo clippy` on everything you have written today and fix what it says.
   It will teach you idiom faster than any tutorial.

## What you should be able to do now

Lay out a multi-file crate, write and run tests, and read a `macro_rules!` block
without panic. Next is stored callbacks, which is the last new Rust in the
course, and then the three hours that tie it to the PR.
