/** Current owned/standalone source-state diagnosis; no target-client answer is
 * generated here. Hits use the real applyHit path and source charging armor. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {make,profile,fixtureRoot} from '../../tests/helpers/rf-passive-fixture-v12.mjs';
import {resolve} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),cases=[];
const strike={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:80},REACT_TYPE:3,HIT_TYPE:1,BACK_SPEED_X:500,BACK_SPEED_Y:1000,STOP_TIME_DEF:.1};
for(const hits of [0,1,2]){
  const simulation=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});simulation.rng=()=>.5;simulation.drainEvents();
  const actor=simulation.actor('rf');let chargingAt=null,fullAt=null,dashAt=null,applied=0;const observations=[],hitReceipts=[];let ticks=0;
  for(;ticks<1100;ticks++){
    simulation.step(1/60,ticks===0?{pressed:['A'],held:['A']}:{held:['A']},{snapshot:false});
    const events=simulation.drainEvents();
    if(actor.state==='RSI_SA_RRF_WILD_CHARGING'){
      chargingAt??=simulation.state.time;
      if(applied<hits&&actor.sourceWildCharge.sourceChargeEquivalent>0){
        const before=actor.sourceWildCharge.sourceChargeEquivalent,hp=actor.hp;
        const result=simulation.applyHit(simulation.actor('target'),actor,strike,{kind:'controlled-source-charge-hit'});applied++;
        hitReceipts.push({time:simulation.state.time,beforeCharge:before,hpBefore:hp,hpAfter:actor.hp,hpMax:actor.hpMax,result});
      }
    }
    if(actor.sourceWildCharge?.sourceChargeEquivalent>=10)fullAt??=simulation.state.time;
    if(ticks%60===0||events.some(event=>event.type==='stateChanged'||event.name==='EffectSet_WILD_CHARGE_MAX'))
      observations.push({tick:ticks,time:simulation.state.time,state:actor.state,hp:actor.hp,wild:structuredClone(actor.sourceWildCharge),
        events:events.filter(event=>['stateChanged','originalSkillCommand','effectEnded'].includes(event.type)).map(event=>({type:event.type,state:event.state,name:event.name,reason:event.reason}))});
    if(actor.state==='RSI_SA_RRF_WILD_CHARGE_DASH'){dashAt=simulation.state.time;break;}
  }
  cases.push({hits,chargingAt,fullAt,dashAt,heldThroughout:true,ticks:ticks+1,chargeSeconds:fullAt-chargingAt,
    fullToDashSeconds:dashAt-fullAt,hitReceipts,wildAtDash:structuredClone(actor.sourceWildCharge),chargingGroupStopped:actor.sourceWildChargeEffectGroup===undefined,observations});
}
const wild=profile.skillCatalog.find(skill=>skill.skillId===24009),files=['.cache/native-reference/X2Lib/X2GURaven.cpp','packages/combat-core/active-skills.mjs',
  'packages/combat-core/index.mjs','packages/native-source/skills.mjs'];
const manifest=JSON.parse(readFileSync(resolve(fixtureRoot,'artifacts/native/manifest.json')));
const report={schema:'rf-wild-charge-source-v3',evidence:'fixed-V5 literal reference plus current native callback/real accepted hit integration; target2016 consumer unavailable',
  targetClientMeasured:false,gpuMeasured:false,businessChanged:false,target:{skillId:24009,SA_EFFECTIVE_TIME:wild.raw.SA_EFFECTIVE_TIME,SA_ATK_REL:wild.raw.SA_ATK_REL,
    description:wild.raw.m_EffectiveDesc,targetConflict:wild.referenceBinding.targetConflict},
  sourceHashes:files.map(file=>({file,sha256:sha(readFileSync(file))})),nativeModuleSha256:manifest.modules.skills.sha256,cases};
if(cases.some(row=>row.dashAt===null||!row.chargingGroupStopped)||cases[1].chargeSeconds>=cases[0].chargeSeconds||cases[2].chargeSeconds>=cases[1].chargeSeconds)
  throw Error('Expected original source auto-release or damage acceleration failed');
writeFileSync('reports/rf-wild-charge-source-v3.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(cases.map(({hits,chargingAt,fullAt,dashAt,chargeSeconds,fullToDashSeconds,hitReceipts})=>({hits,chargingAt,fullAt,dashAt,chargeSeconds,fullToDashSeconds,hitReceipts}))));
