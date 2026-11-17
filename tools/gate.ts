import { resolve } from 'node:path';
import { argument, readSnapshot } from '../lib/snapshot.ts';
import { runGate } from '../lib/gate.ts';

try {
  const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'out';
  const output = resolve(argument('output', positional));
  const snapshot = readSnapshot(argument('input', '/input/snapshot.json'));
  const report = runGate(output, snapshot);
  console.log('CHECK                 RESULT  DETAIL');
  for (const row of report.rows) console.log(row.check.padEnd(22) + (row.pass ? 'PASS' : 'FAIL').padEnd(8) + row.detail);
  console.log(`Dashboard source: ${report.source_bytes} bytes (target ≤62500); all files: ${report.dashboard_bytes} bytes.`);
  for (const image of report.screenshots) console.log(`Screenshot ${image.path}: ${(image.bytes / 1024).toFixed(1)} KiB.`);
  if (!report.screenshots.length) console.log('Screenshots: none. The vendor cannot build a dossier until an image exists.');
  console.log('Determinism: bash tools/determinism.sh <snapshot.json|input-directory>');
  process.exitCode = report.rows.every(row => row.pass) ? 0 : 1;
} catch (error) {
  console.error('gate: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
