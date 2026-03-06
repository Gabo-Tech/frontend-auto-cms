import type { CmsContentFile, CmsNode, CmsPatchFile, CmsRuntimeSettingsFile } from "../shared/types.js";
import { saveCachedContent, loadLocales, saveLocales, loadRuntimeLocales, loadRuntimeContent, loadRuntimeRouteMap, downloadPatchFile } from "./store.js";
import { applyNodeToDom, scanDom } from "./dom-scan.js";
import { SUPPORTED_TRANSLATION_LANGUAGES, translateLanguage } from "./i18n.js";
import { loadHostingConfig, publishToHosting } from "./publish.js";

const AUTH_MODAL_ID = "facms-auth-modal";
const AUTH_MISSING_ID = "facms-auth-missing";
const TOKEN_MODAL_ID = "facms-token-modal";
const LANGUAGE_MODAL_ID = "facms-language-modal";
const THEME_STORAGE_KEY = "frontend-auto-cms::theme";
const MAIN_LANGUAGE_STORAGE_KEY = "frontend-auto-cms::main-language";
const LANGUAGE_LABELS_STORAGE_KEY = "frontend-auto-cms::language-labels";

interface DashboardState {
  content: CmsContentFile;
  locales: Record<string, Record<string, string>>;
  workingDocument: Document;
  baseTextByKey: Record<string, string>;
  activeLanguage: string;
  mainLanguage: string;
  languageLabels: Record<string, string>;
}

interface RuntimeSettings {
  dashboardPath: string;
  pages: string[];
  showFloatingButton: boolean;
  autoTranslateEnabled: boolean;
}

let isAuthenticated = false;
let runtimeAuthConfig: { algorithm: "sha256"; salt: string; passcodeHash: string } | null = null;
let runtimeAuthLoaded = false;
let runtimeSettingsCache: RuntimeSettings | null = null;
let dashboardTheme: "dark" | "light" = "dark";
let runtimeRouteFileMap: Record<string, string> = {};

