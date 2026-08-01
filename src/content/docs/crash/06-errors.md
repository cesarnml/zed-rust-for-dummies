---
title: 'Hour 6: Result and the ? operator'
description: Errors as values, and the operator that makes them bearable.
sidebar:
  order: 7
---

## `Result<T, E>`

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

Also just a library enum. There are no exceptions in Rust — a function that can
fail says so in its return type, and you cannot get at the value without
acknowledging the failure.

```rust
fn parse_hex(text: &str) -> Result<u32, std::num::ParseIntError> {
    u32::from_str_radix(text.trim_start_matches('#'), 16)
}

fn main() {
    match parse_hex("#0f1419") {
        Ok(value) => println!("{value}"),
        Err(error) => println!("bad colour: {error}"),
    }
}
```

The `Option` combinators mostly have `Result` twins — `unwrap_or`, `map`,
`and_then`, `unwrap_or_else` — plus a few for moving between the two worlds:

| Method | Does |
|---|---|
| `result.ok()` | `Result<T, E>` → `Option<T>`, discarding the error |
| `option.ok_or(e)` | `Option<T>` → `Result<T, E>` |
| `result.map_err(\|e\| ...)` | Transform the error type |
| `result.unwrap_or_default()` | The value, or `T::default()` |

`let _ = fallible();` is how you say "I am deliberately ignoring this result".
Without it, `#[must_use]` on `Result` produces a warning — which is the point.

## `?`

Writing `match` on every fallible call gets unreadable fast. `?` unwraps an `Ok`
or returns the `Err` from the enclosing function immediately.

```rust
use std::num::ParseIntError;

fn parse_pair(text: &str) -> Result<(u32, u32), ParseIntError> {
    let (left, right) = text.split_once(',').unwrap_or((text, "0"));
    let a = left.trim().parse::<u32>()?;     // returns early on Err
    let b = right.trim().parse::<u32>()?;
    Ok((a, b))
}

fn main() {
    println!("{:?}", parse_pair("3, 4"));
    println!("{:?}", parse_pair("3, x"));
}
```

That is the whole feature, and it is why Rust error handling reads like happy-path
code. Two constraints:

- `?` only works in a function that returns `Result` (or `Option`, or another
  `Try` type). It is not a general "unwrap".
- The error type must convert into the function's error type via `From`. That
  conversion is what makes `?` work across different error types.

`{:?}` is the **debug** format. `{}` is `Display` and needs the type to opt in;
`{:?}` needs `Debug`, which you almost always get by writing `#[derive(Debug)]`.
Use `{:#?}` for pretty-printed multi-line debug output — it is the fastest
debugging tool in the language.

## Your own error type

```rust
use std::fmt;

#[derive(Debug)]
enum ConfigError {
    Missing(String),
    NotANumber { key: String, value: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Missing(key) => write!(f, "missing key: {key}"),
            ConfigError::NotANumber { key, value } => {
                write!(f, "key {key} is not a number: {value}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}
```

`Debug` for programmers, `Display` for humans, and implementing `std::error::Error`
makes it usable as a boxed error. In real projects the `thiserror` crate generates
all of this from attributes, and `anyhow` gives you a catch-all error type for
application code. Libraries define precise error enums; binaries usually use
`anyhow`. Zed's own conventions land in the same place.

## Build: a config parser

```rust
use std::collections::HashMap;
use std::fmt;

#[derive(Debug)]
enum ConfigError {
    Missing(String),
    NotANumber { key: String, value: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Missing(key) => write!(f, "missing key: {key}"),
            ConfigError::NotANumber { key, value } => {
                write!(f, "key {key} is not a number: {value}")
            }
        }
    }
}

fn parse(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

fn get<'a>(config: &'a HashMap<String, String>, key: &str) -> Result<&'a str, ConfigError> {
    config
        .get(key)
        .map(|value| value.as_str())
        .ok_or_else(|| ConfigError::Missing(key.to_string()))
}

fn get_number(config: &HashMap<String, String>, key: &str) -> Result<u32, ConfigError> {
    let raw = get(config, key)?;
    raw.parse().map_err(|_| ConfigError::NotANumber {
        key: key.to_string(),
        value: raw.to_string(),
    })
}

fn main() {
    let config = parse("theme = Ayu Dark\nfont_size = 14\nbad = xyz");

    println!("{:?}", get(&config, "theme"));
    println!("{:?}", get_number(&config, "font_size"));
    println!("{}", get_number(&config, "bad").unwrap_err());
    println!("{}", get_number(&config, "nope").unwrap_err());
}
```

Read `get`'s signature carefully: `&'a HashMap` in, `&'a str` out. It returns a
reference *into* the map, so the lifetime says the result cannot outlive the map.
That is the same shape as the diff's most important signature, which you will meet
properly next hour but is worth spotting now.

## Panics, and when they are correct

`panic!` aborts the current thread with a message. `unwrap()` and `expect()` panic
on `None`/`Err`. Array indexing out of bounds panics. Integer overflow panics in
debug builds and wraps in release.

Panic is for **bugs** — states that should be impossible. Use `Result` for
conditions that are expected to occur: a file that might not exist, input that
might be malformed, a key that might be absent. A parser should never panic on bad
input; it should return `Err`.

:::caution[`unwrap()` in a review]
A reviewer reading a PR will stop at every `unwrap()`. If you cannot replace it,
replace it with `expect("reason this is impossible")` so the reason is in the
source rather than in your head. This is a cheap way to look like you know what
you are doing, because writing the reason down is how you find out you were wrong.
:::

## Exercises

1. Add a `Range { key: String, max: u32 }` variant to `ConfigError` and a
   `get_number_in_range` that uses it.
2. Change `get_number` to return `Result<u32, Box<dyn std::error::Error>>` and see
   how `?` starts accepting *any* error type. (You will need
   `impl std::error::Error for ConfigError {}`.)
3. Rewrite `main` as `fn main() -> Result<(), ConfigError>` so you can use `?` at
   the top level. What does the program print when it returns an `Err`?

<details>
<summary>Answer to 3</summary>

`main` may return `Result`. On `Err` the runtime prints the **`Debug`**
representation and exits with a non-zero status — which is why deriving `Debug` on
error types is not optional, and why a `Display` impl alone leaves you with ugly
output at the top level.

</details>

## What you should be able to do now

Return `Result`, chain with `?`, and articulate the difference between an error and
a bug. Next hour: the collections and iterators you will use in every program.
