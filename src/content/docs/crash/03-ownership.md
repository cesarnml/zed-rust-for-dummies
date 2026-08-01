---
title: 'Hour 3: Ownership'
description: The one idea Rust has that your other languages don't. Spend the full hour here.
sidebar:
  order: 4
---

This is the hour that decides whether the rest of the course is pleasant. Do not
skim it.

## The rule

1. Every value has exactly one **owner**.
2. When the owner goes out of scope, the value is dropped (freed).
3. Assigning or passing a value **moves** ownership, unless the type is `Copy`.

There is no garbage collector and no manual `free`. Scope decides.

```rust
fn main() {
    let a = String::from("theme");
    let b = a;              // `a` is MOVED into `b`
    println!("{b}");        // fine
}
```

Add `println!("{a}");` after the move and it does not compile:

<!-- rust:expect-fail -->
```rust
fn main() {
    let a = String::from("theme");
    let b = a;
    println!("{a}");
}
```

```
error[E0382]: borrow of moved value: `a`
 --> src/main.rs:4:16
  |
2 |     let a = String::from("theme");
  |         - move occurs because `a` has type `String`,
  |           which does not implement the `Copy` trait
3 |     let b = a;
  |             - value moved here
4 |     println!("{a}");
  |               ^^^ value borrowed here after move
```

**Type that program and read that error.** It names the type, the move, and the
use. Rust's errors are the tutorial.

## Why "move" and not "copy"

`String` owns a heap buffer. If `let b = a` copied it, you would have two owners of
one buffer and a double-free when both go out of scope. Copying the buffer instead
would be silently expensive. So Rust does neither: it transfers ownership and
statically forbids using the old name.

TypeScript has one answer to this question — everything is a reference, the GC
sorts it out. Rust makes you pick, per value, every time.

## `Copy` types are the exception

Small, stack-only types implement `Copy` and are duplicated instead of moved:

```rust
fn main() {
    let a = 5;
    let b = a;
    println!("{a} {b}");   // both fine — i32 is Copy
}
```

Integers, floats, `bool`, `char`, and tuples/arrays of `Copy` types are `Copy`.
`String`, `Vec<T>`, and anything owning a heap allocation are not.

This is why the diff's `WindowId` being `Copy` matters: it can be passed around
and stored in a map key without ceremony, while `Arc<Theme>` cannot.

## Functions move too

```rust
fn consume(s: String) -> usize {
    s.len()
}

fn main() {
    let name = String::from("Ayu Dark");
    let n = consume(name);        // `name` moved into the function
    println!("{n}");
}
```

After `consume(name)`, `name` is gone. The function's parameter owns the string and
drops it at the end of the call.

If you need it back, you have three options, in increasing order of idiom:

**1. Give it back** — clumsy, but explicit:

```rust
fn consume_and_return(s: String) -> (usize, String) {
    (s.len(), s)
}
```

**2. Clone it** — costs a heap allocation, sometimes correct:

```rust
fn consume(s: String) -> usize {
    s.len()
}

fn main() {
    let name = String::from("Ayu Dark");
    let n = consume(name.clone());
    println!("{n} {name}");
}
```

**3. Borrow it** — almost always the answer, and the whole of
[hour 4](/crash/04-borrowing/):

```rust
fn measure(s: &str) -> usize {
    s.len()
}

fn main() {
    let name = String::from("Ayu Dark");
    let n = measure(&name);
    println!("{n} {name}");     // still ours
}
```

## When clone is the right answer

Not all clones are expensive, and treating `.clone()` as a failure is a beginner
mistake in the other direction. `String::clone` copies bytes. `Arc<T>::clone`
increments an atomic counter and copies a pointer — it does not touch `T` at all.

This PR clones `Arc<Theme>` freely and correctly. When a reviewer asks "why is
there a clone here", the answer is often "because this is an `Arc` and the clone is
an atomic increment", not "because I couldn't figure out the borrow".
[The pointers page](/rust/pointers/) has the real examples;
[hour 10](/crash/10-smart-pointers/) builds one.

## Drop order, briefly

Values are dropped at the end of their scope, in reverse declaration order.

```rust
struct Noisy(&'static str);

impl Drop for Noisy {
    fn drop(&mut self) {
        println!("dropping {}", self.0);
    }
}

fn main() {
    let _first = Noisy("first");
    let _second = Noisy("second");
    println!("end of main");
}
```

Run it. Output is `end of main`, then `dropping second`, then `dropping first`.
This is deterministic destruction — the thing a GC cannot give you, and the reason
Rust can manage files, locks and sockets with the same mechanism as memory.

## Exercises

1. Write a function that takes a `String`, appends `"!"`, and returns it. Call it
   twice on the same original value — you will need a clone, and you should be able
   to say why.
2. Make this compile by changing only the function signature:

   <!-- rust:expect-fail -->
   ```rust
   fn longest_word(text: String) -> usize {
       text.split_whitespace().map(|w| w.len()).max().unwrap_or(0)
   }

   fn main() {
       let text = String::from("per window theme overrides");
       println!("{}", longest_word(text));
       println!("{}", text.len());
   }
   ```

3. Add a `Noisy` value inside an inner `{ }` block in `main` and predict the output
   before running.

<details>
<summary>Solution to 2</summary>

```rust
fn longest_word(text: &str) -> usize {
    text.split_whitespace().map(|w| w.len()).max().unwrap_or(0)
}

fn main() {
    let text = String::from("per window theme overrides");
    println!("{}", longest_word(&text));
    println!("{}", text.len());
}
```

Take `&str`, pass `&text`. The function only reads, so it should borrow. This is
the single most common fix you will make for the next month, and it is exactly the
reasoning behind the diff's helpers taking `&Theme` rather than `&App`.

</details>

## What you should be able to do now

Say out loud what "move" means, why `String` is not `Copy`, and why `.clone()` on
an `Arc` is cheap. If any of those is shaky, redo the exercises before hour 4.
