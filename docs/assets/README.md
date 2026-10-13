# README visuals

[Back to the project](../../README.md)

`overview.svg` is an original explanatory workflow illustration, not a product screenshot.

`demo.png`: A formatted summary of an actual saved ToolChaos scenario manifest. This is a documentation presentation, not a screenshot of a hosted dashboard.

The demo uses synthetic local data; it does not represent a production deployment or a live model evaluation.

## Reproduce the data

Run from the repository root after following the main README installation steps:

```bash
demo_root="$(mktemp -d)"
node dist/cli.js scenario examples/scenario.json reconcile "$demo_root/recovery"
node docs/assets/format-demo.mjs "$demo_root/recovery/manifest.json"
```

Timing values and generated paths may differ between runs. Screenshots show the relevant report view; complete artifacts stay in your selected output directory.
