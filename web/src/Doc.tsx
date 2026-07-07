/**
 * The rendered document. Loads the active file's markdown and renders it onto
 * the white doc page, with in-doc features (frontmatter, code-wrap, mermaid,
 * images, wikilinks) and comment-anchor highlights layered on.
 */

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchDoc } from "./api.js";
import { EmptyDoc } from "./Empty.js";
import { enhanceCodeBlocks } from "./render/codeWrap.js";
import { fmBlockHtml, parseFrontmatter, type FmRow } from "./render/frontmatter.js";
import { embedImages, wireImageEmbeds } from "./render/images.js";
import { renderMarkdown } from "./render/markdown.js";
import { renderMermaid, reRenderMermaid } from "./render/mermaid.js";
import { useResolvedTheme } from "./theme.js";
import { linkifyWikilinks, scrollToSection, wireWikilinkClicks } from "./render/wikilinks.js";
import { paintHighlightRects, resolveAnchorRanges } from "./render/highlights.js";
import { removeSelectionToolbar, showSelectionToolbar } from "./render/selection.js";
import { combo, matchEvent } from "./keymap.js";
import type { DisplayThread } from "./commentData.js";

interface DocState {
  status: "empty" | "loading" | "ready" | "error";
  fmRows?: FmRow[];
  /** File lines the frontmatter spans — used to detect comments anchored there. */
  fmLineCount?: number;
  html?: string;
  error?: string;
}

