import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addDroneMarkContact,tickAddDroneMark,addDroneMarkTarget,validateAddDroneMarkState,validateAddDroneMarkEffect,ADD_DRONE_MARK_PROJECTILE} from '../../packages/combat-core/add-drone-mark.mjs';
import {addDroneMarkDuration,receiveAddTargetNotice,validateAddTargetNotice,flushAddTargetNotices} from '../../packages/combat-core/add-target-notices.mjs';
import {createBuffFromFactor,mergeBuffs,tickBuffs} from '../../packages/combat-core/buffs.mjs';
import {skillTraitBuffFactor} from '../../packages/combat-core/skill-traits.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const source=read('contracts/add-drone-mark-target-v1.json');
const profile={...read('packages/combat-core/mm-profile.json')};
profile.buffFactors={...profile.buffFactors,...source.buffFactors};profile.buffTemplates={...profile.buffTemplates,...source.buffTemplates};
// Buff arithmetic already has native regression coverage. This test verifies
// the actual target factor selection and transformed lifetime, not WASM ABI.
const numeric={buffFixed:(v,r)=>Math.fround(v*(1-r)),buffRelation:()=>{throw Error('unused');},buffPercent:()=>{throw Error('unused');},buffInterval:()=>{throw Error('unused');}};
function fixture({networkOwnerId=null,skillId=29013,pose=true}={}){
 const a={id:'mm',professionId:'MM',team:0,hp:100,mp:200,loadout:[{skillId}],skillId,x:0,y:0,z:0};
 const b={id:'enemy',professionId:'LK',team:1,hp:100,mp:50,x:400,y:0,z:0,buffs:[],buffResistances:{0:0},debuffDurationMultiplier:1};
 const c={...b,id:'other',x:500,buffs:[]};
 const e={id:1,ownerId:a.id,name:ADD_DRONE_MARK_PROJECTILE,skillId};
 const sim={networkOwnerId,networkEpochFor:id=>id==='mm'?2:3,state:{actors:[a,b,c],effects:[e]},profileFor:()=>profile,events:[],notes:[],
  grantBuff:(s,t,id,level,policy)=>{const result=createBuffFromFactor(profile,{factor:skillTraitBuffFactor(profile.buffFactors[id].raw,policy),sourceFactorId:id,skillLevel:level,sourceActor:s,targetActor:t,roll:.5,nativeValues:numeric});assert.equal(result.supported,true,JSON.stringify(result));t.buffs=mergeBuffs(profile,t.buffs,result.buff);return t.buffs.find(b=>b.templateId===344);},
  createEffect:(owner,definition,options)=>{const effect={id:sim.state.effects.length+1,ownerId:owner.id,name:definition.NAME,definition,...options};sim.state.effects.push(effect);return effect;},
  effectAnchorSampler:pose?(e,actor)=>({position:[actor.x,actor.y+90,actor.z],rotation:[0,0,0],facing:1}):null,
  emit:(...args)=>sim.events.push(args),note:(...args)=>sim.notes.push(args)};
 return {sim,a,b,c,e};
}

test('original marking projectile applies21.5 percent defense once; explosion and DIE children never mark',()=>{
 const {sim,a,b,c,e}=fixture();
 for(const name of ['DamageEffect_Drone_Activator_Loop_Explosion','DAMAGE_EFFECT_Drone_Activator_Generate'])assert.equal(addDroneMarkContact(sim,a,b,{...e,name}),false);
 assert.equal(addDroneMarkContact(sim,a,b,e),true);assert.equal(addDroneMarkContact(sim,a,c,e),false);assert.equal(c.buffs.length,0);
 assert.equal(b.buffs[0].factorId,370);assert.equal(b.buffs[0].templateId,344);
 for(const row of b.buffs[0].behaviors){assert.ok(['physicalDefence','magicDefence'].includes(row.stat));assert.equal(row.value,Math.fround(.785));}
 assert.equal(a.sourceAddDroneMark.remaining,Math.fround(4.9));assert.equal(b.buffs[0].finalizers[0].remaining,Math.fround(4.9));
 assert.equal(sim.state.effects.filter(e=>e.sourceAddDroneMarkVisual).length,4);
 for(const visual of sim.state.effects.filter(e=>e.sourceAddDroneMarkVisual)){assert.equal(visual.traceActorId,b.id);assert.deepEqual(visual.birthAnchor.position,[400,90,0]);validateAddDroneMarkEffect(visual,{owner:a,profile,actors:sim.state.actors});}
 validateAddDroneMarkState(a.sourceAddDroneMark,{owner:a,profile,actors:sim.state.actors});
});

test('enhancement uses raw1.5 multiplication; skill cancel and generator switching cannot clear the mark',()=>{
 const {sim,a,b,e}=fixture({skillId:29035});addDroneMarkContact(sim,a,b,e);
 const duration=Math.fround(Math.fround(4.9)*1.5);assert.equal(a.sourceAddDroneMark.remaining,duration);assert.notEqual(duration,7.4);
 a.state='RSI_WAIT';a.skillId=null;a.sourceAdd={generator:{skillId:29017}};
 tickAddDroneMark(sim,a,1);assert.equal(addDroneMarkTarget(sim,a),b);assert.equal(a.sourceAddDroneMark.remaining,Math.fround(duration-1));
 tickAddDroneMark(sim,a,7);assert.equal(a.sourceAddDroneMark,undefined);
 assert.ok(sim.state.effects.filter(e=>e.sourceAddDroneMarkVisual).every(e=>e.dead));
 assert.equal(a.sourceAddTargetNotice.remaining,0);
});

