#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function run(script) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(scriptDir, script)], { stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${script} exited with ${code}`)));
  });
}

await run("build-research.mjs");
await run("enrich-options.mjs");
await run("archive-operation.mjs");
