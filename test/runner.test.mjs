import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { runScenario, ReferenceAgent, AnthropicAgent } from "../src/index.ts";
const scenario = {
  schemaVersion: 1,
  id: "lost",
  task: "Payment failed",
  rules: [
    {
      tool: "create_ticket",
      occurrence: 1,
      fault: "drop_response_after_forward",
    },
  ],
  timeoutMs: 5000,
  toolTimeoutMs: 100,
  expectedTickets: 1,
  maxToolCalls: 5,
};
test(
  "MCP scenario runner differentiates recovery strategies and records ground truth",
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-run-"));
    try {
      for (const strategy of ["naive", "idempotent", "reconcile"]) {
        const output = path.join(dir, strategy);
        const result = await runScenario(
          scenario,
          new ReferenceAgent(strategy),
          output,
        );
        assert.equal(
          result.verdict,
          strategy === "naive" ? "FAIL" : "PASS",
          JSON.stringify(result),
        );
        assert.ok(result.events.some((e) => e.stage === "fault_applied"));
        assert.ok(
          (await readFile(path.join(output, "manifest.json"), "utf8")).includes(
            "configHash",
          ),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("unexercised scenario is inconclusive", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-unused-"));
  try {
    const r = await runScenario(
      scenario,
      { name: "noop", metadata: {}, async run() {} },
      path.join(dir, "run"),
    );
    assert.equal(r.verdict, "INCONCLUSIVE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  "hung agent is cancelled and returns evidence",
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-timeout-"));
    try {
      const r = await runScenario(
        { ...scenario, timeoutMs: 1000 },
        {
          name: "hung",
          metadata: {},
          run() {
            return new Promise(() => {});
          },
        },
        path.join(dir, "run"),
      );
      assert.equal(r.verdict, "INCONCLUSIVE");
      assert.ok(r.durationMs < 6000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("native Messages adapter handles tool_use and tool_result", async () => {
  let n = 0,
    receivedResult = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const m = JSON.parse(body);
      n++;
      res.setHeader("Content-Type", "application/json");
      if (n === 1)
        res.end(
          JSON.stringify({
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "call1",
                name: "create_ticket",
                input: { title: "x", operationKey: "1" },
              },
            ],
          }),
        );
      else {
        receivedResult = m.messages.at(-1).content[0].type === "tool_result";
        res.end(
          JSON.stringify({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "done" }],
          }),
        );
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await new AnthropicAgent({
      model: "fixture",
      apiKey: "test-token",
      endpoint: `http://127.0.0.1:${server.address().port}`,
    }).run(
      {
        async list() {
          return [{ name: "create_ticket", inputSchema: { type: "object" } }];
        },
        async call() {
          return { id: "1" };
        },
      },
      "task",
      new AbortController().signal,
    );
    assert.equal(receivedResult, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test(
  "every configured occurrence must be exercised independently",
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-occurrence-"));
    try {
      const r = await runScenario(
        {
          ...scenario,
          rules: [...scenario.rules, { ...scenario.rules[0], occurrence: 3 }],
        },
        new ReferenceAgent("idempotent"),
        path.join(dir, "run"),
      );
      assert.equal(r.verdict, "INCONCLUSIVE");
      assert.equal(r.status, "incomplete");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("native adapter does not follow credential-bearing redirects", async () => {
  let forwarded = 0;
  const target = createServer((req, res) => {
    forwarded++;
    res.end("{}");
  });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const origin = createServer((req, res) => {
    res.writeHead(307, {
      Location: `http://127.0.0.1:${target.address().port}`,
    });
    res.end();
  });
  await new Promise((r) => origin.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      new AnthropicAgent({
        model: "fixture",
        apiKey: "dummy",
        endpoint: `http://127.0.0.1:${origin.address().port}`,
      }).run(
        {
          async list() {
            return [];
          },
          async call() {},
        },
        "test",
        new AbortController().signal,
      ),
    );
    assert.equal(forwarded, 0);
  } finally {
    await Promise.all([
      new Promise((r) => origin.close(r)),
      new Promise((r) => target.close(r)),
    ]);
  }
});
