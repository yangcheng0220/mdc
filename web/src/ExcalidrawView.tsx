/** Read-only Excalidraw surface, loaded only when a drawing is opened. */

import { Component, useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { fetchDrawing } from "./api.js";
import { useResolvedTheme } from "./theme.js";
import "./styles/excalidraw.css";

// Excalidraw otherwise falls back to its public CDN for scene fonts.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
  "/assets/excalidraw/";

interface LoadedScene {
  requestKey: string;
  scene: ExcalidrawInitialDataState | null;
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

export function ExcalidrawView({ file, reloadNonce }: { file: string; reloadNonce: number }) {
  const theme = useResolvedTheme();
  const requestKey = `${file}:${reloadNonce}`;
  const [loaded, setLoaded] = useState<LoadedScene | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDrawing(file).then(
      ({ content }) => {
        if (cancelled) return;
        try {
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
    };
  }, [file, requestKey]);

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
            viewModeEnabled
            handleKeyboardGlobally={false}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                saveAsImage: false,
                toggleTheme: false,
              },
              tools: { image: false },
            }}
          />
        </div>
      </div>
    </DrawingErrorBoundary>
  );
}
