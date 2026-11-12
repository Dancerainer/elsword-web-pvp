import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {addFantasyTracerAcceptedHit,tickAddFantasyTracer,addFantasyTracerPlan,commitAddFantasyTracer,restoreAddFantasyTracerTarget,finishAddFantasyTracer,validateAddFantasyTracerState} from '../../packages/combat-core/add-fantasy-tracer.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
const skill=id=>profile.skillCatalog.find(s=>s.skillId===id);
const ordinary={mode:'cast',mpCost:30,dpCost:10,cooldown:6,resourceMpInsufficient:true,resourceDpInsufficient:true};
function fixture(){
 const a={id:'lp',professionId:'LP',hp:100,team:0,mp:20,state:'RSI_WAIT',sourceAdd:{formation:true},passivePolicy:{skillLevels:{29404:3}},
  loadout:[{skillId:29216},{skillId:29217}],sourceAddCombat:{pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:null}};
 const b={id:'enemy',team:1,hp:100,x:3000,y:900,z:0},c={id:'enemy2',team:1,hp:100};
 const sim={state:{actors:[a,b,c]},networkOwnerId:null,events:[],emit:(...args)=>sim.events.push(args)};
 return {sim,a,b,c};
}
test('Fantasy producer uses raw base USED identities without ordinary CAN or1000/500 gates',()=>{
 const {sim,a,b}=fixture();assert.equal(addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202}),true);
 assert.deepEqual(a.sourceAddFantasyTracer.targets,[{skillId:29202,targetId:'enemy',targetEpoch:0,remaining:3,used:false}]);
 assert.equal(addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29201,REACT_TYPE:11}),true);
 assert.equal(a.sourceAddFantasyTracer.targets.length,2);assert.equal(a.sourceAddCombat.nasodTargetId,null);
 assert.equal(addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29217,CAN_ACTIVATE_NASOD_ARMOR_COMBO:1}),false);
 assert.equal(addFantasyTracerAcceptedHit(sim,a,b,{APPLIED_SKILL_ID:29202}),false);
 validateAddFantasyTracerState(a.sourceAddFantasyTracer,{owner:a,profile,actors:sim.state.actors});
});
test('same family replaces the previous target; Phase and Particle records remain independent',()=>{
 const {sim,a,b,c}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});tickAddFantasyTracer(a,.5);
 addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29201});addFantasyTracerAcceptedHit(sim,a,c,{USED_SKILL_ID:29202});
 assert.equal(a.sourceAddFantasyTracer.targets.length,2);assert.deepEqual(a.sourceAddFantasyTracer.targets.map(r=>[r.skillId,r.targetId,r.remaining]),[[29201,b.id,3],[29202,c.id,3]]);
});
test('two-second eligibility and additional one-second target retention use the exact boundary',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});tickAddFantasyTracer(a,1.5);
 assert.equal(addFantasyTracerPlan(a,skill(29217),ordinary,{profile}).mode,'fantasy-tracer');
 // Original3275eca0 disables below1 and erases below0, both strict.
 tickAddFantasyTracer(a,.5);assert.equal(a.sourceAddFantasyTracer.targets[0].remaining,1);assert.equal(a.sourceAddFantasyTracer.targets[0].used,false);
 assert.equal(addFantasyTracerPlan(a,skill(29217),ordinary,{profile}).mode,'fantasy-tracer');
 tickAddFantasyTracer(a,.5);assert.equal(a.sourceAddFantasyTracer.targets.length,1);
 assert.equal(addFantasyTracerPlan(a,skill(29217),ordinary,{profile}),ordinary);
 tickAddFantasyTracer(a,.5);assert.equal(a.sourceAddFantasyTracer.targets[0].remaining,0);
 tickAddFantasyTracer(a,.01);assert.equal(a.sourceAddFantasyTracer.targets.length,0);
});
test('pure plan maps enhanced identity, keeps existing CD and gives Pulse zeroMP/DP',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});a.mp=0;a.cooldowns={29217:4};
 const before=structuredClone(a),plan=addFantasyTracerPlan(a,skill(29217),ordinary,{profile});assert.deepEqual(a,before);
 assert.equal(plan.fantasySkillId,29202);assert.equal(plan.fantasyTargetId,b.id);assert.equal(plan.mpCost,0);assert.equal(plan.dpCost,0);assert.equal(plan.mutationCost,0);
 assert.equal(plan.ignoreCooldown,true);assert.equal(plan.resourceMpInsufficient,false);assert.equal(plan.resourceDpInsufficient,false);assert.equal(plan.recastState,'ANSI_COMBO_NASOD_ARMOR_READY');
 assert.equal(commitAddFantasyTracer(a,plan),true);assert.equal(a.sourceAddCombat.nasodTargetId,b.id);assert.equal(a.sourceAddFantasyTracer.targets[0].used,true);assert.equal(a.cooldowns[29217],4);assert.equal(a.mp,0);
 assert.equal(commitAddFantasyTracer(a,plan),false);
});
test('Phase live dummy preserves source5MP price while Fantasy chooses the action ahead of blink',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29201});
 const base=addFantasyTracerPlan(a,skill(29216),ordinary,{profile});assert.equal(base.mpCost,0);
 a.sourceAddCombat.phase={remaining:8,position:[0,0,0],group:1,skillId:29216};a.mp=4;
 const plan=addFantasyTracerPlan(a,skill(29216),{...ordinary,mode:'phase-return',recastState:'ANSI_A_AN_PHASE_SHIFT_BLINK'},{profile});
 assert.equal(plan.mode,'fantasy-tracer');assert.equal(plan.mpCost,5);assert.equal(plan.resourceMpInsufficient,true);assert.equal(plan.dpCost,0);assert.equal(plan.ignoreCooldown,true);
 assert.equal(a.sourceAddCombat.phase.remaining,8);
});
test('only the two knocked-down states receive a state-cancel and air exception',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});
 for(const state of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_FRONT','RSI_DAMAGE_AIR','RSI_WAIT']){
  a.state=state;const plan=addFantasyTracerPlan(a,skill(29217),ordinary,{profile});const down=state.includes('DOWN_');
  assert.equal(plan.allowStateCancel,down,state);assert.equal(plan.allowAir,down,state);
 }
});
test('selected target is reread on attack entry, respects later-life identity and clears active selector at landing',()=>{
 const {sim,a,b,c}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});commitAddFantasyTracer(a,addFantasyTracerPlan(a,skill(29217),ordinary,{profile}));
 addFantasyTracerAcceptedHit(sim,a,c,{USED_SKILL_ID:29202});assert.equal(restoreAddFantasyTracerTarget(sim,a),c);assert.equal(a.sourceAddCombat.nasodTargetId,c.id);
 sim.networkEpochFor=()=>2;assert.equal(restoreAddFantasyTracerTarget(sim,a),false);assert.equal(a.sourceAddCombat.nasodTargetId,null);
 finishAddFantasyTracer(a);assert.equal(a.sourceAddFantasyTracer.activeSkillId,null);assert.equal(restoreAddFantasyTracerTarget(sim,a),null);
});
test('consumed row expiry cannot leave an old pursuit target behind',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});commitAddFantasyTracer(a,addFantasyTracerPlan(a,skill(29217),ordinary,{profile}));
 tickAddFantasyTracer(a,3.01);assert.equal(a.sourceAddFantasyTracer.activeSkillId,null);assert.equal(a.sourceAddCombat.nasodTargetId,null);
});
test('ownership, passive, formation, HP recovery, summon and historical replay gates reject spurious producers',()=>{
 for(const mode of ['owner','passive','formation','heal','summon','observe','epoch']){
  const {sim,a,b}=fixture();const data={USED_SKILL_ID:29202},origin={};
  if(mode==='owner')sim.networkOwnerId='enemy';if(mode==='passive')a.passivePolicy.skillLevels={};if(mode==='formation')a.sourceAdd.formation=false;
  if(mode==='heal')data.HP_PERCENT_UP=.1;if(mode==='summon')origin.sourceAddSummonSerial=1;if(mode==='observe')sim.observationOnly=true;
  if(mode==='epoch')sim.networkOwnerId=a.id;
  assert.equal(addFantasyTracerAcceptedHit(sim,a,b,data,origin),false,mode);assert.equal(a.sourceAddFantasyTracer,undefined);
 }
});
test('strict schema rejects duplicate/unbounded records, malformed used fields and foreign source/target identities',()=>{
 const {sim,a,b}=fixture();addFantasyTracerAcceptedHit(sim,a,b,{USED_SKILL_ID:29202});const s=a.sourceAddFantasyTracer,row=s.targets[0],context={owner:a,profile,actors:sim.state.actors};
 for(const state of [null,{...s,targets:[row,row]},{...s,activeSkillId:29201},{...s,targets:[{...row,remaining:4}]},
  {...s,targets:[{...row,remaining:.999,used:false}]},{...s,targets:[{...row,skillId:29217}]},{...s,targets:[{...row,targetId:a.id}]},
  {...s,targets:[{...row,used:1}]},{...s,targets:[{...row,remaining:NaN}]},{...s,targets:[{...row,targetEpoch:-1}]}])assert.throws(()=>validateAddFantasyTracerState(state,context));
 assert.throws(()=>validateAddFantasyTracerState(s,{...context,owner:{...a,professionId:'MM'}}));
 assert.throws(()=>validateAddFantasyTracerState(s,{...context,owner:{...a,loadout:[]}}));
});
