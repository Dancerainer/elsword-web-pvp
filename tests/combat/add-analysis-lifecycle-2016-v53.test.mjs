import test from 'node:test';
import assert from 'node:assert/strict';
import de from '../../packages/combat-core/de-profile.json' with {type:'json'};
import mm from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import lp from '../../packages/combat-core/lp-profile.json' with {type:'json'};
import {startAddSpaceCrack,tickAddSpaceCrack,endAddSpaceCrack,validateAddSpaceCrack} from '../../packages/combat-core/add-space-crack-2016.mjs';
import {clearAddPersistentSkill,tickAddVoidHold} from '../../packages/combat-core/add-persistent-skills.mjs';
import {selectAddMmLot6,advanceAddMmLot6,addMmLot6Contact,validateAddMmLot6} from '../../packages/combat-core/add-mm-lot6-2016.mjs';
import {bindAddCountdownShake,tickAddCountdownShake,validateAddCountdownShake} from '../../packages/combat-core/add-countdown-shake-2016.mjs';
import {startAddPrismEndpoints,tickAddPrismEndpoints,applyAddPrismEndpointDamage,validateAddPrismEndpoints} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {addPrismSetExpired,ADD_PRISM_SET} from '../../packages/combat-core/add-prism-v45.mjs';
function fixture(p=de){
 const a={id:'add',team:0,professionId:p.professionId.toUpperCase(),hp:1000,hpMax:1000,mp:100,skillId:29220,skillScale:1.2,stateSerial:7,state:'RSI_WAIT',stateTime:0,x:0,y:0,z:0,facing:1,sourceAdd:{formation:false,mutation:3,dp:4000},sourceAddCombat:{pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1},stats:{}};
 const b={id:'b',team:1,hp:1000,x:100,y:0,z:0},sim={state:{effects:[],actors:[a,b],nextEffectId:1},profileFor:()=>p,events:[],emit:(...x)=>sim.events.push(x),note:()=>{},effectAnchorSampler:(e,a)=>({position:[a.x,a.y,a.z],rotation:[0,0,0]}),
  createEffect(actor,definition,options={}){const e={id:this.state.nextEffectId++,ownerId:actor.id,name:definition.NAME,skillId:actor.skillId,definition:{...definition},...options};this.state.effects.push(e);return e;},spawnSet(actor,name){return this.createEffect(actor,{NAME:name},{setName:name});}};return {a,b,sim};
}
test('Space Crack remains timed in WAIT: exactly1 main+5 extra attempts,3MP each, no moving-key dependency',()=>{
 const {a,sim}=fixture();assert.equal(startAddSpaceCrack(sim,a),true);for(let i=0;i<5;i++)tickAddSpaceCrack(sim,a,.2);
 const shots=sim.state.effects.filter(e=>e.name.endsWith('_Projectile'));assert.equal(shots.length,6);assert.ok(shots[0].name.includes('_Main_'));assert.ok(shots.slice(1).every(e=>e.name.includes('_Sub_')));assert.equal(a.mp,85);assert.equal(a.sourceAddCombat.spaceCrack.active,false);validateAddSpaceCrack(a.sourceAddCombat.spaceCrack);
 tickAddSpaceCrack(sim,a,.2);assert.equal(sim.state.effects.filter(e=>e.name.endsWith('_Projectile')).length,6);
});
test('Space Crack DP equal snapshot cost allows production but strict payment gate does not deduct; END clears maintenance',()=>{
 const {a,sim}=fixture();a.sourceAdd.formation=true;a.sourceAdd.dp=60;startAddSpaceCrack(sim,a);tickAddSpaceCrack(sim,a,.2);assert.equal(a.sourceAdd.dp,60);assert.equal(a.sourceAddCombat.spaceCrack.count,2);
 endAddSpaceCrack(sim,a,'ANSI_A_ATT_SPACE_CRACK_END');assert.equal(a.sourceAddCombat.spaceCrack.active,false);assert.ok(sim.state.effects.find(e=>e.setName==='EffectSet_ATT_Space_Crack').dead);
 assert.throws(()=>validateAddSpaceCrack({...a.sourceAddCombat.spaceCrack,count:7}));
});
test('Void END retires only its visual group and shrinks carrier per callback after the state is left',()=>{
 const {a,sim}=fixture();a.skillId=29023;const carrier=sim.createEffect(a,{NAME:'DamageEffect_ATT_Void_Field'}),visual=sim.spawnSet(a,'EffectSet_ATT_Void_Field');clearAddPersistentSkill(sim,a,'void');assert.equal(visual.dead,true);assert.equal(carrier.dead,undefined);
 tickAddVoidHold(sim,a,.016);assert.equal(carrier.sourceAddVoidCollapse.scale,Math.fround(.9800000190734863));assert.equal(carrier.sourceAddVoidCollapse.alpha,Math.fround(1+Math.fround(-.03)));
 for(let i=0;i<500&&!carrier.dead;i++)tickAddVoidHold(sim,a,.016);assert.equal(carrier.dead,true);assert.ok(carrier.sourceAddVoidCollapse.scale<=.0010000000474974513);
 assert.equal(sim.state.effects.length,2,'END adds no second explosion');
});
test('Void LOOP maintenance is attempted on the5s/release callback, and equal rawDP fails without debit',()=>{
 const {a,sim}=fixture();a.state='ANSI_SA_ATT_VOID_FIELD_LOOP';a.stateTime=5;a.mp=100;tickAddVoidHold(sim,a,.1);assert.equal(a.mp,97.5);
 a.sourceAdd.formation=true;a.sourceAdd.dp=50;tickAddVoidHold(sim,a,.1);assert.equal(a.sourceAdd.dp,50);assert.equal(a.sourceAddCombat.voidMaintenanceFailed,true);
});
function lotFixture(name='DamageEffect_AMM_Countdown_Bomb_Projectile'){
 const f=fixture(mm),e={name,skillId:29211,damage:mm.damageEffects[name].raw,sourceShadowMesh:{literalMotion:true,position:[0,0,0],rotation:[0,0,0],basis:[[1,0,0],[0,1,0],[0,0,1]],dirSpeed:333,velocity:[0,0,0],gravity:[0,0,0]},birthAnchor:{rotation:[0,0,0]}};
 f.sim.nativeSkills={vectorLockOn:()=>({manualDirDegree:[1,0,0]})};return {...f,e};
}
test('MM LOT6 strict endpoints and nearest-only replacement preserve equal-distance collection order',()=>{
 const {sim,a,b,e}=lotFixture();b.x=700;assert.equal(selectAddMmLot6(sim,e,a,[0,0,0]),null);b.x=0;assert.equal(selectAddMmLot6(sim,e,a,[0,0,0]),null);b.x=100;sim.state.actors.push({...b,id:'equal',x:-100});assert.equal(selectAddMmLot6(sim,e,a,[0,0,0]).id,'b');
});
test('Countdown mode1 clears failed history once; Flick mode3 preserves singleton and clears only more than1',()=>{
 const c=lotFixture();c.b.x=100;addMmLot6Contact(c.e,c.b);assert.equal(selectAddMmLot6(c.sim,c.e,c.a,[0,0,0]),null);assert.deepEqual(c.e.sourceAddLot6.history,[]);assert.equal(selectAddMmLot6(c.sim,c.e,c.a,[0,0,0]).id,'b');
 const d=lotFixture('DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub');addMmLot6Contact(d.e,d.b);assert.equal(selectAddMmLot6(d.sim,d.e,d.a,[0,0,0]),null);assert.deepEqual(d.e.sourceAddLot6.history,['b']);addMmLot6Contact(d.e,{id:'other'});assert.equal(selectAddMmLot6(d.sim,d.e,d.a,[0,0,0]),null);assert.deepEqual(d.e.sourceAddLot6.history,[]);
});
test('Flick cannot steer until first attack; ordinary Countdown saves/stops/restores dirSpeed on failed/successful search',()=>{
 const d=lotFixture('DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub');advanceAddMmLot6(d.sim,d.e,d.a,.1);assert.equal(d.e.sourceAddLockOn,undefined);addMmLot6Contact(d.e,d.b);d.sim.state.actors.push({...d.b,id:'c',x:200});advanceAddMmLot6(d.sim,d.e,d.a,.1);assert.equal(d.e.sourceAddLockOn.targetId,'c');validateAddMmLot6(d.e);
 const c=lotFixture();c.b.x=800;advanceAddMmLot6(c.sim,c.e,c.a,.31);advanceAddMmLot6(c.sim,c.e,c.a,.01);assert.equal(c.e.sourceShadowMesh.dirSpeed,0);c.b.x=100;advanceAddMmLot6(c.sim,c.e,c.a,.01);assert.equal(c.e.sourceShadowMesh.dirSpeed,0);advanceAddMmLot6(c.sim,c.e,c.a,.01);assert.equal(c.e.sourceShadowMesh.dirSpeed,333);
});
test('Countdown observed facing difference increments each prune, once per group, and deletion is next prune after10',()=>{
 const {sim,b}=fixture(mm);b.facing=-1;b.sourceFacingHistory={previous:1,current:-1};const entries=[1,2].map(id=>({id,ownerId:'add',setName:'EffectSet_Countdown_Bomb_Trace',traceActorId:b.id}));bindAddCountdownShake(entries,b);sim.state.effects=entries;
 for(let i=0;i<10;i++)tickAddCountdownShake(sim);assert.equal(entries[0].sourceAddCountdownShake.count,10);assert.equal(entries[1].sourceAddCountdownShake.count,10);assert.equal(entries[0].dead,undefined);for(const e of entries)validateAddCountdownShake(e);
 tickAddCountdownShake(sim);assert.ok(entries.every(e=>e.dead));
 const mutation={id:3,setName:'EffectSet_Countdown_Bomb_Trace_Mutation',traceActorId:b.id};bindAddCountdownShake([mutation],b);assert.equal(mutation.sourceAddCountdownShake,undefined);
});
test('Prism endpoints use quarterHP and strict native duration, opposite first-match death does not remove caster field',()=>{
 const {sim,a}=fixture(lp);a.skillId=29003;sim.state.effects=[{ownerId:a.id,setName:ADD_PRISM_SET,skillId:29003,setElapsed:7}];startAddPrismEndpoints(sim,a,[50,0,0],[700,0,0],123);
 assert.deepEqual(a.sourceAddPrismEndpoints.map(n=>n.hp),[250,250]);validateAddPrismEndpoints(a.sourceAddPrismEndpoints,{owner:a});tickAddPrismEndpoints(sim,a,6.9);assert.ok(a.sourceAddPrismEndpoints.every(n=>n.hp>0));tickAddPrismEndpoints(sim,a,.01);assert.ok(a.sourceAddPrismEndpoints.every(n=>n.hp===0));assert.equal(sim.state.effects[0].dead,undefined);assert.equal(addPrismSetExpired(sim,a,sim.state.effects[0]),false);
});
test('Prism HP0 owner is not destroyed caster; direct endpoint damage is owner-authoritative and cannot mutate foreign HP',()=>{
 const {sim,a}=fixture(lp);startAddPrismEndpoints(sim,a,[0,0,0],[650,0,0]);const id=a.sourceAddPrismEndpoints[0].id;sim.networkOwnerId='other';assert.equal(applyAddPrismEndpointDamage(sim,a,id,250),false);sim.networkOwnerId=a.id;assert.equal(applyAddPrismEndpointDamage(sim,a,id,250),true);tickAddPrismEndpoints(sim,a,.01);assert.equal(a.sourceAddPrismEndpoints[0].pendingState,'DYING');tickAddPrismEndpoints(sim,a,.01);assert.ok(a.sourceAddPrismEndpoints.every(n=>n.hp===0));a.hp=0;assert.equal(addPrismSetExpired(sim,a,{ownerId:a.id,setName:ADD_PRISM_SET,skillId:29003,setElapsed:8}),false);
});
