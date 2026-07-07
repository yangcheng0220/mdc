import { type ReactNode, useEffect, useRef } from "react";

interface PermissionScope {
  label: string;
  value: ReactNode;
}

export function AppPermissionCard({
  title,
  body,
  scopes,
  actions,
  footnote,
  onCancel,
}: {
  title: ReactNode;
  body: ReactNode;
  scopes?: PermissionScope[];
  actions: ReactNode;
  footnote: ReactNode;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Overlays above the card (palettes, menus, dialogs) consume their
      // Escape with preventDefault; listening on window puts this handler
      // after their document/root listeners in the bubble path, so a
      // consumed Escape never also cancels the card underneath.
      if (e.key === "Escape" && !e.defaultPrevented) onCancel();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div ref={cardRef} className="app-trust-card" tabIndex={-1}>
      <div className="app-trust-title">{title}</div>
      <p className="app-trust-body">{body}</p>
      {scopes && scopes.length > 0 && (
        <dl className="app-trust-scopes">
          {scopes.map((scope) => (
            <ScopeRow key={scope.label} scope={scope} />
          ))}
        </dl>
      )}
      <div className="app-trust-actions">{actions}</div>
      <p className="app-trust-note">{footnote}</p>
    </div>
  );
}

function ScopeRow({ scope }: { scope: PermissionScope }) {
  return (
    <>
      <dt>{scope.label}</dt>
      <dd>{scope.value}</dd>
    </>
  );
}
