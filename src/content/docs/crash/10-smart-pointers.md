---
title: 'Hour 10: Box, Rc, Arc, and interior mutability'
description: Shared ownership, and why cloning an Arc is nearly free.
sidebar:
  order: 11
---

Ownership says every value has exactly one owner. Sometimes that is not the shape
of the problem — a theme is used by every window at once, and no one window owns
it. Smart pointers are how you say that.

## `Box<T>` — one owner, on the heap

```rust
fn main() {
    let boxed: Box<i32> = Box::new(5);
    println!("{}", *boxed + 1);
}
```

`Box` moves a value to the heap and owns it. Two reasons you actually need it:

**Recursive types**, which would otherwise be infinitely sized:

```rust
enum Tree {
    Leaf(i32),
    Node(Box<Tree>, Box<Tree>),
}

fn sum(tree: &Tree) -> i32 {
    match tree {
        Tree::Leaf(value) => *value,
        Tree::Node(left, right) => sum(left) + sum(right),
    }
}

fn main() {
    let tree = Tree::Node(
        Box::new(Tree::Leaf(1)),
        Box::new(Tree::Node(Box::new(Tree::Leaf(2)), Box::new(Tree::Leaf(3)))),
    );
    println!("{}", sum(&tree));
}
```

**Trait objects**, from [hour 8](/crash/08-traits/) — `Box<dyn Render>`, because the
concrete type's size is not known at compile time.

## `Rc<T>` — many owners, single thread

```rust
use std::rc::Rc;

struct Theme {
    name: String,
}

fn main() {
    let theme = Rc::new(Theme { name: "Ayu Dark".to_string() });
    println!("count: {}", Rc::strong_count(&theme));

    let a = Rc::clone(&theme);
    let b = theme.clone();          // same thing; `.clone()` on Rc is Rc::clone
    println!("count: {}", Rc::strong_count(&theme));
    println!("{} {} {}", theme.name, a.name, b.name);

    drop(a);
    drop(b);
    println!("count: {}", Rc::strong_count(&theme));
}
```

**Reference counting.** `Rc::clone` does not copy the `Theme` — it bumps a counter
and hands back another handle. When the last handle drops, the value drops.

This is the answer to "cloning is expensive": it depends entirely on what you are
cloning. `String::clone` copies bytes. `Rc::clone` increments an integer.

`Rc` is **not** thread-safe — its counter is a plain integer.

## `Arc<T>` — many owners, many threads

```rust
use std::sync::Arc;
use std::thread;

struct Theme {
    name: String,
}

fn main() {
    let theme = Arc::new(Theme { name: "Ayu Dark".to_string() });

    let handles: Vec<_> = (0..3)
        .map(|i| {
            let theme = Arc::clone(&theme);      // a handle per thread
            thread::spawn(move || {
                println!("thread {i} sees {}", theme.name);
            })
        })
        .collect();

    for handle in handles {
        handle.join().expect("thread panicked");
    }
}
```

`Arc` is `Rc` with an **atomic** counter — the `A` is for atomic, not "arc". Same
API, slightly more expensive clone, safe to share across threads.

`Arc<Theme>` is the single most common type in this PR. Every window's theme is an
`Arc<Theme>`; the override map is `HashMap<WindowId, Arc<Theme>>`; the accessor
returns `&Arc<Theme>`. When you see `.clone()` on one of those in the diff, the cost
is one atomic increment, and that is the answer to give a reviewer who asks.

:::note[Why `&Arc<Theme>` and not `&Theme`?]
Returning `&Arc<Theme>` lets the caller *clone the handle* and keep it beyond the
borrow. Returning `&Theme` would only let them read it for the duration of the
loan. The extra layer is not an oversight — it is the caller's option to take
ownership of a share.
:::

## Interior mutability

`Rc` and `Arc` give out shared references, so their contents are immutable. To
mutate shared data you need a type that moves the "many readers or one writer" check
from compile time to run time.

**`RefCell<T>`** — single-threaded, checked at runtime, panics on violation:

