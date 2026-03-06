import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist/runtime",
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, "src/runtime/index.ts"),
        dashboard: resolve(__dirname, "src/runtime/dashboard.ts")
      },
      formats: ["es"]
    }
  }
});