test('recipient owner applies an aged mark once; sender and replay cannot change remote defense',()=>{
 const {sim,a,b,e}=fixture({networkOwnerId:'mm'});addDroneMarkContact(sim,a,b,e);
 assert.equal(b.buffs.length,0);tickAddDroneMark(sim,a,1);
 const notice=structuredClone(a.sourceAddTargetNotice);sim.networkOwnerId='enemy';
 assert.equal(receiveAddTargetNotice(sim,a,2,notice,{presentationAge:.5}),true);
 assert.ok(Math.abs(b.buffs[0].finalizers[0].remaining-3.4)<1e-6);
 assert.equal(receiveAddTargetNotice(sim,a,2,notice),false);
 const saved=structuredClone(sim.state);sim.state=structuredClone(saved);
 assert.equal(receiveAddTargetNotice(sim,sim.state.actors[0],2,notice),false);
 assert.equal(addDroneMarkContact(sim,a,b,{...e,sourceAddDroneMarkAccepted:undefined}),false);
});

test('pending baseline preserves late-snapshot age and refuses expired or respawned recipients',()=>{
 for(const mode of ['late','expired','respawn']){
  const {sim,a,b,e}=fixture({networkOwnerId:'mm'});addDroneMarkContact(sim,a,b,e);sim.networkOwnerId='enemy';
  sim.deferAddTimeRingNotices=true;receiveAddTargetNotice(sim,a,2,a.sourceAddTargetNotice,{presentationAge:mode==='expired'?5:1.25});
  assert.equal(b.buffs.length,0);if(mode==='respawn')sim.networkEpochFor=()=>4;
  sim.deferAddTimeRingNotices=false;flushAddTargetNotices(sim);
  if(mode==='late')assert.ok(Math.abs(b.buffs[0].finalizers[0].remaining-3.65)<1e-6);else assert.equal(b.buffs.length,0);
  assert.equal(receiveAddTargetNotice(sim,a,2,a.sourceAddTargetNotice),false);
 }
});

test('mark validity clears on death, invincibility, target respawn and replacement; debuff owns its independent timer',()=>{
 for(const gate of ['hp','forceInvincible','invincible','epoch','ownerDeath']){
  const {sim,a,b,e}=fixture();addDroneMarkContact(sim,a,b,e);
  if(gate==='hp')b.hp=0;if(gate==='forceInvincible')b.forceInvincible=1;if(gate==='invincible')b.invincible=true;
  if(gate==='epoch')sim.networkEpochFor=()=>4;if(gate==='ownerDeath')a.hp=0;
  tickAddDroneMark(sim,a,.016);assert.equal(a.sourceAddDroneMark,undefined,gate);
  assert.equal(b.buffs.length,1);const result=tickBuffs(profile,b.buffs,5,{targetActor:b,nativeValues:numeric});assert.equal(result.buffs.length,0);
 }
 const {sim,a,b,c,e}=fixture();addDroneMarkContact(sim,a,b,e);const old=sim.state.effects.filter(e=>e.sourceAddDroneMarkVisual);
 addDroneMarkContact(sim,a,c,{...e,id:99,sourceAddDroneMarkAccepted:undefined});assert.equal(a.sourceAddDroneMark.targetId,c.id);assert.ok(old.every(e=>e.dead));
 assert.equal(b.buffs.length,1);assert.equal(c.buffs.length,1);
});

test('missing target bone never spawns a caster-bone substitute',()=>{
 const {sim,a,b,e}=fixture({pose:false});assert.equal(addDroneMarkContact(sim,a,b,e),true);
 assert.equal(sim.state.effects.length,1);assert.equal(b.buffs.length,1);assert.equal(sim.notes[0][0],'add-drone-mark-target-pose');
});

test('strict mark and notice schemas reject foreign identity, target, timing, arbitrary strength and malformed values',()=>{
 const {sim,a,b,e}=fixture();addDroneMarkContact(sim,a,b,e);const s=a.sourceAddDroneMark,n=a.sourceAddTargetNotice,context={owner:a,profile,actors:sim.state.actors};
 for(const mark of [null,{...s,remaining:5},{...s,targetId:a.id},{...s,targetEpoch:-1},{...s,skillId:29010},{...s,damageMultiplier:100}])assert.throws(()=>validateAddDroneMarkState(mark,context));
 for(const notice of [{...n,remaining:NaN},{...n,remaining:5},{...n,strength:1},{...n,targets:[...n.targets,...n.targets]},{...n,skillId:29016}])assert.throws(()=>validateAddTargetNotice(notice,context));
 assert.throws(()=>validateAddDroneMarkEffect({...e,sourceAddDroneMarkAccepted:1},context));
 assert.throws(()=>validateAddDroneMarkEffect({...e,name:'unrelated'},context));
 assert.throws(()=>validateAddDroneMarkState(s,{...context,owner:{...a,professionId:'DE'}}));
 assert.throws(()=>addDroneMarkDuration({...profile,buffFactors:{}},29013));
 sim.networkOwnerId='enemy';assert.throws(()=>receiveAddTargetNotice(sim,a,2,n,{presentationAge:-1}));
});
