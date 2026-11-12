import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isMapId,DEFAULT_SCENE_ID} from '../packages/online/map-pool.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Local trace verification seals the selected map bytes. Legacy default-map
 * traces without map hashes remain replayable with their original program. */
export function loadReplayMap({root,trace}){
  const candidates=[trace.versions?.sceneId,trace.initial?.versions?.sceneId,trace.initial?.sceneId,trace.final?.sceneId].filter(id=>id!==undefined);
  const sceneId=candidates[0]??DEFAULT_SCENE_ID;
  if(!isMapId(sceneId)||candidates.some(id=>id!==sceneId))throw Error('Trace scene identity mismatch');
  const folder=path.join(root,'artifacts','scene',sceneId),read=file=>readFileSync(path.join(folder,file));
  const manifestBytes=read('manifest.json'),manifest=JSON.parse(manifestBytes);
  if(manifest.sceneId!==sceneId||manifest.collision?.url!=='collision.json'||manifest.geometry?.url!=='scene.glb')throw Error('Trace map manifest mismatch');
  const collisionBytes=read('collision.json'),collision=JSON.parse(collisionBytes);
  if(collision.sceneId!==sceneId)throw Error('Trace map collision identity mismatch');
  const versions=trace.versions??trace.initial?.versions??{};
  const collisionSha=versions.mapCollisionSha256??versions.mapCollision;
  const geometrySha=versions.mapGeometrySha256??versions.mapGeometry;
  if(sceneId!==DEFAULT_SCENE_ID&&(!collisionSha||!geometrySha))throw Error('Trace alternate map resource seals required');
  if(versions.mapManifestSha256&&hash(manifestBytes)!==versions.mapManifestSha256)throw Error('Trace map manifest bytes changed');
  const actualCollision=hash(collisionBytes);
  if(actualCollision!==manifest.collision.sha256||collisionSha&&actualCollision!==collisionSha)throw Error('Trace map collision bytes changed');
  if(geometrySha){const actualGeometry=hash(read('scene.glb'));
    if(actualGeometry!==manifest.geometry.sha256||actualGeometry!==geometrySha)throw Error('Trace map geometry bytes changed');}
  return {...manifest,...collision,renderWorldSettings:manifest.worldSettings};
}
