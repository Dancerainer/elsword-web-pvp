/** Independent original2016 declarations and producer count expectations.
 * Full production skill input, original pose/native contact and actual hurt
 * state; not merely selectHitReaction called with a copied implementation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {preparePracticeTarget} from '../../apps/web/practice-resources.mjs';
const PRE='DamageEffect_SA_APT_Conqueror_Hyper_Pre',SHOT='DamageEffect_SA_APT_Conqueror_Projectile',SHOCK=SHOT+'_Shock',MAIN='DamageEffect_SA_APT_Conqueror_Hyper';
const source={
 [PRE]:{coefficient:.38,react:1,stop:0},
 [SHOCK]:{coefficient:4.25,react:5,stop:.05},
 [MAIN]:{coefficient:61.05,react:5,stop:.2},
};
for(const mutation of [0,3])test(`formed real Conqueror with${mutation}mutation distinguishes Pre, mutation shots and final blast`,t=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29008});preparePracticeTarget(sim);
 a.sourceAdd.dp=8000;a.mp=a.mpMax;
 // Do not treat a manually flipped formation flag as a completed awakening
 // lifecycle. Enter formation through the actual awakening key and source
 // availability instead of pressing A on the initial unprepared packet.
 const initialAvailability=sim.skillAvailability(a.id,0);
 t.diagnostic(JSON.stringify({initialState:a.state,initialAvailability}));
 for(let frame=0;frame<180&&!sim.skillAvailability(a.id,0).available;frame++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(sim.skillAvailability(a.id,0).available,true,JSON.stringify(sim.skillAvailability(a.id,0)));
 sim.step(1/60,{add:{pressed:['AWAKEN'],held:['AWAKEN']}},{snapshot:false});
 for(let frame=0;frame<240&&(!a.sourceAdd.formation||!sim.skillAvailability(a.id,0).available);frame++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(a.sourceAdd.formation,true,'actual AWAKEN must finish formation entry');
 assert.equal(sim.skillAvailability(a.id,0).available,true,JSON.stringify(sim.skillAvailability(a.id,0)));
 a.sourceAdd.mutation=mutation;
 sim.drainEvents();
 const contacts=[],apply=sim.applyHit.bind(sim);
 sim.applyHit=(attacker,target,data,origin)=>{
  const e=origin.kind==='effect'?sim.state.effects.find(row=>row.id===origin.id):null;
  const result=apply(attacker,target,data,origin);
  if(result.accepted&&e&&source[e.name])contacts.push({name:e.name,ownerSerial:e.ownerStateSerial,amount:result.amount,
   coefficient:data.DAMAGE?.MAGIC,react:data.REACT_TYPE,stop:data.STOP_TIME_DEF,state:target.state,hitStop:target.hitStop});
  return result;
 };
 sim.step(1/60,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 assert.equal(a.state,'ANSI_SA_APT_CONQUEROR_HYPER');const castSerial=a.stateSerial;
 for(let frame=1;frame<250;frame++)sim.step(1/60,{}, {snapshot:false});
 const born=sim.state.events.filter(e=>e.type==='effectStarted'&&e.actorId===a.id&&e.ownerStateSerial===castSerial);
 assert.equal(born.filter(e=>e.name===SHOT).length,mutation,'Original Hyper creates c<=3, not normal12+c shots');
 assert.equal(born.filter(e=>e.name===MAIN).length,1);
 const pre=contacts.filter(e=>e.name===PRE);assert.ok(pre.length>0,'Actual original pre mesh must accept contact');
 assert.ok(pre.some(e=>['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_AIR_SMALL'].includes(e.state)),
  'RT1 produces an actual small-hurt action under ordinary fixture conditions');
 assert.ok(pre.every(e=>e.hitStop===0),'Zero defender stop is independently observable from the small-hurt state');
 assert.ok(contacts.some(e=>e.name===MAIN&&e.amount>0),'Real primary blast contact required');
 if(!mutation)assert.ok(contacts.every(e=>e.name!==SHOCK),'No mutation cannot manufacture additional scatter damage');
 for(const e of contacts){const expected=source[e.name];assert.equal(e.coefficient,expected.coefficient);assert.equal(e.react,expected.react);assert.equal(e.stop,expected.stop);}
 assert.ok(b.hp>0,'Original practice HP fixture keeps the reaction observation alive');
});
test('formed mutation scatter independently hits a distant stationary original-map victim and applies actual Shock launch',()=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29008});preparePracticeTarget(sim);
 // This real initial spawn avoids the close victim being launched by Hyper
 // before the three-dimensional scatter unlocks. No live actor is moved.
 b.x=1300;a.sourceAdd.dp=8000;a.mp=a.mpMax;
 sim.step(1/60,{add:{pressed:['AWAKEN'],held:['AWAKEN']}},{snapshot:false});
 for(let n=0;n<240&&(!a.sourceAdd.formation||!sim.skillAvailability(a.id,0).available);n++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(a.sourceAdd.formation,true);assert.equal(sim.skillAvailability(a.id,0).available,true);
 a.sourceAdd.mutation=3;sim.drainEvents();
 const contacts=[],apply=sim.applyHit.bind(sim);
 sim.applyHit=(attacker,target,data,origin)=>{
  const e=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null,result=apply(attacker,target,data,origin);
  if(result.accepted&&attacker.id===a.id&&[SHOT,SHOCK,PRE,MAIN].includes(e?.name))contacts.push({name:e.name,amount:result.amount,
   coefficient:data.DAMAGE?.MAGIC,react:data.REACT_TYPE,stop:data.STOP_TIME_DEF,state:target.state});
  return result;
 };
 for(let frame=0;frame<360;frame++)sim.step(1/60,frame===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
 assert.equal(contacts.filter(e=>e.name===SHOT).length,3,'all three original mutation carriers actually contact this target');
 assert.ok(contacts.filter(e=>e.name===SHOT).every(e=>e.amount===0),'NO_DAMAGE belongs to the carrier, not its Shock');
 const shock=contacts.filter(e=>e.name===SHOCK);assert.ok(shock.length>0,'real descendants must accept HP damage');
 assert.ok(shock.every(e=>e.amount>0&&e.coefficient===4.25&&e.react===5&&e.stop===.05));
 assert.ok(shock.some(e=>['RSI_DAMAGE_AIR_FLY_FRONT','RSI_DAMAGE_AIR_FLY_BACK'].includes(e.state)),'actual Shock requests the original launch state');
 assert.ok(contacts.every(e=>![PRE,MAIN].includes(e.name)),'independent scatter proof excludes the main blast taking credit');
});
