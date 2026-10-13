import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream } from "node:fs";
import type { Rule } from "./index.ts";
import { FaultHarness } from "./index.ts";
/** Transparent newline-delimited stdio JSON-RPC proxy. Does not implement or alter MCP negotiation. */
export async function runProxy(
  config: { rules: Rule[]; timeoutMs?: number; tracePath?: string },
  command: string[],
): Promise<number> {
  new FaultHarness(async () => null, config.rules); // Reuse validation before starting any process.
  const timeoutMs = config.timeoutMs ?? 30000;
  if (
    !command.length ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 3600000
  )
    throw new Error("Invalid proxy command or deadline");
  const child = spawn(command[0], command.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
    detached: process.platform !== "win32",
  });
  const input = createInterface({ input: process.stdin });
  const output = createInterface({ input: child.stdout });
  const trace = config.tracePath
    ? createWriteStream(config.tracePath, { flags: "wx", mode: 0o600 })
    : null;
  const pending = new Map<
    string,
    { rule: Rule | null; tool: string; occurrence: number }
  >();
  const counts = new Map<string, number>();
  let sequence = 0,
    stopping = false;
  const key = (id: unknown) => JSON.stringify([typeof id, id]);
  const event = (
    stage: string,
    id?: unknown,
    tool?: string,
    fault?: string,
    occurrence?: number,
  ) =>
    trace?.write(
      JSON.stringify({
        sequence: ++sequence,
        stage,
        requestId: id,
        tool,
        fault,
        occurrence,
      }) + "\n",
    );
  const send = (target: NodeJS.WritableStream, message: unknown) =>
    target.write(JSON.stringify(message) + "\n");
  return await new Promise<number>((resolve) => {
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const stop = (code: number) => {
      if (stopping) return;
      stopping = true;
      clearTimeout(deadline);
      input.close();
      output.close();
      child.stdin.end();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (fallback) clearTimeout(fallback);
        process.off("SIGTERM", onSignal);
        process.off("SIGINT", onSignal);
        if (trace && !trace.destroyed) trace.end(() => resolve(code));
        else resolve(code);
      };
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          /* Owned process group already exited. */
        }
      };
      if (!child.pid) {
        finish();
        return;
      }
      if (process.platform !== "win32") {
        kill("SIGTERM");
        // Wait for group cleanup even if the direct child exits first.
        fallback = setTimeout(() => {
          kill("SIGKILL");
          finish();
        }, 200);
      } else if (child.exitCode !== null || child.signalCode !== null) finish();
      else {
        child.once("close", finish);
        kill("SIGTERM");
        fallback = setTimeout(() => {
          kill("SIGKILL");
          finish();
        }, 500);
      }
    };
    const onSignal = () => stop(2);
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
    const deadline = setTimeout(() => {
      event("deadline_exceeded");
      stop(2);
    }, timeoutMs);
    trace?.on("error", (error) => {
      console.error(`Trace failed: ${error.message}`);
      stop(2);
    });
    child.on("error", (error) => {
      console.error(`Upstream failed: ${error.message}`);
      stop(2);
    });
    child.stdin.on("error", () => stop(2));
    child.on("close", (code) => {
      if (!stopping) stop(code === 0 && pending.size === 0 ? 0 : 2);
    });
    input.on("close", () => {
      if (!stopping) child.stdin.end();
    });
    input.on("line", (line) => {
      if (stopping) return;
      try {
        if (line.length > 1024 * 1024) throw new Error("Message exceeds 1 MiB");
        const message = JSON.parse(line);
        if (!message || Array.isArray(message) || typeof message !== "object")
          throw new Error("Expected JSON-RPC object");
        if (message.method === "tools/call" && Object.hasOwn(message, "id")) {
          const tool = message.params?.name;
          if (typeof tool !== "string") throw new Error("Invalid tool name");
          const id = key(message.id);
          if (pending.has(id))
            throw new Error("Duplicate in-flight request ID");
          const n = (counts.get(tool) ?? 0) + 1;
          counts.set(tool, n);
          const rule =
            config.rules.find((r) => r.tool === tool && r.occurrence === n) ??
            null;
          event("request_received", message.id, tool, rule?.fault, n);
          if (rule?.fault === "error_before_forward") {
            event("fault_applied", message.id, tool, rule.fault, n);
            send(process.stdout, {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32000,
                message: "Injected pre-execution failure",
              },
            });
            return;
          }
          pending.set(id, { tool, rule, occurrence: n });
          event("request_forwarded", message.id, tool, rule?.fault, n);
        }
        send(child.stdin, message);
      } catch (error) {
        console.error(String(error));
        stop(2);
      }
    });
    output.on("line", (line) => {
      if (stopping) return;
      try {
        if (line.length > 1024 * 1024) throw new Error("Message exceeds 1 MiB");
        const message = JSON.parse(line);
        if (!message || Array.isArray(message) || typeof message !== "object")
          throw new Error("Expected upstream JSON-RPC object");
        // Server-initiated requests can reuse IDs in the opposite direction.
        const id = key(message.id),
          entry = message.method === undefined ? pending.get(id) : undefined;
        if (entry) {
          pending.delete(id);
          event(
            "upstream_response_received",
            message.id,
            entry.tool,
            entry.rule?.fault,
            entry.occurrence,
          );
          if (entry.rule?.fault === "drop_response_after_forward") {
            event(
              "fault_applied",
              message.id,
              entry.tool,
              entry.rule.fault,
              entry.occurrence,
            );
            return;
          }
          if (entry.rule?.fault === "replace_response") {
            delete message.error;
            message.result = { malformed: true };
            event(
              "fault_applied",
              message.id,
              entry.tool,
              entry.rule.fault,
              entry.occurrence,
            );
          }
          event(
            "response_delivered",
            message.id,
            entry.tool,
            entry.rule?.fault,
            entry.occurrence,
          );
        }
        send(process.stdout, message);
      } catch (error) {
        console.error(String(error));
        stop(2);
      }
    });
  });
}
