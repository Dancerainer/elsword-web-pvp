import {authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';
const prefix='g_pMinorParticle:';
/** Original map sequences and GUUser::CreateTeleportEffect. No per-profession
 * copies, combat RNG, guessed portal rings or frame-count based timers.
 */
export function createMapEffects({runtime,index}){
  let map=null,ambientStarted=false;
  const seen=new Map(),ambient=new Map();let portals=0;
  function startAmbient(){
    if(ambientStarted||!map)return;
    ambientStarted=true;
    for(const object of index.maps[map.sceneId]?.ambient??[]){
      const template=index.templates[object.template];
      const e=runtime.add(object.template,{position:object.position,facing:1,
        landPosition:template.fields.LandPosition??0});
      if(e)ambient.set(object.objectId,e.id);
    }
  }
  return {
    setMap(next){map=next;ambientStarted=false;seen.clear();ambient.clear();portals=0;},
    step(state){
      startAmbient();
      const live=new Set();
      for(const actor of state.actors??[]){
        live.add(actor.id);
        const notice=actor.mapMechanics?.portalNotice;
        if(!notice||notice.serial<=(seen.get(actor.id)??0))continue;
        seen.set(actor.id,notice.serial);
        if(notice.age>1.2)continue;
        const facingActor={...actor,lineId:notice.lineId,lastTouchLineId:notice.lineId,facing:1};
        const yaw=authoredLineBasis(facingActor,map).yRotationDegrees;
        const position=notice.position,rotation=[0,yaw,0];
        for(const name of ['RespawnLanding_P01','RespawnLanding_P02','RespawnLanding_P03'])
          runtime.add(prefix+name,{position,facing:1,landPosition:index.templates[prefix+name].fields.LandPosition??0});
        for(const height of [50,100,200,300,450])
          runtime.add(prefix+'RespawnLanding_P04',{position:[position[0],position[1]+height*.8,position[2]],facing:1});
        for(const name of ['RespawnLanding01','RespawnLanding02'])
          runtime.add(prefix+name,{position,facing:1,rotate:rotation});
        portals++;
      }
      for(const id of seen.keys())if(!live.has(id))seen.delete(id);
    },
    clear(){ambientStarted=false;seen.clear();ambient.clear();portals=0;},
    proof(){return {sceneId:map?.sceneId??null,portalBursts:portals,
      ambient:[...ambient].map(([objectId,id])=>({objectId,emitterId:id,live:runtime.emitters.has(id)}))};}
  };
}
