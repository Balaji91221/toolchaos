<h1 align="center">ToolChaos</h1>
<p align="center"><strong>Make tool failures reproducible. Make recovery measurable.</strong></p>
<p align="center">An SDK, CLI, and MCP proxy for testing what an AI agent does when a tool fails, replies incorrectly, or completes an action whose response never arrives.</p>

<p align="center">
  <a href="https://github.com/Balaji91221/toolchaos/actions/workflows/ci.yml"><img src="https://github.com/Balaji91221/toolchaos/actions/workflows/ci.yml/badge.svg" alt="GitHub Actions CI"></a>
  <a href="https://github.com/Balaji91221/toolchaos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.18-339933" alt="Node.js 22.18 or newer"></a>
  <a href="#usage"><img src="https://img.shields.io/badge/SDK-TypeScript-3178C6" alt="TypeScript SDK"></a>
  <a href="#mcp-proxy"><img src="https://img.shields.io/badge/MCP-stdio%20proxy-6750A4" alt="MCP stdio proxy"></a>
</p>

<p align="center">
  <a href="#why-i-built-it">Why</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#docs">Docs</a>
</p>

![ToolChaos workflow: inject a fault, observe agent recovery, and check the final state](https://raw.githubusercontent.com/Balaji91221/toolchaos/main/docs/assets/overview.svg)

## Why I built it

I built ToolChaos to focus on a practical AI engineering problem: an agent can say a task succeeded while leaving the wrong state behind. A successful tool call is only one part of the story. Retries, timeouts, and uncertain outcomes need their own tests.

The goal is to turn recovery behavior into something I can inspect: the fault that happened, the calls that followed, and the result in the test service. It is useful when building tool-using agents, MCP integrations, or recovery logic.

## The problem → the solution

An agent creates a support ticket. The service saves it, but the response disappears. The agent retries with a new operation key and creates a second ticket.

**ToolChaos reproduces that sequence and checks the stored tickets.** A convincing final answer does not override a failing assertion.

| What can go wrong? | What ToolChaos gives you |
| --- | --- |
| A tool fails before doing any work | A repeatable pre-execution error |
| An action succeeds but its reply disappears | A lost-response fault and visible recovery trace |
| A reply has an unexpected shape | A malformed-result fault |
| A test never reaches the intended fault | An `INCONCLUSIVE` result instead of a pass |

### Core capabilities

- **Three fault types:** fail before forwarding, drop a committed response, or replace its payload.
- **Two integration levels:** wrap a function with the SDK or put a stdio proxy in front of an MCP server.
- **Complete local scenarios:** run reference recovery strategies against an isolated ticket fixture with time and call limits.
- **Evidence you can inspect:** save assertions, final state, tool schemas, event traces, and an HTML report.
- **Repeated runs:** use fresh fixtures and collect manifest metadata in a local SQLite index.

## Quick start


Requires **Node.js 22.18+**. In your Node project or an empty working directory, install the package and run its included synthetic ticket scenario. No model API key is needed.

```bash
npm install toolchaos@0.2.1

# The runner creates its output directory, so give it a fresh child path.
demo_root="$(mktemp -d)"
npx toolchaos scenario node_modules/toolchaos/examples/scenario.json reconcile "$demo_root/recovery"
```

Expected result: **`PASS`**, `status: "completed"`, and one ticket. Open `report.html` inside the printed output directory to inspect the evidence.

![Formatted ToolChaos fixture result showing recovery evidence](https://raw.githubusercontent.com/Balaji91221/toolchaos/main/docs/assets/demo.png)

*Formatted summary of an actual local reference run, generated with the [documentation helper](https://github.com/Balaji91221/toolchaos/blob/main/docs/assets/README.md). No live model call.*

Compare all three strategies without creating report files:

```bash
npx toolchaos demo
```

| Reference strategy | Expected verdict | Final tickets |
| --- | --- | --- |
| `naive` — retries with a new operation key | `FAIL` | 2 |
| `idempotent` — reuses the operation key | `PASS` | 1 |
| `reconcile` — checks whether the action already happened | `PASS` | 1 |

The demo command exits 0 when it executes successfully, even though it includes the intentional failing strategy. Individual scenario commands return 0 for `PASS`, 1 for `FAIL`, and 2 for `INCONCLUSIVE` or an input/infrastructure error.

## Usage

### Use the installed SDK

The `toolchaos` package includes compiled ESM JavaScript, TypeScript declarations, the CLI, and example scenarios. Save this as an `.mjs` file, or use a project with `"type": "module"`:

```js
import { runRecovery } from 'toolchaos';

const result = await runRecovery('reconcile');
console.log(result.verdict);        // PASS
console.log(result.tickets.length); // 1
console.log(result.events);         // Fault and recovery sequence
```

For your own tools, `FaultHarness` wraps an async `(name, args) => result` function. For complete agent runs, `runScenario` accepts an `AgentAdapter`. The [usage guide](https://github.com/Balaji91221/toolchaos/blob/main/docs/usage.md) covers both, repeated runs, and the optional Anthropic adapter.

### MCP proxy

Copy `node_modules/toolchaos/examples/lost-response.json` to a known absolute path. Launch a **disposable test MCP server** through the pinned proxy command:

```bash
npx --yes toolchaos@0.2.1 proxy /absolute/path/to/lost-response.json -- \
  node /absolute/path/to/test-mcp-server.js
```

Configure the MCP client to launch that command instead of the upstream server. ToolChaos forwards the server's existing tools; it does not add `toolchaos_*` tools. The bundled ticket fixture exposes `create_ticket` and `find_ticket`.

The proxy deadline bounds the whole session. A client's request timeout must be shorter to leave time for recovery after a dropped response. The scenario runner configures these bounds for you. See [MCP connection details](https://github.com/Balaji91221/toolchaos/blob/main/docs/usage.md#put-the-stdio-proxy-in-front-of-a-test-mcp-server).

## Architecture

| Component | Responsibility |
| --- | --- |
| [`src/index.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/index.ts) | Function-level fault injection and recovery examples |
| [`src/proxy.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/proxy.ts) | Faults in newline-delimited MCP traffic and subprocess cleanup |
| [`src/runner.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/runner.ts) | Run limits, fixture lifecycle, assertions, and evidence |
| [`src/agent.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/agent.ts) | Reference strategies and the optional model adapter |
| [`src/fixture.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/fixture.ts) | Synthetic ticket state and operation-key deduplication |
| [`src/history.ts`](https://github.com/Balaji91221/toolchaos/blob/main/src/history.ts) | Repeated runs and the SQLite manifest index |

Read the [HLD and LLD](https://github.com/Balaji91221/toolchaos/blob/main/docs/architecture.md) for contracts, state ownership, failure semantics, and design tradeoffs.

### Boundaries

The built-in scenario runner evaluates the bundled ticket fixture; it is not a general benchmark for every external service. The proxy supports newline-delimited stdio MCP, not HTTP MCP. The SDK represents a lost reply by throwing after execution; the proxy actually withholds the reply.

Use local fixtures or disposable services. POSIX cleanup covers descendants that remain in the owned process group; it is not a hostile-code sandbox. Live-model quality and production reliability need separate evaluation. See [security guidance](https://github.com/Balaji91221/toolchaos/blob/main/SECURITY.md).

## Docs

| Start here | Go deeper |
| --- | --- |
| [Usage and integration recipes](https://github.com/Balaji91221/toolchaos/blob/main/docs/usage.md) | [Architecture: HLD and LLD](https://github.com/Balaji91221/toolchaos/blob/main/docs/architecture.md) |
| [Scenario JSON Schema](https://github.com/Balaji91221/toolchaos/blob/main/schemas/scenario.schema.json) | [Feature matrix](https://github.com/Balaji91221/toolchaos/blob/main/FEATURE_MATRIX.md) |
| [Implementation and verification status](https://github.com/Balaji91221/toolchaos/blob/main/IMPLEMENTATION_STATUS.md) | [Contribution guide](https://github.com/Balaji91221/toolchaos/blob/main/CONTRIBUTING.md) |

### Develop from source

```bash
git clone https://github.com/Balaji91221/toolchaos.git
cd toolchaos
npm ci
npm run typecheck
npm run build
npm test
```

For a local package check, run `npm pack` and install the generated `toolchaos-0.2.1.tgz` in an empty consuming project. Publishing is a separate release action.

Tests cover injected faults, recovery strategies, MCP forwarding, run evidence, repeated runs, cancellation, and process cleanup. The CI badge links to current hosted results.

Contributions are welcome through [issues](https://github.com/Balaji91221/toolchaos/issues) and pull requests. Read [CONTRIBUTING.md](https://github.com/Balaji91221/toolchaos/blob/main/CONTRIBUTING.md) before changing an adapter or assertion. Original code is available under the [MIT license](https://github.com/Balaji91221/toolchaos/blob/main/LICENSE).
