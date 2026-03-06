import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "dist/cli/postinstall.js");

try {
  await access(target, constants.F_OK);
  await import(target);
} catch {
}
