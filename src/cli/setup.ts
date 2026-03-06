import inquirer from "inquirer";
import chalk from "chalk";
import { resolve, relative, sep, extname, basename, dirname } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { CMS_CONFIG_FILE, CMS_CONTENT_FILE, CMS_ASSET_DIR, CMS_RUNTIME_AUTH_FILE, CMS_HOSTING_FILE, CMS_RUNTIME_HOSTING_FILE, CMS_RUNTIME_SETTINGS_FILE, CMS_RUNTIME_LOCALES_FILE, CMS_RUNTIME_ROUTE_MAP_FILE } from "../shared/constants.js";
import type { CmsConfigFile, CmsHostingConfigFile, CmsRuntimeAuthFile, CmsRuntimeSettingsFile, CmsRuntimeLocalesFile } from "../shared/types.js";
import { createSalt, hashPasscode, hashRuntimePasscode } from "../shared/hash.js";
import { ensureDir, exists, walkProject, writeJson } from "./fs-utils.js";
import { scanFiles } from "./scanner.js";

interface SetupOptions {
  cwd?: string;
  silent?: boolean;
}

type DeploymentHost =
  | "none"
  | "vercel"
  | "netlify"
  | "render"
  | "github-pages"
  | "firebase-hosting"
  | "heroku"
  | "fly-io"
  | "digitalocean";

async function readSeedLocales(cwd: string, localeDir: string): Promise<Record<string, Record<string, string>>> {
  try {
    const dir = resolve(cwd, localeDir);
    const entries = await readdir(dir, { withFileTypes: true });
    const locales: Record<string, Record<string, string>> = {};
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name) !== ".json") {
        continue;
      }
      const lang = basename(entry.name, ".json").toLowerCase();
      const raw = await readFile(resolve(dir, entry.name), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        locales[lang] = parsed as Record<string, string>;
      }
    }
    return locales;
  } catch {
    return {};
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeRoute(route: string): string {
  const clean = route.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!clean || clean === "/") {
    return "/";
  }
  const noTrailing = clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return noTrailing.startsWith("/") ? noTrailing : `/${noTrailing}`;
}

function toRouteFromPathParts(parts: string[], fallback = "/"): string {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) {
    return fallback;
  }
  if (filtered[filtered.length - 1] === "index") {
    filtered.pop();
  }
  if (!filtered.length) {
    return "/";
  }
  return normalizeRoute(`/${filtered.join("/")}`);
}

function detectPageRoute(root: string, absoluteFile: string): string | null {
  const rel = relative(root, absoluteFile).split(sep).join("/");
  const noExt = rel.replace(/\.[^.]+$/, "");
  const parts = noExt.split("/").filter(Boolean);
  if (!parts.length) {
    return null;
  }

  if (parts[0] === "public") {
    return null;
  }

  if (parts.length === 1 && parts[0] === "index") {
    return "/";
  }

  const srcPagesIdx = parts.findIndex((p) => p === "pages");
  if (srcPagesIdx >= 0) {
    return toRouteFromPathParts(parts.slice(srcPagesIdx + 1));
  }

  const srcRoutesIdx = parts.findIndex((p) => p === "routes");
  if (srcRoutesIdx >= 0) {
    const routeParts = parts.slice(srcRoutesIdx + 1).filter((p) => p !== "+page" && p !== "+layout");
    return toRouteFromPathParts(routeParts);
  }

  const appIdx = parts.findIndex((p) => p === "app");
  if (appIdx >= 0) {
    const routeParts = parts
      .slice(appIdx + 1)
      .filter((p) => p !== "page" && p !== "layout" && !p.startsWith("(") && !p.endsWith(")"));
    return toRouteFromPathParts(routeParts);
  }

  if (parts[parts.length - 1] === "index") {
    return toRouteFromPathParts(parts);
  }

  if (parts[0] !== "src") {
    return toRouteFromPathParts(parts);
  }

  return null;
}

function isValidGithubRepository(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value);
}

function isValidGitlabRepository(value: string): boolean {
  return /^([^/\s]+\/)+[^/\s]+$/.test(value);
}

