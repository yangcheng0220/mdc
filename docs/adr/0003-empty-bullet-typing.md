# Keep empty bullet typing in list state

While typing a list item after a paragraph, a line containing only `-` or
`- ` is treated as a list marker by the edit-mode Markdown parser. This keeps
the preceding paragraph's styling stable until the user finishes the item.

The renderer keeps CommonMark's setext-heading behavior. A line containing
three or more dashes, such as `---`, continues to render and highlight as the
H2 underline that the final document contains. Once text follows the marker,
both surfaces parse the content as a list.

## Consequences

- Edit mode has a deliberate, transient deviation from CommonMark for a bare
  dash at the end of an in-progress list item.
- The deviation is limited to the exact `-` / `- ` typing state; completed list
  items and setext headings retain their normal Markdown parsing.
- Saving an incomplete `-` / `- ` line still uses the renderer's unchanged
  CommonMark behavior.
