/** Excalidraw surface, loaded only when a drawing is opened. */

import { Component, useEffect, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { ApiError, fetchDrawing, saveDrawing } from "./api.js";
import { useResolvedTheme } from "./theme.js";
import "./styles/excalidraw.css";

const AUTOSAVE_MS = 600;
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

// Excalidraw otherwise falls back to its public CDN for scene fonts.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
  "/assets/excalidraw/";

interface LoadedScene {
  requestKey: string;
  scene: ExcalidrawInitialDataState | null;
}

interface ExcalidrawViewProps {
  file: string;
  editing: boolean;
  reloadNonce: number;
  externalChange: boolean;
  onOwnWrite?: (file: string, content: string) => void;
  onSaveStateChange?: (state: SaveState) => void;
  onConflict?: () => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject JSON that cannot represent a saved Excalidraw scene. */
export function parseDrawing(content: string): ExcalidrawInitialDataState {
  const value: unknown = JSON.parse(content);
  if (
    !isObject(value) ||
    value.type !== "excalidraw" ||
    !Array.isArray(value.elements) ||
    (value.appState !== undefined && !isObject(value.appState)) ||
    (value.files !== undefined && !isObject(value.files))
  ) {
    throw new Error("invalid Excalidraw scene");
  }
  return {
    elements: value.elements,
    appState: value.appState ?? {},
    files: value.files ?? {},
  } as ExcalidrawInitialDataState;
}

function DrawingError({ file }: { file: string }) {
  const name = file.split("/").pop() ?? file;
  return <div className="doc doc-error drawing-error">{name}: Can't read this drawing</div>;
}

class DrawingErrorBoundary extends Component<
  { file: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <DrawingError file={this.props.file} /> : this.props.children;
  }
}

export function ExcalidrawView({
  file,
  editing,
  reloadNonce,
  externalChange,
  onOwnWrite,
  onSaveStateChange,
  onConflict,
}: ExcalidrawViewProps) {
  const theme = useResolvedTheme();
  const requestKey = `${file}:${reloadNonce}`;
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);
  const versionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const conflictedRef = useRef(false);
  const sessionRef = useRef(0);
  const fileRef = useRef(file);
  fileRef.current = file;
  const lastSerializedRef = useRef<string | null>(null);
  const ownWriteCb = useRef(onOwnWrite);
  ownWriteCb.current = onOwnWrite;
  const saveStateCb = useRef(onSaveStateChange);
  saveStateCb.current = onSaveStateChange;
  const conflictCb = useRef(onConflict);
  conflictCb.current = onConflict;
  const persistPendingRef = useRef<() => void>(() => {});

  const setSaveState = (state: SaveState) => saveStateCb.current?.(state);

  persistPendingRef.current = () => {
    if (inFlightRef.current || conflictedRef.current) return;
    const content = pendingContentRef.current;
    const baseVersion = versionRef.current;
    if (content === null || baseVersion === null) return;

    pendingContentRef.current = null;
    inFlightRef.current = true;
    const session = sessionRef.current;
    const targetFile = fileRef.current;
    setSaveState("saving");
    // Register before sending: the watcher echo can arrive before the response.
    ownWriteCb.current?.(targetFile, content);
    saveDrawing(targetFile, content, baseVersion).then(
      (version) => {
        if (session !== sessionRef.current) return;
        inFlightRef.current = false;
        versionRef.current = version;
        if (pendingContentRef.current !== null && timerRef.current === null) {
          persistPendingRef.current();
        } else if (pendingContentRef.current === null) {
          setSaveState("saved");
        }
      },
      (error: unknown) => {
        if (session !== sessionRef.current) return;
        inFlightRef.current = false;
        if (error instanceof ApiError && error.status === 409) {
          conflictedRef.current = true;
          pendingContentRef.current = null;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
          setSaveState("conflict");
          conflictCb.current?.();
        } else {
          setSaveState("error");
        }
      },
    );
  };

  useEffect(() => {
    sessionRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingContentRef.current = null;
    inFlightRef.current = false;
    conflictedRef.current = false;
    versionRef.current = null;
    lastSerializedRef.current = null;
    setSaveState("idle");
    let cancelled = false;
    fetchDrawing(file).then(
      ({ content, version }) => {
        if (cancelled) return;
        try {
          versionRef.current = version;
          setLoaded({ requestKey, scene: parseDrawing(content) });
        } catch {
          setLoaded({ requestKey, scene: null });
        }
      },
      () => {
        if (!cancelled) setLoaded({ requestKey, scene: null });
      },
    );
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [file, requestKey]);

  // A watcher-confirmed external edit pauses autosave until Reload replaces the
  // canvas and resets the version chain.
  useEffect(() => {
    if (!editing || !externalChange) return;
    conflictedRef.current = true;
    pendingContentRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setSaveState("conflict");
  }, [editing, externalChange]);

  // Switching to view should not strand the final debounced change. The canvas
  // stays mounted, so it can remain visibly read-only while this write finishes.
  useEffect(() => {
    if (editing || conflictedRef.current || pendingContentRef.current === null) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    persistPendingRef.current();
  }, [editing]);

  const onSceneChange: NonNullable<ExcalidrawProps["onChange"]> = (
    elements,
    appState,
    files,
  ) => {
    if (conflictedRef.current) return;
    const content = serializeAsJSON(elements, appState, files, "local");
    if (content === lastSerializedRef.current) return;
    lastSerializedRef.current = content;
    pendingContentRef.current = content;
    setSaveState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      persistPendingRef.current();
    }, AUTOSAVE_MS);
  };

  if (!loaded || loaded.requestKey !== requestKey) return <div className="doc drawing-view" />;
  if (!loaded.scene) return <DrawingError file={file} />;

  const name = file.split("/").pop() ?? file;
  return (
    <DrawingErrorBoundary key={requestKey} file={file}>
      <div className="doc drawing-view">
        <div className="drawing-canvas">
          <Excalidraw
            initialData={loaded.scene}
            name={name}
            theme={theme}
            viewModeEnabled={!editing}
            handleKeyboardGlobally={false}
            onChange={editing ? onSceneChange : undefined}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: editing,
                clearCanvas: editing,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
              tools: { image: editing },
            }}
          />
        </div>
      </div>
    </DrawingErrorBoundary>
  );
}
