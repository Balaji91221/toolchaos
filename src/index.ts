import { writeFile } from "node:fs/promises";
export type FaultKind =
  "error_before_forward" | "drop_response_after_forward" | "replace_response";
export type Rule = { tool: string; occurrence: number; fault: FaultKind };
export type ToolHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
export class FaultError extends Error {
  kind: FaultKind;
  constructor(kind: FaultKind) {
    super(kind);
    this.kind = kind;
  }
}
export class FaultHarness {
  private counts = new Map<string, number>();
  private handler: ToolHandler;
  private rules: Rule[];
  readonly events: Array<{
    sequence: number;
    requestId: number;
    stage: string;
    tool: string;
    fault?: string;
  }> = [];
  private nextId = 0;
  constructor(handler: ToolHandler, rules: Rule[]) {
    for (const rule of rules)
      if (
        !rule.tool ||
        !Number.isInteger(rule.occurrence) ||
        rule.occurrence < 1 ||
        ![
          "error_before_forward",
          "drop_response_after_forward",
          "replace_response",
        ].includes(rule.fault)
      )
        throw new Error("Invalid fault rule");
    if (
      new Set(rules.map((r) => JSON.stringify([r.tool, r.occurrence]))).size !==
      rules.length
    )
      throw new Error("Overlapping fault rules");
    this.handler = handler;
    this.rules = structuredClone(rules);
  }
  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const requestId = ++this.nextId;
    const occurrence = (this.counts.get(tool) ?? 0) + 1;
    this.counts.set(tool, occurrence);
    const rule = this.rules.find(
      (r) => r.tool === tool && r.occurrence === occurrence,
    );
    const record = (stage: string) =>
      this.events.push({
        sequence: this.events.length + 1,
        requestId,
        stage,
        tool,
        ...(rule ? { fault: rule.fault } : {}),
      });
    record("request_received");
    if (rule?.fault === "error_before_forward") {
      record("fault_applied");
      throw new FaultError(rule.fault);
    }
    record("request_forwarded");
    let result;
    try {
      result = await this.handler(tool, structuredClone(args));
    } catch (error) {
      record("upstream_error");
      throw error;
    }
    record("upstream_response_received");
    if (rule?.fault === "drop_response_after_forward") {
      record("fault_applied");
      throw new FaultError(rule.fault);
    }
    if (rule?.fault === "replace_response") {
      record("fault_applied");
      result = { malformed: true };
    }
    record("response_delivered");
    return result;
  }
}
export async function runRecovery(
  strategy: "naive" | "idempotent" | "reconcile",
  fault: FaultKind = "drop_response_after_forward",
) {
  if (!["naive", "idempotent", "reconcile"].includes(strategy))
    throw new Error("Unknown strategy");
  const tickets: Array<{ id: string; title: string; operationKey: string }> =
    [];
  const handler: ToolHandler = async (name, args) => {
    if (name === "find_ticket")
      return tickets.find((t) => t.title === args.title) ?? null;
    if (name !== "create_ticket") throw new Error("Unknown tool");
    const old = tickets.find((t) => t.operationKey === args.operationKey);
    if (old) return { ...old };
    const ticket = {
      id: `T${tickets.length + 1}`,
      title: String(args.title),
      operationKey: String(args.operationKey),
    };
    tickets.push(ticket);
    return { ...ticket };
  };
  const harness = new FaultHarness(handler, [
    { tool: "create_ticket", occurrence: 1, fault },
  ]);
  let result: unknown;
  try {
    result = await harness.call("create_ticket", {
      title: "Payment failed",
      operationKey: "op-1",
    });
    if (!(result as any)?.id) throw new Error("Malformed response");
  } catch {
    if (strategy === "reconcile")
      result = await harness.call("find_ticket", { title: "Payment failed" });
    if (!result || !(result as any).id)
      result = await harness.call("create_ticket", {
        title: "Payment failed",
        operationKey: strategy === "naive" ? "op-2" : "op-1",
      });
  }
  const verdict = tickets.length === 1 ? "PASS" : "FAIL";
  return {
    schemaVersion: 1,
    strategy,
    fault,
    verdict,
    tickets,
    events: harness.events,
  };
}
export async function writeReport(path: string, result: unknown) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  await writeFile(
    path,
    `<!doctype html><meta charset="utf-8"><title>ToolChaos report</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto}pre{white-space:pre-wrap;background:#f4f5f7;padding:24px}</style><h1>ToolChaos recovery evidence</h1><pre>${escape(JSON.stringify(result, null, 2))}</pre>`,
  );
}

export { runScenario } from "./runner.ts";
export type { Scenario } from "./runner.ts";
export { ReferenceAgent, AnthropicAgent } from "./agent.ts";
export type { AgentAdapter, AgentTools } from "./agent.ts";

export { RunStore, runSeries } from "./history.ts";
