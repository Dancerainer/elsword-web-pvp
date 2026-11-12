// Optional Khronos validator runtime supplied explicitly, never downloaded.
// node validate_rf.mjs artifacts/rf path/to/gltf-validator/index.js report.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const [assetDirectory, validatorPath, outputPath] = process.argv.slice(2);
if (!assetDirectory || !validatorPath || !outputPath) {
  throw new Error('Usage: node validate_rf.mjs ASSET_DIRECTORY VALIDATOR_MODULE OUTPUT_REPORT');
}
const require = createRequire(import.meta.url);
const validator = require(path.resolve(validatorPath));
const manifest = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'manifest.json'), 'utf8'));
const files = [manifest.glb, manifest.runtimeGlb, ...manifest.effects.map(e => e.glb)].filter(Boolean);
const reports = [];
for (const file of files) {
  const bytes = fs.readFileSync(path.join(assetDirectory, file));
  const result = await validator.validateBytes(new Uint8Array(bytes), {uri: file, maxIssues: 200});
  reports.push({file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    errors: result.issues.numErrors, warnings: result.issues.numWarnings,
    infos: result.issues.numInfos, hints: result.issues.numHints, issues: result.issues.messages,
    gltfInfo: result.info});
}
const report = {validator: 'Khronos glTF Validator', validatorVersion: validator.version(),
  validatorModuleSha256: crypto.createHash('sha256').update(fs.readFileSync(validatorPath)).digest('hex'),
  clientMeasured: false, limits: 'Format validation only; does not prove native visual/gameplay fidelity.', files: reports};
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(reports.map(({file, errors, warnings}) => ({file, errors, warnings}))));
if (reports.some(r => r.errors)) process.exitCode = 1;
