/**
 * Tiny shared store of which open files are running as trusted apps.
 *
 * Both the HTML surface (which learns trust state from /api/app/info) and the
 * toolbar (which shows a "Trusted App" indicator) need the same answer for the
 * active file. Rather than thread it through App.tsx, they read this one store:
 * the surface publishes, the toolbar subscribes.
 *
 * This is a UI hint only — the server is the real trust authority on every
 * /api/app/* call. A stale entry here can never grant access.
 */

const trusted = new Set<string>();
const listeners = new Set<() => void>();

/** Mark (or unmark) a file as a running trusted app, notifying subscribers. */
export function onTrustChange(file: string, isTrusted: boolean): void {
  const had = trusted.has(file);
  if (isTrusted) trusted.add(file);
  else trusted.delete(file);
  if (had !== isTrusted) for (const l of listeners) l();
}

/** Is this file currently running as a trusted app? */
export function isRunningApp(file: string | null): boolean {
  return !!file && trusted.has(file);
}

/** Subscribe to trust-state changes; returns an unsubscribe fn. */
export function subscribeTrust(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
