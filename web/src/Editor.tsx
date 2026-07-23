/**
 * Raw-markdown editor pane. The edit half of the view/edit toggle: loads the
 * file's source into a CodeMirror editor and autosaves edits back to disk
 * (debounced).
 *
 * It deliberately edits the raw markdown text rather than the rendered view —
 * the rendered doc is left to `Doc`. Swapping the two on toggle (rather than
 * making the rendered view editable) keeps editing clear of the comment-anchor
 * DOM that `Doc` injects. CodeMirror owns its own DOM, so React never
 * reconciles the editor's internals.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { MergeView, acceptChunk, getChunks, rejectChunk, unifiedMergeView } from "@codemirror/merge";
import type { Suggestion } from "../../src/threads.js";
import { MarkdownPalette } from "./MarkdownPalette.js";
import { DocBanner } from "./DocBanner.js";
import {
  applySuggestionEdit,
  buildSuggestionEdit,
  runCommand,
  type MarkdownCommand,
} from "./editor/commands.js";
import { createEditorExtensions } from "./editor/extensions.js";
import { ApiError, fetchDoc, saveDoc, uploadAsset } from "./api.js";
import { parseFrontmatter } from "./render/frontmatter.js";
import type { CommentAnchorY, CommentLine } from "./commentLines.js";

const AUTOSAVE_MS = 600;

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type SuggestionResolution = "applied" | "dismissed";

interface EditSuggestionPreview {
  threadId: string;
  suggestionId: string;
  original: string;
  /** Whether `original` was already on disk when the preview opened — restored
   *  along with the text if the preview is closed or dismissed. */
  originalSaved: boolean;
}

/** Conflict flow: a rejected save (or an external change signal) pauses
 *  autosave and shows the banner; "review" swaps the editor for a side-by-side
 *  merge view until the user resolves or backs out. */
type Conflict = "none" | "banner" | "review";

export interface EditorHandle {
  scrollToComment: (commentId: string) => void;
  applySuggestion: (suggestion: Suggestion) => boolean;
  previewSuggestion: (threadId: string, suggestionId: string, suggestion: Suggestion) => boolean;
  acceptSuggestionPreview: (threadId: string, suggestionId: string) => boolean;
  dismissSuggestionPreview: (threadId: string, suggestionId: string) => boolean;
  closeSuggestionPreview: () => void;
  /** The file changed on disk under a live editing session (externally
   *  detected, e.g. by the doc-changed watcher) — enter the conflict flow. */
  notifyExternalChange: () => void;
}

// The pinned preview's decision chip — identical markup to the view-mode
// preview's floating actions, hosted as a block widget so it owns a reserved
// row above the chunk instead of painting over the text.
class PreviewChipWidget extends WidgetType {
  constructor(
    private readonly actions: { accept: () => void; reject: () => void; close: () => void },
  ) {
    super();
  }

