import { build } from 'esbuild';
import {mkdir, readFile, readdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await import('./validation/build-lobby-config-v45.mjs');
await mkdir(`${root}dist`, { recursive: true });
const outputDir = path.join(root, 'dist');
const previousChunks = (await readdir(outputDir, {withFileTypes: true}))
  .filter(entry => entry.isFile() && /-[A-Z0-9]{8}\.js(?:\.map)?$/.test(entry.name));
// Task worktrees may reuse installed dependencies through a read-only junction.
// Keep logical module paths stable so that an unchanged Babylon dependency does
// not receive a different chunk hash just because the worktree path changed.
// Strip formatting from the large bundled profession declarations while keeping
// syntax, identifiers and source-map inputs unchanged for runtime diagnostics.
const result = await build({ metafile: true, preserveSymlinks: true, entryPoints: [`${root}apps/web/lobby-entry.mjs`], bundle: true, format: 'esm', target: 'es2022',
  outdir: `${root}dist`, entryNames: 'game', sourcemap: true, splitting: true, minify: false, minifyWhitespace: true,
  loader: { '.json': 'json' } });
const css=await Promise.all(['game.css','online.css','online-lobby.css','pvp-hud.css','key-bindings.css','buff-bar.css','guild-panel.css','window-theme.css','skill-details.css','add-hud.css','status-hud-v32.css','add-generator-skill-slot.css','lobby-shell.css'].map(file=>readFile(`${root}apps/web/${file}`,'utf8')));
await writeFile(`${root}dist/game.css`,css.join('\n'));
// Retire previous bundles and maps only after a complete replacement build.
// Deployment manifests and other operator-supplied files stay in the directory.
const emitted = new Set(Object.keys(result.metafile.outputs).map(file => path.resolve(file)));
for (const chunk of previousChunks) {
  const file = path.join(outputDir, chunk.name);
  if (!emitted.has(file)) await unlink(file);
}
console.log('Built authenticated profession workbench.');
