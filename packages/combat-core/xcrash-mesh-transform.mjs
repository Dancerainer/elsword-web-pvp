/** Bounded fixed-V5 LOCAL_ROTATE_EFFECT consumer for confirmed literal meshes.
 * Their literal Size/Rotate events act on the main mesh before bones/children
 * are queried. This is source/static-asset evidence, not target GPU acceptance. */
import {resolvedGMSpawnTemplate} from './gm-sword-spawn-instance.mjs';
import {resolvedAddStardustTemplate} from './add-stardust-mesh-v56.mjs';
const names=new Set(['RRF_XCrash_ScrachDummy01','RRF_XCrash_ScrachDummy02',
  'RRF_XCrash_ScrachDummy03','RRF_XCrash_FireDummy','EffectSet_RVC_Flame_Buster_CROW_M01',
  'RWT_SA_HARPOON_SPEAR_ASSAULT','RWT_SA_HARPOON_SPEAR_Stone',
  // Target2016 local Rotate belongs to the collision helper and the passive
  // displayed sword alike. Movement retains the separate birth-facing basis.
  'SwordFallBlade1','SwordFallBlade2','SwordFallBlade3','SwordFallBlade4',
  'elsword_A_swordFall_M01','elsword_A_swordFall_M02','elsword_A_swordFall_M03','elsword_A_swordFall_M04','elsword_A_swordFall_M05']);
const channels=new WeakMap();
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
function compile(template){
  let result=channels.get(template);if(result)return result;
  result={Size:[],Rotate:[]};
  for(const event of template.events??[])if(event.property==='Size'||event.property==='Rotate'){
    if(!vector(event.value)||!Number.isFinite(event.start)||!Number.isFinite(event.end)||
      event.start<0||event.end<event.start||event.fade&&event.end===event.start)
      throw new TypeError('Unsupported XCrash literal mesh transform event');
    result[event.property].push(event);
  }
  for(const events of Object.values(result))events.sort((a,b)=>a.start-b.start);
  channels.set(template,result);return result;
}
function sample(events,time,initial){
  let value=[...initial];
  for(const event of events){
    if(time<event.start)break;
    if(event.fade){const ratio=Math.max(0,Math.min(1,(time-event.start)/(event.end-event.start)));
      value=value.map((n,i)=>n+(event.value[i]-n)*ratio);
    }else value=[...event.value];
  }
  return value;
}
export function xCrashMeshTransform(template,e,anchor,{literal=false}={}){
  const shared=resolvedGMSpawnTemplate(template,e)??resolvedAddStardustTemplate(template,e);if(shared)template=shared;
  if(!names.has(template?.name)&&!literal&&!shared)return null;
  if(literal&&(template.events??[]).some(event=>['Size','Rotate'].includes(event.property)&&!vector(event.value)))return null;
  const time=e.meshLifetimeElapsed??e.sourceMeshGlobalTime??e.elapsed??0;
  if(!Number.isFinite(time)||time<0||!anchor?.position||!vector(anchor.position))
    throw new TypeError('Explicit XCrash main mesh clock and anchor required');
  const base=anchor.rotation??[0,anchor.facing<0?180:0,0];
  if(!vector(base))throw new TypeError('Explicit XCrash main mesh rotation required');
  const events=compile(template),localRotation=sample(events.Rotate,time,[0,0,0]);
  const size=sample(events.Size,time,[1,1,1]);
  const scale=size.map((n,i)=>n*(e.definition?.[['SCALE_X','SCALE_Y','SCALE_Z'][i]]??1));
  if(!vector(scale))throw new TypeError('Explicit XCrash mesh scale required');
  return {position:[...anchor.position],rotation:base.map((n,i)=>n+localRotation[i]),
    facing:anchor.facing,scale,localRotation,time};
}
