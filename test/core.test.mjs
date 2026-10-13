import test from "node:test";
import assert from "node:assert/strict";
import { FaultHarness, runRecovery } from "../src/index.ts";
test("lost response distinguishes naive, idempotent, and reconciliation clients", async () => {
  assert.equal((await runRecovery("naive")).verdict, "FAIL");
  for (const s of ["idempotent", "reconcile"])
    assert.equal((await runRecovery(s)).verdict, "PASS");
});
test("failure before forward cannot mutate upstream", async () => {
  let writes = 0;
  const h = new FaultHarness(
    async () => ++writes,
    [{ tool: "write", occurrence: 1, fault: "error_before_forward" }],
  );
  await assert.rejects(h.call("write", {}));
  assert.equal(writes, 0);
  assert.equal(await h.call("write", {}), 1);
});
test("lost response happens after upstream commit", async () => {
  let writes = 0;
  const h = new FaultHarness(
    async () => ++writes,
    [{ tool: "write", occurrence: 1, fault: "drop_response_after_forward" }],
  );
  await assert.rejects(h.call("write", {}));
  assert.equal(writes, 1);
  assert.deepEqual(
    h.events.map((e) => e.stage),
    [
      "request_received",
      "request_forwarded",
      "upstream_response_received",
      "fault_applied",
    ],
  );
});
test("concurrent exchanges keep unique request IDs and one fault", async () => {
  const h = new FaultHarness(
    async () => ({ ok: true }),
    [{ tool: "write", occurrence: 2, fault: "replace_response" }],
  );
  const results = await Promise.all([
    h.call("write", {}),
    h.call("write", {}),
    h.call("read", {}),
  ]);
  assert.deepEqual(results, [{ ok: true }, { malformed: true }, { ok: true }]);
  assert.equal(h.events.filter((e) => e.stage === "fault_applied").length, 1);
});
test("invalid and overlapping rules fail before execution", () => {
  assert.throws(
    () =>
      new FaultHarness(
        async () => 0,
        [{ tool: "x", occurrence: 0, fault: "replace_response" }],
      ),
  );
  assert.throws(
    () =>
      new FaultHarness(
        async () => 0,
        [
          { tool: "x", occurrence: 1, fault: "replace_response" },
          { tool: "x", occurrence: 1, fault: "error_before_forward" },
        ],
      ),
  );
});
test("malformed response recovery does not duplicate idempotent action", async () => {
  assert.equal(
    (await runRecovery("idempotent", "replace_response")).verdict,
    "PASS",
  );
});
