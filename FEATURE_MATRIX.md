# ToolChaos feature completion matrix

| Feature | Implementation | Evidence |
|---|---|---|
| Scenario compilation and three faults | FaultHarness validation and proxy rules | `test/core.test.mjs; test/proxy.test.mjs` |
| Transparent stdio transport | Negotiation/notification pass-through, typed request IDs | `test/proxy.test.mjs` |
| Run coordinator and persistence | Fresh run directories, bounded execution, SQLite metadata index and snapshots | `test/runner.test.mjs; test/history.test.mjs` |
| Repeated runs | Independent agents/fixtures, explicit sample counts and incomplete runs | `test/history.test.mjs` |
| Deterministic assertions | Final ticket count, call limit, exercised-fault check | `test/runner.test.mjs` |
| Agent adapter | Real MCP reference clients and opt-in native Claude adapter | `test/runner.test.mjs` |
| Reports and package | HTML evidence, compiled SDK/CLI, CI and local installation | `README.md; package.json` |

## Release boundary

All local in-scope first-release features are implemented. HTTP proxying, production fault injection, hosted dashboards, and model-judged verdicts remain out of scope. Live model quality, independent pilots, and exhaustive cross-platform execution are not claimed.

CI definitions, contribution/security guidance, and package-build instructions are included. A checked-in workflow is not evidence of a remote CI run.
