import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFile, rename } from "node:fs/promises";
export async function startTicketFixture(snapshotFile: string) {
  const tickets: Array<{ id: string; title: string; operationKey: string }> =
    [];
  const persist = async () => {
    await writeFile(
      snapshotFile + ".tmp",
      JSON.stringify({ schemaVersion: 1, tickets }, null, 2),
      { mode: 0o600 },
    );
    await rename(snapshotFile + ".tmp", snapshotFile);
  };
  await persist();
  const server = new Server(
    { name: "toolchaos-ticket-fixture", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_ticket",
        description:
          "Create one ticket. Reuse operationKey to deduplicate retries.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            operationKey: { type: "string" },
          },
          required: ["title", "operationKey"],
          additionalProperties: false,
        },
      },
      {
        name: "find_ticket",
        description:
          "Find an existing ticket by operationKey after uncertain execution.",
        inputSchema: {
          type: "object",
          properties: { operationKey: { type: "string" } },
          required: ["operationKey"],
          additionalProperties: false,
        },
      },
    ],
  }));
  let chain = Promise.resolve();
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    let result: unknown;
    let error = false;
    const action = async () => {
      try {
        const args = request.params.arguments ?? {};
        if (typeof args.operationKey !== "string" || !args.operationKey)
          throw new Error("operationKey required");
        if (request.params.name === "create_ticket") {
          if (typeof args.title !== "string" || !args.title.trim())
            throw new Error("title required");
          const existing = tickets.find(
            (t) => t.operationKey === args.operationKey,
          );
          if (existing && existing.title !== args.title)
            throw new Error("Operation key conflict");
          if (existing) result = existing;
          else {
            const t = {
              id: `T${tickets.length + 1}`,
              title: args.title,
              operationKey: args.operationKey,
            };
            tickets.push(t);
            await persist();
            result = t;
          }
        } else if (request.params.name === "find_ticket")
          result =
            tickets.find((t) => t.operationKey === args.operationKey) ?? null;
        else throw new Error("Unknown tool");
      } catch (e) {
        error = true;
        result = { error: String(e) };
      }
    };
    const work = chain.then(action);
    chain = work.catch(() => {});
    await work;
    return {
      isError: error,
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  });
  await server.connect(new StdioServerTransport());
  return server;
}
