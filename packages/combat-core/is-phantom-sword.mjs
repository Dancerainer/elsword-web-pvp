/** Phantom Sword's custom buff consumer. Timing/matrix queue is the pinned V5
 * X2BuffTemplet.cpp:817–1179 reference; states, damage and resources are 2016.
 * This is a source port, not a claim of target executable frame parity. */
import {isBuffActive} from './buffs.mjs';
const f=Math.fround,copy=structuredClone;
export const PHANTOM_SWORD_REFERENCE=Object.freeze({delay:.2,damageMultiplier:1.2,defenderStopAddition:.033,maxCatchUp:2});
const eligible=(sim,a)=>sim.profileFor(a).target?.unitClass===112;
const active=a=>a.hp>0&&a.buffs.some(b=>b.templateId===29&&isBuffActive(b)&&b.behaviors.some(row=>row.kind==='phantomSword'));
const live=(sim,id)=>sim.state.effects.find(e=>e.id===id&&!e.dead);
const hand=(sim,a)=>{
  const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy1_Rhand',TRACE_MATRIX:1}},a);
  // A position-only substitute would erase the delayed sword's orientation.
  if(!anchor?.matrix)return null;
  return {position:[...anchor.position],rotation:[...anchor.rotation],facing:anchor.facing,matrix:[...anchor.matrix]};
};
function end(sim,a){
  const state=a.sourceInfinitySword?.phantomSword;if(!state)return;
  for(const id of [state.effectId,state.centerId]){const e=live(sim,id);if(e){e.dead=true;e.endReason='phantom-sword-buff-end';}}
  delete a.sourceInfinitySword.phantomSword;
}
/** Called when buff ownership changes, before unit stop/input gates. */
export function phantomSwordSync(sim,a){
  if(!eligible(sim,a))return;
  if(!active(a)){end(sim,a);return;}
  if(a.sourceInfinitySword?.phantomSword)return;
  const profile=sim.profileFor(a),anchor=hand(sim,a);
  if(!anchor||!profile.damageEffects.THIRD_BLADE||!profile.effectTemplates.ThirdBladeCenter){
    sim.note('is-phantom-sword-source','Phantom Sword requires original THIRD_BLADE, ThirdBladeCenter and Dummy1_Rhand matrix',a);return;
  }
  const effects=['THIRD_BLADE','ThirdBladeCenter'].map(name=>{
    const e=sim.createEffect(a,{NAME:name},{birthAnchor:copy(anchor)});
    e.sourcePhantomSword=true;e.sourcePhantomAttackSerial=0;e.buffTemplateId=29;
    e.sourcePosedAnchor=copy(anchor);e.currentAnchor=copy(anchor);
    // Native initialization explicitly calls the mesh OnFrameMove(.01f).
    e.elapsed=e.animationTime=f(.01);
    return e;
  });
  a.sourceInfinitySword??={comboLoops:0,cruelHits:0,cruelCooldown:0,suddenCooldown:0,brutalCooldown:0,lightningTime:0};
  a.sourceInfinitySword.phantomSword={effectId:effects[0].id,centerId:effects[1].id,time:f(.01),matrixQueue:[],attacks:[],currentAttack:null};
}
export function phantomSwordOwnsEffect(a,e){
  const state=a.sourceInfinitySword?.phantomSword;
  return e.sourcePhantomSword===true&&state&&[state.effectId,state.centerId].includes(e.id);
}
function attackRaw(profile,row){
  const raw=profile.states[row.state]?.raw,index=raw?.PHANTOM_BLADE_ATTACK_TIME_INDEX;
  if(!Number.isInteger(index)||index<0)return null;
  const window=raw['ATTACK_TIME'+index]??(index===0?raw.ATTACK_TIME:null);
  const data=raw[raw.PHANTOM_BLADE_DAMAGE_DATA_NAME||'DAMAGE_DATA'];
  return window&&data?{raw,data,window}:null;
}
export function phantomSwordDamageData(profile,row){
  const declaration=attackRaw(profile,row);if(!declaration)return null;
  const {raw}=declaration,data=copy(declaration.data);
  data.DAMAGE??={};for(const type of ['PHYSIC','MAGIC'])if(Number.isFinite(data.DAMAGE[type]))data.DAMAGE[type]=f(f(data.DAMAGE[type])*f(1.2));
  data.FORCE_DOWN=0;data.HIT_ADD_MP=0;data.STOP_TIME_DEF=f(f(data.STOP_TIME_DEF??0)+f(.033));
  data.BACK_SPEED_X=raw.PHANTOM_BLADE_BACK_SPEED_X??0;data.BACK_SPEED_Y=raw.PHANTOM_BLADE_BACK_SPEED_Y??0;
  data.ARRANGED_FLY=1;data.ATTACK_TYPE=profile.enums.ATTACK_TYPE.AT_SPECIAL;
  if(raw.PHANTOM_BLADE_REACT_TYPE)data.REACT_TYPE=raw.PHANTOM_BLADE_REACT_TYPE;
  return data;
}
/** Reconstruct mutable controls from a known state; never accept wire damage. */
export function phantomSwordEffectControls(profile,a,e){
  if(profile.target?.unitClass!==112||!e.sourcePhantomSword||e.name!=='THIRD_BLADE'||!e.damage)return;
  const row=a.sourceInfinitySword?.phantomSword?.currentAttack;if(!row)return;
  const data=phantomSwordDamageData(profile,row);if(!data)return;
  if(e.sourcePhantomAttackSerial!==row.serial){
    // Native MoveDataDataToDamageEffect assigns a newly initialized DamageData,
    // including its empty hitUnitList, for each queued command attack.
    e.hits={};e.hitGaps={};e.sourceHitMemory2016=[];e.sourcePhantomAttackSerial=row.serial;
  }
  e.damage.ATTACK_TIME_START=row.start;e.damage.ATTACK_TIME_END=row.end;e.damage.DAMAGE_DATA=data;
  e.damageDirectionRight=row.facing===1;
  // This queue calls SetDamageDataFromLUA without fPowerRate (header default
  // 1.f), unlike the initial CreateInstance summon. Its newly copied command
  // does not inherit a later active skill's power or trait controls.
  e.powerMultiplier=1;e.traitPolicy=null;
}
function applyFront(sim,a,state){
  state.currentAttack=copy(state.attacks[0]);
  const effect=live(sim,state.effectId);if(effect)phantomSwordEffectControls(sim.profileFor(a),a,effect);
}
export function phantomSwordStateStart(sim,a){
  if(!eligible(sim,a))return;phantomSwordSync(sim,a);
  const state=a.sourceInfinitySword?.phantomSword;if(!state)return;
  const row={state:a.state,serial:a.stateSerial,facing:a.facing,speed:sim.animationSpeed(a)};
  const declaration=attackRaw(sim.profileFor(a),row);if(!declaration||!(row.speed>0))return;
  const {window}=declaration;
  row.start=f(f(state.time+f(window['1']/row.speed))+f(.2));
  row.end=f(f(state.time+f(window['2']/row.speed))+f(.2));
  state.attacks.push(row);if(state.attacks.length===1)applyFront(sim,a,state);
}
export function phantomSwordStateEnd(sim,a){
  if(!eligible(sim,a))return;
  const state=a.sourceInfinitySword?.phantomSword,raw=sim.profileFor(a).states[a.state]?.raw;
  if(!state?.attacks.length||!Object.keys(raw??{}).some(key=>/^ATTACK_TIME\d*$/.test(key)))return;
  const row=state.attacks.at(-1);row.end=Math.min(row.end,f(state.time+f(.2)));
  if(state.attacks.length===1){state.currentAttack.end=row.end;const effect=live(sim,state.effectId);if(effect)phantomSwordEffectControls(sim.profileFor(a),a,effect);}
}
export function phantomSwordFrame(sim,a,dt){
  if(!eligible(sim,a))return;phantomSwordSync(sim,a);
  const state=a.sourceInfinitySword?.phantomSword;if(!state)return;
  const blade=live(sim,state.effectId),center=live(sim,state.centerId);
  if(!blade||!center){end(sim,a);return;}
  // Core mesh clocks advance after units; observe that packet's mesh time as
  // the reference consumer does after the native global mesh phase.
  state.time=f(blade.elapsed+dt);
  const anchor=hand(sim,a);
  if(anchor){
    state.matrixQueue.push({time:f(sim.state.time),anchor});
    let first=state.matrixQueue[0];const delayed=f(f(sim.state.time)-f(.2));
    for(let i=0;i<2;i++){
      if(first.time>delayed)break;
      state.matrixQueue.shift();if(state.matrixQueue.length)first=state.matrixQueue[0];
    }
    for(const e of [blade,center]){e.sourcePosedAnchor=copy(first.anchor);e.currentAnchor=copy(first.anchor);[e.x,e.y,e.z]=first.anchor.position;}
  }
  if(state.attacks.length&&state.attacks[0].end<state.time){state.attacks.shift();if(state.attacks.length)applyFront(sim,a,state);}
}
