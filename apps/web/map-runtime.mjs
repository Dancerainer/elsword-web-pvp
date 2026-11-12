import {assetUrl} from './asset-urls.mjs';
import {isMapId} from '../../packages/online/map-pool.mjs';
import {sha256Hex as sha256} from '../../packages/native-source/sha256.mjs';

/** Small declarations are checked before publishing a map. The large GLB is
 * selected by its content URL; no repeated browser hash of geometry bytes. */
export async function loadMapDeclarations(sceneId,versions={},request=globalThis.fetch){
  if(!isMapId(sceneId))throw Error('invalid-scene-id');
  if(versions.sceneId!==undefined&&versions.sceneId!==sceneId)throw Error('match-scene-version-mismatch');
  const root='/assets/scene/'+sceneId+'/';
  async function json(file,expected){
    const response=await request(assetUrl(root+file));if(!response.ok)throw Error('Failed to load map: HTTP '+response.status);
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(expected&&await sha256(bytes)!==expected)throw Error('map-declaration-version-mismatch');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const manifest=await json('manifest.json',versions.mapManifestSha256);
  if(manifest.sceneId!==sceneId||manifest.collision?.url!=='collision.json'||manifest.geometry?.url!=='scene.glb')throw Error('invalid-map-manifest');
  if(versions.mapGeometrySha256&&versions.mapGeometrySha256!==manifest.geometry.sha256)throw Error('map-geometry-version-mismatch');
  const collision=await json('collision.json',versions.mapCollisionSha256??manifest.collision.sha256);
  if(collision.sceneId!==sceneId||!Array.isArray(collision.lines)||!Array.isArray(collision.spawns))throw Error('invalid-map-collision');
  return {root,manifest,map:{...manifest,...collision,renderWorldSettings:manifest.worldSettings}};
}
export function practiceActors(map){
  const spawns=map.spawns.filter(s=>s.kind==='SetTeamStartPos').slice(0,2);
  if(spawns.length!==2)throw Error('practice-spawns-missing');
  return spawns.map((s,i)=>({id:'player-'+(i+1),team:i,position:s.position,lineId:s.lineId,
    facing:i===0?(s.facingRight?1:-1):(spawns[0].facingRight?-1:1)}));
}
export function mapProjection(map,defaultFov){
  const projection=map.renderWorldSettings?.find(s=>s.callee==='SetProjection')?.arguments;
  return projection?{minZ:projection[0]*.01,maxZ:projection[1]*.01,fov:Math.PI/projection[2],inferred:false}:
    {minZ:.15,maxZ:5000,fov:defaultFov,inferred:true};
}
