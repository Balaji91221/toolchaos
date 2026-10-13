# ToolChaos implementation status

Package version 0.2.1; runtime behavior is unchanged from 0.2.0. See [feature matrix](FEATURE_MATRIX.md) for every implemented feature and its tests.

All local in-scope first-release features are implemented. HTTP proxying, production fault injection, hosted dashboards, and model-judged verdicts remain out of scope. Live model quality, independent pilots, and exhaustive cross-platform execution are not claimed.

## Verification

On Node 26.5.0/macOS, `npm run typecheck`, `npm run build`, and `npm test` passed,
including **17 tests**. Run these commands after `npm ci` to reproduce the project
checks. Local tarball installation and CLI/SDK examples were also verified.
Provider adapters use controlled test endpoints; no live provider account was
configured. The package identity is `toolchaos@0.2.1`; registry publication uses the validated
compiled tarball and remains an explicit maintainer action.

## Public distribution

Install the compiled package with `npm install toolchaos@0.2.1`. The earlier [GitHub v0.2.0 tarball](https://github.com/Balaji91221/toolchaos/releases/download/v0.2.0/toolchaos-0.2.0.tgz) remains available for that version. SDK imports and CLI names are unchanged.
