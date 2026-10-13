# ToolChaos project plan

Fault testing for tool-calling agents.

**Status:** Local 0.2.0 roadmap implementation delivered. See [feature matrix](FEATURE_MATRIX.md), [implementation status](IMPLEMENTATION_STATUS.md), and [actual interfaces](README.md). External pilots and live model quality remain separate verification work. **Planning date:** 13 October 2026. Current package identity: `toolchaos`; use the README for the implemented interfaces below.

## Goal and target users

Agent developers and QA engineers who need to reproduce tool failures before shipping an agent.

An external action can succeed while its response is lost. A naive retry may create a second ticket. ToolChaos injects a specified fault and checks recovery against inspectable fixture state.

## Product hypothesis and validation

Stateful fault scenarios with deterministic assertions about agent recovery. Recording alone is insufficient differentiation. Validate the value against existing MCP recorders and agent evaluation tools.

Before expanding the implementation, interview three to five target developers. Ask for a recent concrete failure, current workaround, and a repository or sanitized fixture they can share. A successful pilot means someone other than the author can install the tool, reproduce a useful finding, and explain why it belongs in their workflow. These are validation goals, not established demand.

## First release scope

One stdio MCP proxy, one mock ticket server, three fault types, a bounded run coordinator, JSON traces, and an HTML report. Faults: error before forwarding, drop response after forwarding, and replace a response with malformed content.

**Out of scope:** No production fault injection, hosted multi-tenant service, universal agent adapters, HTTP transport, or model-judged pass/fail in the first release.

## Representative workflow

CLI starts an isolated fixture and proxy → agent calls create_ticket → proxy forwards once → fixture commits a ticket → proxy withholds the response → agent recovers or retries → evaluator inspects calls and final ticket state.

## High level design

```text
Agent process -> MCP proxy -> Stateful fixture process
Scenario compiler -> Proxy rules
Proxy events + Fixture snapshot -> Assertion engine -> JSON/HTML report
```

**Implementation stack:** TypeScript and Node.js; MCP SDK behind a transport adapter; JSONL traces and SQLite run metadata; static HTML reports before a React viewer.

**Architecture choice:** An SDK wrapper is simpler but misses clients outside that SDK. A protocol proxy is the selected MVP because it tests real MCP boundaries. A hosted fault gateway adds operational and privacy complexity without improving the first experiment.

Keep the core as a local library with thin interface adapters. Process boundaries shown above are deliberate; do not split every module into a deployed service. A dashboard is a consumer of the core results, not the owner of domain rules.

## Low level design

| Component | Contract | Responsibility and state |
|---|---|---|
| `ScenarioCompiler` | `compile(config) -> ScenarioPlan` | Pure validation; rejects unsupported faults and contradictory rules. |
| `RunCoordinator` | `execute(plan, agentAdapter) -> RunResult` | Owns child processes, timeout budget, cancellation, and run status. |
| `RuleMatcher` | `match(request) -> FaultRule \| null` | Owns per-run counters, keyed by rule and tool. |
| `ProxySession` | `handle(message) -> void` | Owns request IDs and outstanding upstream exchanges. |
| `AssertionEngine` | `evaluate(events, state) -> Verdict[]` | Owns assertion semantics, never process management. |
| `EventStore` | `append(event) -> sequence` | Owns durable ordered evidence and redaction. |

### Data and state ownership

Run(id, status, startedAt, configHash); FaultRule(id, tool, occurrence, fault); TraceEvent(runId, sequence, requestId, stage, elapsedMs, payload); AssertionResult(id, verdict, evidenceIds). Lifecycle: created → starting → running → evaluating → completed; terminal alternatives: timed_out, cancelled, infrastructure_failed. Verdict is independently PASS, FAIL, or INCONCLUSIVE.

### Invariants

Request and response ordering may differ: correlate by ID. Notifications never enter request tracking. Record upstream response and delivered response separately. A selected occurrence fires once per run. Fixture state is isolated. A crashed harness produces INCONCLUSIVE, not an agent failure.

### Failure and concurrency behavior

Dropping a response must occur after forwarding and receiving the upstream result. Apply bounded overall timeouts so a waiting client cannot hang CI. On cancellation terminate owned child processes and mark unfinished exchanges unknown. Do not replay external writes automatically. A seed fixes fault scheduling, not model behavior.

## SOLID decisions

- **Single responsibility:** ScenarioCompiler owns input interpretation; EventStore owns its separate output or integration concern. Domain evaluation does not move into CLI handlers.
- **Open closed:** introduce a new supported adapter behind an existing contract; add new domain behavior explicitly rather than adding hidden project-name switches.
- **Liskov substitution:** adapters must preserve documented result, error, cancellation, and completeness semantics. Run the same contract fixtures against every implementation; unsupported behavior must be explicit.
- **Interface segregation:** separate inspection from mutation and execution from reporting. Consumers receive only the operations they use.
- **Dependency inversion:** domain logic consumes typed contracts; the CLI or composition root wires concrete filesystem, transport, and provider implementations. Pure transformations stay functions instead of gaining unnecessary interfaces.

## LLM system design