export function Doc({
  file,
  paths,
  onNavigate,
  scrollToSection: targetSection,
  onSectionScrolled,
  threads,
  onHighlightClick,
  onAnchorsPainted,
  onHighlightsRepositioned,
  onStartPending,
  pendingActive,
  reloadNonce,
  onContentLoaded,
}: {
  file: string | null;
  paths: string[];
  onNavigate: (file: string, section?: string, newTab?: boolean) => void;
  /** A heading to scroll to once this document has rendered (cross-doc link). */
  scrollToSection?: string | null;
  onSectionScrolled?: () => void;
  /** Threads whose anchors get painted as highlights onto the rendered doc. */
  threads: DisplayThread[];
  onHighlightClick: (commentId: string) => void;
  /** Reports the doc body element, the highlight overlay element, and orphan ids
   *  after each highlight repaint. */
  onAnchorsPainted: (
    root: HTMLElement | null,
    overlay: HTMLElement | null,
    orphanIds: string[],
  ) => void;
  /** Highlight rects were re-laid-out (layout shift) without re-matching — bump
   *  the card reposition so cards track the moved rects. No scroll restore. */
  onHighlightsRepositioned: () => void;
  /** Start composing a comment from the current selection (range under #doc). */
  onStartPending: (root: HTMLElement, range: Range) => void;
  /** Whether a comment is already being composed (suppress the toolbar if so). */
  pendingActive: boolean;
  /** Bumped to re-fetch the active doc's content in place (banner "Reload"). */
  reloadNonce: number;
  /** Reports the loaded doc's body (frontmatter stripped) so the outline can
   *  derive headings from the same text the renderer headings come from. */
  onContentLoaded?: (body: string) => void;
}) {
  const [state, setState] = useState<DocState>({ status: "empty" });
  // Tracks which file the current content belongs to, so a banner reload (same
  // file) swaps content in place without flashing the loading state.
  const loadedFile = useRef<string | null>(null);
  // Frontmatter collapse: null = auto (collapsed unless a comment anchors in the
  // frontmatter), true/false = an explicit user toggle (which wins). Toggling
  // re-injects the doc so the block stays selectable/anchorable/measured.
  const [fmCollapsed, setFmCollapsed] = useState<boolean | null>(null);
  const resolvedTheme = useResolvedTheme();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Highlight overlay: a positioned sibling of the doc body that holds the
  // highlight rects. Kept separate from the body so re-injecting the doc HTML
  // never wipes the highlights, and so highlights never mutate the doc tree.
  const overlayRef = useRef<HTMLDivElement>(null);

  // Latest callbacks held in a ref so the inject effect can call them WITHOUT
  // listing them as deps. They're event handlers (some are inline/unstable from
  // the parent); depending on them would re-run the effect — re-injecting the
  // doc and wiping the highlight spans — on every parent render.
  const cb = useRef({ onNavigate, onSectionScrolled, targetSection, onContentLoaded });
  cb.current = { onNavigate, onSectionScrolled, targetSection, onContentLoaded };

  // Same latest-ref pattern for the selection handlers, so the selection effect
  // (bound once) always sees current values without re-binding.
  const selCb = useRef({ onStartPending, pendingActive });
  selCb.current = { onStartPending, pendingActive };

  // The body HTML is injected imperatively (not via dangerouslySetInnerHTML) so
  // React never reconciles this subtree — the highlight spans we add would
  // otherwise be wiped on the next render. Keyed only on the rendered HTML +
  // file + paths, so it re-runs when the document content changes, not on every
  // parent re-render.
  const bodyHtml = state.status === "ready" ? state.html : undefined;
  const fmRows = state.status === "ready" ? (state.fmRows ?? []) : [];
  const fmLineCount = state.status === "ready" ? (state.fmLineCount ?? 0) : 0;

  // How many live (non-resolved) threads anchor inside the frontmatter block
  // (line 1..fmLineCount). Drives the auto-expand rule so a comment there isn't
  // hidden behind a collapsed Properties block.
  const fmCommentCount =
    fmLineCount === 0
      ? 0
      : threads.filter((t) => {
          if (t.resolved) return false;
          const line = t.top.anchor?.line;
          return typeof line === "number" && line >= 1 && line <= fmLineCount;
        }).length;

  // Effective collapse: an explicit user toggle wins; otherwise auto — collapsed
  // only when nothing anchors in the frontmatter.
  const effectiveCollapsed = fmCollapsed ?? fmCommentCount === 0;

  // Force-expand when a NEW frontmatter comment arrives while collapsed, so it
  // isn't silently hidden — overrides even a prior user collapse (matches the
  // live margin always surfacing a fresh comment).
  const prevFmCount = useRef(0);
  useEffect(() => {
    if (fmCommentCount > prevFmCount.current && effectiveCollapsed) {
      setFmCollapsed(false);
    }
    prevFmCount.current = fmCommentCount;
  }, [fmCommentCount, effectiveCollapsed]);

  // The full injected HTML = the Properties block (inside the doc root, so it's
  // selectable/anchorable/measured) + the rendered body.
  const html =
    bodyHtml === undefined ? undefined : fmBlockHtml(fmRows, effectiveCollapsed) + bodyHtml;
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || html === undefined || !file) return;
    root.innerHTML = html;
    // Wire the frontmatter collapse toggle (re-injects via state → reposition).
    // Flip the EFFECTIVE state (captured fresh each inject, since html — and thus
    // this effect — re-runs whenever the collapse state changes), recording it as
    // an explicit user override that the auto rule then respects.
    root
      .querySelector(".fm-header[data-fm-toggle]")
      ?.addEventListener("click", () => setFmCollapsed(!effectiveCollapsed));
    embedImages(root, file); // before wikilinks — both walk text nodes
    linkifyWikilinks(root, paths);
    enhanceCodeBlocks(root);
    void renderMermaid(root);
    wireImageEmbeds(root); // broken-image fallback + click-to-lightbox
    wireWikilinkClicks(root, {
      paths,
      activeFile: file,
      navigate: ({ file: f, section, newTab }) => cb.current.onNavigate(f, section, newTab),
    });
    // A cross-doc [[file#section]] target: scroll once the new doc's headings
    // exist, then clear it so it doesn't re-fire on later renders.
    if (cb.current.targetSection) {
      scrollToSection(root, cb.current.targetSection);
      cb.current.onSectionScrolled?.();
    }
    // Painting is owned by the repaint effect below (it runs right after this on
    // the same render), so highlights aren't re-derived here.
  }, [html, file, paths]);

  // Re-render mermaid when the resolved theme flips: its SVG bakes the theme in at
  // render time, so a light↔dark toggle leaves a stale-themed diagram until the
  // doc is re-fetched. Skip the first run (the inject effect already rendered for
  // the current theme) — only act on an actual theme change.
  const themeFirst = useRef(true);
  useEffect(() => {
    if (themeFirst.current) {
      themeFirst.current = false;
      return;
    }
    const root = bodyRef.current;
    if (root) void reRenderMermaid(root);
  }, [resolvedTheme]);

  // Resolved highlights for the current doc+threads, held so a layout-only
  // reflow (resize, panel toggle) can repaint rects without re-matching anchors.
  const resolved = useRef<ReturnType<typeof resolveAnchorRanges>>({ highlights: [], orphans: [] });

  // Paint/repaint highlights over the injected DOM. Runs on first injection and
  // whenever the thread set or identity changes — without re-injecting the doc,
  // so scroll/selection survive a comment change. Highlights are rects in the
  // overlay layer; the doc DOM is never mutated.
  useEffect(() => {
    const root = bodyRef.current;
    const overlay = overlayRef.current;
    if (!root || !overlay || html === undefined) {
      onAnchorsPainted(null, null, []);
      return;
    }
    resolved.current = resolveAnchorRanges(root, threads);
    paintHighlightRects(overlay, resolved.current.highlights, onHighlightClick);
    onAnchorsPainted(root, overlay, resolved.current.orphans);
  }, [threads, html, onHighlightClick, onAnchorsPainted]);

  // Full reposition: any layout shift moves the text under the highlights, so
  // re-derive the rects from the still-valid ranges (no re-matching) whenever the
  // doc body resizes or the window resizes. A ResizeObserver on the body catches
  // panel collapse/expand (column rewraps), edit-mode toggle, and lazy-grown
  // content (images, mermaid) finishing — all of which change the body's box. The
  // committed-paint effect above already re-runs on tab switch (html changes).
  useEffect(() => {
    const root = bodyRef.current;
    const overlay = overlayRef.current;
    if (!root || !overlay || html === undefined) return;

    let raf = 0;
    const repaint = () => {
      paintHighlightRects(overlay, resolved.current.highlights, onHighlightClick);
      // The rects moved — tell the parent so the comment cards re-measure against
      // the FRESH rect positions, otherwise cards read stale highlight Ys after a
      // resize/panel-toggle and stop tracking the doc. This is reposition-only (no
      // scroll restore), distinct from onAnchorsPainted's full repaint.
      onHighlightsRepositioned();
    };
    // Coalesce bursts (a resize fires many events) into one repaint per frame.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(repaint);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [html, onHighlightClick, onHighlightsRepositioned]);

  // Selection → "Comment" toolbar, and the comment shortcut (see keymap.ts). Bound once;
  // reads current handlers via the ref. A selection inside the doc shows the
  // toolbar; choosing Comment hands the range to the parent to start composing.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;

    const start = (range: Range) => selCb.current.onStartPending(root, range);

    const onMouseUp = () => {
      // Defer so the selection is final (mouseup fires before it settles).
      setTimeout(() => {
        if (selCb.current.pendingActive) return;
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || !text || sel.rangeCount === 0) {
          removeSelectionToolbar();
          return;
        }
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) {
          removeSelectionToolbar();
          return;
        }
        showSelectionToolbar(range, start);
      }, 0);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (matchEvent(e, combo("comment"))) {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || !text || sel.rangeCount === 0 || selCb.current.pendingActive) return;
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        e.preventDefault();
        start(range);
        removeSelectionToolbar();
      }
    };

    const onDocMouseDown = (e: MouseEvent) => {
      // Dismiss a stale toolbar when clicking elsewhere (not on the toolbar).
      if (!(e.target as HTMLElement).closest(".sel-toolbar")) removeSelectionToolbar();
    };

    root.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      root.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onDocMouseDown);
      removeSelectionToolbar();
    };
  }, [html]);

  // Each new file resets to auto (null) so the auto-expand rule applies fresh. A
  // banner-triggered reload (same file, bumped nonce) preserves the current state.
  useEffect(() => {
    setFmCollapsed(null);
  }, [file]);

  useEffect(() => {
    if (!file) {
      loadedFile.current = null;
      setState({ status: "empty" });
      return;
    }
    let cancelled = false;
    // Only flash "loading" on a real file switch; a banner reload (same file)
    // swaps content in place once it arrives, no loading flicker.
    if (loadedFile.current !== file) setState({ status: "loading" });
    fetchDoc(file)
      .then((doc) => {
        if (cancelled) return;
        loadedFile.current = file;
        const { rows, body, lineCount } = parseFrontmatter(doc.content);
        setState({ status: "ready", fmRows: rows, fmLineCount: lineCount, html: renderMarkdown(body) });
        cb.current.onContentLoaded?.(body); // feed the outline the same text headings render from
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof ApiError ? e.message : String(e);
        setState({ status: "error", error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [file, reloadNonce]);

  if (state.status === "empty") {
    return (
      <div className="doc">
        <EmptyDoc />
      </div>
    );
  }
  // No "Loading…" placeholder while fetching: the fetch is a near-instant local
  // read, and the word flashed jarringly on every edit⇄view toggle (the toggle
  // unmounts/remounts Doc, so the loadedFile ref resets and the same-file guard
  // can't suppress it). Render the empty doc frame; the body populates a beat
  // later via the imperative effect — no flashing word, no layout jump.
  if (state.status === "error") {
    return <div className="doc doc-error">Could not load this document: {state.error}</div>;
  }
  // The body div is populated imperatively in the effect above (Properties block
  // + rendered markdown), so React doesn't reconcile away the highlight spans.
  // Content is trusted local markdown from the user's own files.
  return (
    <div className="doc">
      {/* Highlight overlay: absolutely positioned over the doc body, holds the
          .hl-rect divs. pointer-events:none except on the rects (CSS), so it
          never blocks text selection. .doc is position:relative (its offset
          parent), so rects convert client-rects to overlay-local coords. */}
      <div ref={overlayRef} className="hl-overlay" />
      <div ref={bodyRef} />
    </div>
  );
}
