// Node 22.18+; no install, build step, network or wall-clock input.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argument, dataScript, readSnapshot } from './lib/snapshot.ts';
import { checkBoard } from './lib/gate.ts';
import { prepareOutput, writeDossier } from './lib/output.ts';

const RadarModel = createRequire(import.meta.url)('./dashboard/model.js');
const repository = fileURLToPath(new URL('.', import.meta.url));

try {
  const input = argument('input', '/input/snapshot.json');
  const output = resolve(argument('output', process.env.MAKEFUN_OUTPUT_DIR || '/output'));
  const snapshot = readSnapshot(input);
  // The exact classic-script API the browser uses, including all farm-step strings.
  const radar = RadarModel.buildRadar(snapshot);
  const checks = checkBoard(radar.rows, snapshot);
  const errors = checks.filter(check => !check.pass);
  if (errors.length) throw new Error(errors.map(e => e.check + ': ' + e.detail).join('\n'));
  const boardText = JSON.stringify({ as_of: snapshot.as_of, model_version: radar.version,
    constants: radar.constants, farm_assumptions: radar.farm_assumptions,
    validation: radar.validation, rows: radar.rows }) + '\n';
  if (Buffer.byteLength(boardText) > 8_388_608) throw new Error('Board exceeds 8 MiB');
  const copied = prepareOutput(repository, output);
  writeFileSync(join(output, 'board.json'), boardText);
  writeFileSync(join(output, 'data.js'), dataScript(snapshot));
  const dossier = writeDossier(output, copied.screenshots);
  console.log(`Radar ${radar.version} @ ${snapshot.as_of}: ${radar.rows.length} pre-token rows; ${radar.summary.watchlist_covered}/${snapshot.watchlist.length} watchlist; ${radar.trading_peers.length} trading peers.`);
  console.log(`Wrote board.json, raw data.js, dashboard/ (${copied.dashboard} files), screenshots/ (${copied.screenshots} images) to ${output}.`);
  console.log(dossier ? 'dossier.json written with the unchanged vendor buildDossier.' : 'Dossier pending: buildDossier requires an image. Add frontend screenshots and rerun; no placeholder images are fabricated.');
} catch (error) {
  console.error('radar: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
