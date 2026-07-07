/**
 * Standalone image view: an image file opened as its own surface (not an embed
 * inside a doc). Fits the column, click-to-expand via the shared lightbox, and
 * shows a visible placeholder when the file can't be loaded. Sits on the same
 * `.doc` surface as a rendered document so the frame is consistent.
 */

import { useEffect, useState } from "react";
import { imageFileViewUrl } from "./api.js";
import { openImageLightbox } from "./render/images.js";

export function ImageView({ file, reloadNonce }: { file: string; reloadNonce: number }) {
  const [broken, setBroken] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // A cache-buster keyed on reloads and the one error retry forces the browser
  // to re-request the bytes. The lightbox reuses this same src so the expanded
  // view is fresh too.
  const src = imageFileViewUrl(file, reloadNonce + retryNonce);
  const name = file.split("/").pop() ?? file;

  // A reload (or file switch) may resolve a previously-broken image — clear the
  // broken flag so the fresh src gets a chance to load.
  useEffect(() => {
    setBroken(false);
    setRetryNonce(0);
  }, [file, reloadNonce]);

  return (
    <div className="doc image-view">
      {broken ? (
        <span className="image-embed broken" title={`Image not found: "${file}"`}>
          🖼 {file}
        </span>
      ) : (
        <img
          className="image-view-img"
          src={src}
          alt={name}
          onError={() => {
            if (retryNonce === 0) {
              setRetryNonce(1);
            } else {
              setBroken(true);
            }
          }}
          onClick={() => openImageLightbox(src, name)}
        />
      )}
    </div>
  );
}
