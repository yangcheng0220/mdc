export type FileCreateKind = "file" | "drawing";

/** Drawing suffixes are matched as names because `.excalidraw.json` has two dots. */
function isDrawingName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".excalidraw") || lower.endsWith(".excalidraw.json");
}

/** Apply the default extension for the chosen create action. */
export function resolveCreateName(kind: FileCreateKind, name: string): string {
  if (isDrawingName(name)) return name;
  if (kind === "drawing") return `${name}.excalidraw`;
  return name.endsWith(".md") ? name : `${name}.md`;
}
