import { describe, expect, it } from "vitest";
import { clipLineRect, type LineRect } from "./highlights.js";

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom } as DOMRect;
}

describe("highlight rect clipping", () => {
  it("keeps only the part visible inside a scroll container", () => {
    const line: LineRect = { left: 80, right: 360, top: 20, bottom: 36 };

    expect(clipLineRect(line, rect(100, 10, 300, 40))).toEqual({
      left: 100,
      right: 300,
      top: 20,
      bottom: 36,
    });
  });

  it("drops a line that is fully outside its scroll container", () => {
    const line: LineRect = { left: 80, right: 90, top: 20, bottom: 36 };

    expect(clipLineRect(line, rect(100, 10, 300, 40))).toBeNull();
  });
});
