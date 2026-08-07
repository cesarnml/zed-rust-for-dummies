---
title: 'Hour 7: Collections, iterators, closures'
description: Vec, HashMap, and the iterator chains that will feel like home.
sidebar:
  order: 8
---

This is the hour where your functional-programming background pays off. Rust's
iterators are `map`/`filter`/`reduce` with the laziness made explicit and the
allocations made visible.

## `Vec<T>`

```rust
fn main() {
    let mut names: Vec<String> = Vec::new();
    names.push(String::from("Ayu Dark"));
    names.push(String::from("One Dark"));

    let numbers = vec![1, 2, 3];              // the vec! macro

    println!("{}", names.len());
    println!("{:?}", names.first());          // Option<&String>
    println!("{:?}", numbers.get(9));         // Option<&i32> — None, no panic
    println!("{}", numbers[0]);               // panics if out of bounds

    for name in &names {                      // borrow: names still usable after
        println!("{name}");
    }
}
```

`&v` iterates by reference, `&mut v` by mutable reference, and bare `v` consumes
the vector. That trio matches the `&self` / `&mut self` / `self` distinction from
hour 5, and it is the same idea in a different place.

`v[i]` panics out of bounds; `v.get(i)` returns `Option`. Prefer `get`.

**Slices.** `&[T]` is a view into a contiguous run of `T` — to a `Vec`, an array,
or part of either. Take `&[T]` as a parameter for the same reason you take `&str`:
it works with more callers.

```rust
fn total(values: &[i32]) -> i32 {
    values.iter().sum()
}

fn main() {
    let v = vec![1, 2, 3, 4];
    println!("{}", total(&v));        // whole Vec
    println!("{}", total(&v[1..3]));  // a slice of it
    println!("{}", total(&[10, 20])); // an array
}
```

## `HashMap<K, V>`

```rust
use std::collections::HashMap;

fn main() {
    let mut overrides: HashMap<u64, String> = HashMap::new();
    overrides.insert(1, String::from("Ayu Dark"));
    overrides.insert(2, String::from("One Light"));

    println!("{:?}", overrides.get(&1));           // Option<&String>
    println!("{}", overrides.contains_key(&3));

    // The entry API: insert-if-absent, then mutate, in one lookup.
    let mut counts: HashMap<&str, i32> = HashMap::new();
    *counts.entry("theme").or_insert(0) += 1;
    *counts.entry("theme").or_insert(0) += 1;
    println!("{:?}", counts.get("theme"));

    overrides.remove(&2);
    for (id, name) in &overrides {
        println!("{id} -> {name}");
    }
}
```

Iteration order is **not** insertion order and is randomised per process. Use
`BTreeMap` when you need sorted keys.

`HashMap<WindowId, Arc<Theme>>` is the diff's central data structure — window id to
that window's theme, with absence meaning "no override, use the global one". You
now know every piece of that type.

## Closures

```rust
fn main() {
    let add = |a: i32, b: i32| a + b;
    println!("{}", add(1, 2));

    let factor = 10;
    let scale = |n: i32| n * factor;      // captures `factor` from the environment
    println!("{}", scale(5));
}
```

Types are usually inferred. Bodies with more than one expression need braces.

The important part is **how** a closure captures. Rust picks the least demanding of
by-reference (`&`), by-mutable-reference (`&mut`), or by-move — unless you write
`move`, which forces ownership:

```rust
fn main() {
    let name = String::from("Ayu Dark");
    let print_it = move || println!("{name}");   // `name` moved into the closure
    print_it();
    // `name` is no longer usable here
}
```

You need `move` whenever the closure outlives the scope that created it — stored in
a struct, sent to another thread, or handed to an event handler. That is exactly
the situation in the diff's "stored callbacks" rewrite shape, and the reason a
closure capturing `window` cannot be stored where a plain `fn` pointer is expected:
a `fn` pointer has no captures at all.

Three traits describe what a closure can do — `FnOnce` (consumes captures, callable
once), `FnMut` (mutates captures), `Fn` (only reads). You will mostly write
`impl Fn(...)` in signatures and let inference do the rest.

## Iterators

```rust
fn main() {
    let numbers = vec![1, 2, 3, 4, 5, 6];

    let evens_squared: Vec<i32> = numbers
        .iter()
        .filter(|n| *n % 2 == 0)
        .map(|n| n * n)
        .collect();

    println!("{evens_squared:?}");
    println!("{}", numbers.iter().sum::<i32>());
    println!("{:?}", numbers.iter().max());
    println!("{}", numbers.iter().any(|n| *n > 5));
    println!("{}", numbers.iter().all(|n| *n > 0));
}
```

