/**
 * The active file is the `?file=` query param. This hook reads it and keeps it
 * in sync with back/forward navigation; `setActiveFile` updates the URL so the
 * view is shareable and history works.
 */

import { useCallback, useEffect, useState } from "react";

function fileFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("file");
}

export function useActiveFile(): [string | null, (file: string | null) => void] {
  const [file, setFile] = useState<string | null>(fileFromUrl);

  useEffect(() => {
    const onPop = () => setFile(fileFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setActiveFile = useCallback((next: string | null) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("file", next);
    else url.searchParams.delete("file");
    window.history.pushState({}, "", url);
    setFile(next);
  }, []);

  return [file, setActiveFile];
}
