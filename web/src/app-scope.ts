/**
 * App-scope path helpers shared by the trust prompt (HtmlSurface) and the
 * write-grant confirm (AppView). One definition of "the app's own folder" and
 * "reaches beyond it" so the two surfaces can't drift apart.
 *
 * All paths are root-relative posix strings (the same shape the bridge uses).
 */

/** The app's own folder, root-relative ("" for a root-level app). */
export function ownFolder(appPath: string): string {
  return appPath.includes("/") ? appPath.slice(0, appPath.lastIndexOf("/")) : "";
}

/** True if `target` sits inside `folder` (or `folder` is the workspace root). */
function isWithinFolder(folder: string, target: string): boolean {
  return folder === "" || target === folder || target.startsWith(folder + "/");
}

/** True if `target` reaches BEYOND the app's own folder (a cross-folder path). */
export function isBeyondFolder(appPath: string, target: string): boolean {
  return !isWithinFolder(ownFolder(appPath), target);
}

/** The manifest scopes that reach beyond the app's own folder (worth naming). */
export function beyondFolder(scopes: string[], appPath: string): string[] {
  const folder = ownFolder(appPath);
  return scopes.filter((s) => !isWithinFolder(folder, s));
}
