# ToolChaos implementation status

Local version 0.2.0. See [feature matrix](FEATURE_MATRIX.md) for every in-scope plan phase and its tests.

All local in-scope first-release features are implemented. HTTP proxying, production fault injection, hosted dashboards, and model-judged verdicts remain out of scope. Live model quality, independent pilots, public registry publication, and cross-platform execution are not claimed.

## Verification

On Node 26.5.0/macOS, `npm run typecheck`, `npm run build`, and `npm test` passed,
including **17 tests**. Run these commands after `npm ci` to reproduce the project
checks. Local tarball installation and CLI/SDK examples were also verified.
Provider adapters use controlled test endpoints; no live provider account was
configured. Public GitHub source distribution does not publish an npm package;
the package remains unpublished in the npm registry.