function injectDashboardStyles(): void {
  if (document.getElementById("facms-dashboard-css")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "facms-dashboard-css";
  style.textContent = `
    #facms-app, #facms-app * { box-sizing: border-box; font-family: Inter, system-ui, sans-serif; }
    #facms-app {
      height: 100dvh;
      width: 100vw;
      display: grid;
      grid-template-columns: 1fr;
      background: #020617;
      color: #e2e8f0;
      overflow: hidden;
    }
    @media (min-width: 1024px) { #facms-app { grid-template-columns: 760px 1fr; } }
    #facms-app > div { min-height: 0; }

    #facms-app > div:first-child {
      border-right: 1px solid #1e293b;
      background: #0f172a;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }
    #facms-app > div:last-child { background: #020617; padding: 12px; }
    @media (min-width: 1024px) { #facms-app > div:last-child { padding: 20px; } }

    #facms-app h2 { margin: 0; font-size: 1.25rem; font-weight: 700; color: #f8fafc; }
    #facms-app p { margin: 0; color: #94a3b8; }
    #facms-app > div:first-child > div:last-child {
      display: grid;
      grid-template-columns: 220px 1fr;
      min-height: 0;
    }
    #facms-app aside {
      min-height: 0;
      overflow: auto;
    }
    #facms-route-editor {
      min-height: 0;
      overflow: auto;
      overscroll-behavior: contain;
    }
    #facms-route-editor > div { padding: 16px; min-height: 100%; }
    #facms-route-editor #facms-i18n-status { margin-top: 8px; font-size: 12px; color: #94a3b8; }
    #facms-i18n-feedback {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      min-height: 20px;
      margin-top: 8px;
    }
    #facms-translate-loader {
      display: none;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: #a5b4fc;
      white-space: nowrap;
    }
    #facms-translate-loader::before {
      content: "";
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 2px solid #818cf8;
      border-top-color: transparent;
      animation: facms-spin 0.8s linear infinite;
    }
    @keyframes facms-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    #facms-global-loader {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(2, 6, 23, 0.72);
      z-index: 2147483646;
      backdrop-filter: blur(2px);
    }
    #facms-global-loader-inner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #0f172a;
      border: 1px solid #334155;
      color: #e2e8f0;
      border-radius: 12px;
      padding: 10px 14px;
      box-shadow: 0 20px 45px rgba(2, 6, 23, 0.45);
      font-size: 13px;
      font-weight: 500;
    }
    #facms-global-loader-spinner {
      width: 15px;
      height: 15px;
      border-radius: 999px;
      border: 2px solid #818cf8;
      border-top-color: transparent;
      animation: facms-spin 0.8s linear infinite;
    }

    #facms-route-preview {
      width: 100%;
      height: 100%;
      border: 1px solid #1e293b;
      border-radius: 12px;
      background: #ffffff;
    }

    #facms-page-tabs { padding: 0 8px 12px; }
    #facms-page-tabs button {
      width: 100%;
      text-align: left;
      margin-bottom: 6px;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #e2e8f0;
      cursor: pointer;
    }

    #facms-route-editor > div > div:nth-child(2) {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 4px;
    }
    #facms-language-tabs { display: flex; flex-wrap: wrap; gap: 10px; }
    #facms-language-tabs > div {
      display: inline-flex;
      align-items: center;
      border: 1px solid #334155;
      border-radius: 10px;
      overflow: hidden;
      background: #1e293b;
    }
    #facms-language-tabs button, #facms-language-tabs span {
      border: 0;
      border-right: 1px solid #334155;
      padding: 7px 11px;
      font-size: 12px;
      background: #1e293b;
      color: #e2e8f0;
      line-height: 1.1;
    }
    #facms-language-tabs [data-remove-lang] { border-right: 0; }

    #facms-add-language, #facms-save {
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
    }
    #facms-add-language {
      border: 1px solid #6366f1;
      background: #1e1b4b;
      color: #c7d2fe;
    }
    #facms-add-language:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    #facms-save {
      border: 1px solid #059669;
      background: #059669;
      color: #ffffff;
      font-weight: 600;
    }

    #facms-route-editor details {
      border: 1px solid #334155;
      border-radius: 12px;
      background: #0f172a;
      box-shadow: 0 6px 20px rgba(2, 6, 23, 0.35);
      margin-bottom: 10px;
    }
    #facms-route-editor summary {
      list-style: none;
      cursor: pointer;
      padding: 12px;
      border-radius: 10px;
      background: #1e293b;
      border: 1px solid #334155;
      margin: 8px;
      color: #cbd5e1;
    }
    #facms-route-editor details > div { padding: 4px 10px 10px; }

    #facms-route-editor input,
    #facms-route-editor textarea,
    #facms-route-editor select {
      width: 100%;
      border: 1px solid #334155;
      background: #0b1220;
      color: #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      outline: none;
    }
    #facms-route-editor textarea { min-height: 96px; resize: vertical; }
    #facms-route-editor input:focus,
    #facms-route-editor textarea:focus,
    #facms-route-editor select:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
    }

    #facms-route-editor .text-slate-500,
    #facms-route-editor .text-slate-400,
    #facms-route-editor .text-slate-700,
    #facms-route-editor .text-slate-300 { color: #94a3b8; }
    #facms-route-editor .text-indigo-600,
    #facms-route-editor .text-indigo-400 { color: #818cf8; }
    #facms-route-editor .truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #facms-app .bg-indigo-600, #facms-app .bg-indigo-700, #facms-app .bg-indigo-800 {
      background: #4f46e5 !important;
      color: #ffffff !important;
    }
    #facms-app .bg-emerald-600, #facms-app .hover\\:bg-emerald-500:hover {
      background: #059669 !important;
      color: #ffffff !important;
    }
  `;
  document.head.appendChild(style);
}

function applyTheme(theme: "dark" | "light"): void {
  dashboardTheme = theme;
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.body.classList.toggle("dark", isDark);
  document.documentElement.style.background = isDark ? "#020617" : "#f1f5f9";
  document.body.style.background = isDark ? "#020617" : "#f1f5f9";
  document.documentElement.setAttribute("data-facms-theme", theme);
  const app = document.getElementById("facms-app");
  app?.classList.toggle("dark", isDark);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const toggle = document.getElementById("facms-theme-toggle");
  if (toggle) {
    toggle.textContent = theme === "dark" ? "Switch to light" : "Switch to dark";
  }
}

function initTheme(): void {
  dashboardTheme = "dark";
  applyTheme("dark");
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

async function loadSettings(): Promise<RuntimeSettings> {
  if (runtimeSettingsCache) {
    return runtimeSettingsCache;
  }
  try {
    const response = await fetch("/cms-settings.json", { cache: "no-store" });
    if (response.ok) {
      const raw = (await response.json()) as CmsRuntimeSettingsFile;
      runtimeSettingsCache = {
        dashboardPath: raw.dashboardPath || "/dashboard",
        pages: (raw.pages?.length ? raw.pages : ["/"]).map((p) => normalizePagePath(p)),
        showFloatingButton: raw.showFloatingButton ?? false,
        autoTranslateEnabled: raw.autoTranslateEnabled ?? true
      };
      return runtimeSettingsCache;
    }
  } catch {
  }
  runtimeSettingsCache = { dashboardPath: "/dashboard", pages: ["/"], showFloatingButton: false, autoTranslateEnabled: true };
  return runtimeSettingsCache;
}

async function loadRuntimeAuthConfig(): Promise<void> {
  if (runtimeAuthLoaded) return;
  runtimeAuthLoaded = true;
  try {
    const response = await fetch("/cms-runtime-auth.json", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { algorithm?: string; salt?: string; passcodeHash?: string };
    if (data.algorithm === "sha256" && typeof data.salt === "string" && typeof data.passcodeHash === "string") {
      runtimeAuthConfig = { algorithm: "sha256", salt: data.salt, passcodeHash: data.passcodeHash };
    }
  } catch {
    runtimeAuthConfig = null;
  }
}

async function verifyPasscode(input: string): Promise<boolean> {
  const normalized = input.trim();
  if (!normalized) return false;
  await loadRuntimeAuthConfig();
  if (!runtimeAuthConfig) return false;
  const actual = await sha256Hex(`${runtimeAuthConfig.salt}:${normalized}`);
  return actual === runtimeAuthConfig.passcodeHash;
}

function showAuthMissingBlocker(): void {
  let blocker = document.getElementById(AUTH_MISSING_ID);
  if (blocker) return;
  blocker = document.createElement("div");
  blocker.id = AUTH_MISSING_ID;
  blocker.style.position = "fixed";
  blocker.style.inset = "0";
  blocker.style.zIndex = "2147483647";
  blocker.style.background = "rgba(2, 6, 23, 0.88)";
  blocker.style.display = "grid";
  blocker.style.placeItems = "center";
  blocker.innerHTML = `
    <div style="width:min(560px,92vw);background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:16px;padding:16px;box-shadow:0 20px 55px rgba(2,6,23,.45);font-family:Inter,system-ui,sans-serif;">
      <h3 style="margin:0 0 8px 0;font-size:20px;line-height:1.2;font-weight:700;">CMS locked: runtime auth missing</h3>
      <p style="margin:0 0 10px 0;font-size:13px;color:#94a3b8;">The dashboard is blocked until runtime auth is generated.</p>
      <p style="margin:0;font-size:12px;color:#cbd5e1;">Run <code style="color:#e2e8f0;">frontend-auto-cms setup</code> in this project to create <code style="color:#e2e8f0;">public/cms-runtime-auth.json</code>, then refresh.</p>
    </div>
  `;
  document.body.appendChild(blocker);
}

function clearAuthMissingBlocker(): void {
  document.getElementById(AUTH_MISSING_ID)?.remove();
}

async function ensureRuntimeAuthReady(): Promise<boolean> {
  await loadRuntimeAuthConfig();
  if (!runtimeAuthConfig) {
    showAuthMissingBlocker();
    return false;
  }
  clearAuthMissingBlocker();
  return true;
}

function openPasscodeModal(onSuccess: () => void): void {
  const existing = document.getElementById(AUTH_MODAL_ID);
  if (existing) {
    existing.style.display = "grid";
    return;
  }
  const modal = document.createElement("div");
  modal.id = AUTH_MODAL_ID;
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.background = "rgba(2, 6, 23, 0.45)";
  modal.style.display = "grid";
  modal.style.placeItems = "center";
  modal.innerHTML = `
    <div style="width: min(420px, 92vw); background: ${dashboardTheme === "dark" ? "#0f172a" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#0f172a"}; border: 1px solid ${dashboardTheme === "dark" ? "#334155" : "#e2e8f0"}; border-radius: 16px; padding: 16px; box-shadow: 0 20px 55px rgba(2,6,23,0.45); font-family: Inter, system-ui, sans-serif;">
      <h3 style="margin: 0 0 6px 0; font-size: 20px; line-height: 1.2; font-weight: 700;">Unlock CMS</h3>
      <p style="margin: 0 0 12px 0; font-size: 12px; color: ${dashboardTheme === "dark" ? "#94a3b8" : "#475569"};">Enter your passcode to edit content.</p>
      <input id="facms-passcode-input" type="password" style="width: 100%; border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#f1f5f9" : "#0f172a"}; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box;" placeholder="Enter passcode" />
      <p id="facms-passcode-error" style="display:none; margin: 8px 0 0 0; font-size: 12px; color: #ef4444;">Incorrect passcode.</p>
      <div style="margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end;">
        <button id="facms-passcode-cancel" style="border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#f1f5f9"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#334155"}; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Cancel</button>
        <button id="facms-passcode-submit" style="border: 1px solid #4f46e5; background: #4f46e5; color: white; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Open CMS</button>
      </div>
    </div>
  `;
  const input = modal.querySelector<HTMLInputElement>("#facms-passcode-input");
  const error = modal.querySelector<HTMLParagraphElement>("#facms-passcode-error");
  const close = () => (modal.style.display = "none");
  const submit = async () => {
    await loadRuntimeAuthConfig();
    if (!runtimeAuthConfig) {
      if (error) {
        error.textContent = "CMS auth is not configured. Run setup to generate runtime auth files.";
        error.style.display = "block";
      }
      return;
    }
    if (!(await verifyPasscode(input?.value ?? ""))) {
      if (error) {
        error.textContent = "Incorrect passcode.";
        error.style.display = "block";
      }
      return;
    }
    if (error) {
      error.style.display = "none";
    }
    isAuthenticated = true;
    close();
    onSuccess();
  };
  modal.querySelector("#facms-passcode-cancel")?.addEventListener("click", close);
  modal.querySelector("#facms-passcode-submit")?.addEventListener("click", submit);
  input?.addEventListener("keydown", (ev) => ev.key === "Enter" && void submit());
  document.body.appendChild(modal);
  input?.focus();
}

function openTokenModal(provider: "github" | "gitlab", onSubmit: (token: string) => void): void {
  const existing = document.getElementById(TOKEN_MODAL_ID);
  if (existing) {
    existing.remove();
  }
  const modal = document.createElement("div");
  modal.id = TOKEN_MODAL_ID;
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.background = "rgba(2, 6, 23, 0.45)";
  modal.style.display = "grid";
  modal.style.placeItems = "center";
  modal.innerHTML = `
    <div style="width: min(520px, 92vw); background: ${dashboardTheme === "dark" ? "#0f172a" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#0f172a"}; border: 1px solid ${dashboardTheme === "dark" ? "#334155" : "#e2e8f0"}; border-radius: 16px; padding: 16px; box-shadow: 0 20px 55px rgba(2,6,23,0.45); font-family: Inter, system-ui, sans-serif;">
      <h3 style="margin: 0 0 6px 0; font-size: 20px; line-height: 1.2; font-weight: 700;">Publish token required</h3>
      <p style="margin: 0 0 12px 0; font-size: 12px; color: ${dashboardTheme === "dark" ? "#94a3b8" : "#475569"};">Enter your ${provider} token for this publish only. It is not stored.</p>
      <input id="facms-token-input" type="password" style="width: 100%; border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#f1f5f9" : "#0f172a"}; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box;" placeholder="Token" />
      <p id="facms-token-error" style="display:none; margin: 8px 0 0 0; font-size: 12px; color: #ef4444;">Token is required.</p>
      <div style="margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end;">
        <button id="facms-token-cancel" style="border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#f1f5f9"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#334155"}; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Cancel</button>
        <button id="facms-token-submit" style="border: 1px solid #4f46e5; background: #4f46e5; color: white; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Publish</button>
      </div>
    </div>
  `;
  const input = modal.querySelector<HTMLInputElement>("#facms-token-input");
  const error = modal.querySelector<HTMLParagraphElement>("#facms-token-error");
  const close = () => (modal.style.display = "none");
  const submit = () => {
    const token = (input?.value ?? "").trim();
    if (!token) {
      if (error) {
        error.style.display = "block";
      }
      return;
    }
    if (error) {
      error.style.display = "none";
    }
    close();
    onSubmit(token);
  };
  modal.querySelector("#facms-token-cancel")?.addEventListener("click", close);
  modal.querySelector("#facms-token-submit")?.addEventListener("click", submit);
  input?.addEventListener("keydown", (ev) => ev.key === "Enter" && submit());
  document.body.appendChild(modal);
  input?.focus();
}

function openLanguageModal(
  existingLangs: string[],
  allowAutoTranslate: boolean,
  onSubmit: (lang: string, mode: "auto" | "manual") => void
): void {
  const existing = document.getElementById(LANGUAGE_MODAL_ID);
  if (existing) {
    existing.remove();
  }
  const modal = document.createElement("div");
  modal.id = LANGUAGE_MODAL_ID;
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "2147483647";
  modal.style.background = "rgba(2, 6, 23, 0.45)";
  modal.style.display = "grid";
  modal.style.placeItems = "center";
  modal.innerHTML = `
    <div style="width: min(520px, 92vw); background: ${dashboardTheme === "dark" ? "#0f172a" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#0f172a"}; border: 1px solid ${dashboardTheme === "dark" ? "#334155" : "#e2e8f0"}; border-radius: 16px; padding: 16px; box-shadow: 0 20px 55px rgba(2,6,23,0.45); font-family: Inter, system-ui, sans-serif;">
      <h3 style="margin: 0 0 6px 0; font-size: 20px; line-height: 1.2; font-weight: 700;">Add translation</h3>
      <p style="margin: 0 0 8px 0; font-size: 12px; color: ${dashboardTheme === "dark" ? "#94a3b8" : "#475569"};">Pick a supported language or define a custom one for manual translation.</p>
      <select id="facms-language-select" style="width: 100%; border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#f1f5f9" : "#0f172a"}; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box; margin-bottom: 8px;">
        <option value="">Select supported language</option>
        ${SUPPORTED_TRANSLATION_LANGUAGES.filter((entry) => !existingLangs.includes(entry.code))
          .map((entry) => `<option value="${entry.code}">${entry.label} (${entry.code})</option>`)
          .join("")}
        <option value="__custom__">Custom language (manual)</option>
      </select>
      <input id="facms-language-name" type="text" placeholder="Custom language name (e.g. Klingon)" style="width: 100%; border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#f1f5f9" : "#0f172a"}; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box; margin-bottom: 8px; display:none;" />
      <input id="facms-language-input" type="text" placeholder="Custom language code (e.g. tlh)" style="width: 100%; border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#ffffff"}; color: ${dashboardTheme === "dark" ? "#f1f5f9" : "#0f172a"}; border-radius: 10px; padding: 10px 12px; font-size: 14px; box-sizing: border-box; display:none;" />
      <p id="facms-language-error" style="display:none; margin: 8px 0 0 0; font-size: 12px; color: #ef4444;">Enter a valid language code.</p>
      <div style="margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
        <button id="facms-language-cancel" style="border: 1px solid ${dashboardTheme === "dark" ? "#475569" : "#cbd5e1"}; background: ${dashboardTheme === "dark" ? "#1e293b" : "#f1f5f9"}; color: ${dashboardTheme === "dark" ? "#e2e8f0" : "#334155"}; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Cancel</button>
        <button id="facms-language-manual" style="border: 1px solid #334155; background: #334155; color: white; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Add manual</button>
        ${
          allowAutoTranslate
            ? '<button id="facms-language-autofill" style="border: 1px solid #4f46e5; background: #4f46e5; color: white; border-radius: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer;">Add & Auto-fill</button>'
            : ""
        }
      </div>
    </div>
  `;

  const close = () => (modal.style.display = "none");
  modal.querySelector("#facms-language-cancel")?.addEventListener("click", close);
  const select = modal.querySelector<HTMLSelectElement>("#facms-language-select");
  const customCode = modal.querySelector<HTMLInputElement>("#facms-language-input");
  const customName = modal.querySelector<HTMLInputElement>("#facms-language-name");
  select?.addEventListener("change", () => {
    const custom = select.value === "__custom__";
    if (customCode) customCode.style.display = custom ? "block" : "none";
    if (customName) customName.style.display = custom ? "block" : "none";
  });
  const submit = (mode: "auto" | "manual"): void => {
    const error = modal.querySelector<HTMLParagraphElement>("#facms-language-error");
    let lang = "";
    const selected = select?.value ?? "";
    let label = "";
    if (selected && selected !== "__custom__") {
      lang = normalizeLanguageTag(selected);
      label = defaultLanguageLabel(lang);
    } else {
      lang = normalizeLanguageTag(customCode?.value ?? "");
      label = (customName?.value ?? "").trim();
    }
    if (!lang || !/^[a-z]{2,3}([_-][a-z0-9]{2,8})?$|^[a-z]{3}_[A-Za-z]+$/i.test(lang)) {
      if (error) {
        error.textContent = "Enter a valid language code.";
        error.style.display = "block";
      }
      return;
    }
    if (!label) {
      label = defaultLanguageLabel(lang);
    }
    if (existingLangs.includes(lang)) {
      if (error) {
        error.textContent = `Language "${lang}" already exists.`;
        error.style.display = "block";
      }
      return;
    }
    if (error) {
      error.style.display = "none";
    }
    close();
    onSubmit(`${lang}::${label}`, mode);
  };
  modal.querySelector("#facms-language-manual")?.addEventListener("click", () => submit("manual"));
  if (allowAutoTranslate) {
    modal.querySelector("#facms-language-autofill")?.addEventListener("click", () => submit("auto"));
  }
  document.body.appendChild(modal);
}

function logI18n(message: string, payload?: unknown): void {
  if (payload === undefined) {
    console.info(`[frontend-auto-cms:dashboard] ${message}`);
    return;
  }
  console.info(`[frontend-auto-cms:dashboard] ${message}`, payload);
}

function normalizeLanguageTag(input: string): string {
  return input.trim().toLowerCase();
}

function normalizePagePath(input: string): string {
  const clean = input.trim() || "/";
  if (clean === "/") {
    return "/";
  }
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  return withSlash.toLowerCase();
}

function defaultLanguageLabel(code: string): string {
  const normalized = normalizeLanguageTag(code);
  const preset = SUPPORTED_TRANSLATION_LANGUAGES.find((entry) => entry.code === normalized);
  if (preset) {
    return preset.label;
  }
  return normalized.toUpperCase();
}

function loadLanguageLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LANGUAGE_LABELS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLanguageLabels(labels: Record<string, string>): void {
  localStorage.setItem(LANGUAGE_LABELS_STORAGE_KEY, JSON.stringify(labels));
}

function loadMainLanguage(locales: Record<string, Record<string, string>>): string {
  const stored = localStorage.getItem(MAIN_LANGUAGE_STORAGE_KEY);
  if (stored && locales[stored]) {
    return stored;
  }
  if (locales.en) {
    return "en";
  }
  const first = Object.keys(locales)[0];
  return first ?? "en";
}

function saveMainLanguage(lang: string): void {
  localStorage.setItem(MAIN_LANGUAGE_STORAGE_KEY, lang);
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[ch] as string);
}

function compactPreview(value: string, max = 72): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max)}...`;
}

function nodePreview(node: CmsNode): string {
  if (node.type === "section") {
    return compactPreview((node.sectionItems ?? []).join(" | "));
  }
  if (node.type === "property") {
    return compactPreview(JSON.stringify(node.attrs ?? {}));
  }
  return compactPreview(node.value);
}

interface NodeGroup {
  key: string;
  selector: string;
  items: Array<{ node: CmsNode; index: number }>;
}

function buildNodeGroups(nodes: CmsNode[]): NodeGroup[] {
  const groups: NodeGroup[] = [];
  nodes.forEach((node, index) => {
    const selector = (node.selector ?? "").trim();
    const last = groups[groups.length - 1];
    const canMerge = Boolean(last && selector && last.selector === selector);
    if (canMerge && last) {
      last.items.push({ node, index });
      return;
    }
    groups.push({
      key: selector || `group_${index}`,
      selector,
      items: [{ node, index }]
    });
  });
  return groups;
}

function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (input && typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([k, v]) => [k, normalize(v)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

async function sha256HexString(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveOperationFilePath(file: string): string {
  const raw = (file ?? "").trim();
  if (!raw) {
    return raw;
  }
  if (raw.startsWith("/")) {
    const route = normalizePagePath(raw);
    return runtimeRouteFileMap[route] ?? raw;
  }
  return raw.replace(/^\.?\//, "");
}

async function buildPatch(content: CmsContentFile, locales: Record<string, Record<string, string>>, baseTextByKey: Record<string, string>): Promise<CmsPatchFile> {
  const unresolvedRoutes = new Set<string>();
  const operations = content.nodes.flatMap((node) =>
    node.sourceRefs.map((ref) => ({
      file: (() => {
        const source = (ref.file ?? "").trim();
        if (source.startsWith("/")) {
          const route = normalizePagePath(source);
          const mapped = runtimeRouteFileMap[route];
          if (!mapped) {
            unresolvedRoutes.add(route);
            return source;
          }
        }
        return resolveOperationFilePath(source);
      })(),
      find: ref.original,
      replace:
        node.type === "property"
          ? JSON.stringify(node.attrs ?? {})
          : node.type === "section"
            ? (node.sectionItems ?? []).join(" ")
            : node.type === "text"
              ? node.value
              : node.value,
      occurrence: ref.occurrence ?? 1
    }))
  );
  if (unresolvedRoutes.size) {
    throw new Error(
      `Missing route mappings for: ${Array.from(unresolvedRoutes).join(", ")}. Run setup again and commit public/cms-route-map.json.`
    );
  }
  const unsignedPatch: CmsPatchFile = {
    generatedAt: new Date().toISOString(),
    content: { ...content, updatedAt: new Date().toISOString() },
    operations,
    locales
  };
  const digest = await sha256HexString(stableStringify(unsignedPatch));
  return {
    ...unsignedPatch,
    integrity: {
      algorithm: "sha256",
      value: digest
    }
  };
}

function buildNodeEditor(node: CmsNode, index: number): string {
  const title = `${node.type.toUpperCase()} • ${escapeHtml(node.label || node.selector || "")}`;
  const header = `<div class="text-xs text-slate-500 dark:text-slate-400 mb-2">#${index + 1} ${title}</div>`;
  if (node.type === "text") {
    return `<div class="rounded-lg p-2 bg-slate-50/60 dark:bg-slate-900/40">${header}<textarea data-cms-id="${node.id}" data-cms-field="value" class="w-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-sm h-24 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">${escapeHtml(node.value)}</textarea></div>`;
  }
  if (node.type === "image" || node.type === "video") {
    return `<div class="rounded-lg p-2 bg-slate-50/60 dark:bg-slate-900/40">${header}<label class="text-xs text-slate-500 dark:text-slate-400">Source URL</label><input data-cms-id="${node.id}" data-cms-field="value" value="${escapeHtml(node.value)}" class="w-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" /><label class="text-xs text-slate-500 dark:text-slate-400">Alt text</label><input data-cms-id="${node.id}" data-cms-field="alt" value="${escapeHtml(node.attrs?.alt ?? "")}" class="w-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" /></div>`;
  }
  if (node.type === "section") {
    const items = (node.sectionItems ?? []).join("\n");
    return `<div class="rounded-lg p-2 bg-slate-50/60 dark:bg-slate-900/40">${header}<textarea data-cms-id="${node.id}" data-cms-field="sectionItems" class="w-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-sm h-28 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">${escapeHtml(items)}</textarea></div>`;
  }
  return `<div class="rounded-lg p-2 bg-slate-50/60 dark:bg-slate-900/40">${header}<textarea data-cms-id="${node.id}" data-cms-field="attrs" class="w-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs h-28 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">${escapeHtml(JSON.stringify(node.attrs ?? {}, null, 2))}</textarea></div>`;
}

