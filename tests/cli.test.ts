/**
 * Tests for the CLI over the core. Drives main() with argv lists and captures
 * stdout/JSON; each command's effect is checked against the sidecar it wrote.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import { buildProgram, main, resolveServeRoot } from "../src/cli.js";
import { printStartupBanner } from "../src/server/serve.js";
import { deriveThreads, readSidecar, sidecarPathFor } from "../src/sidecar.js";

let dir: string;
let md: string;
let stdout: string;

async function run(argv: string[]): Promise<[number, string]> {
  stdout = "";
  const code = await main(argv);
  return [code, stdout];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mdc-cli-test-"));
  md = join(dir, "d.md");
  writeFileSync(md, "# Doc\n\nThe quick brown fox.\n");
  // Force the user to "dana" regardless of the dev's ~/.mdc.toml.
  vi.stubEnv("MDC_USER", "dana");
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout += a.join(" ") + "\n";
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function comment(): Promise<string> {
  const [code, out] = await run([
    "--author",
    "dana",
    "comment",
    md,
    "--quote",
    "quick brown fox",
    "--line",
    "3",
    "--body",
    "right animal?",
  ]);
  expect(code).toBe(0);
  return out.split(/:(.*)/s)[1]!.trim(); // the new id
}

describe("cli", () => {
  it("defaults serve root to the current directory", () => {
    expect(resolveServeRoot()).toBe(process.cwd());
  });

  it("keeps explicit serve roots unchanged", () => {
    expect(resolveServeRoot(dir)).toBe(dir);
  });

  it("documents serve root as optional in help", () => {
    const program = buildProgram(() => {});
    const serve = program.commands.find((cmd) => cmd.name() === "serve");

    expect(serve).toBeDefined();
    const help = serve!.helpInformation();
    expect(help).toContain("Usage: mdc serve [options] [root]");
    expect(help).not.toContain("Usage: mdc serve [options] <root>");
    expect(help).toMatch(/directory to serve \.md files from \(default: current\s+directory\)/);
  });

  it("comment then list-pending", async () => {
    const tid = await comment();
    const [code, out] = await run(["list-pending", md]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.pending).toHaveLength(1);
    const t = data.pending[0];
    expect(t.thread_id).toBe(tid);
    expect(t.awaiting).toBe("agent"); // dana spoke last
  });

  it("reply flips pending to empty", async () => {
    const tid = await comment();
    const [code] = await run(["--author", "claude", "reply", md, tid, "--body", "yes"]);
    expect(code).toBe(0);
    const [, out] = await run(["list-pending", md]);
    expect(JSON.parse(out).pending).toEqual([]);
  });

  it("comment suggestion defaults its target and survives get-thread", async () => {
    const [code, out] = await run([
      "--author",
      "claude",
      "comment",
      md,
      "--quote",
      "quick brown fox",
      "--body",
      "tighten this",
      "--suggest",
      "swift fox",
    ]);
    expect(code).toBe(0);
    const tid = out.split(/:(.*)/s)[1]!.trim();
    const entry = readSidecar(sidecarPathFor(md))[0]!;
    expect(entry.suggestion).toEqual({
      target: {
        quote: "quick brown fox",
        context: { before: " ", after: "." },
      },
      replacement: "swift fox",
    });

    const [getCode, getOut] = await run(["get-thread", md, tid]);
    expect(getCode).toBe(0);
    expect(JSON.parse(getOut).entries[0].suggestion).toEqual(entry.suggestion);
  });

  it("accepts an empty suggestion replacement", async () => {
    const [code] = await run([
      "comment",
      md,
      "--quote",
      "quick brown fox",
      "--body",
      "delete this",
      "--suggest",
      "",
    ]);
    expect(code).toBe(0);
    expect(readSidecar(sidecarPathFor(md))[0]!.suggestion!.replacement).toBe("");
  });

  it("requires a reply target when suggesting", async () => {
    const tid = await comment();
    const [code] = await run([
      "--author",
      "claude",
      "reply",
      md,
      tid,
      "--body",
      "tighten this",
      "--suggest",
      "new text",
    ]);
    expect(code).toBe(1);
    expect(readSidecar(sidecarPathFor(md))).toHaveLength(1);
  });

  it("rejects an ambiguous suggestion target without appending", async () => {
    writeFileSync(md, "repeat target\nrepeat target\n");
    const [code] = await run([
      "comment",
      md,
      "--quote",
      "repeat target",
      "--body",
      "tighten this",
      "--suggest",
      "replacement",
    ]);
    expect(code).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("pass a longer target"));
    expect(readSidecar(sidecarPathFor(md))).toEqual([]);
  });

  it("acknowledge sets lifecycle", async () => {
    const tid = await comment();
    await run(["--author", "claude", "acknowledge", md, tid]);
    const entries = readSidecar(sidecarPathFor(md));
    expect(deriveThreads(entries, "dana")[0]!.lifecycle).toBe("acknowledged");
  });

  it("resolve then unresolve", async () => {
    const tid = await comment();
    await run(["--author", "claude", "resolve", md, tid]);
    let entries = readSidecar(sidecarPathFor(md));
    expect(deriveThreads(entries, "dana")[0]!.status).toBe("resolved");
    await run(["--author", "claude", "unresolve", md, tid]);
    entries = readSidecar(sidecarPathFor(md));
    expect(deriveThreads(entries, "dana")[0]!.status).toBe("open");
  });

  it("get-thread missing errors", async () => {
    const [code] = await run(["get-thread", md, "nope"]);
    expect(code).toBe(1);
  });

  it("get-thread returns the edited body, not the original", async () => {
    const tid = await comment();
    await run(["--author", "dana", "edit", md, tid, "--body", "the corrected text"]);
    const [code, out] = await run(["get-thread", md, tid]);
    expect(code).toBe(0);
    const data = JSON.parse(out) as { entries: { id: string; body: string }[] };
    const edited = data.entries.find((e) => e.id === tid);
    expect(edited?.body).toBe("the corrected text");
  });

  it("reply to missing parent errors", async () => {
    const [code] = await run(["--author", "claude", "reply", md, "nope", "--body", "x"]);
    expect(code).toBe(1);
  });

  it("locate finds a live anchor with its current line", async () => {
    const tid = await comment();
    const [code, out] = await run(["locate", md, tid]);
    expect(code).toBe(0);
    const data = JSON.parse(out);
    expect(data.found).toBe(true);
    expect(data.line).toBe(3);
    expect(data.recovered).toBe(false);
  });

  it("locate reports an orphan when the quote is edited away", async () => {
    const tid = await comment();
    writeFileSync(md, "# Doc\n\nA completely different sentence.\n");
    const [code, out] = await run(["locate", md, tid]);
    expect(code).toBe(0); // orphaned is an answer, not an error
    expect(JSON.parse(out).found).toBe(false);
  });

  it("locate unknown thread errors", async () => {
    const [code] = await run(["locate", md, "nope"]);
    expect(code).toBe(1);
  });

  it("setup prints the agent setup doc", async () => {
    const [code, out] = await run(["setup"]);
    expect(code).toBe(0);
    const doc = readFileSync(new URL("../docs/agent-setup.md", import.meta.url), "utf8");
    expect(out.trimEnd()).toBe(doc.trimEnd());
    expect(out).toContain("mdc watch");
  });

  it("identity prints the current name and source", async () => {
    const [code, out] = await run(["identity"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("identity: dana (source: env)");
  });

  it("identity writes a fresh home config", async () => {
    vi.stubEnv("HOME", dir);
    const [code] = await run(["identity", "Ada"]);
    expect(code).toBe(0);
    const config = parseToml(readFileSync(join(dir, ".mdc.toml"), "utf8")) as Record<string, unknown>;
    expect(config.user).toBe("Ada");
  });

  it("identity preserves existing home config keys", async () => {
    vi.stubEnv("HOME", dir);
    writeFileSync(join(dir, ".mdc.toml"), 'user = "old"\n\n[apps]\n"apps/board.html" = "hash"\n');
    const [code] = await run(["identity", "Bea"]);
    expect(code).toBe(0);
    const config = parseToml(readFileSync(join(dir, ".mdc.toml"), "utf8")) as Record<string, unknown>;
    expect(config.user).toBe("Bea");
    expect(config.apps).toEqual({ "apps/board.html": "hash" });
  });

  it("identity rejects an empty name", async () => {
    const [code] = await run(["identity", "  "]);
    expect(code).toBe(1);
  });

  it("serve startup prints the identity tip only for the default identity", () => {
    printStartupBanner({
      user: "user",
      identitySource: "default",
      root: dir,
      deny: new Set(),
      markdownCount: 1,
      imageCount: 0,
      port: 8099,
    });
    expect(stdout).toContain('tip: comments are attributed as "user" — set your name: mdc identity <name>');

    stdout = "";
    printStartupBanner({
      user: "Configured",
      identitySource: "home",
      root: dir,
      deny: new Set(),
      markdownCount: 1,
      imageCount: 0,
      port: 8099,
    });
    expect(stdout).not.toContain("tip: comments are attributed");
  });

  it("example lists, copies into apps/, and refuses to overwrite", async () => {
    const [listCode, listOut] = await run(["example"]);
    expect(listCode).toBe(0);
    expect(listOut).toContain("kanban");

    const [code] = await run(["example", "kanban", "--into", dir]);
    expect(code).toBe(0);
    const copied = readFileSync(join(dir, "apps", "kanban", "kanban.html"), "utf8");
    expect(copied).toContain("mdc-app:");

    const [again] = await run(["example", "kanban", "--into", dir]);
    expect(again).toBe(1);

    const [unknown] = await run(["example", "nope", "--into", dir]);
    expect(unknown).toBe(1);
  });
});
