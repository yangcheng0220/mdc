import type { IframeHTMLAttributes } from "react";

type IframeSurfaceProps = {
  viewClassName: string;
  frameClassName: string;
  title: string;
  ready: boolean;
  error: string | null;
  errorLabel: string;
  frameProps: Omit<IframeHTMLAttributes<HTMLIFrameElement>, "className" | "title">;
};

export function IframeSurface({
  viewClassName,
  frameClassName,
  title,
  ready,
  error,
  errorLabel,
  frameProps,
}: IframeSurfaceProps) {
  if (error) return <div className="doc doc-error">{errorLabel}: {error}</div>;
  if (!ready) return <div className={`doc ${viewClassName}`} />;

  return (
    <div className={`doc ${viewClassName}`}>
      <iframe {...frameProps} className={frameClassName} title={title} />
    </div>
  );
}
