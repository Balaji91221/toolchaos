import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runScenario, type Scenario } from "./runner.ts";
import type { AgentAdapter } from "./agent.ts";

/** Metadata index only: source evidence stays in immutable, per-run directories. */
export class RunStore {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000");
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as any).user_version,
    );
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error("Unsupported run index version");
    }
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('PASS','FAIL','INCONCLUSIVE')), artifact_dir TEXT UNIQUE NOT NULL, manifest_sha256 TEXT NOT NULL, indexed_at TEXT NOT NULL); PRAGMA user_version=1",
    );
  }
  async record(id: string, directory: string) {
    if (typeof id !== "string" || !id.trim())
      throw new Error("Run ID required");
    const source = await readFile(
      path.join(directory, "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(source);
    if (
      manifest.schemaVersion !== 1 ||
      typeof manifest.scenario?.id !== "string" ||
      !["PASS", "FAIL", "INCONCLUSIVE"].includes(manifest.verdict)
    )
      throw new Error("Invalid run manifest");
    this.db
      .prepare("INSERT INTO runs VALUES (?,?,?,?,?,?)")
      .run(
        id,
        manifest.scenario.id,
        manifest.verdict,
        path.resolve(directory),
        createHash("sha256").update(source).digest("hex"),
        new Date().toISOString(),
      );
  }
  list(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
      throw new Error("Invalid history limit");
    return this.db
      .prepare("SELECT * FROM runs ORDER BY indexed_at DESC,id DESC LIMIT ?")
      .all(limit);
  }
  close() {
    this.db.close();
  }
}
export async function runSeries(
  scenario: Scenario,
  agentFactory: () => AgentAdapter,
  directory: string,
  repeats = 3,
  options: { signal?: AbortSignal } = {},
) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100)
    throw new Error("repeats must be 1..100");
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const store = new RunStore(path.join(directory, "runs.sqlite"));
  const runs: Array<{
    id: string;
    verdict: string;
    status: string;
    durationMs: number;
  }> = [];
  try {
    for (let i = 0; i < repeats; i++) {
      if (options.signal?.aborted) break;
      const id = `run-${String(i + 1).padStart(3, "0")}`;
      const output = path.join(directory, id);
      const result = await runScenario(
        scenario,
        agentFactory(),
        output,
        options,
      );
      await store.record(id, output);
      runs.push({
        id,
        verdict: result.verdict,
        status: result.status,
        durationMs: result.durationMs,
      });
    }
  } finally {
    store.close();
  }
  const passed = runs.filter((r) => r.verdict === "PASS").length,
    failed = runs.filter((r) => r.verdict === "FAIL").length,
    inconclusive = runs.filter((r) => r.verdict === "INCONCLUSIVE").length;
  const summary = {
    schemaVersion: 1,
    scenarioId: scenario.id,
    requested: repeats,
    executed: runs.length,
    passed,
    failed,
    inconclusive,
    notRun: repeats - runs.length,
    passFractionOfExecuted: runs.length ? passed / runs.length : null,
    verdict:
      runs.length !== repeats || inconclusive
        ? "INCONCLUSIVE"
        : failed
          ? "FAIL"
          : "PASS",
    runs,
  };
  await writeFile(
    path.join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return summary;
}
