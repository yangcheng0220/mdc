/**
 * Task-list rendering: GFM `- [ ]` / `- [x]` items get a `.task-list-item`
 * class (so CSS drops the doubled bullet), and a checked item additionally gets
 * `.task-list-item-checked` (so CSS can strike its text through).
 */

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../web/src/render/markdown.js";

/** The class lists of each `<li class="task-list-item…">`, in document order. */
function taskItemClasses(html: string): string[] {
  return [...html.matchAll(/<li class="(task-list-item[^"]*)"/g)].map((m) => m[1]!);
}

describe("task-list rendering", () => {
  it("tags unchecked vs checked items distinctly", () => {
    const html = renderMarkdown("- [ ] open\n- [x] done\n");
    expect(taskItemClasses(html)).toEqual([
      "task-list-item",
      "task-list-item task-list-item-checked",
    ]);
  });

  it("marks a checked item even with inline formatting", () => {
    const html = renderMarkdown("- [x] done **bold** and `code`\n");
    expect(taskItemClasses(html)).toEqual(["task-list-item task-list-item-checked"]);
    // Inline content survives the tagging pass.
    expect(html).toContain("<strong>bold</strong>");
  });

  it("does not mark a plain (non-task) list item", () => {
    const html = renderMarkdown("- regular item\n");
    expect(taskItemClasses(html)).toEqual([]);
  });
});
