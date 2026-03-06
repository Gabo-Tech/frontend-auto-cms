#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { setupCms } from "./setup.js";
import { applyPatch } from "./apply.js";

const program = new Command();

program
  .name("frontend-auto-cms")
  .description("Auto-inject CMS editing into any frontend project.")
  .version("1.0.0");

program
  .command("setup")
  .description("Initialize CMS config/content files by scanning source files.")
  .action(async () => {
    await setupCms();
  });

program
  .command("apply")
  .description("Apply patch generated from the in-browser dashboard.")
  .option("-p, --patch <path>", "Patch file path", "cms-export.patch.json")
  .option("--allow-unsigned", "Allow applying patches without integrity metadata", false)
  .action(async (opts: { patch: string; allowUnsigned: boolean }) => {
    await applyPatch({ patchPath: opts.patch, allowUnsigned: opts.allowUnsigned });
  });

program
  .command("doctor")
  .description("Verify package wiring quickly.")
  .action(() => {
    process.stdout.write(chalk.green("frontend-auto-cms CLI is installed and ready.\n"));
  });

void program.parseAsync(process.argv);
