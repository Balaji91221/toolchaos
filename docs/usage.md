# ToolChaos usage guide

[← Project overview](../README.md) · [Architecture](architecture.md)

Run commands from the repository root unless a section says to use a consuming project.

Fault injection for agent tool calls. Package: `toolchaos@0.2.1` on npm; Node.js 22.18+ is required.


## Install the release package

```bash
npm install toolchaos@0.2.1
npx toolchaos demo
```

The package ships compiled ESM JavaScript and TypeScript declarations. The source-checkout recipes below assume you have cloned the repository; installed examples are also available under `node_modules/toolchaos/examples/`.

## Quick start and usage

```bash
git clone https://github.com/Balaji91221/toolchaos.git
cd toolchaos
npm ci
npm run build
npm test
npm run demo
node dist/cli.js run naive report.html       # exit 1: expected duplicate
node dist/cli.js run idempotent report.html  # exit 0: one effect
```

`demo` runs all three reference clients and exits zero when the demo executes. `run` returns 0 for PASS, 1 for FAIL, and 2 for invalid input/infrastructure errors. Reports are written only when explicitly requested.

### Use the library

```ts
import { FaultHarness } from 'toolchaos';
const harness = new FaultHarness(
  async (name, args) => myToolClient.call(name, args),
  [{ tool: 'create_ticket', occurrence: 1, fault: 'drop_response_after_forward' }],
);
await harness.call('create_ticket', { title: 'Example', operationKey: 'op-1' });
```

The SDK signals a lost response by throwing `FaultError` **after** upstream execution. It does not emulate the passage of client timeout time. The protocol proxy below actually withholds the response.

### Put the stdio proxy in front of a test MCP server

```bash
npx --yes toolchaos@0.2.1 proxy /absolute/path/to/lost-response.json -- node /absolute/path/to/server.js
```

Copy the included `examples/lost-response.json` configuration to the absolute path above, then configure the assistant to launch this command instead of the upstream server. The proxy forwards MCP negotiation without implementing a server of its own. It injects faults only into `tools/call` requests; notifications and server-initiated messages pass through. The target server must use newline-delimited stdio JSON-RPC.

Scenario fields: `rules` (required), `timeoutMs` (default 30000, max 3600000), and optional `tracePath`. Trace files are created exclusively, with restrictive permissions, and contain stage/ID/tool metadata rather than raw arguments/results. A proxy deadline or malformed frame exits 2. On POSIX, the proxy terminates the owned process group at shutdown, including descendants that remain in that group. Detached or deliberately escaped processes require an OS sandbox.

Only run fault scenarios against local fixtures or disposable test services. No automatic live service modifications are part of the demo.

## Local installation in another project

Build and package this source folder, then install the resulting tarball in your consuming project:

```bash
npm run build
npm pack
# In the consuming project:
npm install /absolute/path/to/generated-package.tgz
```

The package exports compiled JavaScript and TypeScript declarations. Node.js 22.18 or newer is required. `npm ci` uses the committed dependency lockfile. `npm run typecheck` checks the source; `npm run build` creates `dist/`. The public package is named `toolchaos`; its executable is `toolchaos`. Original code is MIT licensed and dependencies retain their own licenses. Publication remains an explicit maintainer release action.

## Design and current scope

See [FEATURE_MATRIX.md](../FEATURE_MATRIX.md) for the implemented features and [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md) for verification boundaries.

## Complete scenario runs

```bash
npm ci
npm run build
npm test
node dist/cli.js scenario examples/scenario.json idempotent /tmp/toolchaos-run-001
node dist/cli.js scenario examples/scenario.json naive /tmp/toolchaos-run-002
```

Choose a fresh output directory for every run. `idempotent` and `reconcile` should pass; `naive` should fail the one-ticket assertion. Each run launches a real MCP client, a stdio fault proxy, and an isolated ticket server. The manifest records scenario/config hashes, tool schemas, adapter metadata, final fixture state, assertion results, event evidence, runtime, and duration. A scenario whose configured fault was not exercised is INCONCLUSIVE. The coordinator bounds time and tool calls; POSIX proxy shutdown terminates its owned process group. Windows process-tree semantics have not been verified.

`manifest.json`, `snapshot.json`, `trace.jsonl`, and `report.html` are created in the run directory. Trace events contain IDs, tool names, occurrence numbers, and stages, not raw arguments. The fixture snapshot contains synthetic ticket data. User-provided agent metadata is included verbatim: do not put credentials in it.

### Native model integration

The `AnthropicAgent` implements the [Claude Messages tool-use loop](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls). It is opt-in, validates tool-use structure, bounds turns/tokens, and records no API key in manifests.

```bash
# Set ANTHROPIC_API_KEY and TOOLCHAOS_MODEL in your shell first.
node dist/cli.js scenario examples/scenario.json anthropic /tmp/toolchaos-model-001
```

Live calls incur provider usage and send the scenario/task and tool results to that provider. No live paid request was made during local verification. The adapter protocol is integration-tested against a controlled HTTP provider; model quality must be measured separately with repeated runs.

```ts
import { runScenario, ReferenceAgent } from 'toolchaos';
const result = await runScenario(scenario, new ReferenceAgent('reconcile'), '/tmp/new-run');
```

An `AgentAdapter` implements `name`, credential-free `metadata`, and `run(tools, task, signal)`. The coordinator provides only discovered fixture tools and applies the same ground-truth assertions for every adapter.

## Repeated runs and local history

```bash
node dist/cli.js suite examples/scenario.json idempotent /tmp/toolchaos-series-001 3
node dist/cli.js history /tmp/toolchaos-series-001/runs.sqlite
```

`runSeries(scenario, agentFactory, directory, repeats, {signal})` creates a fresh
agent and MCP fixture for each run. Its summary reports passed, failed,
inconclusive, not-run and executed counts; the pass fraction includes incomplete
executed runs in its denominator. It is an observation of this sample, not a
reliability guarantee. SQLite schema 1 stores hashes and paths to immutable run
manifests. `RunStore.record(id, directory)`, `.list(limit)` and `.close()` expose
the metadata index; duplicate IDs/artifact paths are rejected. Node may print an
experimental warning for its bundled SQLite API. Preserve the database together
with its run directories; there is no migration from an unknown schema.

Configuration shape: [JSON Schema](../schemas/scenario.schema.json). Runtime validation additionally enforces cross-field deadlines, duplicate IDs and supported operations. Generated `dist/index.d.ts` exposes the current SDK.
