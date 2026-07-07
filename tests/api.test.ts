import { describe, expect, it } from "vitest";
import { imageFileViewUrl, pdfFileUrl } from "../web/src/api.js";

describe("imageFileViewUrl", () => {
  it("keeps the image path separate from the cache-buster", () => {
    const url = imageFileViewUrl("folder/pic one.svg", 7);
    const parsed = new URL(url, "http://mdc.local");

    expect(url.match(/\?/g)?.length).toBe(1);
    expect(parsed.pathname).toBe("/api/image-file");
    expect(parsed.searchParams.get("path")).toBe("folder/pic one.svg");
    expect(parsed.searchParams.get("v")).toBe("7");
  });
});

describe("pdfFileUrl", () => {
  it("keeps the PDF path separate from the cache-buster", () => {
    const url = pdfFileUrl("folder/report one.pdf", 7);
    const parsed = new URL(url, "http://mdc.local");

    expect(url.match(/\?/g)?.length).toBe(1);
    expect(parsed.pathname).toBe("/api/pdf-file");
    expect(parsed.searchParams.get("path")).toBe("folder/report one.pdf");
    expect(parsed.searchParams.get("v")).toBe("7");
  });
});
