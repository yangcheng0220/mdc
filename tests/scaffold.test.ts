import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("scaffold", () => {
  it("uses the development version when the build token is absent", () => {
    expect(VERSION).toBe("0.0.0-dev");
  });
});
