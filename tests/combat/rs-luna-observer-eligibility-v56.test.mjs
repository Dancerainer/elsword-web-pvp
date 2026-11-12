/** Current Web DD/observation regressions; explicit contact inputs, not an
 * original-client trajectory. Original source rows and real native value
 * consumers remain unchanged. No observer may write foreign gameplay state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {observeRemoteDamage} from '../../packages/combat-core/observed-damage.mjs';
import {runeSlayerEffectDamage} from '../../packages/combat-core/rs-skills.mjs';
import {fixture,profile,read} from '../helpers/rs-fixture.mjs';
import {elesisAssets} from '../helpers/elesis-fixture.mjs';

const blade='DamageEffect_SA_ERS_LunaBlade',explosion='DamageEffect_SA_ERS_LunaBlade_ExposionFinal';
const mpEvents=sim=>sim.state.events.filter(e=>['buffMpChanged','observedBuffMpChanged'].includes(e.type));
function contact(f,name=explosion,{originalRaw=false}={}){
  const {sim,a,b}=f;a.skillId=21017;b.mp=b.mpMax;
  const effect=sim.createEffect(a,{NAME:name});sim.drainEvents();
  const raw=profile.damageEffects[name].raw.DAMAGE_DATA;
  return {data:originalRaw?raw:runeSlayerEffectDamage(profile,effect,raw),origin:{kind:'effect',id:effect.id,skillId:21017}};
}
function observeWithoutWrites(f,entry){
  const before=f.sim.snapshot(),result=observeRemoteDamage(f.sim,f.a,f.b,entry.data,entry.origin),after=f.sim.snapshot();
  for(const state of [before,after]){delete state.events;delete state.nextEventId;delete state.localRuneLunaHitReceipts;}
  assert.deepEqual(after,before);return result;
}

for(const hp of [1,1000000])test(`V62 first explosion damage and observer living-factor eligibility agree at hp=${hp}`,()=>{
  const live=fixture({skillId:21017}),seen=fixture({skillId:21017});
  for(const f of [live,seen]){f.b.hpMax=Math.max(f.b.hpMax,hp);f.b.hp=hp;}
  const direct=contact(live),observed=contact(seen);
  assert.equal(direct.data.NO_DAMAGE,undefined);assert.equal(direct.data.REACT_TYPE,2);assert.deepEqual(direct.data.BUFF_FACTOR_ID,{'1':117});
  const settled=live.sim.applyHit(live.a,live.b,direct.data,direct.origin);live.sim.advanceActorBuffs(live.b,1/60);
  const estimated=observeWithoutWrites(seen,observed);
  assert.equal(estimated.accepted,true);assert.equal(estimated.amount,settled.amount);
  assert.ok(settled.amount>0);assert.equal(live.b.hp,Math.max(0,hp-settled.amount));
  assert.equal(estimated.buffContactAllowed,hp>settled.amount);
  const count=hp>settled.amount?1:0;assert.equal(mpEvents(live.sim).length,count);assert.equal(mpEvents(seen.sim).length,count);
  if(count){assert.equal(live.b.state,'RSI_DAMAGE_BIG_FRONT');assert.ok(Math.abs(mpEvents(live.sim)[0].delta+Math.fround(live.b.mpMax*Math.fround(.3)))<.001);
   assert.equal(mpEvents(seen.sim)[0].delta,mpEvents(live.sim)[0].delta);}
  assert.equal(profile.damageEffects[explosion].raw.DAMAGE_DATA.NO_DAMAGE,undefined,'original declaration remains independent');
});

test('original blade row has no factor117; V62 project first blade contact still delivers its one MP application',()=>{
  const f=fixture({skillId:21017}),entry=contact(f,blade);
  assert.equal(entry.data.BUFF_FACTOR_ID,undefined);
  const result=observeWithoutWrites(f,entry);assert.equal(result.accepted,true);assert.equal(result.buffContactAllowed,true);
  assert.equal(mpEvents(f.sim).length,1);
});

test('protected target early return has no local DD buff permission or observed MP number',()=>{
  const f=fixture({skillId:21017}),entry=contact(f);f.b.forceInvincible=1;
  const result=observeWithoutWrites(f,entry);assert.equal(result.accepted,false);
  assert.equal(Object.hasOwn(result,'buffContactAllowed'),false);assert.equal(mpEvents(f.sim).length,0);
});

function mixedFixture(){
  const base=fixture({skillId:21017}),ca=elesisAssets('CA');
  const sim=createSimulation({profile,profiles:{CA:ca.profile},map:base.sim.map,
    preset:{...read('config/rs-preset.json'),loadout:[{skillId:21017},...Array(7).fill(null)]},presets:{CA:ca.preset},seed:2016,
    actors:[{id:'rs',professionId:'RS',team:0,position:[2022.98,2840,0],lineId:6,facing:1},
      {id:'target',professionId:'CA',team:1,position:[2187.85,2840,0],lineId:6,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    nativeGeometry:base.sim.nativeGeometry,nativeSkillValues:base.sim.nativeSkillValues,
    nativeCritical:base.sim.nativeCritical,nativeManaBreak:base.sim.nativeManaBreak,
    effectAnchorSampler:(e,a,options)=>a.professionId==='CA'?ca.samplers.effectAnchorSampler(e,a,options):base.sim.effectAnchorSampler(e,a,options)});
  return {sim,a:sim.actor('rs'),b:sim.actor('target')};
}
for(const immunity of ['chivalry','endurance'])test(`original raw Luna DD against CA ${immunity} source gate blocks factor and observer MP text`,()=>{
  const live=mixedFixture(),seen=mixedFixture();
  for(const f of [live,seen]){
    if(immunity==='chivalry'){f.sim.prepareWayOfSword(f.b.id,-2);f.b.sourceElesisBreakCharge=2000;}
    else assert.equal(f.sim.grantBuff(f.b,f.b,232,1).templateId,238);
    f.b.invincible=false;f.b.forceInvincible=0;f.b.superArmor=false;
  }
  // These raw declarations independently exercise the existing immunity gate.
  // V62 cast quotas do not bypass it; actual helper production is covered by
  // rs-luna-project-v62, not by this explicit-contact fixture.
  const direct=contact(live,explosion,{originalRaw:true}),observed=contact(seen,explosion,{originalRaw:true});
  const settled=live.sim.applyHit(live.a,live.b,direct.data,direct.origin);live.sim.advanceActorBuffs(live.b,1/60);
  const estimated=observeWithoutWrites(seen,observed);
  assert.equal(settled.accepted,true);assert.equal(settled.amount,0);assert.equal(estimated.accepted,true);assert.equal(estimated.amount,0);
  assert.equal(estimated.buffContactAllowed,false);
  assert.equal(mpEvents(live.sim).length,0);assert.equal(mpEvents(seen.sim).length,0);
});
