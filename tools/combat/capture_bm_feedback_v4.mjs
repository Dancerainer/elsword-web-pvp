/** Current-simulation observations only; original source expectations are separate. */
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bmSampledFixture,bmFixture,bmProfile,feedbackBmPreset} from '../../tests/helpers/bm-feedback-fixture-v4.mjs';
const rows=[];
for(const facing of[-1,1]){
  const f=bmSampledFixture({facing,gap:150,passives:[]});f.sim.rng=()=>.99;
  f.press('X');f.press('X');f.wait('RSI_COMBO_XX');f.press('X');f.wait('RSI_COMBO_XXX');f.step(180);
  const events=f.sim.state.events,queued=events.find(e=>e.type==='xxxCandidateQueued'),started=events.find(e=>e.type==='effectStarted'&&e.name==='DamageEffect_RF_XXX');
  rows.push({kind:'xxx',facing,input:'physical sampled X X X',state:f.a.state,
    payment:events.filter(e=>e.type==='xxxCandidatePayment'),
    queuedAt:queued.time,bornAt:started.time,setDelay:started.definition.START_TIME,
    hits:events.filter(e=>e.type==='hit'&&e.origin?.sourceCandidate).map(e=>({time:e.time,amount:e.amount,targetId:e.targetId,magic:e.data.DAMAGE.MAGIC})),
    effectEnd:events.filter(e=>e.type==='effectEnded'&&e.name==='DamageEffect_RF_XXX'),remainingEffects:f.sim.state.effects.length});
  const b=bmSampledFixture({facing,skillId:24210,gap:4000,passives:[]});b.zzz();b.press('X');b.wait('RBM_COMBO_ZZZX');b.at(.3);
  const ids=[...b.a.sourceBladeMaster.blackHoleEffectIds],before=b.a.sourceBladeMaster.blackHoleRemaining,at=b.sim.state.time;
  b.press('A');const after={time:b.sim.state.time,state:b.a.state,remaining:b.a.sourceBladeMaster.blackHoleRemaining,
    retained:ids.filter(id=>b.sim.state.effects.some(e=>e.id===id&&!e.dead))};b.step(180);
  rows.push({kind:'black-hole-skill-cancel',facing,ids,cancelAt:at,remainingBefore:before,after,
    end:b.sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId)),
    remainingAtEnd:b.a.sourceBladeMaster.blackHoleRemaining});
  for(const hyper of[false,true]){
    const h=bmFixture({skillId:24013,gap:250,facing,passives:[]});h.sim.rng=()=>.99;
    if(hyper)h.a.awakening.remaining=20;
    h.sim.step(1/60,{bm:{pressed:['A'],held:['A']}});for(let i=0;i<220;i++)h.sim.step(1/60,{});
    const child=h.sim.state.events.find(e=>e.type==='damageChildCreated'&&e.name===`RAVEN_HYPER_SONIC_STAB${hyper?'_HYPER':''}_Damage`);
    rows.push({kind:'hypersonic-stab',facing,hyper,screenStop:h.sim.state.events.find(e=>e.type==='worldStop'),
      contact:h.sim.state.events.filter(e=>e.type==='effectContact'&&e.origin.skillId===24013).map(e=>({time:e.time,animationTime:e.origin.animationTime})),
      child,damage:h.sim.state.events.filter(e=>e.type==='hit'&&e.origin.skillId===24013).map(e=>({time:e.time,sinceChild:e.time-child.time,amount:e.amount})),
      finalState:h.a.state});
  }
}
const result={schemaVersion:1,evidenceClass:'current-Web-simulation-observations-not-original-client',
  blackHoleLifetimeRecheck:'v5 corrects the earlier missing SpecialAttack/WAIT/WALK/DASH_END/lost-floor timer reset callbacks; old v4 captures remain before-fix simulation observations.',
  originalClientMeasurementCount:0,gpuMeasured:false,profileId:bmProfile.profileId,
  profileSha256:createHash('sha256').update(readFileSync(new URL('../../packages/combat-core/bm-profile.json',import.meta.url))).digest('hex'),
  presetVersion:feedbackBmPreset.presetVersion,presetSha256:createHash('sha256').update(readFileSync(new URL('../../config/bm-preset.json',import.meta.url))).digest('hex'),
  map:'sander-garpai-rock-pvp original authored collision',stepSeconds:1/60,seed:2016,passives:[],rows};
writeFileSync(new URL('../../reports/bm-feedback-runtime-v4.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,clientMeasured:false,profileSha256:result.profileSha256}));
