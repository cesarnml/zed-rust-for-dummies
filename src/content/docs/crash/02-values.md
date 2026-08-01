---
title: 'Hour 2: Values, functions, and match'
description: Bindings, the primitive types, and the pattern matching you will use in every file.
sidebar:
  order: 3
---

## Bindings are immutable by default

```rust
fn main() {
    let x = 5;
    let mut y = 5;
    y += 1;
    println!("{x} {y}");
}
```

`let x = 5;` then `x += 1;` is a compile error. This is the opposite default from
`let` in JavaScript, and it is load-bearing: when you see a binding without `mut`,
you know nothing reassigns it.

**Shadowing** is not mutation. You can re-`let` the same name, including at a
different type:

```rust
fn main() {
    let spaces = "   ";
    let spaces = spaces.len();   // now a usize, and that's fine
    println!("{spaces}");
}
```

This is idiomatic and common — particularly for parsing, where you shadow a
`String` with the thing you parsed out of it.

## The types you actually meet

| Type | Notes |
|---|---|
| `i32` / `u32` / `i64` / `u64` | Signed and unsigned integers. `i32` is the default |
| `usize` | Pointer-sized unsigned. Indices and lengths are always `usize` |
| `f64` | Float. Default for decimals |
| `bool` | `true` / `false`. No truthiness. `if 1` is an error |
| `char` | A Unicode scalar. Four bytes, not one |
| `&str` | A borrowed string slice |
| `String` | An owned, growable string |
| `()` | Unit — "no value". What a function returns when it returns nothing |

The `String`/`&str` split is the first thing that trips up people arriving from a
GC'd language, and it is your first taste of ownership. `String` owns its bytes and
can grow. `&str` is a *view* into bytes someone else owns. A string literal is a
`&'static str` — a view into your binary, which is why it lives forever.

```rust
fn main() {
    let owned: String = String::from("theme");
    let borrowed: &str = &owned;      // a view into `owned`
    let literal: &str = "theme";      // a view into the binary
    println!("{owned} {borrowed} {literal}");
}
```

Rule of thumb that will serve you for months: **take `&str` as a parameter, return
`String` when you built something new.**

## Functions

```rust
fn celsius_to_fahrenheit(c: f64) -> f64 {
    c * 9.0 / 5.0 + 32.0
}
```

Parameter types are mandatory. Return type after `->`, omitted when it is `()`.
The last expression without a semicolon is the return value.

Type inference works inside bodies but never across function signatures — which is
deliberate, and why reading a signature tells you everything about a function's
contract. The single most important line in this PR is a function signature, and
[hour 9](/crash/09-lifetimes/) is about reading it.

## `if` is an expression

```rust
fn classify(n: i32) -> &'static str {
    if n < 0 {
        "negative"
    } else if n == 0 {
        "zero"
    } else {
        "positive"
    }
}
```

Both branches must have the same type. There is no ternary because `if` already
is one.

## `match`

This is the one to internalise. `match` is a `switch` that is exhaustive, can
destructure, and is an expression.

```rust
fn describe(n: i32) -> String {
    match n {
        0 => "zero".to_string(),
        1..=9 => "single digit".to_string(),
        n if n < 0 => format!("negative: {n}"),
        _ => format!("big: {n}"),
    }
}
```

- Arms are tried top to bottom.
- `1..=9` is a range pattern.
- `n if n < 0` is a **match guard** — a pattern plus a condition.
- `_` is the catch-all. It is also the name you give any binding you intend to
  ignore, which is why the diff is full of `_window` — a parameter that must exist
  for the signature but is unused.

**Exhaustiveness is the feature.** If `n` were an enum and you forgot a variant,
this would not compile. That is the mechanism behind the entire PR: delete a trait
method, and the compiler enumerates all 1,800 places that used it. The compiler as
a worklist is a Rust habit, not a trick.

`if let` is `match` with one arm you care about:

```rust
fn main() {
    let maybe_name: Option<&str> = Some("Ayu Dark");
    if let Some(name) = maybe_name {
        println!("theme: {name}");
    }
}
```

You will write this constantly once [hour 5](/crash/05-structs-enums/) introduces
`Option`.

## Build: a unit converter

Make a new crate and write this, then extend it.

```rust
fn convert(value: f64, unit: &str) -> Option<f64> {
    match unit {
        "c" => Some(value * 9.0 / 5.0 + 32.0),
        "f" => Some((value - 32.0) * 5.0 / 9.0),
        "km" => Some(value * 0.621_371),
        "mi" => Some(value / 0.621_371),
        _ => None,
    }
}

fn main() {
    let cases = [(100.0, "c"), (212.0, "f"), (5.0, "km"), (0.0, "kg")];
    for (value, unit) in cases {
        match convert(value, unit) {
            Some(result) => println!("{value}{unit} -> {result:.2}"),
            None => println!("{value}{unit} -> unknown unit"),
        }
    }
}
```

`{result:.2}` is format precision. Underscores in `0.621_371` are digit separators
and are ignored — use them in large literals.

## Exercises

1. Add `"kg"` → pounds and `"lb"` → kilograms.
2. Change `convert` to also accept `"C"` and `"F"`. (Hint: `unit.to_lowercase()`
   returns a `String`; match on `.as_str()`.)
3. Write `fn fizzbuzz(n: u32) -> String` using `match (n % 3, n % 5)`. Matching on
   a tuple is the idiomatic way and takes four arms.

<details>
<summary>Solution to 3</summary>

```rust
fn fizzbuzz(n: u32) -> String {
    match (n % 3, n % 5) {
        (0, 0) => "FizzBuzz".to_string(),
        (0, _) => "Fizz".to_string(),
        (_, 0) => "Buzz".to_string(),
        _ => n.to_string(),
    }
}
```

Destructuring a tuple in a pattern, with `_` meaning "any value in this position".
That same destructuring works on structs and enums, which is hour 5.

</details>

## What you should be able to do now

Write and call functions, use `match` for branching, and explain why `String` and
`&str` are different types. Next hour is ownership, which is the hour that matters.
