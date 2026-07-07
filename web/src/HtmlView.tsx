/**
 * Standalone HTML view: an .html file rendered inside a fully isolated iframe.
 *
 * Isolation is the point. The HTML is loaded via `srcdoc` with `sandbox=""`
 * (NO flags): the iframe is an opaque origin, so its scripts don't run and it
 * cannot reach the parent page (the mdc app) at all. View-only — a design
 * mockup renders inline without a trip to a separate browser tab.
 *
 * The frame fills the viewport below the toolbar and scrolls internally. Its
 * height is NOT auto-fit to content: measuring an opaque-origin iframe's content
 * height would require `allow-same-origin`, which lowers the isolation wall — so
 * we fill the column instead. A deliberate trade for isolation, not a limitation.
 *
 * One consequence of full isolation: keyboard events that land inside the frame
 * stay inside it (the sandbox wall blocks them from bubbling to the parent), so
 * the app's ⌘-shortcuts don't fire while focus is in the frame. Clicking back
 * out into the app restores them. This is inherent to the isolation, not a bug.
 */

import { useEffect, useState } from "react";
import { ApiError, fetchHtmlFile } from "./api.js";
import { IframeSurface } from "./IframeSurface.js";

export function HtmlView({ file, reloadNonce }: { file: string; reloadNonce: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-fetches on `file` change and on `reloadNonce` bump (the change-banner's
  // Reload). A fresh fetch swaps the iframe's srcDoc, so there's no iframe URL
  // cache to bust.
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    fetchHtmlFile(file)
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Could not load this file");
      });
    return () => {
      cancelled = true;
    };
  }, [file, reloadNonce]);

  return (
    <IframeSurface
      viewClassName="html-view"
      frameClassName="html-frame"
      title={file}
      ready={html !== null}
      error={error}
      errorLabel="Could not load this HTML file"
      frameProps={{ sandbox: "", srcDoc: html ?? "" }}
    />
  );
}
