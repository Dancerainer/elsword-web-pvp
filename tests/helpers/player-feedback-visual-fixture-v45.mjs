/** Explicit file-presence fixture for loader/identity tests. It adopts the
 * real overlay's source identity while providing labeled empty pose and byte
 * placeholders. Never instantiate native combat or decode these fake GLBs. */
import path from 'node:path';
import moonlight from '../../contracts/de-moonlight-visual-v45.json' with {type:'json'};
import counterWait from '../../contracts/lk-counter-visual-v49.json' with {type:'json'};
export const FEEDBACK_FIXTURE_REFERENCE=moonlight.referenceVersion;
const templates=Object.values(moonlight.templates);
const sourcePaths=key=>[...new Set(templates.map(t=>t[key]).filter(Boolean).map(file=>path.posix.normalize('de/'+file)))].sort();
export const FEEDBACK_FIXTURE_POSE_PATHS=Object.freeze(sourcePaths('poseData'));
const binaryPaths=[...new Set([...sourcePaths('glb'),...templates.flatMap(t=>Object.values(t.textures??{})
 .map(texture=>path.posix.normalize('de/'+texture.file))),...Object.values(counterWait.templates).flatMap(t=>Object.values(t.textures??{}).map(r=>'lk/'+r.file))])].sort();
export async function writeFeedbackVisualFixture(write){
 await write('lk/counter-v49/index.json',JSON.stringify(counterWait));
 for(const file of FEEDBACK_FIXTURE_POSE_PATHS)await write(file,JSON.stringify({schemaVersion:1,frames:[],clips:[],helpers:[],
  syntheticFixture:'loader-file-presence-only; no original pose data'})+'\n');
 for(const file of binaryPaths)await write(file,Buffer.from('synthetic loader fixture; never decoded or executed\n'));
}
