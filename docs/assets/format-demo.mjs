// Documentation helper: summarize a saved local scenario manifest.
import { readFileSync } from 'node:fs';
const run = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const row = (label, value) => console.log(label.padEnd(16) + value);
row('SCENARIO', run.scenario.id);
row('RECOVERY', run.agent.name);
row('FAULT', run.scenario.rules[0].fault);
row('VERDICT', run.verdict);
row('FINAL TICKETS', run.snapshot.tickets.length);
console.log('\nASSERTIONS');
for (const a of run.assertions) row(a.passed ? 'PASS' : 'FAIL', `${a.name}: actual ${a.actual}, expected ${a.expected}`);
console.log('\nOBSERVED TOOL EVENTS');
for (const e of run.events) row(e.stage, '  ' + (e.tool ?? ''));
