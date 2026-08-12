import { describe, expect, it } from "vitest";
import { classifyImgSrc, isExternalSrc } from "./images.js";

describe("isExternalSrc", () => {
  it("treats absolute URLs and protocol-relative srcs as external", () => {
    expect(isExternalSrc("https://cdn.example.com/foo.png")).toBe(true);
    expect(isExternalSrc("http://example.com/foo.png")).toBe(true);
    expect(isExternalSrc("//cdn.example.com/foo.png")).toBe(true);
  });

  it("treats an already-resolved backend src as external", () => {
    expect(isExternalSrc("/api/image?doc=a.md&ref=b.png")).toBe(true);
  });

  it("treats a bare relative path as not external", () => {
    expect(isExternalSrc("images/foo.png")).toBe(false);
    expect(isExternalSrc("./foo.png")).toBe(false);
    expect(isExternalSrc("/foo.png")).toBe(false);
  });
});

describe("classifyImgSrc", () => {
  it("leaves an external src pointing at the network and only tags the behavior hook", () => {
    const result = classifyImgSrc("doc.md", "https://cdn.example.com/foo.png");
    expect(result.rewrittenSrc).toBeNull();
    expect(result.classes).toEqual(["img-behaviors"]);
    expect(result.classes).not.toContain("embed"); // stays inline, no block layout
  });

  it("rewrites a relative src through the backend resolver and adds block embed layout", () => {
    const result = classifyImgSrc("notes/doc.md", "images/foo.png");
    expect(result.rewrittenSrc).toBe(
      "/api/image?doc=notes%2Fdoc.md&ref=images%2Ffoo.png",
    );
    expect(result.classes).toEqual(["embed", "img-behaviors"]);
  });
});
