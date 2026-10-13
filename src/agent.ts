export type AgentTools = {
  list(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
};
export interface AgentAdapter {
  name: string;
  metadata: Record<string, unknown>;
  run(tools: AgentTools, task: string, signal: AbortSignal): Promise<void>;
}
export class ReferenceAgent implements AgentAdapter {
  name: string;
  metadata: Record<string, unknown>;
  strategy: "naive" | "idempotent" | "reconcile";
  constructor(strategy: "naive" | "idempotent" | "reconcile") {
    if (!["naive", "idempotent", "reconcile"].includes(strategy))
      throw new Error("Invalid strategy");
    this.strategy = strategy;
    this.name = `reference-${strategy}`;
    this.metadata = { strategy, version: 1 };
  }
  async run(tools: AgentTools, task: string, signal: AbortSignal) {
    signal.throwIfAborted();
    try {
      const r: any = await tools.call("create_ticket", {
        title: task,
        operationKey: "op-1",
      });
      if (!r?.id) throw new Error("Malformed result");
    } catch {
      signal.throwIfAborted();
      if (this.strategy === "reconcile") {
        const found: any = await tools.call("find_ticket", {
          operationKey: "op-1",
        });
        if (found?.id) return;
      }
      const r: any = await tools.call("create_ticket", {
        title: task,
        operationKey: this.strategy === "naive" ? "op-2" : "op-1",
      });
      if (!r?.id) throw new Error("Malformed retry");
    }
  }
}
/** Native Anthropic Messages tool loop. Credentials never enter the manifest. */
export class AnthropicAgent implements AgentAdapter {
  name = "anthropic-messages";
  metadata: Record<string, unknown>;
  private options: {
    model: string;
    apiKey: string;
    endpoint?: string;
    maxTurns?: number;
    maxTokens?: number;
  };
  constructor(options: {
    model: string;
    apiKey: string;
    endpoint?: string;
    maxTurns?: number;
    maxTokens?: number;
  }) {
    if (!options.model || !options.apiKey)
      throw new Error("Model and API key required");
    const url = new URL(
      options.endpoint ?? "https://api.anthropic.com/v1/messages",
    );
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Use HTTPS or local test endpoint");
    if (
      !Number.isInteger(options.maxTurns ?? 8) ||
      (options.maxTurns ?? 8) < 1 ||
      (options.maxTurns ?? 8) > 50 ||
      !Number.isInteger(options.maxTokens ?? 1024) ||
      (options.maxTokens ?? 1024) < 1 ||
      (options.maxTokens ?? 1024) > 8192
    )
      throw new Error("Invalid model limits");
    this.options = options;
    this.metadata = {
      model: options.model,
      maxTurns: options.maxTurns ?? 8,
      maxTokens: options.maxTokens ?? 1024,
      promptVersion: 1,
    };
  }
  async run(tools: AgentTools, task: string, signal: AbortSignal) {
    const schema = (await tools.list()).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema,
    }));
    const messages: any[] = [{ role: "user", content: task }];
    for (let turn = 0; turn < (this.options.maxTurns ?? 8); turn++) {
      signal.throwIfAborted();
      const response = await fetch(
        this.options.endpoint ?? "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.options.model,
            max_tokens: this.options.maxTokens ?? 1024,
            system:
              "Complete the task with the supplied tools. A failed response does not prove the action failed. Reconcile uncertain outcomes and avoid duplicate effects.",
            messages,
            tools: schema,
          }),
          signal,
        },
      );
      if (!response.ok)
        throw new Error(`Model request failed: ${response.status}`);
      const body: any = await response.json();
      if (!Array.isArray(body.content))
        throw new Error("Malformed model response");
      messages.push({ role: "assistant", content: body.content });
      const calls = body.content.filter((b: any) => b.type === "tool_use");
      if (!calls.length) {
        if (body.stop_reason !== "end_turn")
          throw new Error("Incomplete model turn");
        return;
      }
      if (calls.length > 20) throw new Error("Too many tool calls in one turn");
      const results: any[] = [];
      for (const call of calls) {
        if (
          typeof call.id !== "string" ||
          typeof call.name !== "string" ||
          !call.input ||
          typeof call.input !== "object" ||
          Array.isArray(call.input)
        )
          throw new Error("Malformed tool use");
        try {
          const result = await tools.call(call.name, call.input);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          signal.throwIfAborted();
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: String(error),
          });
        }
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("Model turn limit reached");
  }
}
