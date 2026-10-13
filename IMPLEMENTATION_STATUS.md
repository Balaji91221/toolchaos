# ToolChaos implementation status

Local version 0.2.0. See [feature matrix](FEATURE_MATRIX.md) for every in-scope plan phase and its tests.

All local in-scope first-release features are implemented. HTTP proxying, production fault injection, hosted dashboards, and model-judged verdicts remain out of scope. Live model quality, independent pilots, and exhaustive cross-platform execution are not claimed.

## Verification

On Node 26.5.0/macOS, `npm run typecheck`, `npm run build`, and `npm test` passed,
including **17 tests**. Run these commands after `npm ci` to reproduce the project
checks. Local tarball installation and CLI/SDK examples were also verified.
Provider adapters use controlled test endpoints; no live provider account was
configured. The package identity is `toolchaos@0.2.0`; registry publication uses the validated
compiled tarball and remains an explicit maintainer action.

## Public distribution

The compiled `toolchaos@0.2.0` package is distributed as a [GitHub release tarball](https://github.com/Balaji91221/toolchaos/releases/download/v0.2.0/toolchaos-0.2.0.tgz). npm registry publication is pending. Installing the public tarball with npm provides the same SDK and CLI.
