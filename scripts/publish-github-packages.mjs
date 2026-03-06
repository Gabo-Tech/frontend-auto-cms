import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const tempDir = await mkdtemp(join(tmpdir(), "frontend-auto-cms-ghpkg-"));

try {
  const packageJsonPath = resolve(root, "package.json");
  const packageRaw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(packageRaw);
  const scope = (process.env.GH_NPM_SCOPE ?? "gabo-tech").toLowerCase();
  const unscopedName = String(pkg.name || "frontend-auto-cms").replace(/^@[^/]+\//, "");
  const scopedName = `@${scope}/${unscopedName}`;

  const publishPkg = {
    ...pkg,
    name: scopedName,
    scripts: {
      postinstall: "node ./dist/cli/postinstall.js"
    },
    publishConfig: {
      ...(pkg.publishConfig ?? {}),
      registry: "https://npm.pkg.github.com"
    }
  };

  delete publishPkg.private;

  await cp(resolve(root, "dist"), join(tempDir, "dist"), { recursive: true });
  await cp(resolve(root, "README.md"), join(tempDir, "README.md"));
  await cp(resolve(root, "LICENSE"), join(tempDir, "LICENSE"));
  await writeFile(join(tempDir, "package.json"), `${JSON.stringify(publishPkg, null, 2)}\n`, "utf8");
  await writeFile(join(tempDir, ".npmrc"), `@${scope}:registry=https://npm.pkg.github.com\n`, "utf8");

  execFileSync("npm", ["publish", "--registry", "https://npm.pkg.github.com"], {
    cwd: tempDir,
    stdio: "inherit"
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