```rust
use std::cell::RefCell;
use std::rc::Rc;

fn main() {
    let log = Rc::new(RefCell::new(Vec::<String>::new()));

    let writer = Rc::clone(&log);
    writer.borrow_mut().push("first".to_string());
    log.borrow_mut().push("second".to_string());

    println!("{:?}", log.borrow());
}
```

`borrow()` and `borrow_mut()` are the runtime equivalents of `&` and `&mut`. Two
overlapping `borrow_mut()`s compile fine and **panic** at runtime. That is the
trade: flexibility for a class of bug the compiler would otherwise have caught.

**`Mutex<T>`** — the thread-safe version, blocking instead of panicking:

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));

    let handles: Vec<_> = (0..4)
        .map(|_| {
            let counter = Arc::clone(&counter);
            thread::spawn(move || {
                let mut guard = counter.lock().expect("mutex poisoned");
                *guard += 1;
            })
        })
        .collect();

    for handle in handles {
        handle.join().expect("thread panicked");
    }

    println!("{}", *counter.lock().expect("mutex poisoned"));
}
```

`Arc<Mutex<T>>` is *the* shared-mutable-state idiom. The lock returns a guard;
the guard derefs to the value; dropping the guard unlocks. There is no way to touch
the data without holding the lock, which is the whole point.

`RwLock<T>` is the same thing with many-readers-or-one-writer semantics — the
borrow rule again, at runtime.

## `Send` and `Sync`

Two marker traits, implemented automatically, that make the above safe:

- **`Send`** — safe to *move* to another thread. Almost everything is; `Rc` is not.
- **`Sync`** — safe to *share* by reference between threads. `T` is `Sync` if `&T`
  is `Send`. `RefCell` is not; `Mutex` is.

You rarely implement them, but you will read them in bounds. A closure handed to a
background task typically needs `Send + 'static`: movable to another thread, and
borrowing nothing that might expire. That pair is exactly what the PR's stored
callbacks carry, and [the closures page](/rust/closures/) shows the real ones.

## Build: a shared theme cache

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
struct Theme {
    name: String,
}

#[derive(Default)]
struct Registry {
    themes: Mutex<HashMap<String, Arc<Theme>>>,
}

impl Registry {
    fn get_or_insert(&self, name: &str) -> Arc<Theme> {
        let mut themes = self.themes.lock().expect("registry poisoned");
        themes
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Theme { name: name.to_string() }))
            .clone()               // clone the Arc, not the Theme
    }
}

fn main() {
    let registry = Registry::default();

    let a = registry.get_or_insert("Ayu Dark");
    let b = registry.get_or_insert("Ayu Dark");
    let c = registry.get_or_insert("One Light");

    println!("{}", Arc::ptr_eq(&a, &b));   // true — same allocation
    println!("{}", Arc::ptr_eq(&a, &c));   // false
    println!("{:?} {:?}", a, c);
    println!("handles to a: {}", Arc::strong_count(&a));
}
```

`Arc::ptr_eq` compares identity rather than contents, and proves the cache returned
the same allocation twice. That `.clone()` at the end of `get_or_insert` is the
pattern the diff uses constantly: pull an `Arc` out of a map, clone the handle, hand
it to the caller.

## Exercises

1. Change `Mutex` to `RwLock` and use `.read()` for lookups, `.write()` only when
   inserting. What does that buy under concurrent reads?
2. Add `fn len(&self) -> usize` to `Registry`, then call it while holding the lock
   in `get_or_insert` and observe the deadlock. (Then undo it — that is the lesson.)
3. Build an `Rc<RefCell<Vec<String>>>` shared between two closures, have both push,
   and print the result. Then try holding two `borrow_mut()`s at once and read the
   panic.

<details>
<summary>Answer to 1</summary>

`RwLock` lets any number of readers proceed simultaneously and only serialises
writers. For a registry that is read on every frame and written when the user picks
a theme, that is the right shape. The cost is a slightly more expensive lock and the
possibility of writer starvation under constant reads.

</details>

## What you should be able to do now

Explain why `Arc::clone` is cheap, when you need `Arc<Mutex<T>>`, and what `Send`
means on a closure bound. Six hours left: packaging, stored callbacks (a long
one), the capstone, the real diff, and the exam.
