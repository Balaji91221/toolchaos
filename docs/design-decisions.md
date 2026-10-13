# Implementation decisions

Fault scheduling uses explicit per-tool occurrence numbers, so no random seed is needed. The SQLite index holds metadata; JSONL and snapshots retain ordered evidence. Adapters and pure evaluators are small modules rather than one class per proposed component.

The plan records the architecture and scope; README and generated TypeScript declarations are the executable API reference. These independent packages share no runtime framework.
