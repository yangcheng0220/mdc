import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../web/src/render/markdown.js";

describe("markdown rendering", () => {
  it("closes self-closing non-void HTML tags so later markdown remains outside them", () => {
    const html = renderMarkdown(`Text above.

<iframe src="https://example.com/video" style={{ width: 560 }} allowFullScreen />

Text below.

## Heading below
`);

    expect(html).toContain(
      '<iframe src="https://example.com/video" style={{ width: 560 }} allowFullScreen></iframe>',
    );
    expect(html).toContain("<p>Text below.</p>");
    expect(html).toContain('<h2 id="heading-below">Heading below</h2>');
    expect(html.indexOf("</iframe>")).toBeLessThan(html.indexOf("<p>Text below.</p>"));
  });

  it("preserves void HTML tags and escaped code samples", () => {
    const html = renderMarkdown(`Before<br />

\`\`\`html
<iframe src="https://example.com/video" />
\`\`\`
`);

    expect(html).toContain("Before<br />");
    expect(html).toContain("&lt;");
    expect(html).toContain("iframe");
    expect(html).toContain("/&gt;");
    expect(html).not.toContain("</iframe>");
  });

  it("requires double tildes for strikethrough", () => {
    const html = renderMarkdown(`~~struck~~

~single~

~L42

a ~ b

\`~inline~\`

\`\`\`
~fenced~
\`\`\`
`);

    expect(html).toContain("<del>struck</del>");
    expect(html).toContain("<p>~single~</p>");
    expect(html).toContain("<p>~L42</p>");
    expect(html).toContain("<p>a ~ b</p>");
    expect(html).toContain("<code>~inline~</code>");
    expect(html).toContain("<pre><code>~fenced~</code></pre>");
    expect(html).not.toContain("<del>single</del>");
    expect(html).not.toContain("<del>L42</del>");
    expect(html).not.toContain("<del>inline</del>");
    expect(html).not.toContain("<del>fenced</del>");
  });

  // Nested list items must parse as a real nested list regardless of whether the
  // child is indented with two spaces, a tab, or four spaces — real docs mix
  // these, and a broken parse changes the DOM the list CSS depends on.
  it.each([
    ["two spaces", "- [ ] parent\n  - [ ] child\n  - bullet\n"],
    ["a tab", "- [ ] parent\n\t- [ ] child\n\t- bullet\n"],
    ["four spaces", "- [ ] parent\n    - [ ] child\n    - bullet\n"],
  ])("nests a child list indented with %s", (_label, md) => {
    const html = renderMarkdown(md);
    // A nested list = a <ul> that appears inside a parent <li>.
    expect(/<li[^>]*>[\s\S]*?<ul/.test(html)).toBe(true);
  });
});
