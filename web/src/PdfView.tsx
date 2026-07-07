/**
 * Standalone PDF view: a .pdf file rendered by the browser's native PDF viewer
 * inside a full-height iframe. View-only, like image and plain HTML surfaces.
 */

import { useEffect, useState } from "react";
import { ApiError, pdfFileUrl } from "./api.js";
import { IframeSurface } from "./IframeSurface.js";

export function PdfView({ file, reloadNonce }: { file: string; reloadNonce: number }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = pdfFileUrl(file, reloadNonce);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    fetch(src, { method: "HEAD" })
      .then((r) => {
        if (!r.ok) throw new ApiError(r.status, r.statusText);
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Could not load this file");
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <IframeSurface
      viewClassName="pdf-view"
      frameClassName="pdf-frame"
      title={file}
      ready={ready}
      error={error}
      errorLabel="Could not load this PDF file"
      // No sandbox: browser-native PDF viewers can refuse to render inside a
      // restrictive sandbox, and this surface has no page script or bridge.
      frameProps={{ src }}
    />
  );
}
