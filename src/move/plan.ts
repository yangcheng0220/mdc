/**
 * Move planner — computes the full effect of moving a doc or folder before any
 * of it happens. The preview route returns the plan; the move route applies it.
 *
 * Computing once and applying the same plan keeps the dry-run and the real move
 * in lockstep: the counts a user confirms are exactly what executes. Path math
 * is delegated to the pure rewrite engine; this layer adds the fs reads (which
 * files exist, what they contain) the engine deliberately doesn't do.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { SIDECAR_SUFFIX } from "../sidecar.js";
import { linksTo, relinkInbound, relinkOutbound, type Rewrite } from "./rewrite.js";

const { join } = posix;

/** One doc whose content changes, with the new content to write. */
interface DocEdit {
  /** Root-relative path of the doc to rewrite. */
  path: string;
  /** Its rewritten content. */
  content: string;
  /** The individual link changes (for the preview summary). */
  rewrites: Rewrite[];
}

/** One .md (and its sidecar, if present) relocating from → to. */
interface FileMove {
  from: string;
  to: string;
  /** True if a `.comments.jsonl` sits next to `from` and travels with it. */
  hasSidecar: boolean;
}

export interface MovePlan {
  /** Every .md that physically relocates (one for a file move; N for a folder). */
  fileMoves: FileMove[];
  /** Docs (outside the moved set) whose inbound links get rewritten. */
  inboundEdits: DocEdit[];
  /** Moved docs whose own outbound links get rewritten (post-move content). */
  outboundEdits: DocEdit[];
  /** Names that would collide at the destination (move refused if non-empty). */
  collisions: string[];
}

export interface PlanInput {
  root: string;
  /** Every indexed .md (root-relative posix), e.g. the live server index. */
  index: Set<string>;
  /** Root-relative source path (a .md or a folder). */
  from: string;
  /** Root-relative destination path (full new path of the .md or folder). */
  to: string;
}

/** Is `p` equal to, or nested under, directory `dir`? */
function isUnder(dir: string, p: string): boolean {
  return p === dir || p.startsWith(dir + "/");
}

/**
 * Compute the move plan against the current index. Pure w.r.t. the move itself —
 * reads files but writes nothing. Throwing here (e.g. source missing) surfaces
 * to the route as a 4xx.
 */
export function planMove(input: PlanInput): MovePlan {
  const { root, index, from, to } = input;
  const fromAbs = join(root, from);
  const isFolder = existsSync(fromAbs) && statSync(fromAbs).isDirectory();

  // The set of .md files that physically move, paired with their destinations.
  const fileMoves: FileMove[] = [];
  const movedFromTo = new Map<string, string>(); // old md path → new md path
  if (isFolder) {
    for (const md of index) {
      if (!isUnder(from, md)) continue;
      const dest = to + md.slice(from.length); // rebase the subpath under `to`
      movedFromTo.set(md, dest);
    }
  } else {
    movedFromTo.set(from, to);
  }
  for (const [oldMd, newMd] of movedFromTo) {
    fileMoves.push({ from: oldMd, to: newMd, hasSidecar: existsSync(join(root, oldMd) + SIDECAR_SUFFIX) });
  }

  // Collisions: any destination that already exists and isn't itself moving.
  const collisions: string[] = [];
  for (const newMd of movedFromTo.values()) {
    if (existsSync(join(root, newMd)) && !movedFromTo.has(newMd)) collisions.push(newMd);
  }

  // Inbound: docs NOT in the moved set that link to any moved doc → rewrite each
  // such link to its destination. A doc can link to several moved docs (folder
  // move), so accumulate edits per linking doc.
  const inboundEdits: DocEdit[] = [];
  for (const linker of index) {
    if (movedFromTo.has(linker)) continue; // handled as an outbound edit instead
    let content = safeRead(join(root, linker));
    if (content === null) continue;
    const rewrites: Rewrite[] = [];
    // A folder move relocates many docs; a single linker may reference several,
    // so fold each moved target's rewrite into the running content.
    for (const [oldMd, newMd] of movedFromTo) {
      if (!linksTo(content, linker, oldMd)) continue;
      const res = relinkInbound(content, linker, oldMd, newMd);
      content = res.content;
      rewrites.push(...res.rewrites);
    }
    if (rewrites.length) inboundEdits.push({ path: linker, content, rewrites });
  }

  // Outbound: each moved doc's own links rebase from its new location. We compute
  // against the OLD content (the move hasn't happened yet); the result is what
  // gets written at the NEW path.
  const outboundEdits: DocEdit[] = [];
  for (const [oldMd, newMd] of movedFromTo) {
    const src = safeRead(join(root, oldMd));
    if (src === null) continue;
    // Pass the full moved set so a link to a co-moving sibling resolves to the
    // sibling's destination, not its now-vacated old path.
    const res = relinkOutbound(src, oldMd, newMd, movedFromTo);
    if (res.rewrites.length) {
      outboundEdits.push({ path: newMd, content: res.content, rewrites: res.rewrites });
    }
  }

  return { fileMoves, inboundEdits, outboundEdits, collisions };
}

function safeRead(abs: string): string | null {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Human-readable counts for the confirm dialog. */
export function planSummary(plan: MovePlan): {
  docsToMove: number;
  sidecarsToRelocate: number;
  docsToRewrite: number;
  linksToRewrite: number;
  collisions: string[];
} {
  const docsToRewrite = new Set([
    ...plan.inboundEdits.map((e) => e.path),
    ...plan.outboundEdits.map((e) => e.path),
  ]).size;
  const linksToRewrite =
    plan.inboundEdits.reduce((n, e) => n + e.rewrites.length, 0) +
    plan.outboundEdits.reduce((n, e) => n + e.rewrites.length, 0);
  return {
    docsToMove: plan.fileMoves.length,
    sidecarsToRelocate: plan.fileMoves.filter((m) => m.hasSidecar).length,
    docsToRewrite,
    linksToRewrite,
    collisions: plan.collisions,
  };
}
