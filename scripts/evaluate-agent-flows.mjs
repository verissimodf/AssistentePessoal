import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "tests/evals/agent-flows.json"), "utf8"));
const startedAt = new Date().toISOString();
const commit = process.env.GIT_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const results = [];

for (const scenario of manifest.scenarios) {
  const start = performance.now();
  const run = spawnSync(process.execPath, ["--no-warnings", "--test", "--test-reporter=tap", ...scenario.suites], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, JARVIS_NO_LISTEN: "1" },
  });
  const reportText = `${run.stdout || ""}\n${run.stderr || ""}`;
  const count = (name) => Number(reportText.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] || 0);
  results.push({
    id: scenario.id,
    status: run.status === 0 ? "passed" : "failed",
    tests: count("tests"),
    passed: count("pass"),
    failed: count("fail"),
    durationMs: Math.round(performance.now() - start),
    exitCode: run.status,
  });
}

const report = {
  evalVersion: manifest.version,
  appVersion: version,
  commit,
  startedAt,
  offline: true,
  result: results.every((r) => r.status === "passed") ? "passed" : "failed",
  scenarios: results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.result !== "passed") process.exitCode = 1;
