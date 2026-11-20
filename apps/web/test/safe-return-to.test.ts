import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../src/lib/safe-return-to.ts";

describe("safeReturnTo", () => {
  it.each([
    ["/books/1?x=y", "/books/1?x=y"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
