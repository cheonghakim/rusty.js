# Rusty

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/rusty.js)](https://www.npmjs.com/package/rusty.js)

> Write JavaScript. Think in ownership.

Rusty brings Rust's ownership/borrow checking to plain JavaScript, without replacing its syntax
or data structures. You keep using objects, arrays, classes, and Promises as-is. Rusty adds four
small primitives, `ref / mut / move / clone`, and statically tracks who can read a value, who can
mutate it, and who currently owns it as it moves through your code.

TypeScript checks what shape a value has. Rusty checks who's allowed to touch it and when. A lot
of real JS/TS bugs aren't type mismatches at all: something holds a reference to an object, and a
different part of the code mutates it out from under that reference. Structural typing has no way
to see that. That's the gap Rusty is for.

```js
const user = { name: "Summer", age: 30 };

send(move(user));

console.log(user.name);
// rusty/use-after-move
// `user` was moved into send() and can no longer be used here.
```

This is a proof-of-concept, built to answer one question: can `ref/mut/move` plus static
analysis catch real ownership bugs in JavaScript without an unusable rate of false positives?
Early dogfooding (see [Status](#status--limitations)) suggests yes, but it hasn't been run on a
large real codebase yet, and the tool isn't hardened for production use.

## What it catches

| Rule                          | Example                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `rusty/use-after-move`        | using a value after `move()`                                                                                |
| `rusty/maybe-use-after-move`  | using a value that was moved on only one branch                                                             |
| `rusty/double-mut-borrow`     | two simultaneous `mut()` borrows                                                                            |
| `rusty/mut-while-ref`         | `mut()` while a `ref()` is still active                                                                     |
| `rusty/ref-while-mut`         | `ref()` while a `mut()` is still active                                                                     |
| `rusty/move-while-borrowed`   | `move()` while a borrow is still active                                                                     |
| `rusty/mutation-through-ref`  | writing to a value (directly or through an alias) while it's `ref()`-borrowed, including nested properties |

Borrows track lifetime, not lexical scope (non-lexical lifetime, same idea as modern Rust). A
`ref()` that's never read again releases right away, so this is fine:

```js
{
  const r = ref(user);
  console.log(r.name);
}
update(mut(user)); // fine, r's borrow already ended
```

Anything Rusty can't statically determine — closures escaping into `setTimeout`, third-party
calls with no declared contract, dynamic property access, `Proxy`/`eval` — is treated as
`Unknown` and stays silent by default instead of guessing.

## One package, three ways to use it

Everything ships as a single npm package with subpath exports, so there's one version number and
one install to think about — pull in only the entry point you actually need.

| Entry point           | What it's for                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `rusty.js`             | `ref`, `mut`, `move`, `clone` — the only import that ends up in your shipped app code. No dependencies. |
| `rusty.js/eslint`      | An ESLint flat-config plugin for editor/CI diagnostics. Self-contained bundle; the analyzer is compiled in.  |
| `rusty` (the `rusty.js` bin) | `rusty check` for CI or one-off scans. Exits non-zero when it finds an error.                              |

`sideEffects: false` is set at the package level, so bundlers only pull in whichever entry point
you actually import — importing `rusty.js` alone never drags in the ESLint plugin or its bundled
analyzer.

## Quick start

### Install

```bash
npm install rusty.js
```

Package manager doesn't matter — `pnpm add`, `yarn add`, `bun add` work the same way, just
substitute the command.

### Use

```js
// eslint.config.js
import rusty from "rusty.js/eslint";

export default [rusty.configs.recommended];
```

```bash
npx rusty check         # or, once installed: rusty check
```

```js
import { ref, mut, move } from "rusty.js";

render(ref(state));
update(mut(state));
send(move(state));
```

## Status & limitations

Early-stage. This has been validated against a fixture corpus and two small hand-written example
files, not against a real production codebase, so treat findings as advisory and review its output
rather than trusting it blindly.

**The one limitation to know before you rely on this**: Rusty only tracks what you write
explicitly. Calling `fn(value)` without wrapping `value` in `ref()`/`mut()`/`move()` at the call
site makes no claim at all about what `fn` does to it — Rusty stays silent, it does not check the
inside of `fn` for you. There's no cross-function or cross-module contract propagation yet. If you
expect it to catch ownership bugs across ordinary, unwrapped function calls, it won't.

What's implemented:

- Single-file, synchronous ownership/borrow tracking, with real control-flow merging
  (`if`/`else`, loops via a 2-pass fixed point)
- Static alias resolution: `const a = b`, `ref()`/`mut()` aliasing, `clone()`/`move()` producing
  independent owners
- Closures that escape into deferred callbacks (`setTimeout`, event handlers) are marked
  `Escaped` and no longer checked, so they don't risk false positives

What's missing, on purpose, for now:

- Class method mutation inference
- Cross-function or cross-module contract propagation (see above)
- async/await lifetime policy
- LSP/VSCode integration (inlay hints, hover)
- Automatic ownership inference
- Per-package external contracts (`*.rusty.json`)
- Configurable strictness levels — there's one fixed profile today

## License

MIT. See [LICENSE](./LICENSE) for details.