  override eq(): boolean {
    // Never reuse across reconfigures: the handlers close over the live preview.
    return false;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement("div");
    chip.className = "suggestion-preview-actions";
    chip.setAttribute("role", "group");
    chip.setAttribute("aria-label", "Suggestion actions");
    const button = (label: string, className: string, onClick: () => void) => {
      const el = document.createElement("button");
      el.type = "button";
      if (className) el.className = className;
      el.textContent = label;
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      return el;
    };
    chip.append(
      button("Reject", "suggestion-preview-reject", this.actions.reject),
      button("Accept", "", this.actions.accept),
      button("Close", "suggestion-preview-close", this.actions.close),
    );
    return chip;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// Underline the anchored quote of each comment in the editor text — the
// edit-mode analog of the view-mode highlight. A mark decoration over the
// comment's character range; role sets the color, flashing adds the click flash.
// The RangeSet behind decorations needs ranges sorted by `from` (same trap as
// the gutter), so sort before building.
function commentHighlightExtension(commentLines: CommentLine[], flashingCommentId: string | null) {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const docLen = view.state.doc.length;
    const ranges = commentLines
      .filter((c) => c.from >= 0 && c.to > c.from && c.to <= docLen)
      .slice()
      .sort((a, b) => a.from - b.from || a.to - b.to);
    for (const c of ranges) {
      const flash = c.commentId === flashingCommentId ? " flash" : "";
      builder.add(
        c.from,
        c.to,
        Decoration.mark({
          class: `cm-comment-underline${flash}`,
          attributes: { "data-comment-id": c.commentId },
        }),
      );
    }
    return builder.finish();
  };
  return EditorView.decorations.of((view) => build(view));
}

// Anchor Ys are reported relative to the editor's scroll container, NOT the
// viewport: a viewport Y is only valid at the instant it's measured, and the
// card layout runs a frame or more later — during a smooth scroll the two
// moments disagree and cards land offset by the scroll progressed in between.
// A container-relative offset is scroll-invariant; the layout pass re-bases it
// against the container's live position in the same frame it places cards.
function measureCommentAnchorYs(view: EditorView, commentLines: CommentLine[]): CommentAnchorY[] {
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const scrollTop = view.scrollDOM.scrollTop;
  const docLen = view.state.doc.length;
  const anchors: CommentAnchorY[] = [];

  for (const comment of commentLines) {
    if (comment.from < 0 || comment.from > docLen) continue;
    const pos = Math.min(comment.from, docLen);
    const coords = view.coordsAtPos(pos);
    const y =
      coords !== null ? coords.top - scrollRect.top : view.lineBlockAt(pos).top - scrollTop;
    if (Number.isFinite(y)) anchors.push({ commentId: comment.commentId, y });
  }

  return anchors;
}

// Editor surface: grow to content so the PAGE scrolls (matching the rendered
// doc's native-scroll model), and inherit the doc column's typography rather
// than CodeMirror's default monospace chrome.
const editorTheme = EditorView.theme({
  "&": { fontSize: "inherit", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-content": {
    fontFamily: "inherit",
    padding: "0",
    caretColor: "var(--text)",
  },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "visible" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "0",
    color: "var(--text-faint)",
  },
  "&.cm-focused": { outline: "none" },
  // Caret + selection use OUR tokens so they follow light/dark (CM's defaults are
  // tuned for light — a dark caret + pale-blue selection that vanish on a dark bg).
  // The caret is a border-left on .cm-cursor; the selection fill needs CM's full
  // focused selector to win the specificity fight (the project's known CM gotcha).
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--selection)" },
  ".cm-selectionBackground": { backgroundColor: "var(--selection)" },
});

