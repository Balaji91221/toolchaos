import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { FaultHarness, writeReport, type Rule } from "./index.ts";
import type { AgentAdapter, AgentTools } from "./agent.ts";
export type Scenario = {
  schemaVersion: 1;
  id: string;
  task: string;
  rules: Rule[];
  timeoutMs?: number;
  toolTimeoutMs?: number;
  expectedTickets: number;
  maxToolCalls?: number;
};
export async function runScenario(
  scenario: Scenario,
  agent: AgentAdapter,
  output: string,
  options: { signal?: AbortSignal } = {},
) {
  if (
    scenario.schemaVersion !== 1 ||
    typeof scenario.id !== "string" ||
    !scenario.id.trim() ||
    typeof scenario.task !== "string" ||
    !scenario.task.trim() ||
    !Number.isInteger(scenario.expectedTickets) ||
    scenario.expectedTickets < 0
  )
    throw new Error("Invalid scenario");
  new FaultHarness(async () => null, scenario.rules);
  const timeout = scenario.timeoutMs ?? 10000,
    toolTimeout = scenario.toolTimeoutMs ?? 200,
    maxCalls = scenario.maxToolCalls ?? 10;
  if (
    !Number.isFinite(timeout) ||
    timeout < 100 ||
    timeout > 600000 ||
    !Number.isFinite(toolTimeout) ||
    toolTimeout < 10 ||
    toolTimeout >= timeout ||
    !Number.isInteger(maxCalls) ||
    maxCalls < 1 ||
    maxCalls > 1000
  )
    throw new Error("Invalid run limits");
  await mkdir(output, { recursive: false, mode: 0o700 });
  output = path.resolve(output);
  const started = Date.now();
  const controller = new AbortController();
  let runTimer: ReturnType<typeof setTimeout>;
  const cancellation = () => controller.abort();
  options.signal?.addEventListener("abort", cancellation, { once: true });
  if (options.signal?.aborted) controller.abort();
  const config = {
    rules: scenario.rules,
    timeoutMs: timeout + 1000,
    tracePath: path.join(output, "trace.jsonl"),
  };
  await writeFile(path.join(output, "proxy.json"), JSON.stringify(config), {
    flag: "wx",
    mode: 0o600,
  });
  const cli = fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts") ? "./cli.ts" : "./cli.js",
      import.meta.url,
    ),
  );
  const client = new Client({ name: "toolchaos-runner", version: "0.2.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      cli,
      "proxy",
      path.join(output, "proxy.json"),
      "--",
      process.execPath,
      cli,
      "fixture",
      path.join(output, "snapshot.json"),
    ],
    stderr: "pipe",
  });
  let status = "completed",
    error: string | undefined,
    calls = 0;
  const toolSchemas: unknown[] = [];
  const deadline = new Promise<never>((_, reject) => {
    runTimer = setTimeout(() => {
      controller.abort();
      reject(new Error("Run deadline exceeded"));
    }, timeout);
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("Run cancelled or deadline exceeded")),
      { once: true },
    );
  });
  try {
    await Promise.race([
      (async () => {
        await client.connect(transport);
        const list = await client.listTools();
        toolSchemas.push(...list.tools);
        const tools: AgentTools = {
          async list() {
            return list.tools;
          },
          async call(name, args) {
            controller.signal.throwIfAborted();
            if (++calls > maxCalls) throw new Error("Tool call limit exceeded");
            const result: any = await client.callTool(
              { name, arguments: args },
              undefined,
              { timeout: toolTimeout, signal: controller.signal },
            );
            if (result.isError) throw new Error("Tool execution error");
            const text = result.content?.find(
              (c: any) => c.type === "text",
            )?.text;
            if (typeof text !== "string")
              throw new Error("Malformed tool result");
            return JSON.parse(text);
          },
        };
        await agent.run(tools, scenario.task, controller.signal);
      })(),
      deadline,
    ]);
  } catch (e) {
    status = controller.signal.aborted
      ? "interrupted"
      : "infrastructure_failed";
    error = String(e);
  } finally {
    clearTimeout(runTimer!);
    controller.abort();
    options.signal?.removeEventListener("abort", cancellation);
    await client.close();
  }
  let snapshot: any = null,
    events: any[] = [];
  try {
    snapshot = JSON.parse(
      await readFile(path.join(output, "snapshot.json"), "utf8"),
    );
    events = (await readFile(path.join(output, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((x) => JSON.parse(x));
  } catch (e) {
    status = "infrastructure_failed";
    error = String(e);
  }
  const assertions = [
    {
      name: "ticket_count",
      expected: scenario.expectedTickets,
      actual: snapshot?.tickets?.length,
      passed: snapshot?.tickets?.length === scenario.expectedTickets,
    },
    {
      name: "bounded_tool_calls",
      expected: maxCalls,
      actual: calls,
      passed: calls <= maxCalls,
    },
  ];
  const exercised = scenario.rules.every((rule) =>
    events.some(
      (e) =>
        e.stage === "fault_applied" &&
        e.tool === rule.tool &&
        e.fault === rule.fault &&
        e.occurrence === rule.occurrence,
    ),
  );
  if (!exercised && status === "completed") {
    status = "incomplete";
    error = "Not every configured fault was exercised";
  }
  const result = {
    schemaVersion: 1,
    scenario,
    agent: { name: agent.name, ...agent.metadata },
    configHash: createHash("sha256")
      .update(JSON.stringify({ scenario, agent: agent.metadata }))
      .digest("hex"),
    runtime: process.version,
    toolSchemas,
    status,
    verdict:
      status !== "completed"
        ? "INCONCLUSIVE"
        : assertions.every((a) => a.passed)
          ? "PASS"
          : "FAIL",
    assertions,
    snapshot,
    events,
    error,
    durationMs: Date.now() - started,
  };
  await writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeReport(path.join(output, "report.html"), result);
  return result;
}
