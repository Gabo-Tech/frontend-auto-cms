import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { SUPPORTED_EXTENSIONS } from "../shared/constants.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".astro",
  ".svelte-kit",
  "coverage",
  ".turbo",
  ".vite"
]);

export async function walkProject(root: string): Promise<string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          await visit(abs);
        }
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(extname(entry.name) as (typeof SUPPORTED_EXTENSIONS)[number])) {
        out.push(abs);
      }
    }
  }

  await visit(root);
  return out;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}
