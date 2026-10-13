import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSeries, RunStore, ReferenceAgent } from "../src/index.ts";
test(
  "repeated scenarios isolate state and persist verified run metadata",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-series-"));
    const out = path.join(dir, "suite");
    try {
      const scenario = {
        schemaVersion: 1,
        id: "lost",
        task: "Task",
        expectedTickets: 1,
        rules: [
          {
            tool: "create_ticket",
            occurrence: 1,
            fault: "drop_response_after_forward",
          },
        ],
        timeoutMs: 5000,
        toolTimeoutMs: 100,
      };
      const r = await runSeries(
        scenario,
        () => new ReferenceAgent("idempotent"),
        out,
        2,
      );
      assert.equal(r.passed, 2);
      assert.equal(r.executed, 2);
      const store = new RunStore(path.join(out, "runs.sqlite"));
      try {
        assert.equal(store.list().length, 2);
        await assert.rejects(
          store.record("run-001", path.join(out, "run-001")),
        );
        assert.throws(() => store.list(-1));
      } finally {
        store.close();
      }
      for (const id of ["run-001", "run-002"])
        assert.equal(
          JSON.parse(await readFile(path.join(out, id, "snapshot.json")))
            .tickets.length,
          1,
        );
      await assert.rejects(
        runSeries(scenario, () => new ReferenceAgent("naive"), out, 2),
        /EEXIST/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
