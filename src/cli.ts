#!/usr/bin/env node
import {
  runScenario,
  runSeries,
  RunStore,
  ReferenceAgent,
  AnthropicAgent,
  runRecovery,
  writeReport,
} from "./index.ts";
import { startTicketFixture } from "./fixture.ts";
import { runProxy } from "./proxy.ts";
import { readFile } from "node:fs/promises";
try {
  const command = process.argv[2] ?? "demo";
  if (command === "fixture") {
    if (!process.argv[3]) throw new Error("fixture SNAPSHOT_PATH");
    await startTicketFixture(process.argv[3]);
  } else if (command === "history") {
    if (!process.argv[3]) throw new Error("history INDEX.sqlite");
    const store = new RunStore(process.argv[3]);
    try {
      console.log(JSON.stringify(store.list(), null, 2));
    } finally {
      store.close();
    }
  } else if (command === "scenario" || command === "suite") {
    const scenario = JSON.parse(await readFile(process.argv[3], "utf8"));
    const mode = process.argv[4];
    const createAgent = () =>
      mode === "anthropic"
        ? new AnthropicAgent({
            model: process.env.TOOLCHAOS_MODEL ?? "",
            apiKey: process.env.ANTHROPIC_API_KEY ?? "",
          })
        : new ReferenceAgent(mode as any);
    const result =
      command === "suite"
        ? await runSeries(
            scenario,
            createAgent,
            process.argv[5],
            Number(process.argv[6] ?? 3),
          )
        : await runScenario(scenario, createAgent(), process.argv[5]);
    console.log(
      JSON.stringify({
        verdict: result.verdict,
        status: "status" in result ? result.status : result.verdict,
        output: process.argv[5],
      }),
    );
    process.exitCode =
      result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 2;
  } else if (command === "proxy") {
    const delimiter = process.argv.indexOf("--");
    if (delimiter < 0)
      throw new Error("Usage: toolchaos proxy scenario.json -- command args");
    process.exitCode = await runProxy(
      JSON.parse(await readFile(process.argv[3], "utf8")),
      process.argv.slice(delimiter + 1),
    );
  } else {
    if (!["demo", "run"].includes(command))
      throw new Error(
        "Usage: toolchaos demo | run naive|idempotent|reconcile [report.html]",
      );
    const results =
      command === "demo"
        ? await Promise.all(
            ["naive", "idempotent", "reconcile"].map((s) =>
              runRecovery(s as any),
            ),
          )
        : await runRecovery(process.argv[3] as any);
    console.log(JSON.stringify(results, null, 2));
    if (process.argv[4]) await writeReport(process.argv[4], results);
    if (!Array.isArray(results) && results.verdict === "FAIL")
      process.exitCode = 1;
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 2;
}
