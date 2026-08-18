import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, mut, move, ref } from "../src/runtime/index.js";

describe("ref/mut preserve identity (no Proxy wrapping)", () => {
  it("ref returns the exact same reference", () => {
    const user = { name: "Summer" };
    expect(ref(user)).toBe(user);
  });

  it("mut returns the exact same reference", () => {
    const user = { name: "Summer" };
    expect(mut(user)).toBe(user);
  });
});

describe("move", () => {
  it("returns the same reference on first use", () => {
    const user = { name: "Summer" };
    expect(move(user)).toBe(user);
  });

  it("throws in dev mode when the same object is touched again after being moved", () => {
    const user = { name: "Summer" };
    move(user);
    expect(() => ref(user)).toThrow(/use-after-move/);
    expect(() => mut(user)).toThrow(/use-after-move/);
    expect(() => move(user)).toThrow(/use-after-move/);
  });

  it("is a no-op passthrough for primitives", () => {
    expect(move(42)).toBe(42);
    expect(ref("hello")).toBe("hello");
  });
});

describe("clone", () => {
  it("produces a deep, independent copy", () => {
    const user = { name: "Summer", profile: { age: 30 } };
    const copy = clone(user);
    expect(copy).toEqual(user);
    expect(copy).not.toBe(user);
    expect(copy.profile).not.toBe(user.profile);

    copy.profile.age = 99;
    expect(user.profile.age).toBe(30);
  });

  describe("without a native structuredClone (JSON fallback path)", () => {
    // Node 20 always has structuredClone; this simulates older runtimes that don't, to make
    // sure the fallback in src/runtime/index.ts actually gets exercised and is correct.
    let originalStructuredClone: typeof globalThis.structuredClone;

    beforeEach(() => {
      originalStructuredClone = globalThis.structuredClone;
      delete (globalThis as { structuredClone?: unknown }).structuredClone;
    });

    afterEach(() => {
      globalThis.structuredClone = originalStructuredClone;
    });

    it("still deep-clones plain objects", () => {
      const user = { name: "Summer", profile: { age: 30 } };
      const copy = clone(user);
      expect(copy).toEqual(user);
      expect(copy).not.toBe(user);
      expect(copy.profile).not.toBe(user.profile);
    });

    it("throws a clear error on circular references instead of a raw JSON error", () => {
      const node: { name: string; self?: unknown } = { name: "loop" };
      node.self = node;
      expect(() => clone(node)).toThrow(/circular reference/);
    });
  });
});
