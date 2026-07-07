/**
 * HTML surface router: decides how an .html file is shown.
 *
 *   - no `mdc-app` manifest      → HtmlView (view-only, scriptless sandbox)
 *   - manifest present, untrusted → a trust prompt (what it can access)
 *   - manifest present, trusted   → AppView (runs as a trusted mini app)
 *
 * Trust is checked via /api/app/info on open and re-checked when the file
 * reloads (its hash changes on edit → it falls back to untrusted, re-prompting).
 */

import { useCallback, useEffect, useState } from "react";
import { AppPermissionCard } from "./AppPermissionCard.js";
import { AppView } from "./AppView.js";
import { HtmlView } from "./HtmlView.js";
import { fetchAppInfo, trustApp, type AppInfo } from "./api.js";
import { onTrustChange } from "./trust-state.js";
import { beyondFolder, ownFolder } from "./app-scope.js";

export function HtmlSurface({ file, reloadNonce }: { file: string; reloadNonce: number }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [declined, setDeclined] = useState(false);

  const load = useCallback(() => {
    setInfo(null);
    setFailed(false);
    setDeclined(false);
    fetchAppInfo(file).then(
      (i) => {
        setInfo(i);
        // Keep the toolbar's indicator in sync with the resolved trust state.
        onTrustChange(file, i.name !== null && i.trusted);
      },
      () => setFailed(true), // info unavailable → treat as plain HTML
    );
  }, [file]);

  useEffect(() => load(), [load, reloadNonce]);

  // On unmount / file switch, this file is no longer the running app on screen.
  useEffect(() => () => onTrustChange(file, false), [file]);

  const isApp = !!info && info.name !== null;

  async function onTrust(): Promise<void> {
    await trustApp(file);
    load(); // re-fetch info → publishes trusted=true → re-renders as AppView
  }

  // No manifest (or info failed) → plain view-only HTML.
  if (failed || (info && !isApp)) {
    return <HtmlView file={file} reloadNonce={reloadNonce} />;
  }
  // Still loading info — blank surface (avoids a flash of the wrong view).
  if (!info) return <div className="doc html-view" />;

  if (info.trusted) {
    return <AppView file={file} reloadNonce={reloadNonce} />;
  }
  if (declined) {
    return <HtmlView file={file} reloadNonce={reloadNonce} />;
  }

  return <TrustPrompt info={info} onTrust={onTrust} onDecline={() => setDeclined(true)} />;
}

/** The pre-run prompt: shows what the app would access, asks for explicit trust. */
function TrustPrompt({
  info,
  onTrust,
  onDecline,
}: {
  info: AppInfo;
  onTrust: () => Promise<void>;
  onDecline: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const read = scopeList(info.permissions.read, info.appPath);
  // An app that declares read scopes beyond its folder but no write scope reaches
  // OUT read-only: it can write only its own folder, never the granted folders.
  // Name that explicitly rather than echoing the own-folder as if it were the grant.
  const beyondRead = beyondFolder(info.permissions.read, info.appPath).length > 0;
  const beyondWrite = beyondFolder(info.permissions.write, info.appPath).length > 0;
  const readOnlyReach = beyondRead && !beyondWrite;
  const write = readOnlyReach
    ? "nothing beyond its own folder (read-only)"
    : scopeList(info.permissions.write, info.appPath);

  return (
    <div className="doc app-trust">
      <AppPermissionCard
        title={<>Run “{info.name}” as a trusted app?</>}
        body={
          <>
            This HTML file wants to run with access to files in this workspace. Only trust apps you
            understand — a trusted app can read and write the files listed below.
          </>
        }
        scopes={[
          { label: "Can read", value: read },
          { label: "Can write", value: write },
        ]}
        actions={
          <button
            type="button"
            className="app-trust-run"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onTrust().finally(() => setBusy(false));
            }}
          >
            {busy ? "Trusting…" : "Trust & run"}
          </button>
        }
        footnote="Trust is remembered for this exact file. Editing it will ask again."
        onCancel={onDecline}
      />
    </div>
  );
}

/**
 * Human-readable scope summary. The app's own folder is always included; any
 * manifest path already inside that folder is dropped as redundant (only paths
 * that REACH BEYOND the folder are worth naming separately).
 */
function scopeList(scopes: string[], appPath: string): string {
  const folder = ownFolder(appPath);
  const own = folder ? `${folder}/ (its own folder)` : "the workspace root";
  return [own, ...beyondFolder(scopes, appPath)].join(", ");
}
