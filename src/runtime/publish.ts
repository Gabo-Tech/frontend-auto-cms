import type { CmsContentFile, CmsPatchFile, CmsPatchOperation } from "../shared/types.js";

interface RuntimeHostingConfig {
  version: 1;
  provider: "none" | "github" | "gitlab";
  repository: string;
  branch: string;
}

function isValidGithubRepository(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value);
}

function isValidGitlabRepository(value: string): boolean {
  return /^([^/\s]+\/)+[^/\s]+$/.test(value);
}

async function gitlabFileExists(config: RuntimeHostingConfig, token: string, filePath: string): Promise<boolean> {
  const res = await fetch(
    `https://gitlab.com/api/v4/projects/${encodeURIComponent(config.repository)}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(config.branch)}`,
    {
      method: "GET",
      headers: { "PRIVATE-TOKEN": token }
    }
  );
  return res.ok;
}

export async function loadHostingConfig(): Promise<RuntimeHostingConfig | null> {
  try {
    const response = await fetch("/cms-hosting.json", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const config = (await response.json()) as RuntimeHostingConfig;
    if (!config || !config.provider || config.provider === "none") {
      return null;
    }
    if (config.provider !== "github" && config.provider !== "gitlab") {
      return null;
    }
    if (typeof config.repository !== "string" || !config.repository.trim()) {
      return null;
    }
    const repo = config.repository.trim();
    if (config.provider === "github" && !isValidGithubRepository(repo)) {
      return null;
    }
    if (config.provider === "gitlab" && !isValidGitlabRepository(repo)) {
      return null;
    }
    if (typeof config.branch !== "string" || !config.branch.trim()) {
      return null;
    }
    return { ...config, repository: repo, branch: config.branch.trim() };
  } catch {
    return null;
  }
}

async function upsertGithubFile(config: RuntimeHostingConfig, token: string, path: string, content: string, message: string): Promise<void> {
  const base = `https://api.github.com/repos/${config.repository}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  let sha: string | undefined;
  const existing = await fetch(`${base}?ref=${encodeURIComponent(config.branch)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (existing.ok) {
    const body = (await existing.json()) as { sha?: string };
    sha = body.sha;
  }

  const payload = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: config.branch,
    sha
  };

  const res = await fetch(base, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`GitHub publish failed for ${path}`);
  }
}

