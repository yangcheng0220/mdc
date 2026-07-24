import { describe, expect, it } from "vitest";
import { workspaceRootName } from "../web/src/fileTree.js";

describe("workspaceRootName", () => {
  it("returns the final folder for POSIX and Windows roots", () => {
    expect(workspaceRootName("/home/user/my-workspace")).toBe("my-workspace");
    expect(workspaceRootName("C:\\Users\\user\\my-workspace")).toBe("my-workspace");
  });

  it("ignores trailing separators and preserves a filesystem root", () => {
    expect(workspaceRootName("/home/user/my-workspace/")).toBe("my-workspace");
    expect(workspaceRootName("C:\\Users\\user\\my-workspace\\")).toBe("my-workspace");
    expect(workspaceRootName("/")).toBe("/");
  });
});
