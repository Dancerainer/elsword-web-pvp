/** Qualified Add factory follower callbacks; original target mesh/damage roots.
 * Attack drivers are independently declared and never replaced by generic DPS. */
import {arcLineBasis} from './archenemy-mesh.mjs';
const f=Math.fround;
export const ADD_FACTORY_DRONES=Object.freeze({29013:'DAMAGE_EFFECT_Drone_Activator_Generate',29035:'DAMAGE_EFFECT_Drone_Activator_Generate',29018:'DAMAGE_EFFECT_Shooting_Chaser_Generate',29017:'DAMAGE_EFFECT_Ultimate_Fury_Generate',29016:'DAMAGE_EFFECT_Star_Fall_Generate'});
const names=new Set(Object.values(ADD_FACTORY_DRONES));
export const isAddFactoryFollower=e=>names.has(e?.name)&&[29013,29035,29016,29017,29018].includes(e?.skillId);
function stop(sim,a,e){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason:'add-factory-generation-ended'});}
export function tickAddFactory(sim,a){
 if(a.professionId!=='MM')return;
 const generator=a.hp>0?a.sourceAdd?.generator:null,name=ADD_FACTORY_DRONES[generator?.skillId];
 let current=null;
 for(const e of sim.state.effects)if(e.ownerId===a.id&&names.has(e.name)&&!e.dead){if(e.name!==name||current)stop(sim,a,e);else current=e;}
 if(!name)return;
 let basis;try{basis=arcLineBasis(a,sim.map.lines);}catch{sim.note('add-factory-line-basis','Original owner line basis unavailable for Dynamo follower',a);return;}
 // ReInit -200,150,0; ThirdPath_OnFactoryFrameMove .9/.1 is a source
 // frame interpolation, not an invented real-time damping formula.
 const target=[a.x,a.y,a.z].map((n,i)=>f(n+basis.direction[i]*-200*a.facing+(i===1?150:0)));
 if(!current){current=sim.createEffect(a,{NAME:name},{birthAnchor:{position:target,facing:a.facing,rotation:basis.rotation}});if(!current)return;current.currentAnchor={...current.birthAnchor};}
 else{
  const old=(current.currentAnchor??current.birthAnchor).position,position=old.map((n,i)=>f(f(n*.9)+f(target[i]*.1)));
  current.currentAnchor={...(current.currentAnchor??current.birthAnchor),position,rotation:basis.rotation};[current.x,current.y,current.z]=position;
 }
}
export function addFactoryStateStart(sim,a){
 if(a.professionId==='MM'&&sim.profileFor(a).states[a.state].sourceState==='ANSI_AAT_CREATE_DYNAMO_FACTORY'){
  addFactoryModeBuff(sim,a);sim.spawnSet(a,'EffectSet_SI_SA_AAT_Installation_Drone_Activator_Generate');tickAddFactory(sim,a);
 }
}
/** Target 29408 owns BFI367. Its three MP-gain stat behaviors, original
 * three-stack limit and 15s level3 lifetime are executed by the buff system. */
export function addFactoryModeBuff(sim,a){
 if(a.professionId!=='MM')return;
 const level=a.passivePolicy?.skillLevels?.[29408];if(!level)return;
 const skill=sim.profileFor(a).skillCatalog.find(s=>s.skillId===29408),factor=skill.raw.BUFF_FACTOR['1'];
 sim.grantBuff(a,a,factor,level,null);
}
