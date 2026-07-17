/**
 * Builds the nested folder tree the nav renders from the flat list of file
 * paths in the index. Each node keys on its relative path prefix (e.g.
 * "notes/projects"), which doubles as the collapse-state key.
 */

export interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: string[];
}

/** The served workspace folder name, accepting either platform's separators. */
export function workspaceRootName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || root;
}

export function buildTree(
  paths: string[],
  dirs: string[] = [],
): { root: TreeNode; dirPaths: string[] } {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };
  const dirPaths: string[] = [];

  // Walk a directory path, creating any missing nodes, and return the deepest.
  function ensureDir(relDir: string): TreeNode {
    let node = root;
    for (const seg of relDir.split("/")) {
      let child = node.dirs.get(seg);
      if (!child) {
        const path = node.path ? `${node.path}/${seg}` : seg;
        child = { name: seg, path, dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
        dirPaths.push(path);
      }
      node = child;
    }
    return node;
  }

  // Seed every known directory first, so folders with no .md yet still render.
  for (const dir of dirs) {
    if (dir) ensureDir(dir);
  }

  for (const file of paths) {
    const i = file.lastIndexOf("/");
    const parent = i === -1 ? root : ensureDir(file.slice(0, i));
    parent.files.push(file);
  }

  return { root, dirPaths };
}