function detectPagesFromFiles(root: string, files: string[], dashboardPath: string): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    const route = detectPageRoute(root, file);
    if (!route) {
      continue;
    }
    const normalized = normalizeRoute(route).toLowerCase();
    if (normalized !== normalizeRoute(dashboardPath).toLowerCase()) {
      routes.add(normalized);
    }
  }
  if (!routes.size) {
    routes.add("/");
  }
  return Array.from(routes).sort((a, b) => {
    if (a === "/") {
      return -1;
    }
    if (b === "/") {
      return 1;
    }
    return a.localeCompare(b);
  });
}

function detectRouteFileMap(root: string, files: string[], dashboardPath: string): Record<string, string> {
  const map: Record<string, string> = {};
  const scores: Record<string, number> = {};
  const scoreFile = (filePath: string): number => {
    const normalized = filePath.split(sep).join("/");
    const extension = extname(normalized).toLowerCase();
    let score = 50;
    if (normalized.startsWith("src/pages/")) score -= 30;
    if (normalized.startsWith("src/routes/")) score -= 30;
    if (normalized.startsWith("app/")) score -= 20;
    if (normalized.includes("/pages/")) score -= 10;
    if (normalized.endsWith("/index.tsx") || normalized.endsWith("/index.jsx")) score -= 8;
    if (normalized.endsWith("/index.ts") || normalized.endsWith("/index.js")) score -= 4;
    if (extension === ".html") score += 25;
    if (normalized === "index.html") score += 35;
    if (normalized.startsWith("src/")) score -= 6;
    return score;
  };
  for (const file of files) {
    const route = detectPageRoute(root, file);
    if (!route) {
      continue;
    }
    const normalizedRoute = normalizeRoute(route).toLowerCase();
    if (normalizedRoute === normalizeRoute(dashboardPath).toLowerCase()) {
      continue;
    }
    const rel = relative(root, file).split(sep).join("/");
    const candidateScore = scoreFile(rel);
    const previousScore = scores[normalizedRoute];
    if (previousScore == null || candidateScore < previousScore) {
      map[normalizedRoute] = rel;
      scores[normalizedRoute] = candidateScore;
    }
  }
  return map;
}

function dashboardBootstrapFilePath(dashboardPath: string): string | null {
  const normalized = normalizePath(dashboardPath);
  if (normalized === "/") {
    return null;
  }
  const raw = normalized.replace(/^\/+/, "");
  const segments = raw.split("/").filter(Boolean);
  if (!segments.length || segments.some((s) => s === "." || s === "..")) {
    return null;
  }
  if (segments[segments.length - 1].endsWith(".html")) {
    return ["public", ...segments].join("/");
  }
  return ["public", ...segments, "index.html"].join("/");
}

function dashboardBootstrapHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CMS Dashboard</title>
    <script>
      (function () {
        var url = new URL(window.location.href);
        url.pathname = "/";
        url.searchParams.set("__facms", "1");
        window.location.replace(url.toString());
      })();
    </script>
  </head>
  <body></body>