function applyLanguage(
  content: CmsContentFile,
  dict: Record<string, string>,
  targetDocument: Document,
  baseTextByKey: Record<string, string>
): void {
  content.nodes.forEach((node) => {
    if (node.type === "text") {
      node.value = dict[node.key] ?? baseTextByKey[node.key] ?? node.value;
      applyNodeToDom(node, targetDocument);
    }
  });
}

function switchLanguage(state: DashboardState, lang: string): void {
  state.activeLanguage = lang;
  const dict = state.locales[lang] ?? state.locales[state.mainLanguage] ?? state.baseTextByKey;
  applyLanguage(state.content, dict, state.workingDocument, state.baseTextByKey);
}

function syncLanguageTabs(root: HTMLElement, state: DashboardState): void {
  const tabs = root.querySelector("#facms-language-tabs");
  if (!tabs) {
    return;
  }
  const languages = Object.keys(state.locales);
  tabs.innerHTML = languages
    .map((lang) => {
      const active = lang === state.activeLanguage;
      const main = lang === state.mainLanguage;
      const label = state.languageLabels[lang] ?? defaultLanguageLabel(lang);
      return `<div class="inline-flex items-center rounded-lg overflow-hidden border ${
        active ? "border-indigo-500" : "border-slate-200 dark:border-slate-700"
      }">
        <button data-lang="${lang}" class="px-2.5 py-1.5 text-xs ${
          active
            ? "bg-indigo-600 text-white"
            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
        }">${escapeHtml(label)}</button>
        ${
          main
            ? `<span class="px-2 py-1.5 text-[10px] font-semibold ${
                active ? "bg-indigo-700 text-indigo-100" : "bg-emerald-600 text-white"
              }">MAIN</span>`
            : `<button data-main-lang="${lang}" title="Set as main language" class="px-2 py-1.5 text-xs ${
                active
                  ? "bg-indigo-700 text-indigo-100 hover:bg-indigo-800"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }">★</button>`
        }
        <button data-remove-lang="${lang}" title="Remove language" class="px-2 py-1.5 text-xs ${
          active
            ? "bg-indigo-700 text-indigo-100 hover:bg-indigo-800"
            : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600"
        }">×</button>
      </div>`;
    })
    .join("");
  tabs.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      if (!lang) {
        return;
      }
      switchLanguage(state, lang);
      renderEditor(root, state);
    });
  });
  tabs.querySelectorAll<HTMLButtonElement>("[data-main-lang]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const lang = btn.dataset.mainLang;
      if (!lang || !state.locales[lang]) {
        return;
      }
      state.mainLanguage = lang;
      saveMainLanguage(lang);
      state.baseTextByKey = { ...state.locales[lang] };
      renderEditor(root, state);
    });
  });
  tabs.querySelectorAll<HTMLButtonElement>("[data-remove-lang]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const lang = btn.dataset.removeLang;
      if (!lang) {
        return;
      }
      if (Object.keys(state.locales).length <= 1) {
        alert("You must keep at least one language.");
        return;
      }
      delete state.locales[lang];
      delete state.languageLabels[lang];
      saveLanguageLabels(state.languageLabels);
      saveLocales(state.locales);
      if (state.mainLanguage === lang) {
        state.mainLanguage = loadMainLanguage(state.locales);
        saveMainLanguage(state.mainLanguage);
        state.baseTextByKey = { ...(state.locales[state.mainLanguage] ?? {}) };
      }
      if (state.activeLanguage === lang) {
        state.activeLanguage = pickPreferredLanguage(state.locales, state.mainLanguage);
      }
      applyStateLanguage(state);
      renderEditor(root, state);
    });
  });
}

function bindInputs(root: HTMLElement, state: DashboardState): void {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-cms-id]").forEach((el) => {
    const id = el.dataset.cmsId;
    const field = el.dataset.cmsField;
    if (!id || !field) return;
    el.addEventListener("input", () => {
      const node = state.content.nodes.find((n) => n.id === id);
      if (!node) return;
      if (field === "value") {
        node.value = el.value;
        if (node.type === "text") {
          if (state.activeLanguage === state.mainLanguage) {
            state.baseTextByKey[node.key] = el.value;
            state.locales[state.mainLanguage] = { ...(state.locales[state.mainLanguage] ?? {}), [node.key]: el.value };
          } else {
            state.locales[state.activeLanguage] = {
              ...(state.locales[state.activeLanguage] ?? {}),
              [node.key]: el.value
            };
          }
          saveLocales(state.locales);
        }
      }
      else if (field === "alt") node.attrs = { ...(node.attrs ?? {}), alt: el.value };
      else if (field === "sectionItems") node.sectionItems = el.value.split("\n").map((v) => v.trim()).filter(Boolean);
      else if (field === "attrs") {
        try {
          node.attrs = JSON.parse(el.value) as Record<string, string>;
        } catch {
          return;
        }
      }
      applyNodeToDom(node, state.workingDocument);
      saveCachedContent(state.content);
    });
  });
}

function setTranslationUiState(root: HTMLElement, message: string, loading: boolean): void {
  const status = root.querySelector("#facms-i18n-status") as HTMLParagraphElement | null;
  const loader = root.querySelector("#facms-translate-loader") as HTMLDivElement | null;
  const addButton = root.querySelector("#facms-add-language") as HTMLButtonElement | null;
  setGlobalLoaderState(loading, message);
  if (status) {
    status.textContent = message;
  }
  if (loader) {
    loader.style.display = loading ? "inline-flex" : "none";
  }
  if (addButton) {
    addButton.disabled = loading;
  }
}

function setGlobalLoaderState(loading: boolean, message: string): void {
  const globalLoader = document.getElementById("facms-global-loader") as HTMLDivElement | null;
  const globalLoaderLabel = document.getElementById("facms-global-loader-label") as HTMLDivElement | null;
  if (globalLoader) {
    globalLoader.style.display = loading ? "flex" : "none";
  }
  if (globalLoaderLabel) {
    globalLoaderLabel.textContent = loading ? message : "Loading";
  }
}

function renderEditor(root: HTMLElement, state: DashboardState): void {
  const groups = buildNodeGroups(state.content.nodes);
  const rows = groups.length
    ? groups
    .map((group) => {
      const first = group.items[0];
      const last = group.items[group.items.length - 1];
      const range = first.index === last.index ? `#${first.index + 1}` : `#${first.index + 1} - #${last.index + 1}`;
      const preview = group.items.map((entry) => nodePreview(entry.node)).filter(Boolean).join(" • ");
      const summaryTitle =
        group.items.length > 1
          ? `${range} ${escapeHtml(group.selector || "Grouped fields")} (${group.items.length} fields)`
          : `${range} ${escapeHtml(first.node.type.toUpperCase())} • ${escapeHtml(first.node.label || first.node.selector || "")}`;
      const body = group.items.map((entry) => buildNodeEditor(entry.node, entry.index)).join("");
      return `
        <details class="rounded-xl p-2 border border-slate-200 dark:border-transparent bg-white dark:bg-slate-900/60 shadow-sm">
          <summary class="list-none cursor-pointer flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-xs text-slate-500 dark:text-slate-400">${summaryTitle}</div>
              <div class="text-sm text-slate-700 dark:text-slate-300 truncate">${escapeHtml(compactPreview(preview || "No preview"))}</div>
            </div>
            <span class="text-xs text-indigo-600 dark:text-indigo-400">Expand</span>
          </summary>
          <div class="pt-3 px-2 pb-2 space-y-2">${body}</div>
        </details>
      `;
    })
    .join("")
    : `<div class="rounded-xl p-3 border border-slate-700 bg-slate-900/70 text-slate-300 text-sm">
         No editable elements detected yet on this route. This page may still be rendering client-side content. Wait a moment, then switch routes and come back.
       </div>`;
  root.innerHTML = `
    <div class="p-4 space-y-3">
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-2">All editable elements are shown in page order.</p>
      <div class="flex items-center flex-wrap gap-2">
        <div id="facms-language-tabs" class="flex flex-wrap gap-2"></div>
        <button id="facms-add-language" class="px-2.5 py-1.5 rounded-lg text-xs border border-indigo-500 text-indigo-600 dark:text-indigo-300 dark:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">+ Add translation</button>
      </div>
      <div class="space-y-3">${rows}</div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button id="facms-save" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-500 shadow">Save + Publish</button>
      </div>
      <div id="facms-i18n-feedback">
        <div id="facms-translate-loader">Translating</div>
        <p id="facms-i18n-status" class="text-xs text-slate-500 dark:text-slate-400"></p>
      </div>
    </div>
  `;
  syncLanguageTabs(root, state);
  root.querySelector("#facms-save")?.addEventListener("click", async () => {
    let patch: CmsPatchFile;
    let hostingConfig: Awaited<ReturnType<typeof loadHostingConfig>>;
    try {
      patch = await buildPatch(state.content, state.locales, state.baseTextByKey);
      hostingConfig = await loadHostingConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Could not prepare publish payload: ${message}`);
      return;
    }
    if (!hostingConfig || hostingConfig.provider === "none") {
      downloadPatchFile(patch);
      alert("Patch downloaded. Configure hosting in setup for one-click publish.");
      return;
    }
    const provider = hostingConfig.provider;
    openTokenModal(provider, async (token) => {
      let published = false;
      let publishError = "Publishing failed. Please verify token permissions and repository settings.";
      try {
        published = await publishToHosting(patch, token, hostingConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message) {
          publishError = `Publishing failed: ${message}`;
        }
        published = false;
      }
      if (!published) {
        alert(publishError);
        return;
      }
      alert("Changes published successfully.");
    });
  });
  root.querySelector("#facms-add-language")?.addEventListener("click", () => {
    openLanguageModal(Object.keys(state.locales), runtimeSettingsCache?.autoTranslateEnabled ?? true, async (payload, mode) => {
      const [langRaw, labelRaw] = payload.split("::");
      const lang = normalizeLanguageTag(langRaw ?? "");
      const label = (labelRaw ?? "").trim() || defaultLanguageLabel(lang);
      if (!lang) {
        return;
      }
      const started = performance.now();
      const sourceDict = state.locales[state.mainLanguage] ?? state.baseTextByKey;
      const seededDict = { ...sourceDict };
      logI18n("Add language requested", {
        lang,
        mode,
        sourceKeys: Object.keys(sourceDict).length,
        browserLanguage: navigator.language,
        browserLanguages: navigator.languages
      });
      state.locales[lang] = seededDict;
      state.languageLabels[lang] = label;
      saveLanguageLabels(state.languageLabels);
      state.activeLanguage = lang;
      saveLocales(state.locales);
      applyLanguage(state.content, state.locales[lang], state.workingDocument, state.baseTextByKey);
      renderEditor(root, state);
      logI18n("Manual language tab created", { lang });
      setTranslationUiState(root, `Added ${label} tab prefilled with source text for manual translation.`, false);
      if (mode !== "auto" || !(runtimeSettingsCache?.autoTranslateEnabled ?? true)) {
        if (mode === "auto" && !(runtimeSettingsCache?.autoTranslateEnabled ?? true)) {
          setTranslationUiState(root, `Privacy mode is on. Added ${label} tab for manual translation only.`, false);
        }
        return;
      }
      try {
        const total = Object.keys(sourceDict).length;
        setTranslationUiState(root, `Auto-filling ${label} translation... (0/${total})`, true);
        const translated = await translateLanguage(sourceDict, lang, state.mainLanguage, (done, all) => {
          setTranslationUiState(root, `Auto-filling ${label} translation... (${done}/${all})`, true);
        });
        state.locales[lang] = translated;
        saveLocales(state.locales);
        state.activeLanguage = lang;
        applyLanguage(state.content, translated, state.workingDocument, state.baseTextByKey);
        renderEditor(root, state);
        logI18n("Automatic translation succeeded", {
          lang,
          translatedKeys: Object.keys(translated).length,
          ms: Math.round(performance.now() - started)
        });
        setTranslationUiState(root, `Added ${label} with auto-filled translation. Review and edit as needed.`, false);
      } catch (error) {
        console.error("[frontend-auto-cms:dashboard] Automatic translation failed", {
          lang,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          ms: Math.round(performance.now() - started)
        });
        setTranslationUiState(root, `Auto-fill failed. ${label} stays prefilled with source text for manual editing.`, false);
      }
    });
  });
  bindInputs(root, state);
}

function pickPreferredLanguage(locales: Record<string, Record<string, string>>, preferredMain?: string): string {
  const available = Object.keys(locales);
  const main = preferredMain && locales[preferredMain] ? preferredMain : loadMainLanguage(locales);
  const candidates = [...(navigator.languages ?? []), navigator.language].map((lang) => lang.toLowerCase().split("-")[0]);
  for (const candidate of candidates) {
    if (available.includes(candidate)) {
      return candidate;
    }
  }
  return available.includes(main) ? main : available[0] ?? "en";
}

function applyStateLanguage(state: DashboardState): void {
  const dict = state.locales[state.activeLanguage] ?? state.locales.en ?? state.baseTextByKey;
  applyLanguage(state.content, dict, state.workingDocument, state.baseTextByKey);
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function scanDomWithRetries(targetDocument: Document, pagePath: string): Promise<CmsContentFile> {
  const backoff = [0, 120, 280, 600, 1100, 1800, 2600];
  let latest = scanDom(targetDocument, pagePath);
  if (latest.nodes.length > 0) {
    return latest;
  }
  for (const ms of backoff.slice(1)) {
    await waitFor(ms);
    latest = scanDom(targetDocument, pagePath);
    if (latest.nodes.length > 0) {
      return latest;
    }
  }
  return latest;
}

function makeInitialState(content: CmsContentFile, workingDocument: Document, seededLocales: Record<string, Record<string, string>>): DashboardState {
  const persistedLocales = loadLocales();
  const existingLocales: Record<string, Record<string, string>> = {
    ...seededLocales,
    ...persistedLocales
  };
  const languageLabels = loadLanguageLabels();
  const baseTextByKey = Object.fromEntries(content.nodes.filter((n) => n.type === "text").map((n) => [n.key, n.value]));
  const mainLanguage = loadMainLanguage(existingLocales);
  const locales: Record<string, Record<string, string>> = {
    ...existingLocales,
    [mainLanguage]: { ...(existingLocales[mainLanguage] ?? {}), ...baseTextByKey }
  };
  if (!locales.en && mainLanguage === "en") {
    locales.en = Object.assign({}, locales.en ?? {}, baseTextByKey);
  }
  const activeLanguage = pickPreferredLanguage(locales, mainLanguage);
  const hydratedLabels = { ...languageLabels };
  Object.keys(locales).forEach((lang) => {
    if (!hydratedLabels[lang]) {
      hydratedLabels[lang] = defaultLanguageLabel(lang);
    }
  });
  saveLanguageLabels(hydratedLabels);
  return {
    content,
    locales,
    workingDocument,
    baseTextByKey: locales[mainLanguage] ?? baseTextByKey,
    activeLanguage,
    mainLanguage,
    languageLabels: hydratedLabels
  };
}

async function applyRuntimePublishedContentOnCurrentPage(): Promise<void> {
  const published = await loadRuntimeContent();
  if (!published?.nodes?.length) {
    return;
  }
  const scanned = scanDom(document, location.pathname);
  if (!scanned.nodes.length) {
    return;
  }
  const byKey = new Map(published.nodes.map((node) => [node.key, node]));
  scanned.nodes.forEach((node) => {
    const source = byKey.get(node.key);
    if (!source || source.type !== node.type) {
      return;
    }
    node.value = source.value;
    if (source.attrs) {
      node.attrs = { ...source.attrs };
    }
    if (source.sectionItems) {
      node.sectionItems = [...source.sectionItems];
    }
    applyNodeToDom(node, document);
  });
}

async function applyBrowserPreferredLanguageOnCurrentPage(): Promise<void> {
  await applyRuntimePublishedContentOnCurrentPage();
  const runtimeLocales = await loadRuntimeLocales();
  const mergedLocales = {
    ...runtimeLocales,
    ...loadLocales()
  };
  if (!Object.keys(mergedLocales).length) {
    return;
  }
  const main = loadMainLanguage(mergedLocales);
  const lang = pickPreferredLanguage(mergedLocales, main);
  if (!lang || lang === main) {
    return;
  }
  const content = scanDom(document, location.pathname);
  const dict = mergedLocales[lang];
  if (!dict) {
    return;
  }
  const baseTextByKey = Object.fromEntries(content.nodes.filter((n) => n.type === "text").map((n) => [n.key, n.value]));
  applyLanguage(content, dict, document, baseTextByKey);
}

function mountStandaloneRoute(settings: RuntimeSettings): void {
  const pages = settings.pages.length ? settings.pages : ["/"];
  document.documentElement.style.margin = "0";
  document.documentElement.style.padding = "0";
  document.documentElement.style.background = dashboardTheme === "dark" ? "#020617" : "#f1f5f9";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = dashboardTheme === "dark" ? "#020617" : "#f1f5f9";
  document.body.innerHTML = `
    <div id="facms-app" class="h-screen w-screen grid grid-cols-1 lg:grid-cols-[760px_1fr] bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div class="border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-rows-[auto_1fr]">
        <div class="p-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold text-xl">CMS Dashboard</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">Edit pages from one place.</p>
          </div>
        </div>
        <div class="grid grid-cols-[220px_1fr] min-h-0">
          <aside class="border-r border-slate-200 dark:border-slate-800 overflow-auto">
            <div class="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Routes</div>
            <div id="facms-page-tabs" class="px-2 pb-3 space-y-1"></div>
          </aside>
          <div id="facms-route-editor" class="overflow-auto"></div>
        </div>
      </div>
      <div class="bg-slate-200 dark:bg-slate-950 p-3 lg:p-5">
        <iframe id="facms-route-preview" class="w-full h-full border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950" src="/"></iframe>
      </div>
    </div>
    <div id="facms-global-loader" aria-live="polite" aria-busy="true">
      <div id="facms-global-loader-inner">
        <div id="facms-global-loader-spinner"></div>
        <div id="facms-global-loader-label">Translating</div>
      </div>
    </div>
  `;
  const iframe = document.getElementById("facms-route-preview") as HTMLIFrameElement;
  const editor = document.getElementById("facms-route-editor") as HTMLElement;
  const tabs = document.getElementById("facms-page-tabs") as HTMLElement;
  const pageState = new Map<string, DashboardState>();
  let activePath = pages[0];
  let seededLocales: Record<string, Record<string, string>> = {};

  const renderTabs = () => {
    tabs.innerHTML = pages
      .map(
        (path) =>
          `<button data-page="${path}" class="w-full text-left px-3 py-2 rounded-lg text-sm border ${
            path === activePath
              ? "bg-indigo-600 border-indigo-500 text-white"
              : "bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
          }">${escapeHtml(path)}</button>`
      )
      .join("");
    tabs.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activePath = btn.dataset.page || "/";
        renderTabs();
        iframe.src = activePath;
      });
    });
  };

  applyTheme(dashboardTheme);

  iframe.addEventListener("load", async () => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    setGlobalLoaderState(true, `Scanning page content for ${activePath}...`);
    try {
      let state = pageState.get(activePath);
      if (!state) {
        const content = await scanDomWithRetries(doc, activePath);
        state = makeInitialState(content, doc, seededLocales);
        pageState.set(activePath, state);
      } else {
        state.workingDocument = doc;
        const scanned = state.content.nodes.length ? scanDom(doc, activePath) : await scanDomWithRetries(doc, activePath);
        if (scanned.nodes.length && !state.content.nodes.length) {
          state.content = scanned;
        }
      }
      applyStateLanguage(state);
      saveCachedContent(state.content);
      renderEditor(editor, state);
    } finally {
      setGlobalLoaderState(false, "Loading");
    }
  });

  renderTabs();
  void Promise.all([loadRuntimeLocales(), loadRuntimeRouteMap()]).then(([locales, routeFileMap]) => {
    seededLocales = locales;
    runtimeRouteFileMap = routeFileMap;
    iframe.src = activePath;
  });
}

export async function launchDashboard(): Promise<void> {
  injectDashboardStyles();
  initTheme();
  if (!(await ensureRuntimeAuthReady())) {
    return;
  }
  const settings = await loadSettings();
  const open = () => mountStandaloneRoute(settings);
  if (!isAuthenticated) {
    openPasscodeModal(open);
    return;
  }
  open();
}

export async function registerCmsLauncher(): Promise<void> {
  const settings = await loadSettings();
  const search = new URLSearchParams(location.search);
  const forcedDashboard = search.get("__facms") === "1";
  if (location.pathname !== settings.dashboardPath && !forcedDashboard) {
    void applyBrowserPreferredLanguageOnCurrentPage();
    return;
  }
  injectDashboardStyles();
  initTheme();
  if (!(await ensureRuntimeAuthReady())) {
    return;
  }
  if (!isAuthenticated) {
    openPasscodeModal(() => void launchDashboard());
    return;
  }
  void launchDashboard();
}
