/**
 * Rusty runtime — deliberately thin. Ownership/borrow checking is a static-analysis concern
 * (see ../core, only used by the eslint/cli subpaths); this entry point only provides:
 *
 *  1. Identity-preserving `ref`/`mut`/`move` markers, so a compiler plugin can erase them to
 *     plain passthroughs in production builds (zero runtime cost).
 *  2. An opt-in dev-mode safety net for the cases static analysis can't fully see (closures,
 *     async boundaries): a moved value throws if it's ever touched again, anywhere.
 *
 * `ref`/`mut` intentionally do NOT wrap the value in a Proxy — doing so would break `===`
 * identity, which real JS code (memoization, React keys, Map/Set membership) relies on.
 */

type Ticket = "moved";

const tickets = new WeakMap<object, Ticket>();

const devMode: boolean =
  typeof process === "undefined" ||
  process.env == null ||
  process.env.NODE_ENV !== "production";

function assertNotMoved(value: object, op: string): void {
  if (tickets.get(value) === "moved") {
    throw new Error(
      `[rusty] use-after-move: ${op}() was called on a value that was already moved.`,
    );
  }
}

export function ref<T>(value: T): T {
  if (devMode && value !== null && typeof value === "object") {
    assertNotMoved(value, "ref");
  }
  return value;
}

export function mut<T>(value: T): T {
  if (devMode && value !== null && typeof value === "object") {
    assertNotMoved(value, "mut");
  }
  return value;
}

export function move<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (devMode) assertNotMoved(value, "move");
    tickets.set(value, "moved");
  }
  return value;
}

/**
 * Deep-clones a value to create an independent owner. Uses the native `structuredClone`
 * when available (all modern runtimes); falls back to JSON round-trip on older platforms.
 *
 * **Limitations of the JSON fallback** (used on platforms without `structuredClone`):
 * - Functions, Symbols, and `undefined` are dropped.
 * - Built-in objects (Date, RegExp, Map, Set, WeakMap, WeakSet, etc.) lose their type.
 * - Circular references throw an error.
 * - Prototype chains are not preserved.
 *
 * For most plain objects and arrays, this works fine. For objects with special handling,
 * consider using `structuredClone` directly if available, or a specialized cloning library.
 *
 * @throws {TypeError} If the value contains circular references (JSON fallback only).
 */
export function clone<T>(value: T): T {
  const globalStructuredClone = (
    globalThis as { structuredClone?: <V>(v: V) => V }
  ).structuredClone;
  if (typeof globalStructuredClone === "function") {
    return globalStructuredClone(value);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    if (error instanceof TypeError && /circular|cyclic/i.test(error.message)) {
      throw new TypeError(
        "[rusty] clone() failed: circular reference detected. " +
          "Either use structuredClone() directly, use a specialized cloning library, " +
          "or restructure your object to be acyclic.",
      );
    }
    throw error;
  }
}
