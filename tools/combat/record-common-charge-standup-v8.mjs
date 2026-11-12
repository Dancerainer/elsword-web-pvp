/** Current simulation evidence; not an original-client expected trace. */
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {commonRecoveryFixture,beginDown,receivedStrike} from '../../tests/helpers/common-charge-standup-v8-fixture.mjs';
const until=(f,p,max=240)=>{for(let i=0;i<max&&!p();i++)f.step();assert.ok(p(),f.a.state);};
const recovery=[];
for(const profession of ['RF','LK','VC'])for(const facing of [-1,1])for(const down of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING']){
  const gap=profession==='LK'&&down==='RSI_DAMAGE_DOWN_BACK'?0:20;
  const f=await commonRecoveryFixture(profession,{facing,gap});beginDown(f,down);
  until(f,()=>f.a.animationTime>.66);f.tap('X');f.step();
  f.b.knockdown.now=100;f.b.knockdown.lastDamageSeconds=-10;
  const events=[];for(let i=0;i<150;i++){f.step();events.push(...f.sim.drainEvents());}
  const hits=events.filter(e=>e.type==='hit'&&e.actorId===f.a.id&&e.targetId===f.b.id&&e.origin.kind==='character');
  assert.ok(hits.length);assert.ok(hits.every(e=>e.data.REACT_TYPE===2&&e.data.FORCE_DOWN===0));
  const knockedDown=events.some(e=>e.type==='knockdownTriggered'&&e.actorId===f.b.id);
  assert.equal(knockedDown,false);
  recovery.push({profession,facing,down,gap,initialTargetKnockdown:100,selectedState:events.find(e=>e.type==='stateChanged'&&e.actorId===f.a.id&&/STANDUP_ATTACK/.test(e.state))?.state,
    states:events.filter(e=>e.type==='stateChanged'&&e.actorId===f.a.id).map(e=>({time:e.time,state:e.state,animationName:e.animationName})),
    hits:hits.map(e=>({time:e.time,amount:e.amount,reaction:e.data.REACT_TYPE,forceDown:e.data.FORCE_DOWN,backSpeedX:e.data.BACK_SPEED_X})),
    finalFacing:f.a.facing,knockedDown,finalState:f.a.state});
}
const charge=[];
for(const [profession,state,key]of [['LK','ESSI_ESK_DASH_COMBO_ZChargeX','X'],['LK','ESSI_ELK_DASH_COMBO_XChargeX','X'],
  ['VC','RVC_DASH_COMBO_ZZZ','Z'],['VC','RVC_DASH_COMBO_ZZZPushZ_READY','Z'],['VC','RVC_DASH_COMBO_ZZZPushZ','Z']]){
  const f=await commonRecoveryFixture(profession,{gap:2500,sampledLevels:true});f.a.mp=300;
  f.a.manaBreak.canCharge=true;f.a.manaBreak.charge=50;f.sim.enter(f.a,state,'diagnostic-charge-fixture');f.down(key);
  for(let i=0;i<8;i++)f.step();const beforeHit=f.a.manaBreak.charge;
  assert.equal(beforeHit,0);assert.equal(receivedStrike(f).accepted,true);
  for(let i=0;i<8;i++)f.step();const afterHit=f.a.manaBreak.charge;assert.ok(afterHit>0);
  f.up(key);for(let i=0;i<3;i++)f.step();assert.equal(f.a.manaBreak.charge,0);
  charge.push({profession,state,key,previousGreen:50,beforeHit,afterHit,afterRelease:0});
}
const result={schema:'common-charge-standup-simulation-v8',evidenceClass:'current-simulation-not-original-oracle',targetClientMeasured:false,
  sourceContract:'contracts/common-charge-standup-source-v8.json',diagnosticFixture:'actual Garpai + converted original helper poses; named down states injected, sampled held charge receives accepted character strike',
  versions:(await commonRecoveryFixture('VC')).sim.snapshot().versions,
  recovery,charge,totalRecoveryCases:recovery.length,totalChargeCases:charge.length,
  limits:['No original2016 client runtime or native GPU trace','No widened or synthetic collision boxes','Two-direction standup hit scenarios are diagnostic fixtures, not claims about all positions']};
writeFileSync('reports/common-charge-standup-v8.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({recovery:recovery.length,charge:charge.length,passed:recovery.length+charge.length}));
