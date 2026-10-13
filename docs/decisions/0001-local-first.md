# Local first implementation

The initial ToolChaos implementation keeps its domain behavior in a typed library and composes CLI/adapters around it. Tests use controlled fixtures. A hosted UI and model-assisted features are deferred until the core contracts are demonstrated.

Implemented: typed fault harness, per-tool occurrence matching, three fault kinds, stdio proxy, three reference recovery clients, trace metadata and escaped HTML report. Verified: deterministic recovery and protocol-boundary integration tests, including ID types and pass-through negotiation. Not yet implemented: arbitrary agent run manifests, process-tree isolation, HTTP transport, model-provider runs, trace-redaction policies for opt-in raw captures, or hosted UI. The demo fixture is deliberately separate from FixtureForge so this package remains independently installable.
