import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("scaffold", () => {
  it("exposes a version", () => {
    // Injected from package.json at build; the -dev fallback applies to
    // unbuilt source (as here, under vitest), so allow a pre-release suffix.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
  });
});
