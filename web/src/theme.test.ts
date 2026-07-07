import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThemeMode } from "./theme.js";

type ThemeModule = typeof import("./theme.js");

class TestCustomEvent<T = unknown> extends Event {
  readonly detail: T | null;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail ?? null;
  }
}

function installBrowser(matches: boolean) {
  const store = new Map<string, string>();
  const listeners = new Set<EventListener>();
  let currentMatches = matches;
  const addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "change" && typeof listener === "function") {
        listeners.add(listener);
      }
    },
  );
  const removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "change" && typeof listener === "function") {
        listeners.delete(listener);
      }
    },
  );

  const mql = {
    get matches() {
      return currentMatches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    emit(next: boolean) {
      currentMatches = next;
      const event = { matches: next, media: this.media } as MediaQueryListEvent;
      for (const listener of listeners) listener.call(this, event);
    },
  } as MediaQueryList & { emit(next: boolean): void };

  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  };
  const doc = { documentElement: { dataset: {} as DOMStringMap } } as Document;
  const windowTarget = Object.assign(new EventTarget(), {
    matchMedia: vi.fn(() => mql),
  }) as unknown as Window & typeof globalThis;

  vi.stubGlobal("CustomEvent", TestCustomEvent);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", windowTarget);

  return { addEventListener, doc, mql, store, windowTarget };
}

async function loadTheme(): Promise<ThemeModule> {
  vi.resetModules();
  return import("./theme.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("system theme watcher", () => {
  it("updates system mode on color-scheme changes", async () => {
    const { addEventListener, doc, mql, store, windowTarget } = installBrowser(false);
    store.set("mdc-theme", "system");
    const { applyStoredTheme, startSystemThemeWatcher } = await loadTheme();

    applyStoredTheme();
    let resolvedEvents = 0;
    windowTarget.addEventListener("mdc-theme-resolved", () => resolvedEvents++);
    startSystemThemeWatcher();
    startSystemThemeWatcher();

    mql.emit(false);
    expect(doc.documentElement.dataset.theme).toBe("light");
    expect(resolvedEvents).toBe(0);

    mql.emit(true);
    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(resolvedEvents).toBe(1);
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it.each<ThemeMode>(["light", "dark"])(
    "ignores color-scheme changes in explicit %s mode",
    async (mode) => {
      const { doc, mql, store, windowTarget } = installBrowser(false);
      store.set("mdc-theme", mode);
      const { applyStoredTheme, startSystemThemeWatcher } = await loadTheme();

      applyStoredTheme();
      let resolvedEvents = 0;
      windowTarget.addEventListener("mdc-theme-resolved", () => resolvedEvents++);
      startSystemThemeWatcher();

      mql.emit(mode === "light");
      expect(doc.documentElement.dataset.theme).toBe(mode);
      expect(resolvedEvents).toBe(0);
    },
  );
});