The agent under test owns its model calls. Core assertions remain deterministic. Pin scenario, model identifier, prompts, tool schemas, sampling settings, and fixture version in the run manifest. Later, evaluate uncertainty explanations with separately reported and human-calibrated model judgments.

When optional model calls are introduced, version prompts and output schemas, validate every response, bound tokens/time/cost, and store source references. Treat retrieved files and tool output as data. Keep model output out of authorization and deterministic pass/fail decisions. Document which content leaves the machine.

## Installation and integration design

The following command names are proposed interfaces for this future project; they are not claims that published packages exist. Reserve a package name, select a license, and publish only after the clean-install gate passes.

```text
toolchaos run scenarios/lost-response.yaml
toolchaos report runs/latest
```

**Public SDK contract:**

```text
runScenario({ scenario, agentAdapter, artifactDir }): Promise<RunResult>
```

Provide one end-to-end example with pinned supported dependencies. Keep the CLI a wrapper over the public SDK. Document configuration discovery, schema version, error categories, supported platforms, and exit codes. For check-oriented commands, distinguish success, failed checks, and incomplete/infrastructure failure. MCP integrations should expose narrow tools and validate configured roots; a plugin packages instructions and connection configuration rather than duplicating the engine.

## Repository structure

```text
src/
  core/             # Domain types, state, and evaluation
  adapters/         # External protocols, analyzers, runners, or storage
  cli/              # User commands and composition
tests/
  unit/
  integration/
  fixtures/
examples/
docs/
  decisions/
  api/
```

Add a report UI or server directory only when that milestone begins. Keep runtime artifacts and any credential files out of version control. Do not create a shared framework spanning these seven independent projects.

## Implementation roadmap

| Phase | Working deliverable | Verification gate |
|---|---|---|
| 1. Reproduce the bug | Create a mock ticket service and naive retrying client. | Lost response reproducibly creates duplicate state. |
| 2. Build transparent proxy | Forward initialization, tool discovery, calls, errors, and notifications. | Normal and concurrent request flows behave unchanged. |
| 3. Inject faults | Implement three faults with request-stage evidence. | Each fault occurs only at its configured boundary. |
| 4. Evaluate recovery | Add run manifests, fixture snapshots, deterministic assertions. | Good and bad reference clients receive correct verdicts. |
| 5. Integrate an agent | Add one real agent adapter and bounded execution. | Repeated runs generate independent complete reports. |
| 6. Package and pilot | Ship CLI, library exports, HTML report, example CI job. | A clean install executes the example without manual source edits. |

Proceed in order. Each phase should finish with a runnable example and its verification evidence. Size the next phase after measuring the current one; no fixed delivery date is assumed.

## Testing and evaluation

Known-bad client retries with a new idempotency key and must fail; known-good client reuses its key and must pass; reconciliation client looks up the committed ticket and must pass. Add concurrent requests, cancellation, malformed frames, redaction, and process-cleanup integration tests.

Release gate: all three reference clients receive expected verdicts; all fault boundaries are verified; runs terminate within configured deadlines. Track overhead separately from model latency. Report repeated-agent success rates with sample counts rather than a single-run reliability claim.

Use unit tests for pure rules and integration tests at external boundaries. Maintain a held-out set for model-dependent behavior. Record run counts, versions, and incomplete cases. Do not call a system production-ready based only on seeded fixtures.

## Operations and release

- Start local-first. Log structured event IDs, durations, completeness, and errors without secrets; make detailed source capture explicit.
- Version configuration and stored artifact schemas. Validate compatibility before loading older artifacts; migrate a copy and retain the original.
- Pin supported integration versions in examples and test the documented minimum/current range before releases.
- Build distributable artifacts in CI and test installation in a clean environment. Publish release notes, a changelog, contribution instructions, and a security-reporting route.
- Roll back by pinning the previous package version. Keep baseline artifacts readable; do not overwrite them during a failed upgrade.
- A future hosted dashboard requires authentication, tenant isolation, retention/deletion controls, job quotas, and tested backups. Those are a separate release, not implicit MVP features.

## Learning outcomes

Build the deterministic core to practice data modeling and LLD. Trace the process and storage boundaries to practice HLD. Package the CLI/SDK to learn API stability and developer experience. Add model evaluation only where the product needs it. Use the optional report UI to learn full-stack integration around meaningful domain results.

## Open decisions and risks

MCP cancellation and lifecycle details must be verified against the SDK version selected at implementation. Some hosts have opaque timeout policies. Start with a configurable test client and publish its limitations.

Before implementation: confirm the first supported platform and dependency versions, choose a license compatible with reused code, check naming conflicts, and find pilot users. These are implementation inputs rather than reasons to expand the initial scope.

## Delivery checklist

- [ ] Product hypothesis tested with target developers
- [x] First vertical slice implemented
- [x] Local domain and integration verification gates passed
- [ ] Model-dependent behavior evaluated, if present
- [x] Clean-install example verified
- [x] Documentation and local package artifacts reviewed
- [ ] Release published
- [ ] Independent pilot completed

## Reference projects

These references are starting points for implementation-time review, not proof that the proposed differentiator is novel.

- [MCP recorder reference](https://github.com/devhelmhq/mcp-recorder)
