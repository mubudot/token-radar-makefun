import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

export const DOSSIER_CAPS = {
  text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 }
};
export const DOSSIER_GATE_BYTES = 1_572_864;

/** Copy our own authored source into the output, never follow symlinks. */
function copyTree(source: string, target: string): number {
  mkdirSync(target, { recursive: true });
  if (!existsSync(source)) return 0;
  let count = 0;
  for (const name of readdirSync(source).sort()) {
    if (name.startsWith('.')) continue;
    const from = join(source, name), to = join(target, name), st = lstatSync(from);
    if (st.isDirectory()) count += copyTree(from, to);
    else if (st.isFile()) { copyFileSync(from, to); count++; }
    else throw new Error('Only regular source files/directories may be copied: ' + from);
  }
  return count;
}

export function prepareOutput(repository: string, output: string): { dashboard: number; screenshots: number } {
  const root = resolve(repository), out = resolve(output);
  const inside = (path: string, directory: string) => path === directory || path.startsWith(directory + sep);
  if (out === root || inside(out, join(root, 'dashboard')) || inside(out, join(root, 'screenshots'))) {
    throw new Error('Output must be separate from source dashboard/screenshots and repository root');
  }
  mkdirSync(out, { recursive: true });
  // Only these generated paths are replaced. This removes stale assets between builds.
  for (const dir of ['dashboard', 'screenshots']) {
    const path = join(out, dir);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Output path is a symlink: ' + relative(root, path));
    rmSync(path, { recursive: true, force: true });
  }
  rmSync(join(out, 'dossier.json'), { force: true });
  return { dashboard: copyTree(join(root, 'dashboard'), join(out, 'dashboard')),
    screenshots: copyTree(join(root, 'screenshots'), join(out, 'screenshots')) };
}

/** No made-up screenshots: an empty set cannot produce a vendor dossier. */
export function writeDossier(output: string, screenshotCount: number): boolean {
  if (screenshotCount === 0) return false;
  const dossier = buildDossier(output, DOSSIER_CAPS);
  if (dossier.byteLength > DOSSIER_GATE_BYTES) throw new Error('Dossier exceeds the gate\'s 1.5 MiB cap');
  writeFileSync(join(output, 'dossier.json'), dossier);
  return true;
}
