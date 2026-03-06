import { registerCmsLauncher } from "./dashboard.js";

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void registerCmsLauncher(), { once: true });
  } else {
    void registerCmsLauncher();
  }
}

boot();
