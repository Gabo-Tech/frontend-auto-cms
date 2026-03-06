import type { CmsContentFile } from "../shared/types.js";
import { CMS_PATCH_FILE } from "../shared/constants.js";
import type { RuntimeLocaleMap } from "./types.js";

const STORAGE_KEY = "frontend-auto-cms::content";
const LOCALES_KEY = "frontend-auto-cms::locales";

export function saveCachedContent(content: CmsContentFile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
}

export function loadLocales(): RuntimeLocaleMap {
  try {
    const raw = localStorage.getItem(LOCALES_KEY);
    return raw ? (JSON.parse(raw) as RuntimeLocaleMap) : {};
  } catch {
    return {};
  }
}

export function saveLocales(locales: RuntimeLocaleMap): void {
  localStorage.setItem(LOCALES_KEY, JSON.stringify(locales));
}

export async function loadRuntimeContent(): Promise<CmsContentFile | null> {
  try {
    const response = await fetch("/cms-content.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json()) as CmsContentFile;
    if (!raw || !Array.isArray(raw.nodes)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export async function loadRuntimeLocales(): Promise<RuntimeLocaleMap> {
  try {
    const response = await fetch("/cms-locales.json", { cache: "no-store" });
    if (!response.ok) {
      return {};
    }
    const raw = (await response.json()) as { locales?: RuntimeLocaleMap };
    const locales = raw?.locales;
    return locales && typeof locales === "object" ? locales : {};
  } catch {
    return {};
  }
}

export async function loadRuntimeRouteMap(): Promise<Record<string, string>> {
  try {
    const response = await fetch("/cms-route-map.json", { cache: "no-store" });
    if (!response.ok) {
      return {};
    }
    const raw = (await response.json()) as { routes?: Record<string, string> };
    const routes = raw?.routes;
    return routes && typeof routes === "object" ? routes : {};
  } catch {
    return {};
  }
}

export function downloadPatchFile(payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = CMS_PATCH_FILE;
  a.click();
  URL.revokeObjectURL(url);
}