**Iterators are lazy.** Nothing happens until a consuming method runs — `collect`,
`sum`, `count`, `for`, `find`, `fold`. Building a chain and not consuming it does
nothing at all, and the compiler warns you.

The three entry points, matching the ownership trio again:

| Call | Yields | The collection after |
|---|---|---|
| `.iter()` | `&T` | Still yours |
| `.iter_mut()` | `&mut T` | Still yours |
| `.into_iter()` | `T` | Consumed |

`collect()` is unusually powerful: it builds whatever collection the target type
asks for, which is why the turbofish sometimes appears (`.collect::<Vec<_>>()`) —
you are telling it what to build.

The ones worth knowing today:

```rust
fn main() {
    let words = ["theme", "window", "override"];

    println!("{:?}", words.iter().map(|w| w.len()).collect::<Vec<_>>());
    println!("{:?}", words.iter().filter(|w| w.len() > 5).collect::<Vec<_>>());
    println!("{:?}", words.iter().find(|w| w.starts_with('w')));
    println!("{:?}", words.iter().position(|w| *w == "window"));
    println!("{:?}", words.iter().enumerate().collect::<Vec<_>>());
    println!("{}", words.iter().fold(0, |acc, w| acc + w.len()));
    println!("{}", words.join(", "));

    // filter_map: filter and map in one, keeping the Some values
    let maybe_numbers = ["1", "x", "3"];
    let parsed: Vec<u32> = maybe_numbers.iter().filter_map(|s| s.parse().ok()).collect();
    println!("{parsed:?}");
}
```

## Build: a word-frequency report

```rust
use std::collections::HashMap;

fn word_counts(text: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for word in text.split_whitespace() {
        let cleaned: String = word
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        if cleaned.is_empty() {
            continue;
        }
        *counts.entry(cleaned).or_insert(0) += 1;
    }
    counts
}

fn main() {
    let text = "the theme is the theme for the window";
    let counts = word_counts(text);

    let mut ranked: Vec<(&String, &usize)> = counts.iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));

    for (word, count) in ranked.iter().take(3) {
        println!("{count:>3}  {word}");
    }
}
```

`sort_by` with `b.cmp(a)` is descending; `.then(...)` breaks ties, here
alphabetically, so the output is deterministic. `{count:>3}` right-aligns in three
columns.

## Exercises

1. Rewrite `word_counts` using `fold` instead of a `for` loop.
2. Write `fn unique_words(text: &str) -> Vec<String>` preserving first-appearance
   order. (A `HashSet` for membership plus a `Vec` for order.)
3. Given `Vec<Option<i32>>`, produce a `Vec<i32>` of just the present values, two
   ways: with `filter_map` and with `flatten`.

<details>
<summary>Solution to 1</summary>

```rust
use std::collections::HashMap;

fn word_counts(text: &str) -> HashMap<String, usize> {
    text.split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .fold(HashMap::new(), |mut acc, word| {
            *acc.entry(word).or_insert(0) += 1;
            acc
        })
}
```

`fold` carries an accumulator (`HashMap::new()` to start) through the whole
iterator and returns it at the end — the same shape as the `for` loop, just with
the "empty counts, then update per item" made explicit as the fold's two
arguments instead of implicit in a mutable variable declared above the loop.

</details>

<details>
<summary>Solution to 2</summary>

```rust
use std::collections::HashSet;

fn unique_words(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut order = Vec::new();
    for word in text.split_whitespace() {
        let cleaned = word.to_lowercase();
        if seen.insert(cleaned.clone()) {   // insert returns true if it was NEW
            order.push(cleaned);
        }
    }
    order
}
```

`HashSet::insert` returns `true` exactly when the value wasn't already present —
that return value doubles as the "have I seen this?" check, so one call does both
the membership test and the insert. The `Vec` alongside it is what gives you
back insertion order, which a `HashSet` alone never guarantees.

</details>

<details>
<summary>Solution to 3</summary>

```rust
fn main() {
    let values: Vec<Option<i32>> = vec![Some(1), None, Some(3)];

    let a: Vec<i32> = values.iter().filter_map(|v| *v).collect();
    let b: Vec<i32> = values.iter().flatten().copied().collect();

    println!("{a:?} {b:?}");
}
```

`flatten` works because `Option` is itself iterable — it yields zero or one item.
That is a genuinely useful thing to know.

</details>

## What you should be able to do now

Reach for `Vec` and `HashMap` without thinking, write an iterator chain, and
explain what `move` does to a closure. Next hour is traits, which is where Rust
starts to feel like a different language rather than a stricter one.
