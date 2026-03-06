import { relative } from "node:path";
import type { CmsContentFile, CmsNode } from "../shared/types.js";
import { readText } from "./fs-utils.js";

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${String(idCounter).padStart(4, "0")}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildKey(file: string, type: string, idx: number): string {
  const clean = file.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return `${clean}.${type}.${idx}`;
}

function detectSections(content: string): string[] {
  const results: string[] = [];
  const patterns = [
    /<([a-zA-Z0-9_-]+)[^>]*class=["'][^"']*(faq|card|testimonial|item|list|feature|pricing)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    /\{[\s\S]*?map\(([\s\S]*?)=>[\s\S]*?\)/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const value = normalizeText(match[0]).slice(0, 240);
      if (value.length > 30) {
        results.push(value);
      }
    }
  }

  return Array.from(new Set(results));
}

export async function scanFiles(root: string, files: string[]): Promise<CmsContentFile> {
  const nodes: CmsNode[] = [];

  for (const file of files) {
    const rel = relative(root, file);
    const content = await readText(file);

    let idx = 0;
    const textPattern = />\s*([^<>{}\n][^<>{}]{2,})\s*</g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textPattern.exec(content)) !== null) {
      const textValue = normalizeText(textMatch[1]);
      if (textValue.length < 2 || /^(true|false|null|undefined)$/i.test(textValue)) {
        continue;
      }
      idx += 1;
      nodes.push({
        id: nextId("txt"),
        key: buildKey(rel, "text", idx),
        type: "text",
        label: `${rel} text ${idx}`,
        value: textValue,
        sourceRefs: [{ file: rel, original: textMatch[1] }]
      });
    }

    let mediaIndex = 0;
    const mediaPattern = /<(img|video)\b([^>]*?)>/gi;
    let mediaMatch: RegExpExecArray | null;
    while ((mediaMatch = mediaPattern.exec(content)) !== null) {
      mediaIndex += 1;
      const tag = mediaMatch[1].toLowerCase();
      const attrs = mediaMatch[2];
      const src = /src=["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      if (!src) {
        continue;
      }
      const alt = /alt=["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
      const type = tag === "img" ? "image" : "video";
      nodes.push({
        id: nextId("med"),
        key: buildKey(rel, type, mediaIndex),
        type,
        label: `${rel} ${type} ${mediaIndex}`,
        value: src,
        attrs: { alt, src },
        sourceRefs: [{ file: rel, original: src }]
      });
    }

    const sections = detectSections(content);
    for (let s = 0; s < sections.length; s += 1) {
      nodes.push({
        id: nextId("sec"),
        key: buildKey(rel, "section", s + 1),
        type: "section",
        label: `${rel} section ${s + 1}`,
        value: sections[s],
        sectionItems: sections[s].split(/\s{2,}|,\s+/).filter(Boolean).slice(0, 8),
        sourceRefs: [{ file: rel, original: sections[s] }]
      });
    }
  }

  return {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes
  };
}
