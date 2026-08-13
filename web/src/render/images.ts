/**
 * Image embeds. Two syntaxes resolve through the backend's image endpoint
 * (which falls back doc-relative → root-relative → basename search): `![[path]]` embeds and standard
 * `![](path)` images with a relative src. Local embeds are lazy-loaded, laid
 * out as block figures, open a lightbox on click, and fall back to a visible
 * placeholder when they can't be found. External `![](https://...)` images
 * load straight from the network (never through the backend resolver) and
 * stay inline — they're often small avatars sitting in link/text runs, not
 * standalone figures — but still get the click-to-lightbox and
 * broken-placeholder behaviors, plus a `max-width: 100%` safety net from CSS
 * (`.doc img` in images.css) so a large external image can't overflow the
 * column. `embed` marks the block-figure layout; `img-behaviors` is the
 * separate hook for the shared zoom/broken-placeholder behaviors, applied to
 * both kinds.
 */

/** The backend URL that resolves an image ref against the referencing doc. */
function imageSrc(activeFile: string, ref: string): string {
  return `/api/image?doc=${encodeURIComponent(activeFile)}&ref=${encodeURIComponent(ref)}`;
}

/** Absolute/external/already-resolved srcs load straight from the network. */
export function isExternalSrc(raw: string): boolean {
  return /^[a-z]+:/i.test(raw) || raw.startsWith("//") || raw.startsWith("/api/");
}

/**
 * What a standard `![](src)` image should become, decided purely from its raw
 * src (no DOM access) so the src/class split is testable without a browser.
 * `rewrittenSrc` is null for external images — the caller must leave the
 * existing src alone and let it load from the network as-is.
 */
export function classifyImgSrc(
  activeFile: string,
  raw: string,
): { classes: string[]; rewrittenSrc: string | null } {
  if (isExternalSrc(raw)) return { classes: ["img-behaviors"], rewrittenSrc: null };
  return { classes: ["embed", "img-behaviors"], rewrittenSrc: imageSrc(activeFile, raw) };
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
  // the server root, where they 404). External srcs load as-is — never through
  // the backend resolver — but still get the shared zoom/broken-placeholder hook.
  for (const img of root.querySelectorAll("img")) {
    if (img.classList.contains("embed") || img.classList.contains("img-behaviors")) continue; // created above
    const raw = img.getAttribute("src") ?? "";
    if (!raw) continue;
    const { classes, rewrittenSrc } = classifyImgSrc(activeFile, raw);
    img.classList.add(...classes);
    if (rewrittenSrc === null) continue; // external: network-loaded as-is, stays inline
    img.dataset.ref = raw;
    img.loading = "lazy";
    img.src = rewrittenSrc;
  }
}

function makeImg(activeFile: string, ref: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "embed img-behaviors";
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
      if (!(img instanceof HTMLImageElement) || !img.classList.contains("img-behaviors")) return;
      const span = document.createElement("span");
      span.className = "image-embed broken";
      const ref = img.dataset.ref || img.getAttribute("src") || "";
      span.title = `Image not found: "${ref}"`;
      span.textContent = `🖼 ${ref}`;
      img.replaceWith(span);
    },
    true,
  );

  // Click any image (local embed or external) → open the lightbox at full size.
  // Linked images (`[![](img)](href)`, common in scraped web content) would
  // otherwise both zoom and follow the link — external hrefs render with
  // target="_blank", so the click opened a tab alongside the lightbox. Zoom
  // wins: suppress the navigation so an image click always means "look closer".
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const img = target.closest("img.img-behaviors");
    if (img instanceof HTMLImageElement) {
      e.preventDefault();
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
