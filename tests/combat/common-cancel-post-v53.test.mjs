import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import {runSourceCommonPost,originalCancelLimit} from '../../packages/combat-core/common-cancel-post-v53.mjs';
import {withSourcePostRequests,requestSourceState,applySourceStateRequest} from '../../packages/combat-core/source-state-requests-v53.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const keys=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed),released:new Set(),edges:[]}),f=Math.fround;
test('original enter normalizes eight cancel gates to .1 and ATTACK falls back to WALK',()=>{
 for(const key of ['SKILL_CANCEL_AFTER','BWALK_CANCEL_AFTER','WALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX','UPDOWN_CANCEL_AFTER','SKILL_CANCEL_AFTER_FLY'])
  assert.equal(originalCancelLimit({[key]:0},key),f(.1));
 assert.equal(originalCancelLimit({WALK_CANCEL_AFTER:.7},'ATTACK_CANCEL_AFTER'),f(.7));
 assert.equal(originalCancelLimit({},'SKILL_CANCEL_AFTER'),9999);
});
test('nine-source own dash request is overwritten by common skill; MP/CD pay while old state/context remain',()=>{
 const {sim,a}=vcFixture({skillId:24034,passives:[],gap:5000}),oldState='RVC_SI_SA_IGNITION_CROW_OVERHEAT_END';
 sim.enter(a,oldState,'source-test');a.animationTime=.6;const oldSkill=a.skillId,before=a.mp;
 assert.ok(runSourceCommonPost(sim,a,{...keys(['RIGHT','A'],['DASH','A']),pureDoubleRight:true}));
 assert.equal(a.state,oldState);assert.equal(a.skillId,oldSkill);assert.ok(a.mp<before);assert.equal(a.cooldowns[24034],7);
 const events=sim.state.events.filter(e=>e.type==='sourceStateRequested');assert.equal(events.at(-2).state,'RSI_DASH');
 assert.equal(events.at(-1).state,'RSI_SA_RWT_REVOLVER_CANNON');assert.equal(a.sourcePendingState.skill.skillId,24034);
 assert.equal(a.sourcePendingState.slot,0);assert.equal(a.sourcePendingState.force,0);
 assert.ok(applySourceStateRequest(sim,a));assert.equal(a.state,'RSI_SA_RWT_REVOLVER_CANNON');assert.equal(a.skillId,24034);assert.equal(a.skillContext.key,'A');
 assert.equal(a.sourcePendingState,undefined);assert.equal(a.sourceAppliedStateByte,a.sourceStateRequestByte);
});
test('common gate is strict and slot selection never falls through an earlier empty slot',()=>{
 const {sim,a}=vcFixture({skillId:24034,passives:[],gap:5000});sim.enter(a,'RSI_A_RWT_MENTAL_BREAK','source-test');
 const p=sim.profileFor(a),at=p.states[a.state].raw.SKILL_CANCEL_AFTER;a.animationTime=at;const before=a.mp;
 runSourceCommonPost(sim,a,keys(['A'],['A']));assert.equal(a.sourcePendingState,undefined);assert.equal(a.mp,before);
 a.animationTime=at+.001;const equipped=a.loadout[0];a.loadout[0]=null;a.loadout[1]=equipped;
 runSourceCommonPost(sim,a,keys(['A','S'],['A','S']));assert.equal(a.mp,before);assert.equal(a.sourcePendingState,undefined);
});
test('own, common, and base mode3 write in that order without an early apply',()=>{
 const {sim,a}=vcFixture({skillId:24034,passives:[],gap:5000});
 sim.enter(a,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END','source-test');a.animationTime=.6;
 // A synthetic condition3 row exercises the recovered base entrance. Current
 // shipped Raven loadouts contain no condition3 row; no source value changes.
 sim.profileFor(a).skillCatalog.find(s=>s.skillId===24034).useCondition=3;
 const before=a.mp;runSourceCommonPost(sim,a,{...keys(['RIGHT','A'],['DASH','A']),pureDoubleRight:true});
 const requested=sim.state.events.filter(e=>e.type==='sourceStateRequested').map(e=>e.state);
 assert.deepEqual(requested.slice(-3),['RSI_DASH','RSI_WAIT','RSI_SA_RWT_REVOLVER_CANNON']);
 assert.equal(a.state,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END');assert.ok(a.mp<before);
 assert.equal(a.sourcePendingState.skill.skillId,24034);
});
test('pending waits for next eligible actor update and STOP prevents it from applying',()=>{
 const {sim,a}=vcFixture({passives:[],gap:5000});sim.enter(a,'RSI_A_RWT_MENTAL_BREAK','source-test');a.animationTime=.6;
 runSourceCommonPost(sim,a,keys(['LEFT']));assert.equal(a.sourcePendingState.state,'RSI_WAIT');const serial=a.stateSerial;
 a.hitStop=.1;sim.step(1/60,{}, {snapshot:false});assert.equal(a.stateSerial,serial);assert.equal(a.state,'RSI_A_RWT_MENTAL_BREAK');
 a.hitStop=a.worldStop=0;sim.step(1/60,{}, {snapshot:false});assert.equal(a.state,'RSI_WAIT');assert.ok(a.stateSerial>serial);
});
test('original own/common airborne branches can both adjust Y and final pending stays airborne',()=>{
 const {sim,a}=vcFixture({passives:[],gap:5000});sim.enter(a,'RSI_WEAPON_TAKER_COMBO_ZZZXX','source-test');a.grounded=false;const y=a.y;
 runSourceCommonPost(sim,a,keys());assert.equal(a.y,f(y-90));assert.equal(a.vx,0);assert.equal(a.passiveSpeed.x,-1);
 assert.equal(a.sourcePendingState.state,'RSI_JUMP_DOWN');assert.equal(a.state,'RSI_WEAPON_TAKER_COMBO_ZZZXX');
});
test('exit can replace pending after the apply serial has been claimed',()=>{
 const {sim,a}=vcFixture({passives:[],gap:5000});sim.enter(a,'RSI_A_RWT_MENTAL_BREAK','source-test');
 withSourcePostRequests(sim,a,()=>sim.enter(a,'RSI_WAIT','source-test-pending'));
 const claimed=a.sourceStateRequestByte,base=sim.commandsFor.bind(sim);let wrote=false;
 sim.commandsFor=actor=>{const original=base(actor);return {...original,runEnd:(actor,p)=>{
  if(actor===a&&!wrote){wrote=true;requestSourceState(sim,a,'RSI_COMBO_Z','source-exit-replaces-pending',{clearSkill:true});}
  return original?.runEnd?.(actor,p)??{handled:false};}};};
 applySourceStateRequest(sim,a);assert.equal(a.state,'RSI_COMBO_Z');assert.equal(a.sourceAppliedStateByte,claimed);
 assert.notEqual(a.sourceAppliedStateByte,a.sourceStateRequestByte,'exit advanced the request byte after the original claim');
 assert.equal(a.sourcePendingState.state,'RSI_COMBO_Z');
});
test('owner packet preserves pending skills and rejects invalid slot/template/trait magnitudes',()=>{
 const one=vcFixture({skillId:24034,passives:[],gap:5000}),two=vcFixture({skillId:24034,passives:[],gap:5000});
 one.sim.enter(one.a,'RSI_A_RWT_MENTAL_BREAK','source-test');one.a.animationTime=.6;
 runSourceCommonPost(one.sim,one.a,keys(['A'],['A']));const packet=validateOwnedState(encodeOwnedState(one.sim,one.a.id));
 validateOwnedReferences(packet,two.a,two.sim.profileFor(two.a),two.map,{actors:two.sim.state.actors,profiles:two.sim.profiles});applyOwnedState(two.sim,two.a.id,packet);
 assert.equal(two.a.sourcePendingState.skill.skillId,24034);
 applySourceStateRequest(two.sim,two.a);assert.equal(two.a.state,'RSI_SA_RWT_REVOLVER_CANNON');
 const forged=structuredClone(packet);forged.actor.sourcePendingState.skill.skillContext.traitPolicy={damageMultiplier:100};
 assert.throws(()=>validateOwnedState(forged));
 const wrong=structuredClone(packet);wrong.actor.sourcePendingState.skill.skillId=24035;
 assert.throws(()=>validateOwnedReferences(wrong,two.a,two.sim.profileFor(two.a),two.map,{actors:two.sim.state.actors,profiles:two.sim.profiles}));
 const wrongSlot=structuredClone(packet);wrongSlot.actor.sourcePendingState.slot=7;
 assert.throws(()=>validateOwnedReferences(wrongSlot,two.a,two.sim.profileFor(two.a),two.map,{actors:two.sim.state.actors,profiles:two.sim.profiles}));
});
test('awakening request consumes no bead when common post overwrites it before apply',()=>{
 const {sim,a}=vcFixture({passives:[],gap:5000});sim.enter(a,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END','source-test');a.animationTime=.6;a.awakening.orbs=3;
 runSourceCommonPost(sim,a,keys(['LEFT'],['AWAKEN']));
 assert.equal(a.awakening.orbs,3);assert.equal(a.sourcePendingState.state,'RSI_HYPER_MODE','common also prioritizes awakening');
 withSourcePostRequests(sim,a,()=>requestSourceState(sim,a,'RSI_WAIT','later-source-request',{clearSkill:true}));
 applySourceStateRequest(sim,a);assert.equal(a.awakening.orbs,3);
});
test('VC product physical66 attack survives only a final winning dash request and owner validation',()=>{
 const {sim,a,map}=vcFixture({passives:[],gap:5000});sim.enter(a,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END','source-test');a.animationTime=.6;
 runSourceCommonPost(sim,a,{...keys(['RIGHT','Z'],['DASH','Z']),pureDoubleRight:true});
 assert.deepEqual(a.sourcePendingState.productPressed,['Z']);
 const wire=validateOwnedState(encodeOwnedState(sim,a.id));validateOwnedReferences(wire,a,sim.profileFor(a),map,{actors:sim.state.actors,profiles:sim.profiles});
 applySourceStateRequest(sim,a);assert.ok(a.pendingPressed.includes('Z'));
 sim.enter(a,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END','source-test');a.animationTime=.6;
 runSourceCommonPost(sim,a,{...keys(['RIGHT','A','Z'],['DASH','A','Z']),pureDoubleRight:true});
 assert.equal(a.sourcePendingState.productPressed,undefined,'later accepted skill replaces the entire dash request');
 const forged=structuredClone(wire);forged.actor.sourcePendingState.state='RSI_COMBO_X';
 assert.throws(()=>validateOwnedReferences(forged,a,sim.profileFor(a),map,{actors:sim.state.actors,profiles:sim.profiles}));
});
