import { describe, expect, it } from "vitest";
import { pastedImageName } from "./imagePaste.js";

describe("pastedImageName", () => {
  const now = new Date(2026, 6, 9, 8, 7, 6);

  it("formats a local timestamp and maps supported image MIME types", () => {
    expect(pastedImageName(now, "image/png")).toBe("pasted-20260709-080706.png");
    expect(pastedImageName(now, "image/jpeg")).toBe("pasted-20260709-080706.jpg");
    expect(pastedImageName(now, "image/svg+xml")).toBe("pasted-20260709-080706.svg");
    expect(pastedImageName(now, "image/webp")).toBe("pasted-20260709-080706.webp");
  });

  it("falls back to png for an unknown image MIME type", () => {
    expect(pastedImageName(now, "image/avif")).toBe("pasted-20260709-080706.png");
  });
});
