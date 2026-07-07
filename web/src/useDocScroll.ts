/**
 * Per-file scroll memory across tab switches.
 *
 * The doc scrolls in the native window (the doc-area is height-driven, not an
 * inner scroller), so position is `window.scrollY`. Switching tabs should return
 * you to where you were in that file, not the top.
 *
 * The tricky part is *when* to save. On a switch, the Doc swaps to a short
 * "Loading…" view, which collapses the page and resets `window.scrollY` to 0 —
 * before any switch effect runs. So we can't read the outgoing position at
 * switch time; instead a scroll listener records the position continuously while
 * a file is shown. To avoid the collapse's scroll-to-0 clobbering the saved
 * value, the listener only attributes scrolls to the file we've actually settled
 * on — `settled` advances only after the new file is restored (onDocPainted),
 * not the instant `activeFile` changes.
 */

import { useCallback, useEffect, useRef } from "react";

export function useDocScroll(activeFile: string | null): {
  /** Call when the active doc has rendered (e.g. from onAnchorsPainted). Pass
   * true when a section jump owns this render so restore is skipped. */
  onDocPainted: (sectionJump?: boolean) => void;
  /** Call when the active surface is NOT a restoring doc (image/html/editor):
   * it never paints anchors, so settle the switch state here instead — otherwise
   * the pending handshake dangles and the NEXT real doc restore desyncs. */
  onNoRestore: () => void;
} {
  const positions = useRef<Map<string, number>>(new Map());
  // The file scrolls are currently attributed to. Lags `activeFile` across a
  // switch: it only advances once the new file is restored, so the collapse's
  // scroll-to-0 during the switch is never saved against either file.
  const settled = useRef<string | null>(activeFile);
  // The file awaiting a restore once it paints (null = nothing pending).
  const pendingRestore = useRef<string | null>(null);
  // Whether a switch is mid-flight (suppresses the scroll listener so the
  // page-collapse reset isn't recorded).
  const switching = useRef(false);

  useEffect(() => {
    if (settled.current === activeFile) return;
    switching.current = true;
    pendingRestore.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    const onScroll = () => {
      // Ignore scrolls while switching (the page collapses to 0 mid-swap).
      if (switching.current) return;
      if (settled.current) positions.current.set(settled.current, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // `sectionJump` is true when the render navigates to a specific heading (a
  // [[file#section]] wikilink): that jump owns the scroll, so skip restore.
  const onDocPainted = useCallback((sectionJump = false) => {
    const file = pendingRestore.current;
    if (file === null) return;
    pendingRestore.current = null;
    if (!sectionJump) {
      const y = positions.current.get(file) ?? 0;
      // The doc's full height isn't there yet at paint time — lazy images and
      // mermaid diagrams grow it over the next frames, so an immediate scrollTo
      // clamps short. Re-assert the target across a few animation frames until
      // the height can hold it (or we run out of tries).
      let tries = 0;
      const settle = () => {
        window.scrollTo({ top: y, behavior: "auto" });
        // Suppress the listener while we drive the scroll, so these programmatic
        // scrolls don't overwrite the saved value.
        switching.current = true;
        if ((window.scrollY < y - 1 || window.scrollY > y + 1) && tries < 20) {
          tries += 1;
          requestAnimationFrame(settle);
          return;
        }
        // Landed (or gave up) — hand scroll attribution to this file.
        settled.current = file;
        switching.current = false;
      };
      requestAnimationFrame(settle);
      return;
    }
    settled.current = file;
    switching.current = false;
  }, []);

  // A non-restoring surface (image/html/editor) is now active. It records no
  // scroll position and never restores one, so just complete the switch
  // handshake: attribute scrolls to it and clear the pending restore. Without
  // this, switching md→image leaves pendingRestore/switching dangling, and the
  // next md→doc switch restores against stale state (lands at top, then corrects
  // on a second switch). `settled` advancing to this file is fine — its scroll
  // is harmless to save, and switching back sets pendingRestore afresh.
  const onNoRestore = useCallback(() => {
    pendingRestore.current = null;
    switching.current = false;
    settled.current = activeFile;
  }, [activeFile]);

  return { onDocPainted, onNoRestore };
}