export const Editor = forwardRef<EditorHandle, {
  file: string;
  commentLines?: CommentLine[];
  onCommentMarkerClick?: (commentId: string) => void;
  /** Reports a save landed for `file`, so the parent can ignore the disk-change
   *  event our own write echoes back (passing the just-written content to match). */
  onDirtyChange?: (file: string, dirty: boolean, savedContent?: string) => void;
  /** Surfaces save status to the parent, which shows it next to the filename. */
  onSaveStateChange?: (state: SaveState) => void;
  /** Reports the editor's live body (frontmatter stripped) on load and on each
   *  edit, so the outline tracks headings as you type — no wait for autosave. */
  onContentChange?: (body: string) => void;
  /** Reports the editor's live raw markdown for comment anchor matching, plus
   *  whether that exact value has completed saving — Copy contents needs the
   *  on-screen buffer and its freshness, which the coarse save state can't give
   *  (it reports "saving" for a value already superseded by newer typing). */
  onRawContentChange?: (raw: string, saved: boolean) => void;
  /** Reports each live comment anchor's Y (relative to the editor's scroll
   *  container top) after editor geometry changes. */
  onCommentAnchorYsChange?: (anchors: CommentAnchorY[]) => void;
  /** Reports the editor's scroll container element — the base the card layout
   *  measures anchor offsets against. Null on unmount. */
  onEditorHostChange?: (host: HTMLElement | null) => void;
  /** Records the qualified decision made by an edit-mode preview chunk. */
  onSuggestionPreviewDecision?: (
    threadId: string,
    suggestionId: string,
    resolution: SuggestionResolution,
  ) => void;
  /** Reports asset insertion failures through the app-owned toast. */
  onAssetError?: (message: string) => void;
  /** Requests an immediate file-index refresh after an asset is created. */
  onAssetCreated?: () => void;
}>(function Editor({
  file,
  commentLines = [],
  onCommentMarkerClick,
  onDirtyChange,
  onSaveStateChange,
  onContentChange,
  onRawContentChange,
  onCommentAnchorYsChange,
  onEditorHostChange,
  onSuggestionPreviewDecision,
  onAssetError,
  onAssetCreated,
}, ref) {
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flashingCommentId, setFlashingCommentId] = useState<string | null>(null);
  const [conflict, setConflictState] = useState<Conflict>("none");
  // Mirror for closures (the autosave timer, the imperative handle) that must
  // read the live conflict state, not the one captured at schedule time.
  const conflictRef = useRef<Conflict>("none");
  const setConflict = (c: Conflict) => {
    conflictRef.current = c;
    setConflictState(c);
  };
  // The content hash of what this editor believes is on disk — read at load,
  // chained through every successful save, sent as baseVersion so a save can
  // never silently clobber an external change.
  const versionRef = useRef<string | null>(null);
  // Disk-side content captured when entering review, so the merge view and the
  // resolving save agree on what "theirs" was.
  const theirsRef = useRef<{ content: string; version: string } | null>(null);
  const textRef = useRef<string | null>(null);
  textRef.current = text;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const suggestionPreviewCompartment = useRef(new Compartment());
  const suggestionPreviewExtension = useMemo(
    () => suggestionPreviewCompartment.current.of([]),
    [],
  );
  const suggestionPreviewRef = useRef<EditSuggestionPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const closingSuggestionPreview = useRef(false);
  const suggestionDecisionCb = useRef(onSuggestionPreviewDecision);
  suggestionDecisionCb.current = onSuggestionPreviewDecision;
  // Latest callbacks, read without re-binding effects.
  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;
  const saveStateCb = useRef(onSaveStateChange);
  saveStateCb.current = onSaveStateChange;
  const setSaveState = (s: SaveState) => saveStateCb.current?.(s);
  const contentCb = useRef(onContentChange);
  contentCb.current = onContentChange;
  const rawContentCb = useRef(onRawContentChange);
  rawContentCb.current = onRawContentChange;
  // The last value handed to the parent. A save resolves for one specific value,
  // so it may only flip that value to "saved" if newer typing hasn't replaced it
  // in the meantime — otherwise a slow save would mark stale text as on-disk.
  const publishedRaw = useRef<string | null>(null);
  const publishedSaved = useRef(true);
  const publishRaw = (raw: string, saved: boolean) => {
    publishedRaw.current = raw;
    publishedSaved.current = saved;
    rawContentCb.current?.(raw, saved);
  };
  /** Mark `value` saved only if it is still what the buffer shows. */
  const markSaved = (value: string) => {
    if (publishedRaw.current === value) publishRaw(value, true);
  };
  const anchorYsCb = useRef(onCommentAnchorYsChange);
  anchorYsCb.current = onCommentAnchorYsChange;
  const commentLinesRef = useRef(commentLines);
  commentLinesRef.current = commentLines;
  const markerClickCb = useRef(onCommentMarkerClick);
  markerClickCb.current = onCommentMarkerClick;
  const editorHostCb = useRef(onEditorHostChange);
  editorHostCb.current = onEditorHostChange;
  const assetErrorCb = useRef(onAssetError);
  assetErrorCb.current = onAssetError;
  const assetCreatedCb = useRef(onAssetCreated);
  assetCreatedCb.current = onAssetCreated;
  const anchorReportRaf = useRef<number | null>(null);
  const scheduleAnchorReportRef = useRef<() => void>(() => {});
  scheduleAnchorReportRef.current = () => {
    if (!anchorYsCb.current) return;
    if (anchorReportRaf.current !== null) return;
    anchorReportRaf.current = requestAnimationFrame(() => {
      anchorReportRaf.current = null;
      const view = viewRef.current;
      if (!view) return;
      anchorYsCb.current?.(measureCommentAnchorYs(view, commentLinesRef.current));
    });
  };

  // Build the editor extensions once — a fresh array each render would make
  // CodeMirror reconfigure on every keystroke. `setPaletteOpen` is a stable
  // useState setter, so closing over it here is safe. ⌘/ opens the command
  // palette; the binding lives in the editor keymap so it only fires while
  // editing (and preventDefault keeps the browser out of it).
  const baseExtensions = useMemo(
    () =>
      createEditorExtensions(() => setPaletteOpen(true), {
        upload: (name, blob) => uploadAsset(fileRef.current, name, blob),
        onError: (message) => assetErrorCb.current?.(message),
        onCreated: () => assetCreatedCb.current?.(),
      }),
    [],
  );
  const commentHighlight = useMemo(
    () => commentHighlightExtension(commentLines, flashingCommentId),
    [commentLines, flashingCommentId],
  );
  const commentAnchorReporter = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.geometryChanged || update.viewportChanged) {
          scheduleAnchorReportRef.current();
        }
      }),
    [],
  );
  // Click the underlined quote → jump to its card (and flash the quote).
  // Hover tints ALL spans of the comment together via a .hover class (a quote
  // crossing lines renders as multiple mark spans, and native :hover would tint
  // only the hovered piece) — the same group-hover the rendered view paints.
  const commentClickHandler = useMemo(() => {
    const groupSpans = (view: EditorView, id: string) =>
      view.dom.querySelectorAll<HTMLElement>(
        `.cm-comment-underline[data-comment-id="${CSS.escape(id)}"]`,
      );
    const idAt = (event: Event) =>
      (event.target as HTMLElement).closest<HTMLElement>(".cm-comment-underline[data-comment-id]")
        ?.dataset.commentId;
    return EditorView.domEventHandlers({
      mousedown(event) {
        const id = idAt(event);
        if (!id) return false;
        markerClickCb.current?.(id);
        flashCommentMarker(id);
        return true;
      },
      mouseover(event, view) {
        const id = idAt(event);
        if (!id) return false;
        for (const span of groupSpans(view, id)) span.classList.add("hover");
        return false;
      },
      mouseout(event, view) {
        const id = idAt(event);
        if (!id) return false;
        // Still inside another span of the same comment → keep the group lit.
        const to = event.relatedTarget as HTMLElement | null;
        if (to?.closest?.(`.cm-comment-underline[data-comment-id="${CSS.escape(id)}"]`)) {
          return false;
        }
        for (const span of groupSpans(view, id)) span.classList.remove("hover");
        return false;
      },
    });
  }, []);
  const extensions = useMemo(
    () => [
      ...baseExtensions,
      commentHighlight,
      commentClickHandler,
      commentAnchorReporter,
      suggestionPreviewExtension,
    ],
    [
      baseExtensions,
      commentHighlight,
      commentClickHandler,
      commentAnchorReporter,
      suggestionPreviewExtension,
    ],
  );

  const flashCommentMarker = (commentId: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashingCommentId(null);
    window.setTimeout(() => setFlashingCommentId(commentId), 0);
    flashTimer.current = setTimeout(() => {
      setFlashingCommentId((current) => (current === commentId ? null : current));
    }, 1300);
  };

  const clearSuggestionPreview = () => {
    if (!suggestionPreviewRef.current) return;
    suggestionPreviewRef.current = null;
    setPreviewOpen(false);
    viewRef.current?.dispatch({
      effects: suggestionPreviewCompartment.current.reconfigure([]),
    });
  };

  const closeSuggestionPreview = () => {
    const preview = suggestionPreviewRef.current;
    const view = viewRef.current;
    if (!preview || !view) return;
    closingSuggestionPreview.current = true;
    if (view.state.doc.toString() !== preview.original) {
      rejectChunk(view, getChunks(view.state)?.chunks[0]?.fromB);
      if (view.state.doc.toString() !== preview.original) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: preview.original },
        });
      }
    }
    closingSuggestionPreview.current = false;
    clearSuggestionPreview();
  };

  const settleSuggestionPreview = (
    resolution: SuggestionResolution,
    chunkHandled = false,
  ): boolean => {
    const preview = suggestionPreviewRef.current;
    const view = viewRef.current;
    if (!preview || !view) return false;
    if (!chunkHandled) {
      const chunk = getChunks(view.state)?.chunks[0];
      const pos = chunk?.fromB;
      const changed = resolution === "applied" ? acceptChunk(view, pos) : rejectChunk(view, pos);
      if (!changed) return false;
    }
    // A dismissal must restore the whole buffer: a preview whose diff shares an
    // unchanged line splits into several chunks, and rejecting one chunk leaves
    // the others' proposed text to silently persist on the next save.
    if (resolution === "dismissed" && view.state.doc.toString() !== preview.original) {
      closingSuggestionPreview.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: preview.original },
      });
      closingSuggestionPreview.current = false;
    }
    const { threadId, suggestionId } = preview;
    clearSuggestionPreview();
    if (resolution === "applied") queueAutosaveRef.current(view.state.doc.toString());
    suggestionDecisionCb.current?.(threadId, suggestionId, resolution);
    return true;
  };

  const previewSuggestion = (threadId: string, suggestionId: string, suggestion: Suggestion): boolean => {
    if (conflictRef.current !== "none") return false;
    if (suggestionPreviewRef.current) closeSuggestionPreview();
    const view = viewRef.current;
    if (!view) return false;
    const original = view.state.doc.toString();
    const transaction = buildSuggestionEdit(view.state, suggestion);
    if (!transaction) return false;
    const changes = transaction.changes as { from: number };
    // Remember whether the pre-preview buffer was on disk: restoring it on close
    // or dismissal must restore that status too, not leave a saved doc marked
    // unsaved just because a preview passed through it.
    const preview = { threadId, suggestionId, original, originalSaved: publishedSaved.current };
    suggestionPreviewRef.current = preview;
    setPreviewOpen(true);
    view.dispatch(transaction);
    // The chip is a block widget above the chunk's first line — a reserved row,
    // never painted over the text, matching the view-mode preview's layout. The
    // package's per-chunk controls and gutter markers are disabled: the chip is
    // the one decision surface, and the chunk washes are the one change marker.
    const chipAt = view.state.doc.lineAt(Math.min(changes.from, view.state.doc.length)).from;
    view.dispatch({
      effects: suggestionPreviewCompartment.current.reconfigure([
        unifiedMergeView({
          original,
          allowInlineDiffs: true,
          gutter: false,
          mergeControls: false,
        }),
        EditorView.decorations.of(
          Decoration.set([
            Decoration.widget({
              widget: new PreviewChipWidget({
                accept: () => settleSuggestionPreview("applied", true),
                reject: () => settleSuggestionPreview("dismissed", true),
                close: () => closeSuggestionPreviewRef.current(),
              }),
              block: true,
              // Sort above the package's deleted-chunk widget at the same
              // position, so the chip heads the whole preview like view mode.
              side: -2,
            }).range(chipAt),
          ]),
        ),
      ]),
    });
    // Mirror the view-mode rule: pinning brings the preview to the reader. The
    // editor page-scrolls natively, so measure viewport coords and move the
    // window when the chunk isn't fully visible (top-align when it is taller
    // than the viewport, centre otherwise).
    requestAnimationFrame(() => {
      if (suggestionPreviewRef.current !== preview) return;
      // Measure the chip's real position: the deleted-chunk widget of unknown
      // height sits between the chip row and the first changed line.
      const chip = view.dom.querySelector(".suggestion-preview-actions");
      const chipTop = chip ? chip.getBoundingClientRect().top : null;
      if (chipTop === null) return;
      const endPos = Math.min(changes.from + suggestion.replacement.length, view.state.doc.length);
      const tail = view.coordsAtPos(endPos);
      const bottom = tail ? tail.bottom : chipTop;
      if (chipTop >= 0 && bottom <= window.innerHeight) return;
      const height = bottom - chipTop;
      const target =
        height > window.innerHeight * 0.8
          ? window.scrollY + chipTop - 60
          : window.scrollY + chipTop - (window.innerHeight - height) / 2;
      window.scrollTo({ top: Math.max(target, 0) });
    });
    return true;
  };

  const previewSuggestionRef = useRef(previewSuggestion);
  previewSuggestionRef.current = previewSuggestion;
  const closeSuggestionPreviewRef = useRef(closeSuggestionPreview);
  closeSuggestionPreviewRef.current = closeSuggestionPreview;

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeSuggestionPreviewRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  useImperativeHandle(ref, () => ({
    applySuggestion(suggestion) {
      const view = viewRef.current;
      return view !== null && applySuggestionEdit(suggestion, view);
    },
    previewSuggestion(threadId, suggestionId, suggestion) {
      return previewSuggestionRef.current(threadId, suggestionId, suggestion);
    },
    acceptSuggestionPreview(threadId, suggestionId) {
      const preview = suggestionPreviewRef.current;
      if (!preview || preview.threadId !== threadId || preview.suggestionId !== suggestionId) return false;
      return settleSuggestionPreview("applied");
    },
    dismissSuggestionPreview(threadId, suggestionId) {
      const preview = suggestionPreviewRef.current;
      if (!preview || preview.threadId !== threadId || preview.suggestionId !== suggestionId) return false;
      return settleSuggestionPreview("dismissed");
    },
    closeSuggestionPreview() {
      closeSuggestionPreviewRef.current();
    },
    notifyExternalChange() {
      if (conflictRef.current !== "none") return; // already in the flow
      if (timer.current) clearTimeout(timer.current);
      closeSuggestionPreviewRef.current();
      setConflict("banner");
      setSaveState("conflict");
    },
    scrollToComment(commentId: string) {
      const view = viewRef.current;
      if (!view || conflictRef.current === "review") return;
      const comment = commentLinesRef.current.find((line) => line.commentId === commentId);
      if (!comment || comment.line < 1 || comment.line > view.state.doc.lines) return;
      const line = view.state.doc.line(comment.line);
      const block = view.lineBlockAt(line.from);
      const scrollRect = view.scrollDOM.getBoundingClientRect();
      const lineCenter =
        window.scrollY + scrollRect.top + block.top - view.scrollDOM.scrollTop + block.height / 2;
      window.scrollTo({
        top: Math.max(0, lineCenter - window.innerHeight / 2),
        behavior: "smooth",
      });
      // Flash immediately, like the view-mode highlight — the flash outlasts
      // the smooth scroll, so it's still visible when the line settles.
      flashCommentMarker(commentId);
    },
  }));

  // --- conflict resolutions --------------------------------------------------

  /** Discard the buffer, adopt the disk state. */
  const loadTheirs = () => {
    fetchDoc(file)
      .then((doc) => {
        versionRef.current = doc.version;
        theirsRef.current = null;
        setText(doc.content);
        contentCb.current?.(parseFrontmatter(doc.content).body);
        publishRaw(doc.content, true); // adopted from disk — matches the file
        setConflict("none");
        setSaveState("idle");
      })
      .catch(() => setSaveState("error"));
  };

  /** Overwrite the disk state with the buffer — a deliberate blind write. */
  const keepMine = () => {
    const value = textRef.current;
    if (value === null) return;
    setSaveState("saving");
    dirtyCb.current?.(file, false, value); // pre-register the echo (see autosave)
    saveDoc(file, value)
      .then((version) => {
        versionRef.current = version;
        theirsRef.current = null;
        markSaved(value);
        setConflict("none");
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  };

  /** Fetch the disk state and open the side-by-side merge view. */
  const openReview = () => {
    fetchDoc(file)
      .then((doc) => {
        theirsRef.current = { content: doc.content, version: doc.version };
        setConflict("review");
      })
      .catch(() => setSaveState("error"));
  };

  /** Save the merge view's right side as the resolution — conflict-safe against
   *  the disk state the review showed (moved again mid-review → 409 → banner). */
  const applyReview = () => {
    const mv = mergeRef.current;
    const theirs = theirsRef.current;
    if (!mv || !theirs) return;
    const value = mv.b.state.doc.toString();
    setSaveState("saving");
    dirtyCb.current?.(file, false, value); // pre-register the echo (see autosave)
    saveDoc(file, value, theirs.version)
      .then((version) => {
        versionRef.current = version;
        theirsRef.current = null;
        setText(value);
        contentCb.current?.(parseFrontmatter(value).body);
        publishRaw(value, true); // the merge resolution is now on disk
        setConflict("none");
        setSaveState("saved");
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 409) {
          setConflict("banner");
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
      });
  };

  // The merge view is imperative (it owns two EditorViews); mount it into an
  // empty host div while reviewing, read its right side back on resolution.
  const mergeHostRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  useEffect(() => {
    if (conflict !== "review") return;
    const host = mergeHostRef.current;
    const theirs = theirsRef.current;
    if (!host || !theirs) return;
    const shared = [EditorView.lineWrapping, editorTheme];
    const mv = new MergeView({
      parent: host,
      a: { doc: theirs.content, extensions: [...shared, EditorState.readOnly.of(true)] },
      b: {
        doc: textRef.current ?? "",
        extensions: [
          ...shared,
          // Copy contents must follow the editable side while review is open —
          // chunks pulled from disk and hand edits alike, none of them saved.
          EditorView.updateListener.of((u) => {
            if (u.docChanged) publishRaw(u.state.doc.toString(), false);
          }),
        ],
      },
      revertControls: "a-to-b",
      // The default control is a bare squiggle glyph; render a real button with
      // a straight arrow instead (the package positions it and delegates the
      // click — only the element is ours).
      renderRevertControl: () => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "merge-take-btn";
        btn.setAttribute("aria-label", "Take their version for this chunk");
        btn.title = "Take their version for this chunk";
        btn.innerHTML =
          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
          ` stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
          `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`;
        return btn;
      },
      highlightChanges: true,
      gutter: true,
    });
    mergeRef.current = mv;
    // Seed the copy source with the editable side as review opens, so a copy
    // before the first edit still reads "Your version" rather than the buffer
    // value published before the merge view existed.
    publishRaw(mv.b.state.doc.toString(), false);
    return () => {
      mv.destroy();
      mergeRef.current = null;
    };
  }, [conflict]);

  // Apply a palette-chosen command to the live editor (selection → wrap, caret
  // → insert), then close the palette and return focus to the editor.
  const runFromPalette = (cmd: MarkdownCommand) => {
    const view = viewRef.current;
    setPaletteOpen(false);
    if (view) runCommand(cmd, view);
  };

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (anchorReportRaf.current !== null) cancelAnimationFrame(anchorReportRaf.current);
      closeSuggestionPreviewRef.current();
      editorHostCb.current?.(null);
    };
  }, []);

  useEffect(() => {
    scheduleAnchorReportRef.current();
  }, [commentLines]);

  useEffect(() => {
    const onResize = () => scheduleAnchorReportRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load the source whenever the file changes.
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setLoadError(null);
    setSaveState("idle");
    setConflict("none");
    theirsRef.current = null;
    fetchDoc(file)
      .then((doc) => {
        if (cancelled) return;
        versionRef.current = doc.version;
        setText(doc.content);
        contentCb.current?.(parseFrontmatter(doc.content).body); // seed the live outline
        publishRaw(doc.content, true); // freshly loaded — identical to disk
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof ApiError ? e.message : "Failed to load file");
      });
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      closeSuggestionPreviewRef.current();
    };
  }, [file]);

  const onChange = (value: string) => {
    setText(value);
    contentCb.current?.(parseFrontmatter(value).body); // live outline tracks typing
    // On screen but not yet on disk — including a pinned preview's proposed
    // buffer, which stays unsaved until its own save completes. Backing out of a
    // preview to its exact pre-preview text restores that text's prior status:
    // a saved doc shouldn't read "unsaved" just because a preview passed by.
    const open = suggestionPreviewRef.current;
    publishRaw(value, open !== null && value === open.original ? open.originalSaved : false);
    // A pinned suggestion is a temporary buffer state. Undoing it restores the
    // original text and releases the merge decorations without saving.
    const preview = suggestionPreviewRef.current;
    if (preview) {
      if (!closingSuggestionPreview.current && value === preview.original) clearSuggestionPreview();
      return;
    }
    // While conflicted, typing keeps the buffer but never writes — a save now
    // would clobber the very change the conflict flagged. Resolution resumes.
    if (conflictRef.current !== "none") return;
    queueAutosaveRef.current(value);
  };

  const queueAutosave = (value: string) => {
    if (conflictRef.current !== "none" || suggestionPreviewRef.current) return;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (conflictRef.current !== "none") return; // conflict landed mid-debounce
      if (suggestionPreviewRef.current) return;
      // Tell the parent what we're writing BEFORE the request goes out — the
      // watcher's doc-changed event can outrun the PUT response, and the echo
      // must already be recognizable when it lands.
      dirtyCb.current?.(fileRef.current, false, value);
      saveDoc(fileRef.current, value, versionRef.current ?? undefined)
        .then((version) => {
          versionRef.current = version;
          markSaved(value); // no-op if newer typing already superseded it
          setSaveState("saved");
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 409) {
            setConflict("banner");
            setSaveState("conflict");
          } else {
            setSaveState("error");
          }
        });
    }, AUTOSAVE_MS);
  };
  const queueAutosaveRef = useRef(queueAutosave);
  queueAutosaveRef.current = queueAutosave;

  if (loadError) {
    return <div className="editor-status editor-error">{loadError}</div>;
  }
  // Mount CodeMirror ONLY once the source has loaded, so the editor is CREATED
  // with the real content as its initial doc — never born empty and mutated into
  // it. @uiw applies a later `value`-prop change as an undoable transaction
  // (useCodeMirror.js — `changes` dispatch, no addToHistory:false), so an
  // empty→content load would sit in the undo history and a single Cmd-Z would
  // wipe the whole doc (then autosave persists the wipe). Born-with-content has
  // no such transaction to undo. While loading, render the empty editor frame —
  // no "Loading…" word (avoids the flash on every view⇄edit toggle), no layout
  // jump, and crucially nothing for undo to roll back to.
  if (text === null) {
    return <div className="editor" />;
  }

  return (
    <div className="editor">
      {conflict !== "none" && (
        <DocBanner
          className="editor-conflict-banner"
          text={
            conflict === "review"
              ? "Reviewing: their version (disk) on the left, yours on the right — pull their chunks across or edit the right side, then save."
              : "This file changed on disk while you were editing. Autosave is paused."
          }
          actions={
            conflict === "banner"
              ? [
                  { label: "Review", onClick: openReview },
                  { label: "Load theirs", onClick: loadTheirs },
                  { label: "Keep mine", onClick: keepMine },
                ]
              : [
                  { label: "Save result", onClick: applyReview },
                  { label: "Back", onClick: () => setConflict("banner") },
                ]
          }
        />
      )}
      {conflict === "review" ? (
        <div className="editor-merge">
          <div className="editor-merge-heads">
            <span>On disk (theirs)</span>
            <span>Your version</span>
          </div>
          <div ref={mergeHostRef} className="editor-merge-view" />
        </div>
      ) : (
        <CodeMirror
          className="editor-cm"
          value={text}
          onChange={onChange}
          onCreateEditor={(view) => {
            viewRef.current = view;
            scheduleAnchorReportRef.current();
            editorHostCb.current?.(view.scrollDOM);
          }}
          theme={editorTheme}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            // Keep selection-match / bracket tinting off (the stray purple/green);
            // markdown syntax highlighting is supplied by the editor extension set.
            highlightSelectionMatches: false,
            bracketMatching: false,
            syntaxHighlighting: true,
          }}
          extensions={extensions}
        />
      )}
      {paletteOpen && (
        <MarkdownPalette onClose={() => setPaletteOpen(false)} onRun={runFromPalette} />
      )}
    </div>
  );
});