</html>
`;
}

function normalizeDashboardRewritePath(dashboardPath: string): string | null {
  const normalized = (normalizePath(dashboardPath).replace(/\/+$/, "") || "/").toLowerCase();
  if (normalized === "/") {
    return null;
  }
  return normalized;
}

function buildRewritePaths(dashboardPath: string, pages: string[]): string[] {
  const set = new Set<string>();
  const base = normalizeDashboardRewritePath(dashboardPath);
  if (base) set.add(base);
  for (const page of pages) {
    const normalized = normalizeDashboardRewritePath(page);
    if (normalized) {
      set.add(normalized);
    }
  }
  return Array.from(set);
}

function buildVercelDashboardRewrites(dashboardPath: string, pages: string[]): Array<{ source: string; destination: string }> {
  const paths = buildRewritePaths(dashboardPath, pages);
  return paths.flatMap((path) => [
    { source: path, destination: "/" },
    { source: `${path}/:path*`, destination: "/" }
  ]);
}

function isRewriteEntry(value: unknown): value is { source: string; destination: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { source?: unknown }).source === "string" &&
      typeof (value as { destination?: unknown }).destination === "string"
  );
}

async function configureVercelRouting(cwd: string, dashboardPath: string, pages: string[]): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const rewritesToAdd = buildVercelDashboardRewrites(dashboardPath, pages);
  if (!rewritesToAdd.length) {
    return "skipped";
  }
  const vercelPath = resolve(cwd, "vercel.json");
  const hasExisting = await exists(vercelPath);
  let config: Record<string, unknown> = {};
  if (hasExisting) {
    try {
      const raw = await readFile(vercelPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      config = {};
    }
  }
  const existing = Array.isArray(config.rewrites) ? config.rewrites.filter(isRewriteEntry) : [];
  let changed = false;
  for (const entry of rewritesToAdd) {
    const present = existing.some((r) => r.source === entry.source && r.destination === entry.destination);
    if (!present) {
      existing.push(entry);
      changed = true;
    }
  }
  if (!changed && hasExisting) {
    return "unchanged";
  }
  config.rewrites = existing;
  await writeFile(vercelPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return hasExisting ? "updated" : "created";
}

function dashboardRewriteLines(dashboardPath: string, pages: string[]): string[] {
  const paths = buildRewritePaths(dashboardPath, pages);
  return paths.flatMap((path) => [`${path} /index.html 200`, `${path}/* /index.html 200`]);
}

async function configurePublicRedirects(cwd: string, dashboardPath: string, pages: string[]): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const rules = dashboardRewriteLines(dashboardPath, pages);
  if (!rules.length) {
    return "skipped";
  }
  const redirectsPath = resolve(cwd, "public", "_redirects");
  const hasExisting = await exists(redirectsPath);
  let content = "";
  if (hasExisting) {
    try {
      content = await readFile(redirectsPath, "utf8");
    } catch {
      content = "";
    }
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let changed = false;
  for (const rule of rules) {
    if (!lines.includes(rule)) {
      lines.push(rule);
      changed = true;
    }
  }
  if (!changed && hasExisting) {
    return "unchanged";
  }
  await ensureDir(dirname(redirectsPath));
  await writeFile(redirectsPath, `${lines.join("\n")}\n`, "utf8");
  return hasExisting ? "updated" : "created";
}

async function configureFirebaseHosting(cwd: string, dashboardPath: string, pages: string[]): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const paths = buildRewritePaths(dashboardPath, pages);
  if (!paths.length) {
    return "skipped";
  }
  const firebasePath = resolve(cwd, "firebase.json");
  const hasExisting = await exists(firebasePath);
  let config: Record<string, unknown> = {};
  if (hasExisting) {
    try {
      const raw = await readFile(firebasePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      config = {};
    }
  }
  const hostingRaw = config.hosting;
  const hosting =
    hostingRaw && typeof hostingRaw === "object" && !Array.isArray(hostingRaw)
      ? (hostingRaw as Record<string, unknown>)
      : { public: "public" };
  const rewritesRaw = hosting.rewrites;
  const rewrites = Array.isArray(rewritesRaw)
    ? rewritesRaw.filter((item) => item && typeof item === "object")
    : [];
  const required = paths.flatMap((path) => [
    { source: path, destination: "/index.html" },
    { source: `${path}/**`, destination: "/index.html" }
  ]);
  let changed = false;
  for (const entry of required) {
    const existsEntry = rewrites.some(
      (item) =>
        (item as { source?: unknown }).source === entry.source &&
        (item as { destination?: unknown }).destination === entry.destination
    );
    if (!existsEntry) {
      rewrites.push(entry);
      changed = true;
    }
  }
  if (!changed && hasExisting) {
    return "unchanged";
  }
  hosting.rewrites = rewrites;
  if (!hosting.public || typeof hosting.public !== "string") {
    hosting.public = "public";
  }
  config.hosting = hosting;
  await writeFile(firebasePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return hasExisting ? "updated" : "created";
}

async function configureGithubPagesSupport(cwd: string): Promise<"created" | "updated" | "unchanged"> {
  const noJekyllPath = resolve(cwd, "public", ".nojekyll");
  const existed = await exists(noJekyllPath);
  await ensureDir(dirname(noJekyllPath));
  await writeFile(noJekyllPath, "", "utf8");
  return existed ? "unchanged" : "created";
}

async function writeServerHostInstructions(cwd: string, host: "heroku" | "fly-io" | "digitalocean", dashboardPath: string): Promise<void> {
  const base = normalizeDashboardRewritePath(dashboardPath) ?? "/dashboard";
  const prettyHost = host === "fly-io" ? "Fly.io" : host === "digitalocean" ? "DigitalOcean App Platform" : "Heroku";
  const notesPath = resolve(cwd, "cms-hosting-notes.md");
  const content = `# CMS Hosting Notes (${prettyHost})

Add a dashboard route rewrite so \`${base}\` serves your app entry page.

## Node/Express example

\`\`\`js
app.get("${base}", (_req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));
app.get("${base}/*", (_req, res) => res.sendFile(path.join(process.cwd(), "public", "index.html")));
\`\`\`

## Static servers

If your host supports redirect rules files, map:
- \`${base} -> /index.html (200)\`
- \`${base}/* -> /index.html (200)\`
`;
  await writeFile(notesPath, content, "utf8");
}

function githubAutoApplyWorkflowYaml(): string {
  return `name: frontend-auto-cms apply patch

on:
  push:
    paths:
      - "cms-export.patch.json"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci --ignore-scripts

      - name: Apply CMS patch
        run: npx frontend-auto-cms apply

      - name: Commit changes if any
        run: |
          if git diff --quiet; then
            echo "No source changes to commit."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git commit -m "chore(cms): apply published patch"
          git push
`;
}

async function configureGithubAutoApplyWorkflow(cwd: string): Promise<"created" | "updated" | "unchanged"> {
  const workflowPath = resolve(cwd, ".github", "workflows", "frontend-auto-cms-apply.yml");
  const next = githubAutoApplyWorkflowYaml();
  const hasExisting = await exists(workflowPath);
  if (hasExisting) {
    try {
      const current = await readFile(workflowPath, "utf8");
      if (current === next) {
        return "unchanged";
      }
    } catch {
    }
  }
  await ensureDir(dirname(workflowPath));
  await writeFile(workflowPath, next, "utf8");
  return hasExisting ? "updated" : "created";
}

export async function setupCms(options: SetupOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolve(cwd, CMS_CONFIG_FILE);
  const contentPath = resolve(cwd, CMS_CONTENT_FILE);

  const alreadyConfigured = await exists(configPath);
  if (alreadyConfigured && options.silent) {
    return;
  }

  const { passcode } = await inquirer.prompt<{ passcode: string }>([
    {
      type: "password",
      name: "passcode",
      message: "Choose your CMS passcode:",
      mask: "*",
      validate: (input) => {
        const value = input.trim();
        if (value.length < 10) {
          return "Passcode must be at least 10 characters.";
        }
        if (!/[a-z]/i.test(value) || !/[0-9]/.test(value)) {
          return "Passcode must include at least one letter and one number.";
        }
        return true;
      }
    }
  ]);

  const routeAnswers = await inquirer.prompt<{
    dashboardPath: string;
  }>([
    {
      type: "input",
      name: "dashboardPath",
      message: "Dashboard route path (for editors):",
      default: "/dashboard",
      validate: (input) => (input.trim() ? true : "Dashboard path is required.")
    }
  ]);
  const securityAnswers = await inquirer.prompt<{
    autoTranslateEnabled: boolean;
  }>([
    {
      type: "confirm",
      name: "autoTranslateEnabled",
      message: "Enable automatic translation via third-party API?",
      default: true
    }
  ]);
  const deploymentAnswers = await inquirer.prompt<{
    host: DeploymentHost;
  }>([
    {
      type: "list",
      name: "host",
      message: "Where is your app deployed (for dashboard routing)?",
      choices: [
        { name: "No hosting-specific routing changes", value: "none" },
        { name: "Vercel (auto-add dashboard rewrites)", value: "vercel" }
        ,
        { name: "Netlify (auto-add public/_redirects)", value: "netlify" },
        { name: "Render Static Site (auto-add public/_redirects)", value: "render" },
        { name: "GitHub Pages (auto-add .nojekyll support file)", value: "github-pages" },
        { name: "Firebase Hosting (auto-add firebase.json rewrites)", value: "firebase-hosting" },
        { name: "Heroku (generate server rewrite notes)", value: "heroku" },
        { name: "Fly.io (generate server rewrite notes)", value: "fly-io" },
        { name: "DigitalOcean App Platform (generate server rewrite notes)", value: "digitalocean" }
      ],
      default: "none"
    }
  ]);

  const hostingAnswers = await inquirer.prompt<{
    provider: "none" | "github" | "gitlab";
    repository: string;
    branch: string;
  }>([
    {
      type: "list",
      name: "provider",
      message: "Where is your code hosted for Save & Publish?",
      choices: [
        { name: "None (export patch only)", value: "none" },
        { name: "GitHub", value: "github" },
        { name: "GitLab", value: "gitlab" }
      ],
      default: "none"
    },
    {
      type: "input",
      name: "repository",
      message: "Repository slug (owner/repo or group/project):",
      when: (answers) => answers.provider !== "none",
      validate: (input: string) => {
        const repo = input.trim();
        if (!repo) {
          return "Repository is required.";
        }
        if (!isValidGithubRepository(repo) && !isValidGitlabRepository(repo)) {
          return 'Use "owner/repo" (GitHub) or "group/project" (GitLab).';
        }
        return true;
      }
    },
    {
      type: "input",
      name: "branch",
      message: "Branch to publish to:",
      default: "main",
      when: (answers) => answers.provider !== "none",
      validate: (input) => (input.trim() ? true : "Branch is required.")
    }
  ]);

  const files = await walkProject(cwd);
  const content = await scanFiles(cwd, files);
  const dashboardPath = normalizePath(routeAnswers.dashboardPath);
  const detectedPages = detectPagesFromFiles(cwd, files, dashboardPath);
  const routeFileMap = detectRouteFileMap(cwd, files, dashboardPath);
  const repository = (hostingAnswers.repository ?? "").trim();
  if (hostingAnswers.provider === "github" && repository && !isValidGithubRepository(repository)) {
    throw new Error('Invalid GitHub repository slug. Use "owner/repo" (example: Gabo-Tech/testlanding).');
  }
  if (hostingAnswers.provider === "gitlab" && repository && !isValidGitlabRepository(repository)) {
    throw new Error('Invalid GitLab repository slug. Use "group/project" (nested groups allowed).');
  }

  const salt = createSalt();
  const config: CmsConfigFile = {
    version: 1,
    passcodeSalt: salt,
    passcodeHash: hashPasscode(passcode, salt),
    contentFile: CMS_CONTENT_FILE,
    localeDir: "locales",
    dashboardPath,
    pages: detectedPages
  };
  const runtimeLocales: CmsRuntimeLocalesFile = {
    version: 1,
    locales: await readSeedLocales(cwd, config.localeDir)
  };
  const runtimeSalt = createSalt();
  const runtimeAuth: CmsRuntimeAuthFile = {
    version: 1,
    algorithm: "sha256",
    salt: runtimeSalt,
    passcodeHash: hashRuntimePasscode(passcode, runtimeSalt)
  };

  await writeJson(configPath, config);
  await writeJson(contentPath, content);
  await ensureDir(resolve(cwd, CMS_ASSET_DIR));
  await writeJson(resolve(cwd, CMS_RUNTIME_AUTH_FILE), runtimeAuth);

  const hostingConfig: CmsHostingConfigFile = {
    version: 1,
    provider: hostingAnswers.provider,
    repository,
    branch: hostingAnswers.branch ?? "main"
  };
  await writeJson(resolve(cwd, CMS_HOSTING_FILE), hostingConfig);
  await writeJson(resolve(cwd, CMS_RUNTIME_HOSTING_FILE), hostingConfig);

  const runtimeSettings: CmsRuntimeSettingsFile = {
    version: 1,
    dashboardPath: config.dashboardPath ?? "/dashboard",
    pages: config.pages ?? ["/"],
    showFloatingButton: false,
    autoTranslateEnabled: securityAnswers.autoTranslateEnabled
  };
  await writeJson(resolve(cwd, CMS_RUNTIME_SETTINGS_FILE), runtimeSettings);
  await writeJson(resolve(cwd, CMS_RUNTIME_LOCALES_FILE), runtimeLocales);
  await writeJson(resolve(cwd, CMS_RUNTIME_ROUTE_MAP_FILE), { version: 1, routes: routeFileMap });
  const bootstrapPath = dashboardBootstrapFilePath(runtimeSettings.dashboardPath);
  if (bootstrapPath) {
    const absoluteBootstrapPath = resolve(cwd, bootstrapPath);
    await ensureDir(dirname(absoluteBootstrapPath));
    await writeFile(absoluteBootstrapPath, dashboardBootstrapHtml(), "utf8");
  }
  const deploymentActions: string[] = [];
  const automationActions: string[] = [];
  if (deploymentAnswers.host === "vercel") {
    const result = await configureVercelRouting(cwd, runtimeSettings.dashboardPath, runtimeSettings.pages);
    deploymentActions.push(`vercel.json rewrites: ${result}`);
  } else if (deploymentAnswers.host === "netlify" || deploymentAnswers.host === "render") {
    const result = await configurePublicRedirects(cwd, runtimeSettings.dashboardPath, runtimeSettings.pages);
    deploymentActions.push(`public/_redirects: ${result}`);
  } else if (deploymentAnswers.host === "firebase-hosting") {
    const result = await configureFirebaseHosting(cwd, runtimeSettings.dashboardPath, runtimeSettings.pages);
    deploymentActions.push(`firebase.json rewrites: ${result}`);
  } else if (deploymentAnswers.host === "github-pages") {
    const result = await configureGithubPagesSupport(cwd);
    deploymentActions.push(`public/.nojekyll: ${result}`);
  } else if (
    deploymentAnswers.host === "heroku" ||
    deploymentAnswers.host === "fly-io" ||
    deploymentAnswers.host === "digitalocean"
  ) {
    await writeServerHostInstructions(cwd, deploymentAnswers.host, runtimeSettings.dashboardPath);
    deploymentActions.push("cms-hosting-notes.md: created");
  }
  if (hostingAnswers.provider === "github") {
    const result = await configureGithubAutoApplyWorkflow(cwd);
    automationActions.push(`GitHub auto-apply workflow: ${result}`);
  }

  if (!options.silent) {
    process.stdout.write("\n");
    process.stdout.write(chalk.bold.green("frontend-auto-cms initialized successfully.\n"));
    process.stdout.write(chalk.cyan(`- Config: ${CMS_CONFIG_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Content: ${CMS_CONTENT_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Assets directory: ${CMS_ASSET_DIR}\n`));
    process.stdout.write(chalk.cyan(`- Runtime auth: ${CMS_RUNTIME_AUTH_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Hosting config: ${CMS_HOSTING_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Runtime hosting: ${CMS_RUNTIME_HOSTING_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Runtime settings: ${CMS_RUNTIME_SETTINGS_FILE}\n`));
    process.stdout.write(chalk.cyan(`- Runtime locales: ${CMS_RUNTIME_LOCALES_FILE}\n`));
    if (deploymentActions.length) {
      deploymentActions.forEach((entry) => process.stdout.write(chalk.cyan(`- Hosting routing: ${entry}\n`)));
    }
    if (automationActions.length) {
      automationActions.forEach((entry) => process.stdout.write(chalk.cyan(`- Automation: ${entry}\n`)));
    }
    process.stdout.write(chalk.cyan(`- Detected pages: ${(runtimeSettings.pages ?? []).join(", ")}\n`));
    process.stdout.write(chalk.yellow("\nNext steps:\n"));
    process.stdout.write("1) Add `import \"frontend-auto-cms\";` to your frontend entry file.\n");
    process.stdout.write(`2) Open ${runtimeSettings.dashboardPath} to edit your site.\n`);
    process.stdout.write("3) After edits, click Save + Publish (or export patch and run apply).\n\n");
  }
}
