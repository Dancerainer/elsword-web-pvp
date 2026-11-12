/** Node-only inventories of the actual host program and loaded resource bytes.
 * These identify a web simulation release; they do not change native seals or
 * establish original-client fidelity. Collection runs once during asset loading.
 */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';

export const HOST_FINGERPRINT_DOMAIN='rf-online-host-program-sha256-v1';
export const RESOURCE_FINGERPRINT_DOMAIN='rf-online-battle-resources-sha256-v1';
// Include all host source/catalog files in these bounded program directories,
// so a later core/guild module is sealed without a hand-maintained filename list.
export const HOST_PROGRAM_DIRECTORIES=Object.freeze([
  'packages/combat-core','packages/combat-assets','packages/native-source',
  'packages/pvp','packages/input','packages/effect-runtime','packages/online','packages/professions','packages/presentation','apps/server',
]);
// Actual dependencies outside those directories, including imported JSON data.
export const HOST_PROGRAM_FILES=Object.freeze([
  'apps/local-client/update-contract.mjs',
  'apps/server/battle-driver.mjs','apps/web/sampled-keyboard.mjs','apps/web/input-buffer.mjs',
  'apps/web/game.mjs','apps/web/login.mjs','apps/web/online-client.mjs','apps/web/online-peer-control.mjs','apps/web/input-prediction.mjs',
  'apps/web/remote-combat-playback.mjs','apps/web/input-stage-trace.mjs',
  'apps/web/camera-handoff.mjs','apps/web/cast-display.mjs','apps/web/buff-afterimages.mjs','apps/web/result-presentation.mjs','contracts/cast-display-index-v1.json',
  'apps/web/owned-actions.mjs','apps/web/owned-presentation.mjs','apps/web/pvp-practice.mjs',
  'apps/web/actor-render-clock.mjs','apps/web/remote-actor-clock.mjs',
  'apps/web/effects-view.mjs','apps/web/effect-render-anchors.mjs','apps/web/profession-effects.mjs',
  'apps/web/actor-presentation.mjs','apps/web/add-formation-effects.mjs',
  'apps/web/destruction-rage-effects.mjs',
  'apps/web/counter-wait-effects-v49.mjs','contracts/lk-counter-visual-v49.json','contracts/lk-counter-native-v49.json',
  'apps/web/effect-state-lookup.mjs','apps/web/native-quad-materials.mjs',
  'apps/web/hit-lighting.mjs','apps/web/effect-prewarm.mjs',
  'apps/web/render-preparation.mjs',
  'apps/web/lighting.mjs','apps/web/character-toon-material.mjs','contracts/character-toon-source-v27.json',
  'apps/web/impact-camera.mjs','apps/web/ground-shadow.mjs','apps/web/hit-framebuffer.mjs',
  'apps/web/native-character-edge.mjs','apps/web/weapon-presentation.mjs','contracts/common-presentation-source-v28.json',
  'apps/web/map-effects.mjs','apps/web/map-uv-scroll.mjs',
  'apps/web/camera-line-basis.mjs','apps/web/camera-follow.mjs','apps/web/camera-policy.mjs',
  'apps/web/active-mesh-candidates.mjs','apps/web/native-quad-batch-v5.mjs',
  'apps/web/render-quality.mjs','apps/web/resource-timing-summary.mjs',
  'apps/web/invulnerability-presentation.mjs','apps/web/buff-bar.mjs',
  'apps/web/online-lobby.mjs','apps/web/guild-panel.mjs','apps/web/interface-audio.mjs','apps/web/audio-preferences.mjs','apps/web/battle-audio.mjs',
  'contracts/lobby-ui-audio-source-v4.json',
  'apps/web/online-socket.mjs','apps/web/match-entry.mjs','apps/web/nasod-core-presentation.mjs',
  'packages/online/poll-contract.mjs',
  'tools/assets/character/sample_pose.mjs','contracts/rf-nasod-target-v11.json',
  'contracts/rf-hit-audio-source-v17.json','contracts/rf-pvp-rules-source-v1.json',
  'contracts/equipment-2016-source-v1.json',
  'contracts/elesis-equipment-source-v1.json',
  'contracts/elesis-effect-density-v1.json',
  'contracts/elesis-effect-targets-v30.json','contracts/standup-rolling-source-v30.json',
  'contracts/command-presentation-bindings-v29.json',
  'contracts/structural-mesh-source-clocks-v29.json',
  'apps/web/way-of-sword-hud.mjs','apps/web/way-of-sword-particles.mjs','apps/web/skill-sword-cues.mjs','apps/web/hud-values.mjs',
  'contracts/pvp-map-mechanics-source-v1.json','contracts/pvp-map-fx-index-v1.json',
  'contracts/add-lp-bone-targets-v45.json','contracts/add-mm-bone-targets-v45.json',
  'contracts/add-moonlight-explosions-v45.json','contracts/de-moonlight-visual-v45.json',
  'contracts/bh-air-fire-visual-v45.json','contracts/bh-fire-audio-peaks-v45.json',
  'contracts/ca-shield-visual-v45.json','contracts/elesis-attack-closure-v45.json',
  'contracts/elesis-firewall-npc-v45.json','contracts/elesis-player-feedback-native-v45.json',
  'contracts/feedback-buff-closure-v45.json',
  'contracts/add-de-command-closure-v45.json','contracts/de-air-combo-visual-v45.json','contracts/source-distance-native-v45.json',
  'apps/web/source-audio-distance-v45.mjs','apps/web/pose-audio.mjs',
  'apps/web/add-hud.mjs','apps/web/add-hud.css','apps/web/load-profession-assets.mjs',
  'apps/web/lobby-shell.mjs','apps/web/lobby-shell.css','apps/web/lobby-configuration.mjs','apps/web/lobby-configuration-panel.mjs','apps/web/lobby-handoff.mjs','contracts/lobby-config-v45.json',
]);
const sourceExtensions=new Set(['.mjs','.js','.json']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;
function relativeFile(file){
  if(typeof file!=='string'||!file)throw new TypeError('Relative fingerprint path required');
  const result=file.replaceAll('\\','/');
  if(result.startsWith('/')||result.includes(':')||result.split('/').some(part=>!part||part==='.'||part==='..'))
    throw new TypeError('Fingerprint path must stay inside its input root');
  return result;
}

/** Inventory only retains byte lengths/hashes, not large parsed poses or WASM.
 * A second read of the same identity must agree, catching changed input bytes.
 * Hash framing is UTF-8 JSON {schemaVersion,domain,files}, with files sorted by
 * case-sensitive path code units. Each file seals its exact bytes, not parsed or
 * newline-normalized contents; path/length framing cannot concatenate ambiguously.
 */
export function createFingerprintInventory(domain){
  if(typeof domain!=='string'||!domain)throw new TypeError('Fingerprint domain required');
  const records=new Map();
  return {
    add(file,bytes){
      file=relativeFile(file);
      if(!(bytes instanceof Uint8Array))throw new TypeError('Fingerprint requires raw bytes');
      const record=Object.freeze({file,bytes:bytes.byteLength,sha256:sha256(bytes)}),prior=records.get(file);
      if(prior&&(prior.sha256!==record.sha256||prior.bytes!==record.bytes))throw new Error('Input changed during fingerprint: '+file);
      records.set(file,prior??record);return prior??record;
    },
    snapshot(){
      const files=Object.freeze([...records.values()].sort((a,b)=>compare(a.file,b.file)));
      const content={schemaVersion:1,domain,files};
      return Object.freeze({...content,sha256:sha256(JSON.stringify(content))});
    },
  };
}

export async function fingerprintHostProgram({root,directories=HOST_PROGRAM_DIRECTORIES,files=HOST_PROGRAM_FILES}={}){
  if(typeof root!=='string'||!root)throw new TypeError('Host program root required');
  const inventory=createFingerprintInventory(HOST_FINGERPRINT_DOMAIN),selected=new Set(files.map(relativeFile));
  async function visit(directory){
    directory=relativeFile(directory);
    for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){
      const file=path.posix.join(directory,entry.name);
      if(entry.isSymbolicLink())throw new TypeError('Symlink not allowed in host program inventory: '+file);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&sourceExtensions.has(path.extname(entry.name)))selected.add(file);
    }
  }
  for(const directory of directories)await visit(directory);
  await Promise.all([...selected].map(async file=>inventory.add(file,await readFile(path.join(root,file)))));
  return inventory.snapshot();
}
