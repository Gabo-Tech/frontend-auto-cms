import { resolve, dirname, relative, isAbsolute } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import chalk from "chalk";
import type { CmsPatchFile } from "../shared/types.js";
import { CMS_PATCH_FILE, CMS_CONTENT_FILE, CMS_RUNTIME_LOCALES_FILE } from "../shared/constants.js";

interface ApplyOptions {
  patchPath?: string;
  cwd?: string;
  allowUnsigned?: boolean;
}

function assertInsideRoot(root: string, targetPath: string, label: string): void {
  const rel = relative(root, targetPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to access ${label} outside project root: ${targetPath}`);
  }
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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function replaceNth(haystack: string, needle: string, replacement: string, occurrence = 1): Promise<string> {
  if (!needle) {
    return haystack;
  }
  let from = 0;
  let count = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) {
      break;
    }
    count += 1;
    if (count === occurrence) {
      return `${haystack.slice(0, idx)}${replacement}${haystack.slice(idx + needle.length)}`;
    }
    from = idx + needle.length;
  }
  return haystack;
}

export async function applyPatch(options: ApplyOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const patchPath = resolve(cwd, options.patchPath ?? CMS_PATCH_FILE);
  assertInsideRoot(cwd, patchPath, "patch file");
  const patchRaw = await readFile(patchPath, "utf8");
  const patch = JSON.parse(patchRaw) as CmsPatchFile;
  if (!patch.integrity || patch.integrity.algorithm !== "sha256" || !patch.integrity.value) {
    if (!options.allowUnsigned) {
      throw new Error("Patch integrity metadata missing. Refusing to apply unsigned patch without --allow-unsigned.");
    }
    process.stdout.write(chalk.yellow("Warning: applying unsigned patch because --allow-unsigned was set.\n"));
  } else {
    const unsignedPatch = {
      generatedAt: patch.generatedAt,
      content: patch.content,
      operations: patch.operations,
      locales: patch.locales
    };
    const expected = sha256Hex(stableStringify(unsignedPatch));
    if (expected !== patch.integrity.value) {
      throw new Error("Patch integrity verification failed. File may be tampered or corrupted.");
    }
  }

  let appliedOps = 0;
  for (const op of patch.operations) {
    const filePath = resolve(cwd, op.file);
    assertInsideRoot(cwd, filePath, "operation target");
    const original = await readFile(filePath, "utf8");
    const next = await replaceNth(original, op.find, op.replace, op.occurrence ?? 1);
    if (next !== original) {
      await writeFile(filePath, next, "utf8");
      appliedOps += 1;
    }
  }

  const contentPath = resolve(cwd, CMS_CONTENT_FILE);
  await writeFile(contentPath, JSON.stringify(patch.content, null, 2), "utf8");

  if (patch.locales) {
    for (const [lang, dict] of Object.entries(patch.locales)) {
      if (!/^[a-z0-9_-]{2,16}$/i.test(lang)) {
        throw new Error(`Invalid locale code in patch: ${lang}`);
      }
      const target = resolve(cwd, "locales", `${lang}.json`);
      assertInsideRoot(cwd, target, "locale file");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(dict, null, 2), "utf8");
    }
    const runtimeLocalesPath = resolve(cwd, CMS_RUNTIME_LOCALES_FILE);
    assertInsideRoot(cwd, runtimeLocalesPath, "runtime locales file");
    await mkdir(dirname(runtimeLocalesPath), { recursive: true });
    await writeFile(
      runtimeLocalesPath,
      JSON.stringify({ version: 1, locales: patch.locales }, null, 2),
      "utf8"
    );
  }

  process.stdout.write(chalk.green(`Applied ${appliedOps} source operations.\n`));
  process.stdout.write(chalk.green(`Updated ${CMS_CONTENT_FILE} and locale files.\n`));
}
