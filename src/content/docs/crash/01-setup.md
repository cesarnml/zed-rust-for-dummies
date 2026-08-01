---
title: 'Hour 1: Toolchain and hello world'
description: rustup, cargo, and the four commands you will run ten thousand times.
sidebar:
  order: 2
---

## Install

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Accept the defaults. Then restart your shell and check:

```bash
rustc --version
cargo --version
```

`rustup` is the toolchain manager, `rustc` the compiler, `cargo` everything else —
build system, package manager, test runner, doc generator. You will almost never
call `rustc` directly.

:::note[Editor setup]
In Zed, install the Rust extension; it wires up `rust-analyzer`, which is the
language server and is very good. Inline type hints are on by default and are
worth leaving on for the first month — a huge amount of learning Rust is finding
out what type an expression actually has.
:::

## Your first crate

```bash
cargo new hello
cd hello
cargo run
```

You get:

```
hello/
├── Cargo.toml
└── src/
    └── main.rs
```

`Cargo.toml` is the manifest — name, version, edition, dependencies. `Cargo.lock`
appears after the first build and pins exact versions; commit it for binaries.

A **crate** is the unit of compilation. A **package** is what `Cargo.toml`
describes and contains one or more crates. `src/main.rs` makes a binary crate;
`src/lib.rs` makes a library crate. Zed is a workspace of ~250 packages, which is
why the diff's file paths all start `crates/`.

## The program

```rust
fn main() {
    println!("Hello, world!");
}
```

Three things to notice, because all three come back later:

`fn` declares a function. `main` takes no arguments and returns nothing — which in
Rust is written as returning `()`, the empty tuple, called *unit*.

`println!` ends in `!`, so it is a **macro**, not a function. Macros run at compile
time and can do things functions cannot — here, type-checking a format string
against its arguments. When you see `vec![]`, `format!`, `assert_eq!` or the
diff's `sql!` and `impl_tuple_row_traits!`, that `!` is what you are looking at.

The semicolon matters. Rust is expression-oriented: a block's value is its last
expression *without* a semicolon. Adding one throws the value away.

```rust
fn five() -> i32 {
    5      // no semicolon: this is the return value
}

fn also_five() -> i32 {
    return 5;   // explicit return works too, but is unidiomatic here
}
```

## The four commands

| Command | What it does | When |
|---|---|---|
| `cargo check` | Type-checks without producing a binary | Constantly. It is much faster than `build` |
| `cargo run` | Builds and runs | When you want to see output |
| `cargo test` | Runs tests | Hour 11 |
| `cargo clippy` | Lints — idiom, not just correctness | Before you show anyone anything |

Add `cargo fmt` to format. It is not configurable in any way that matters and
that is a feature: no one argues about it.

:::caution[`cargo check` is your inner loop]
Rust compiles slowly compared to what you are used to. `cargo check` skips code
generation and is often 5–10× faster. Get in the habit of `check` while writing
and `run` only when you want to see something happen. Zed's own `./script/clippy`
exists for the same reason — the diff's verification page leans on it.
:::

## Exercise

Write a program that prints the numbers 1 to 10, one per line, and then prints
their sum. You will need `for i in 1..=10` — `..=` is an inclusive range,
`..` is exclusive.

<details>
<summary>Solution</summary>

```rust
fn main() {
    let mut total = 0;
    for i in 1..=10 {
        println!("{i}");
        total += i;
    }
    println!("sum = {total}");
}
```

`let mut` because `total` is reassigned — bindings are immutable by default, which
is hour 2. `{i}` inside a format string captures the variable directly; older code
writes `println!("{}", i)` and both are fine.

</details>

## What you should be able to do now

Create a crate, run it, and read a compile error. That is the whole hour. The next
one starts putting things in variables.
