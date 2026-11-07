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

// --no-archive refreshes the research snapshot only. Scheduled weekday runs
// use it so the published data stays current without adding "临时更新操作单"
// records; the Friday 10:00 ET run archives the weekly action sheet.
const archive = !process.argv.includes("--no-archive");

await run("build-research.mjs");
await run("enrich-execution.mjs");
await run("enrich-options.mjs");
if (archive) await run("archive-operation.mjs");
else console.log("Skipped operation-history archive (--no-archive).");