async function githubBranchExists(config: RuntimeHostingConfig, token: string, branch: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${config.repository}/branches/${encodeURIComponent(branch)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.ok;
}

async function githubDefaultBranch(config: RuntimeHostingConfig, token: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${config.repository}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { default_branch?: string };
  const defaultBranch = body.default_branch?.trim();
  return defaultBranch || null;
}

async function resolveGithubBranch(config: RuntimeHostingConfig, token: string): Promise<RuntimeHostingConfig> {
  const currentBranch = config.branch.trim();
  if (await githubBranchExists(config, token, currentBranch)) {
    return { ...config, branch: currentBranch };
  }
  const fallback = await githubDefaultBranch(config, token);
  if (!fallback) {
    throw new Error(`Configured branch "${currentBranch}" was not found and repo default branch could not be resolved.`);
  }
  if (!(await githubBranchExists(config, token, fallback))) {
    throw new Error(`Configured branch "${currentBranch}" was not found. Resolved default branch "${fallback}" is also unavailable.`);
  }
  return { ...config, branch: fallback };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceNthExact(
  haystack: string,
  needle: string,
  replacement: string,
  occurrence = 1
): { content: string; replaced: boolean } {
  if (!needle || occurrence < 1) {
    return { content: haystack, replaced: false };
  }
  let index = -1;
  let start = 0;
  for (let i = 0; i < occurrence; i += 1) {
    index = haystack.indexOf(needle, start);
    if (index < 0) {
      return { content: haystack, replaced: false };
    }
    start = index + needle.length;
  }
  return {
    content: `${haystack.slice(0, index)}${replacement}${haystack.slice(index + needle.length)}`,
    replaced: true
  };
}

function replaceNthFlexibleWhitespace(
  haystack: string,
  needle: string,
  replacement: string,
  occurrence = 1
): { content: string; replaced: boolean } {
  if (!needle || occurrence < 1) {
    return { content: haystack, replaced: false };
  }
  const tokens = needle.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { content: haystack, replaced: false };
  }
  const pattern = tokens.map((token) => escapeRegExp(token)).join("\\s+");
  const regex = new RegExp(pattern, "g");
  let match: RegExpExecArray | null = null;
  let count = 0;
  while ((match = regex.exec(haystack)) !== null) {
    count += 1;
    if (count !== occurrence) {
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    return {
      content: `${haystack.slice(0, start)}${replacement}${haystack.slice(end)}`,
      replaced: true
    };
  }
  return { content: haystack, replaced: false };
}

function applyOperationToContent(
  content: string,
  operation: CmsPatchOperation
): { content: string; replaced: boolean } {
  if (!operation.find || operation.find === operation.replace) {
    return { content, replaced: false };
  }
  const exact = replaceNthExact(content, operation.find, operation.replace, operation.occurrence ?? 1);
  if (exact.replaced) {
    return exact;
  }
  return replaceNthFlexibleWhitespace(content, operation.find, operation.replace, operation.occurrence ?? 1);
}

function isSourceCandidatePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (
    normalized.startsWith("public/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".git/")
  ) {
    return false;
  }
  if (
    normalized === "cms-content.json" ||
    normalized === "cms-locales.json" ||
    normalized === "cms-export.patch.json" ||
    normalized === "public/cms-route-map.json"
  ) {
    return false;
  }
  return /\.(html|js|jsx|ts|tsx|vue|svelte|astro|mdx?)$/i.test(normalized);
}

function sourcePathPriority(path: string): number {
  const normalized = path.replace(/\\/g, "/");
  let score = 100;
  if (normalized.startsWith("src/pages/")) score -= 50;
  if (normalized.startsWith("src/routes/")) score -= 50;
  if (normalized.startsWith("app/")) score -= 40;
  if (normalized.startsWith("src/")) score -= 20;
  if (normalized.endsWith("/index.tsx") || normalized.endsWith("/index.jsx")) score -= 15;
  if (normalized.endsWith("/index.ts") || normalized.endsWith("/index.js")) score -= 10;
  if (normalized.endsWith(".html")) score += 20;
  if (normalized === "index.html") score += 40;
  return score;
}

async function listGithubSourceCandidates(config: RuntimeHostingConfig, token: string): Promise<string[]> {
  const response = await fetch(
    `https://api.github.com/repos/${config.repository}/git/trees/${encodeURIComponent(config.branch)}?recursive=1`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`GitHub tree listing failed (${response.status}). ${bodyText.slice(0, 240)}`);
  }
  const body = (await response.json()) as { tree?: Array<{ path?: string; type?: string }> };
  const paths = (body.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path as string)
    .filter((path) => isSourceCandidatePath(path));
  return paths.sort((a, b) => sourcePathPriority(a) - sourcePathPriority(b));
}

function toSafeOperationPath(input: string): string | null {
  const normalized = (input ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return null;
  }
  return normalized;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function loadGithubTextFile(
  config: RuntimeHostingConfig,
  token: string,
  path: string
): Promise<{ sha: string; content: string } | null> {
  const base = `https://api.github.com/repos/${config.repository}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const response = await fetch(`${base}?ref=${encodeURIComponent(config.branch)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { sha?: string; content?: string; encoding?: string };
  if (!body.sha || !body.content || body.encoding !== "base64") {
    return null;
  }
  return {
    sha: body.sha,
    content: decodeBase64Utf8(body.content)
  };
}

async function applyOperationsToGithubSources(
  config: RuntimeHostingConfig,
  token: string,
  operations: CmsPatchOperation[],
  message: string
): Promise<{
  updatedFiles: number;
  attemptedFiles: number;
  actionableOperations: number;
  appliedOperations: number;
  fallbackCandidatesChecked: number;
  unmatchedSample?: string;
}> {
  const byFile = new Map<string, CmsPatchOperation[]>();
  let actionableOperations = 0;
  operations.forEach((operation) => {
    if (operation.find !== operation.replace) {
      actionableOperations += 1;
    }
    const safeFile = toSafeOperationPath(operation.file);
    if (!safeFile) {
      return;
    }
    const list = byFile.get(safeFile) ?? [];
    list.push({ ...operation, file: safeFile });
    byFile.set(safeFile, list);
  });

  const fileDrafts = new Map<string, { original: string; current: string }>();
  const unresolved: CmsPatchOperation[] = [];
  const loadDraft = async (filePath: string): Promise<{ original: string; current: string } | null> => {
    const cached = fileDrafts.get(filePath);
    if (cached) {
      return cached;
    }
    const existing = await loadGithubTextFile(config, token, filePath);
    if (!existing) {
      return null;
    }
    const draft = { original: existing.content, current: existing.content };
    fileDrafts.set(filePath, draft);
    return draft;
  };

  let appliedOperations = 0;
  for (const [filePath, fileOperations] of byFile.entries()) {
    const draft = await loadDraft(filePath);
    if (!draft) {
      unresolved.push(
        ...fileOperations.filter((operation) => operation.find && operation.find !== operation.replace)
      );
      continue;
    }
    fileOperations.forEach((operation) => {
      const result = applyOperationToContent(draft.current, operation);
      if (result.replaced) {
        draft.current = result.content;
        appliedOperations += 1;
        return;
      }
      if (operation.find && operation.find !== operation.replace) {
        unresolved.push(operation);
      }
    });
  }

  let fallbackCandidatesChecked = 0;
  if (unresolved.length > 0) {
    const candidates = await listGithubSourceCandidates(config, token);
    fallbackCandidatesChecked = candidates.length;
    for (const operation of unresolved) {
      let applied = false;
      for (const candidatePath of candidates) {
        const draft = await loadDraft(candidatePath);
        if (!draft) {
          continue;
        }
        const result = applyOperationToContent(draft.current, operation);
        if (!result.replaced) {
          continue;
        }
        draft.current = result.content;
        appliedOperations += 1;
        applied = true;
        break;
      }
      if (!applied) {
        continue;
      }
    }
  }

  let updatedFiles = 0;
  for (const [filePath, draft] of fileDrafts.entries()) {
    if (draft.current === draft.original) {
      continue;
    }
    await upsertGithubFile(config, token, filePath, draft.current, message);
    updatedFiles += 1;
  }
  const unmatchedSample = unresolved.find((op) => op.find && op.find !== op.replace)?.find?.slice(0, 120);
  return { updatedFiles, attemptedFiles: byFile.size, actionableOperations, appliedOperations, fallbackCandidatesChecked, unmatchedSample };
}

async function publishGithub(config: RuntimeHostingConfig, token: string, payload: CmsPatchFile): Promise<void> {
  const effectiveConfig = await resolveGithubBranch(config, token);
  const message = `chore(cms): publish content updates ${new Date().toISOString()}`;
  const sourceResult = await applyOperationsToGithubSources(effectiveConfig, token, payload.operations ?? [], message);
  if (sourceResult.actionableOperations > 0 && sourceResult.appliedOperations === 0) {
    throw new Error(
      `No source files were updated (${sourceResult.attemptedFiles} mapped files, ${sourceResult.fallbackCandidatesChecked} fallback files checked).` +
        (sourceResult.unmatchedSample ? ` Unmatched text sample: "${sourceResult.unmatchedSample}".` : "") +
        " Run setup again to refresh cms-route-map.json and retry."
    );
  }
  await upsertGithubFile(effectiveConfig, token, "cms-content.json", JSON.stringify(payload.content, null, 2), message);
  if (payload.locales) {
    for (const [lang, dict] of Object.entries(payload.locales)) {
      await upsertGithubFile(effectiveConfig, token, `locales/${lang}.json`, JSON.stringify(dict, null, 2), message);
    }
    await upsertGithubFile(
      effectiveConfig,
      token,
      "cms-locales.json",
      JSON.stringify({ version: 1, locales: payload.locales }, null, 2),
      message
    );
  }
  await upsertGithubFile(effectiveConfig, token, "cms-export.patch.json", JSON.stringify(payload, null, 2), message);
}

async function publishGitlab(config: RuntimeHostingConfig, token: string, payload: CmsPatchFile): Promise<void> {
  const files: Array<{ filePath: string; content: string }> = [
    { filePath: "cms-content.json", content: JSON.stringify(payload.content, null, 2) },
    { filePath: "cms-export.patch.json", content: JSON.stringify(payload, null, 2) }
  ];
  if (payload.locales) {
    for (const [lang, dict] of Object.entries(payload.locales)) {
      files.push({ filePath: `locales/${lang}.json`, content: JSON.stringify(dict, null, 2) });
    }
    files.push({ filePath: "cms-locales.json", content: JSON.stringify({ version: 1, locales: payload.locales }, null, 2) });
  }
  const actions: Array<{ action: "create" | "update"; file_path: string; content: string }> = [];
  for (const file of files) {
    const exists = await gitlabFileExists(config, token, file.filePath);
    actions.push({
      action: exists ? "update" : "create",
      file_path: file.filePath,
      content: file.content
    });
  }

  const res = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(config.repository)}/repository/commits`, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      branch: config.branch,
      commit_message: `chore(cms): publish content updates ${new Date().toISOString()}`,
      actions
    })
  });
  if (!res.ok) {
    throw new Error("GitLab publish failed.");
  }
}

export async function publishToHosting(payload: CmsPatchFile, token: string, config: RuntimeHostingConfig | null): Promise<boolean> {
  if (!config || !token.trim()) {
    return false;
  }
  if (config.provider === "github" && !isValidGithubRepository(config.repository)) {
    throw new Error('Invalid GitHub repository format. Use "owner/repo".');
  }
  if (config.provider === "gitlab" && !isValidGitlabRepository(config.repository)) {
    throw new Error('Invalid GitLab repository format. Use "group/project".');
  }
  if (config.provider === "github") {
    await publishGithub(config, token.trim(), payload);
    return true;
  }
  if (config.provider === "gitlab") {
    await publishGitlab(config, token.trim(), payload);
    return true;
  }
  return false;
}

export function applyPublishedLocales(content: CmsContentFile): Record<string, string> {
  return Object.fromEntries(content.nodes.filter((n) => n.type === "text").map((n) => [n.key, n.value]));
}
