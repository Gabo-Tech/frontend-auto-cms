import { setupCms } from "./setup.js";

async function run(): Promise<void> {
  try {
    await setupCms({ silent: true });
  } catch {
  }
}

void run();
