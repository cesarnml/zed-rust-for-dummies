---
title: "Hour 12: Storing closures — Fn traits, 'static, Send"
description: Writing a closure is hour 7. Storing one in a struct is where the diff's hardest rewrites live. A long hour, closer to two.
sidebar:
  order: 13
---

[Hour 7](/crash/07-collections/) taught you to *write* closures and hand them to
iterators, and it told you — in one sentence, in passing — that a capturing
closure cannot go where a `fn` pointer is expected. Every closure you wrote there
died at the end of the expression that made it.

This hour makes you *prove* that sentence, and then deals with the consequences —
closures that **outlive the function that created them**, stored in a struct
field, handed to an event handler, sent to a background thread. That is a different problem, and it is the one the diff keeps running
into. Two of the seven rewrite shapes are entirely this.

:::note[This is a two-hour hour]
It is one page because the ideas only make sense together, but budget more time
than the others. It is also the only hour where you can be genuinely *stuck*
rather than merely slow — everything else in this course is either mechanical or
a five-minute lookup.
:::

## The wall

Here is a button that stores what to do when it is clicked. It does not compile.
Type it anyway.

<!-- rust:expect-fail -->
```rust
struct Button {
    on_click: fn() -> String,
}

fn main() {
    let label = String::from("Save");
    let button = Button { on_click: || label.clone() };
    println!("{}", (button.on_click)());
}
```

```
error[E0308]: mismatched types
note: closures can only be coerced to `fn` types if they do not capture any variables
```

Read that note twice. It is the whole hour in one line.

**`fn` is a function pointer — an address, nothing else.** It has no room to
carry `label`. The moment a closure captures anything from its environment, it
stops being an address and becomes a value with hidden fields, and those two
things are not the same type.

Drop the capture and it compiles:

```rust
struct Button {
    on_click: fn() -> String,
}

fn main() {
    let button = Button { on_click: || String::from("Save") };
    println!("{}", (button.on_click)());
}
```

Which is useless for anything real, because the whole point of a callback is that
it knows something.

## The fix: `Box<dyn Fn>`

Every closure has its own anonymous type that you cannot name. To store one, you
have to stop naming it — which is [hour 8](/crash/08-traits/)'s `dyn`, and it
needs a `Box` because the size isn't known at compile time.

```rust
struct Button {
    on_click: Box<dyn Fn() -> String>,
}

fn main() {
    let label = String::from("Save");
    let button = Button { on_click: Box::new(move || label.clone()) };
    println!("{}", (button.on_click)());
}
```

Three things changed, and all three are load-bearing:

| Change | Why |
|---|---|
| `fn` → `dyn Fn` | A trait, so any closure shape qualifies |
| wrapped in `Box` | Unsized value needs a home on the heap |
| `move` | The closure now outlives `main`'s locals, so it must own them |

## Which `Fn` trait does your field need?

Hour 7 named the three. Storing them is where the difference bites, because it
decides whether the *field* has to be mutable.

| Trait | The closure... | Callable |
|---|---|---|
| `Fn` | only reads its captures | many times, through `&` |
| `FnMut` | mutates its captures | many times, needs `&mut` |
| `FnOnce` | consumes its captures | exactly once |

A counter has to mutate, so it is `FnMut`, and that propagates outward — the
struct holding it has to be `mut` at the call site:

```rust
struct Counter {
    bump: Box<dyn FnMut() -> u32>,
}

fn main() {
    let mut count = 0;
    let mut counter = Counter {
        bump: Box::new(move || {
            count += 1;
            count
        }),
    };

    let first = (counter.bump)();
    let second = (counter.bump)();
    println!("{first} {second}");
}
```

Try removing either `mut`. The error tells you which one it needed.

**Rule of thumb:** ask for the weakest one that works. `Fn` in a signature accepts
the most callers; `FnOnce` accepts the fewest but is honest about consuming.

## `'static` is not "lives forever"

This is the most commonly misread bound in Rust, and the diff is full of it.

`Box<dyn Fn()>` secretly means `Box<dyn Fn() + 'static>`. That does **not** mean
the closure lives for the whole program. It means **the closure contains no
borrowed data that could dangle** — either it owns everything, or it borrows only
things that genuinely do live forever, like a string literal.

Here is the failure it exists to prevent:

<!-- rust:expect-fail -->
```rust
struct Button {
    on_click: Box<dyn Fn() -> String>,
}

fn main() {
    let button;
    {
        let label = String::from("Save");
        button = Button { on_click: Box::new(|| label.clone()) };
    }
    println!("{}", (button.on_click)());
}
```

```
error[E0597]: `label` does not live long enough
```

No `move`, so the closure borrowed `label`, and `label` died at the closing
brace while the button outlived it. Add `move` and it compiles — the closure now
*owns* the string, so there is nothing left to dangle.

That is the entire content of `'static` on a closure bound: **own your captures,
or borrow only immortal ones.**

## `Send`, and the thread that won't take your closure

[Hour 10](/crash/10-smart-pointers/) introduced `Send` as "safe to move to
another thread". Here is where you meet it for real:

```rust
use std::thread;

fn main() {
    let name = String::from("background");
    let handle = thread::spawn(move || format!("ran on {name}"));
    println!("{}", handle.join().unwrap());
}
```

`thread::spawn` demands `FnOnce() -> T + Send + 'static`. Both bounds are doing
work. Now break it with the one smart pointer that isn't `Send`:

<!-- rust:expect-fail -->
```rust
use std::rc::Rc;
use std::thread;

fn main() {
    let shared = Rc::new(String::from("not Send"));
    let handle = thread::spawn(move || shared.len());
    println!("{}", handle.join().unwrap());
}
```

```
error[E0277]: `Rc<String>` cannot be sent between threads safely
```

Swap `Rc` for `Arc` and it compiles. `Rc`'s refcount is a plain integer; `Arc`'s
is atomic, which costs a little and buys thread-safety. That is why the theme is
an `Arc<Theme>` and not an `Rc<Theme>` — it is shared across a whole application,
not just one thread. (The `Arc` predates this PR; don't claim it as a decision the
diff made.)

## Sharing a stored closure: `Arc<dyn Fn>`

Put it together and you get the shape GPUI uses constantly: a callback that is
**shared** rather than owned, so it needs `Arc` instead of `Box`, and `Sync` on
top of `Send` because several threads may hold it at once.

```rust
use std::sync::Arc;

#[derive(Clone)]
struct Tooltip {
    render: Arc<dyn Fn(&str) -> String + Send + Sync>,
}

fn main() {
    let prefix = String::from("hint: ");
    let tooltip = Tooltip {
        render: Arc::new(move |body| format!("{prefix}{body}")),
    };

    let cloned = tooltip.clone();
    println!("{}", (cloned.render)("theme is per-window"));
}
```

`Arc<dyn Fn(...) + Send + Sync>` is a mouthful, and now every word in it is one
you can read. Read it left to right: shared ownership, of some closure whose
type nobody names, safe to move between threads, safe to *share* between threads.

## Why this hour is in the course

The migration deletes an accessor and rewrites ~1,800 call sites. Most are
one-liners. The ones that fight back are the stored callbacks, and they fight
back for exactly the reason you just typed: **a closure that captures `window`
cannot go where a `fn` pointer was expected.** That is question 3 of the
five-question exam.

## What the PR did instead — and why you need to know that

Here is the twist, and it is the most useful thing on this page.

You have just learned that `Box<dyn Fn>` and `Arc<dyn Fn>` are how you store a
closure that captures. **The PR considered that and rejected it.**

`Arc<dyn Fn(...)>` adds an allocation and dynamic dispatch, complicates equality
and debuggability, and — the real objection — *still* lets you capture a stale
window or theme. It solves the compile error without solving the bug.

What the diff does instead, in order of preference:

| Shape | The problem | The fix |
|---|---|---|
| [4](/migration/shapes/) | A stored `fn(&App) -> Hsla` now needs a window | Keep it capture-free; change what it **receives** — `fn(&Theme) -> Hsla`, resolved at paint time |
| [5a](/migration/shapes/) | Tooltips, drag handlers, list rows | The callback is **handed** a fresh `&mut Window` when invoked — use that parameter instead of capturing the outer one |
| [5b](/migration/shapes/) | The callback type has no window at all | Add one to its signature and update the callers |
| [5c](/migration/shapes/) | Genuinely detached, `Send + Sync` work | Move the *derived values* — an `Hsla` is four floats — not the loan |

The through-line: **resolve the theme where the callback is invoked, not where it
is created.** `dyn Fn` would have let the author skip that decision, which is why
it was the wrong tool despite being the obvious one.

:::tip[This is a reviewer question waiting to happen]
"Why not just make these `Arc<dyn Fn>`?" is a natural thing for someone to ask,
and the answer is not "I didn't think of it." Being able to say *what it costs*
and *which bug it fails to fix* is worth more than the two hours you spent on
this page.
:::

So this hour has two jobs. `Box`/`Arc<dyn Fn>` is vocabulary you need to **read**
GPUI, which is full of it. And knowing when it is the wrong answer is what lets
you defend the parts of the diff that avoided it.

## Break it on purpose

1. Change `Box<dyn Fn() -> String>` to `Box<dyn FnMut() -> String>` in the button
   and see what the compiler demands at the call site. Then `FnOnce`. Notice you
   can only call it once, and that the compiler *knows*.
2. Write a function taking `impl Fn() -> String` and another taking
   `Box<dyn Fn() -> String>`. Pass the same closure to both. The first
   monomorphises, the second allocates — that is the generics-vs-`dyn` trade from
   hour 8, in the case you will actually hit.
3. Try to store two *different* closures in a `Vec`. Find out why the element
   type has to be `Box<dyn Fn()>` and cannot be `impl Fn()`.
4. Remove `Sync` from the `Tooltip` field and try to share it across two threads
   with `thread::scope`. Read the error. `Send` and `Sync` are different claims.

## What you should be able to do now

Explain why a capturing closure is not a `fn` pointer, choose between `Fn`,
`FnMut`, and `FnOnce` for a stored field, and say what `'static` means on a bound
without using the word "forever".

Three hours left: the capstone, then the real diff, then the exam.
