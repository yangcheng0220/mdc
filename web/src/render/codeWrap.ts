/**
 * Code-wrap toggles. After the document HTML is in the DOM, wrap each <pre> in a
 * positioned container and add a hover button that toggles soft-wrapping of long
 * lines on that block. Idempotent — safe to run again on re-render.
 */

const WRAP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="11 15 14 18 11 21"/></svg>`;

export function enhanceCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll("pre").forEach((pre) => {
    const parent = pre.parentElement;
    if (parent?.classList.contains("code-block-wrapper")) return; // already done

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-wrap-btn";
    btn.title = "Wrap long lines";
    btn.innerHTML = WRAP_ICON;
    wrapper.appendChild(btn);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowWrap = !pre.classList.contains("wrapped");
      pre.classList.toggle("wrapped", nowWrap);
      btn.classList.toggle("active", nowWrap);
      btn.title = nowWrap ? "Unwrap lines" : "Wrap long lines";
    });
  });
}
