---
title: 'Hour 4: Borrowing and &mut'
description: Many readers or one writer, never both — and the errors that rule produces.
sidebar:
  order: 5
---

Borrowing is how you use a value without taking ownership of it.

```rust
fn measure(s: &str) -> usize {
    s.len()
}

fn shout(s: &mut String) {
    s.push('!');
}

fn main() {
    let mut name = String::from("Ayu Dark");
    println!("{}", measure(&name));   // shared borrow
    shout(&mut name);                 // exclusive borrow
    println!("{name}");
}
```

Two kinds:

| Form | Called | How many at once |
|---|---|---|
| `&T` | Shared / immutable borrow | Any number |
| `&mut T` | Exclusive / mutable borrow | Exactly one, and no `&T` at the same time |

## The one rule

**Many readers, or one writer, never both.**

That is the entire borrow checker. Everything else is the compiler working out how
long each borrow lasts.

<!-- rust:expect-fail -->
```rust
fn main() {
    let mut name = String::from("Ayu Dark");
    let r = &name;              // shared borrow starts
    name.push('!');             // needs &mut — conflict
    println!("{r}");            // shared borrow still alive here
}
```

```
error[E0502]: cannot borrow `name` as mutable because it is also
              borrowed as immutable
 --> src/main.rs:4:5
  |
3 |     let r = &name;
  |             ----- immutable borrow occurs here
4 |     name.push('!');
  |     ^^^^^^^^^^^^^^ mutable borrow occurs here
5 |     println!("{r}");
  |               --- immutable borrow later used here
```

Type it. Then delete the last `println!` and watch it compile — because the borrow
is no longer *used* afterwards, so it ends before the mutation. That is
**non-lexical lifetimes**: a borrow lasts until its last use, not to the end of the
block.

## Why this rule exists

It eliminates data races and iterator invalidation at compile time. The classic
bug it kills:

<!-- rust:expect-fail -->
```rust
fn main() {
    let mut items = vec![1, 2, 3];
    for item in &items {
        if *item == 2 {
            items.push(4);      // mutating while iterating
        }
    }
}
```

In C++ this is undefined behaviour; in JavaScript it silently does something
surprising. In Rust it does not compile, because `&items` (the iterator) is alive
while `items.push` wants `&mut`.

## Dereferencing

`*` reads through a reference. You need it less often than you would expect,
because Rust auto-dereferences on method calls and field access.

```rust
fn main() {
    let n = 5;
    let r = &n;
    println!("{}", *r + 1);     // explicit deref
    let s = String::from("hi");
    let sr = &s;
    println!("{}", sr.len());   // auto-deref: no * needed
}
```

You will see `*` mostly in two places: comparing through a reference (`*item == 2`
above), and in the diff's `&**window.theme(cx)` — which derefs an `&Arc<Theme>`
twice to reach the `Theme`, then takes a reference to that.

## Borrows in structs mean lifetimes

This is the moment lifetimes become unavoidable, and it is worth seeing now so
[hour 9](/crash/09-lifetimes/) is a recap rather than a shock.

<!-- rust:expect-fail -->
```rust
struct Excerpt {
    part: &str,
}
```

```
error[E0106]: missing lifetime specifier
 --> src/main.rs:2:11
  |
2 |     part: &str,
  |           ^ expected named lifetime parameter
```

A struct holding a reference must declare how long that reference is good for:

```rust
struct Excerpt<'a> {
    part: &'a str,
}

fn main() {
    let text = String::from("Call me Ishmael. Some years ago...");
    let first = text.split('.').next().expect("no sentence");
    let excerpt = Excerpt { part: first };
    println!("{}", excerpt.part);
}
```

`'a` is a **lifetime parameter**: "this `Excerpt` cannot outlive the string it
points into". You are not choosing a duration; you are naming a relationship the
compiler then checks.

## Build: a word counter

```rust
fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn longest<'a>(text: &'a str) -> &'a str {
    text.split_whitespace().max_by_key(|w| w.len()).unwrap_or("")
}

fn shout_into(buffer: &mut String, word: &str) {
    buffer.push_str(word);
    buffer.push('!');
}

fn main() {
    let text = "per window theme overrides for zed";
    println!("words: {}", count_words(text));
    println!("longest: {}", longest(text));

    let mut out = String::new();
    shout_into(&mut out, longest(text));
    println!("{out}");
}
```

`longest` returns a reference *into* its argument, so its signature says so with
`'a`. Try deleting the lifetimes — the compiler will tell you exactly what it
needs. (In this specific case it will compile without them, because there is only
one input reference and elision infers it. Write them anyway for now; seeing them
explicitly is the point.)

## Exercises

1. Write `fn first_word(text: &str) -> &str` returning everything before the first
   space, or the whole string if there is none. (`text.find(' ')` returns
   `Option<usize>`; `&text[..i]` slices.)
2. Fix this without cloning:

   <!-- rust:expect-fail -->
   ```rust
   fn main() {
       let mut names = vec![String::from("a"), String::from("b")];
       let first = &names[0];
       names.push(String::from("c"));
       println!("{first}");
   }
   ```

3. Write a function taking `&mut Vec<i32>` that removes all odd numbers.
   (`v.retain(|n| n % 2 == 0)`.)

<details>
<summary>Solution to 1</summary>

```rust
fn first_word(text: &str) -> &str {
    match text.find(' ') {
        Some(i) => &text[..i],
        None => text,
    }
}
```

No lifetime annotation needed: one input reference, one output reference, so
elision ties them together. Hour 9 explains why that rule exists and when it stops
working.

</details>

<details>
<summary>Solution to 2</summary>

Shorten the borrow. `first` only needs to be alive until it is printed, so print
it before the push:

```rust
fn main() {
    let mut names = vec![String::from("a"), String::from("b")];
    let first = &names[0];
    println!("{first}");                // borrow ends here
    names.push(String::from("c"));
    println!("{}", names.len());
}
```

Half of borrow-checker fighting is discovering the borrow did not need to last
that long. Cloning would also work and is the right call when you genuinely need
the value after the mutation — but reach for it second, not first.

</details>

## What you should be able to do now

Explain the one rule, read an `E0502`, and say why a struct holding a `&str`
needs a lifetime. Ownership and borrowing are now behind you; the rest of the
course is building things.
