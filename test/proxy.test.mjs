import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
async function run(rules, messages) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-"));
  try {
    const trace = path.join(dir, "trace.jsonl");
    const scenario = path.join(dir, "scenario.json");
    await writeFile(
      scenario,
      JSON.stringify({ rules, timeoutMs: 2000, tracePath: trace }),
    );
    const mock = path.join(dir, "mock.cjs");
    await writeFile(
      mock,
      `let count=0;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!Object.hasOwn(m,'id'))return;if(m.method==='tools/call')count++;console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{count}}));});`,
    );
    const p = spawn(process.execPath, [
      cli,
      "proxy",
      scenario,
      "--",
      process.execPath,
      mock,
    ]);
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
    const code = await new Promise((r) => p.on("close", r));
    assert.equal(code, 0, stderr);
    return {
      responses: stdout.trim().split("\n").filter(Boolean).map(JSON.parse),
      events: (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const call = (id) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "create_ticket", arguments: { secret: "not-in-trace" } },
});
test("proxy drops committed response and preserves string/number IDs", async () => {
  const r = await run(
    [
      {
        tool: "create_ticket",
        occurrence: 1,
        fault: "drop_response_after_forward",
      },
    ],
    [call(1), call("1")],
  );
  assert.equal(r.responses.length, 1);
  assert.equal(r.responses[0].id, "1");
  assert.equal(r.responses[0].result.count, 2);
  assert.equal(
    r.events.filter((e) => e.stage === "upstream_response_received").length,
    2,
  );
  assert.ok(!JSON.stringify(r.events).includes("not-in-trace"));
});
test("pre-forward error prevents upstream mutation", async () => {
  const r = await run(
    [{ tool: "create_ticket", occurrence: 1, fault: "error_before_forward" }],
    [call(1), call(2)],
  );
  assert.ok(r.responses[0].error);
  assert.equal(r.responses[1].result.count, 1);
});
test("notifications and initialization pass through", async () => {
  const r = await run(
    [],
    [
      { jsonrpc: "2.0", id: 0, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      call(1),
    ],
  );
  assert.deepEqual(
    r.responses.map((m) => m.id),
    [0, 1],
  );
});

test(
  "proxy deadline cleans an owned descendant process group",
  { timeout: 12000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chaos-group-"));
    let descendant, p, closed, lines, readinessTimer;
    let stderr = "";
    try {
      const parent = path.join(dir, "parent.cjs");
      await writeFile(
        parent,
        `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send({ready:true});setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
child.once('message',()=>console.log(JSON.stringify({jsonrpc:'2.0',method:'test/descendantReady',params:{pid:child.pid}})));
setInterval(()=>{},1000);`,
      );
      const scenario = path.join(dir, "scenario.json");
      const trace = path.join(dir, "trace.jsonl");
      await writeFile(
        scenario,
        JSON.stringify({ rules: [], timeoutMs: 5000, tracePath: trace }),
      );
      p = spawn(process.execPath, [
        cli,
        "proxy",
        scenario,
        "--",
        process.execPath,
        parent,
      ]);
      // Register completion immediately so an early exit cannot be missed.
      closed = new Promise((resolve) =>
        p.once("close", (code, signal) => resolve({ code, signal })),
      );
      p.stderr.on("data", (data) => (stderr += data));
      lines = createInterface({ input: p.stdout });
      const ready = new Promise((resolve, reject) => {
        readinessTimer = setTimeout(
          () => reject(new Error(`Descendant did not become ready: ${stderr}`)),
          4000,
        );
        p.once("error", reject);
        closed.then(({ code, signal }) =>
          reject(
            new Error(
              `Proxy exited before readiness (${code}, ${signal}): ${stderr}`,
            ),
          ),
        );
        lines.on("line", (line) => {
          try {
            const message = JSON.parse(line);
            if (message.method === "test/descendantReady")
              resolve(message.params.pid);
          } catch (error) {
            reject(error);
          }
        });
      });
      // The descendant emits readiness only after its SIGTERM handler is installed.
      descendant = await ready;
      clearTimeout(readinessTimer);
      assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
      process.kill(descendant, 0);
      const { code, signal } = await closed;
      assert.equal(code, 2, stderr);
      assert.equal(signal, null, stderr);
      const events = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.ok(events.some((event) => event.stage === "deadline_exceeded"));
      let alive = true;
      const cleanupDeadline = Date.now() + 2000;
      while (Date.now() < cleanupDeadline) {
        try {
          process.kill(descendant, 0);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
          alive = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(alive, false, "Owned descendant should be terminated");
    } finally {
      clearTimeout(readinessTimer);
      lines?.close();
      if (p && p.exitCode === null && p.signalCode === null) {
        p.kill("SIGTERM");
        const force = setTimeout(() => p.kill("SIGKILL"), 2000);
        try {
          await closed;
        } finally {
          clearTimeout(force);
        }
      }
      if (Number.isSafeInteger(descendant) && descendant > 0)
        try {
          process.kill(descendant, "SIGKILL");
        } catch {}
      await rm(dir, { recursive: true, force: true });
    }
  },
);
