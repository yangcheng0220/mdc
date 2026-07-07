/**
 * Wikilinks + section anchors.
 *
 * `[[doc]]`, `[[doc|alias]]`, `[[doc#section]]`, and same-doc `[[#section]]`
 * become navigable links; an unresolved target renders visibly broken. Click
 * handling also covers same-page `(#slug)` anchors and plain markdown links to
 * `.md` files. Resolution uses the file index; navigation goes through a
 * caller-supplied callback so this module stays UI-agnostic.
 */

import { slugify } from "./markdown.js";

interface NavTarget {
  file: string;
  section?: string;
  newTab: boolean;
}

interface WikilinkDeps {
  /** Known file paths (root-relative), for resolving link targets. */
  paths: string[];
  /** The doc currently shown (for resolving relative links + same-doc anchors). */
  activeFile: string;
  /** Navigate to a file (and optional section). */
  navigate: (target: NavTarget) => void;
}

/** Resolve a wikilink target (no extension needed) to a known file path, or null. */
function resolveWikilink(paths: string[], target: string): string | null {
  let t = target.trim().replace(/^\.\//, "");
  if (!t) return null;
  // Wikilinks usually omit .md ([[note]]); try as-is then with .md appended.
  const candidates = t.endsWith(".md") ? [t] : [t, t + ".md"];
  for (const cand of candidates) {
    const hits = paths.filter((p) => p === cand || p.endsWith("/" + cand));
    if (hits.length) {
      hits.sort((a, b) => a.length - b.length); // shortest = most specific
      return hits[0]!;
    }
  }
  return null;
}

/** Scroll the doc to a heading by its section text/slug. Returns whether it hit. */
export function scrollToSection(root: HTMLElement, section: string): boolean {
  if (!section) return false;
  const slug = slugify(section) || section;
  const escaped = window.CSS && CSS.escape ? CSS.escape(slug) : slug;
  const target = root.querySelector(`#${escaped}`);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/** Replace `[[ ]]` text with navigable links (or broken spans). */
export function linkifyWikilinks(root: HTMLElement, paths: string[]): void {
  const RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (!text.nodeValue?.includes("[[")) continue;
    if (text.parentElement?.closest("code, pre")) continue;
    targets.push(text);
  }
  for (const textNode of targets) {
    const value = textNode.nodeValue ?? "";
    RE.lastIndex = 0;
    if (!RE.test(value)) continue;
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(value)) !== null) {
      // ![[ ]] is an image embed, not a wikilink — leave it.
      if (m.index > 0 && value[m.index - 1] === "!") continue;
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      const rawTarget = m[1]!;
      const display = (m[2] || m[1] || "").trim();
      const hashIdx = rawTarget.indexOf("#");
      const filePart = (hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx)).trim();
      const section = hashIdx === -1 ? "" : rawTarget.slice(hashIdx + 1).trim();

      if (!filePart && section) {
        // [[#section]] — same-doc anchor.
        const a = document.createElement("a");
        a.className = "wikilink";
        a.dataset.section = section;
        a.href = "#" + slugify(section);
        a.textContent = display;
        frag.appendChild(a);
      } else {
        const path = resolveWikilink(paths, filePart);
        if (path) {
          const a = document.createElement("a");
          a.className = "wikilink";
          a.dataset.file = path;
          if (section) a.dataset.section = section;
          a.href = "/?file=" + encodeURIComponent(path);
          a.textContent = display;
          frag.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.className = "wikilink broken";
          span.title = `No file matches "${filePart}"`;
          span.textContent = display;
          frag.appendChild(span);
        }
      }
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/** Wire click handling for wikilinks, same-page anchors, and plain .md links. */
export function wireWikilinkClicks(root: HTMLElement, deps: WikilinkDeps): void {
  root.addEventListener("click", (e) => {
    const evt = e as MouseEvent;
    const mod = evt.metaKey || evt.ctrlKey; // Cmd/Ctrl-click → new tab
    const el = e.target as HTMLElement;

    const wl = el.closest("a.wikilink");
    if (wl instanceof HTMLElement) {
      if (wl.classList.contains("broken")) return;
      e.preventDefault();
      if (wl.dataset.file) {
        deps.navigate({ file: wl.dataset.file, section: wl.dataset.section, newTab: mod });
      } else if (wl.dataset.section) {
        scrollToSection(root, wl.dataset.section);
      }
      return;
    }

    // Same-page anchor [text](#slug): scroll, don't write the hash to the URL.
    const anchor = el.closest('a[href^="#"]');
    if (anchor instanceof HTMLAnchorElement) {
      e.preventDefault();
      scrollToSection(root, decodeURIComponent(anchor.getAttribute("href")!.slice(1)));
      return;
    }

    // Plain markdown link to an .md file (skip external).
    const a = el.closest("a[href]");
    if (!(a instanceof HTMLAnchorElement)) return;
    const href = a.getAttribute("href") ?? "";
    if (!href || /^[a-z]+:/i.test(href)) return; // external
    if (!a.pathname.endsWith(".md")) return;
    const section = a.hash ? a.hash.slice(1) : "";

    let relPath = decodeURIComponent(a.pathname.replace(/^\//, ""));
    if (!deps.paths.includes(relPath)) {
      const rawNoHash = href.split("#")[0]!.replace(/^\.\//, "");
      const docDir = deps.activeFile.includes("/")
        ? deps.activeFile.slice(0, deps.activeFile.lastIndexOf("/"))
        : "";
      const candidate = docDir ? docDir + "/" + rawNoHash : rawNoHash;
      if (deps.paths.includes(candidate)) {
        relPath = candidate;
      } else {
        const hit = deps.paths
          .filter((p) => p === rawNoHash || p.endsWith("/" + rawNoHash))
          .sort((x, y) => x.length - y.length)[0];
        if (!hit) return;
        relPath = hit;
      }
    }
    e.preventDefault();
    deps.navigate({ file: relPath, section, newTab: mod });
  });
}
