/**
 * Image embeds. Two syntaxes resolve through the backend's image endpoint
 * (which falls back doc-relative → root-relative → basename search): `![[path]]` embeds and standard
 * `![](path)` images with a relative src. Images are lazy-loaded, fit the
 * column, open a lightbox on click, and fall back to a visible placeholder when
 * they can't be found.
 */

/** The backend URL that resolves an image ref against the referencing doc. */
function imageSrc(activeFile: string, ref: string): string {
  return `/api/image?doc=${encodeURIComponent(activeFile)}&ref=${encodeURIComponent(ref)}`;
}

/** Replace `![[ref]]` text and relative `![](ref)` srcs with backend-resolved images. */
export function embedImages(root: HTMLElement, activeFile: string): void {
  // 1. ![[path]] embeds (path only — no alias form for images).
  const RE = /!\[\[([^[\]\n|]+)\]\]/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (!text.nodeValue?.includes("![[")) continue;
    if (text.parentElement?.closest("code, pre")) continue; // don't touch code
    targets.push(text);
  }
  for (const text of targets) {
    const value = text.nodeValue ?? "";
    RE.lastIndex = 0;
    if (!RE.test(value)) continue;
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(value)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      const ref = m[1]!.trim();
      frag.appendChild(makeImg(activeFile, ref));
      last = m.index + m[0].length;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    text.parentNode?.replaceChild(frag, text);
  }

  // 2. Standard ![](path): rewrite relative srcs (marked leaves them pointing at
  // the server root, where they 404). Leave absolute/external/already-resolved.
  for (const img of root.querySelectorAll("img")) {
    if (img.classList.contains("embed")) continue; // created above
    const raw = img.getAttribute("src") ?? "";
    if (!raw) continue;
    if (/^[a-z]+:/i.test(raw) || raw.startsWith("//") || raw.startsWith("/api/")) continue;
    img.classList.add("embed");
    img.dataset.ref = raw;
    img.loading = "lazy";
    img.src = imageSrc(activeFile, raw);
  }
}

function makeImg(activeFile: string, ref: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "embed";
  img.dataset.ref = ref;
  img.alt = ref;
  img.loading = "lazy"; // offscreen images don't fetch until scrolled near
  img.src = imageSrc(activeFile, ref);
  return img;
}

/** Wire broken-image fallback + click-to-lightbox on the doc root (once). */
export function wireImageEmbeds(root: HTMLElement): void {
  // Broken image → visible placeholder. The error event doesn't bubble, so
  // listen in the capture phase.
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains("embed")) return;
      const span = document.createElement("span");
      span.className = "image-embed broken";
      const ref = img.dataset.ref || img.getAttribute("src") || "";
      span.title = `Image not found: "${ref}"`;
      span.textContent = `🖼 ${ref}`;
      img.replaceWith(span);
    },
    true,
  );

  // Click an embed → open the lightbox at full size.
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const img = target.closest("img.embed");
    if (img instanceof HTMLImageElement) {
      openImageLightbox(img.src, img.dataset.ref || img.alt || "");
    }
  });
}

export function openImageLightbox(src: string, caption: string): void {
  const overlay = document.createElement("div");
  overlay.className = "image-lightbox";
  const img = document.createElement("img");
  img.src = src;
  img.alt = caption;
  overlay.appendChild(img);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  overlay.addEventListener("click", close); // backdrop or image closes
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}
