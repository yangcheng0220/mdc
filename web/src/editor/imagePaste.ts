import { EditorView } from "@codemirror/view";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export function pastedImageName(now: Date, mime: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${timestamp}.${MIME_EXTENSIONS[mime.toLowerCase()] ?? "png"}`;
}

function isImageFile(file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTENSIONS.has(file.name.slice(dot).toLowerCase());
}

export interface ImagePasteOptions {
  upload: (name: string, blob: Blob) => Promise<{ ref: string }>;
  onError: (message: string) => void;
  onCreated: () => void;
  now?: () => Date;
}

function insertReferences(
  view: EditorView,
  from: number,
  to: number,
  refs: string[],
  cursorInAlt: boolean,
): void {
  const docLength = view.state.doc.length;
  const start = Math.min(from, docLength);
  const end = Math.max(start, Math.min(to, docLength));
  const inserted = refs.map((ref) => `![](${ref})`).join("\n");
  view.dispatch({
    changes: { from: start, to: end, insert: inserted },
    selection: { anchor: cursorInAlt ? start + 2 : start + inserted.length },
  });
}

export function imagePasteExtension(options: ImagePasteOptions) {
  const uploadFiles = async (
    view: EditorView,
    files: Array<{ file: File; name: string }>,
    from: number,
    to: number,
    cursorInAlt: boolean,
  ) => {
    try {
      const refs: string[] = [];
      for (const { file, name } of files) {
        refs.push((await options.upload(name, file)).ref);
      }
      insertReferences(view, from, to, refs, cursorInAlt);
      options.onCreated();
    } catch {
      options.onError("Couldn't add image");
    }
  };

  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboard = event.clipboardData;
      if (!clipboard || clipboard.getData("text/plain")) return false;
      const item = Array.from(clipboard.items).find(
        (candidate) => candidate.kind === "file" && candidate.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (!item || !file) return false;

      event.preventDefault();
      const selection = view.state.selection.main;
      void uploadFiles(
        view,
        [{ file, name: pastedImageName(options.now?.() ?? new Date(), item.type || file.type) }],
        selection.from,
        selection.to,
        true,
      );
      return true;
    },
    dragover(event) {
      if (!event.dataTransfer?.types.includes("Files")) return false;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return true;
    },
    drop(event, view) {
      const transfer = event.dataTransfer;
      // Only claim drops that carry files. A files-less drop is CodeMirror's
      // own drag-selected-text (or text dragged in from outside) — let the
      // editor's default handling move/insert it.
      if (!transfer || !transfer.types.includes("Files")) return false;
      event.preventDefault();
      const files = Array.from(transfer.files).filter(isImageFile);
      if (files.length === 0) {
        options.onError("Only images can be dropped into a doc");
        return true;
      }
      const at =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void uploadFiles(
        view,
        files.map((file) => ({ file, name: file.name })),
        at,
        at,
        false,
      );
      return true;
    },
  });
}
