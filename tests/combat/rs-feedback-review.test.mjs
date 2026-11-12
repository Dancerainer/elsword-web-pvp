import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import source from '../../contracts/rs-feedback-review-source.json' with {type:'json'};
import {fixture,cast,steps,profile,index} from '../helpers/rs-fixture.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {RS_COMMAND_EFFECT_SETS,RS_COMMAND_DAMAGE_EFFECTS} from '../../packages/combat-core/rs-effect-bindings.mjs';
import {phoenixAfterimageEnabled,createAfterimageClock,AFTERIMAGE_REFERENCE,PHOENIX_AFTERIMAGE_INTERVAL_SECONDS} from '../../packages/presentation/buff-afterimage.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('RS target static records and qualified reference bytes independently verify all changed consumers',()=>{
  for(const f of source.references){const bytes=readFileSync(f.cachePath);assert.equal(sha(bytes),f.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),f.gitBlob);}
  for(const d of Object.values(source.target.sources))assert.equal(sha(readFileSync(d.path)),d.sha256);
  // Support metadata changed with the decoded2016 traits. Pin independent raw
  // action declarations rather than a hash which also covers that metadata.
  for(const [name,d]of Object.entries(source.target.states))assert.deepEqual(profile.states[name].raw,d.raw);
  for(const [name,d]of Object.entries(source.target.damage))assert.deepEqual(profile.damageEffects[name].raw,d);
});
test('Source-created RS command effects and all audited sets use one complete presentation clock',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  for(const setName of RS_COMMAND_EFFECT_SETS)assert.deepEqual(policy.effect({skillId:null,setName}),FULL_EFFECT_QUALITY);
  for(const name of RS_COMMAND_DAMAGE_EFFECTS)assert.deepEqual(policy.effect({skillId:null,name}),FULL_EFFECT_QUALITY);
  assert.deepEqual(policy.effect({skillId:21016,name:'DamageEffect_EMK_SwordFire_Fire_Attack'}),DEFAULT_EFFECT_QUALITY);
});
test('Three overlapping 668XZ source packets retain both ring and inner cues at identical relative times',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),births=[];let time=0;
  const runtime=createEffectRuntime({index,seed:2016,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push({name:p.name,time,parent:p.options.parentParticleId})});
  const ownerTimes=new Map();
  for(let frame=0;frame<84;frame++){
    if([0,18,36].includes(frame)){const e=runtime.add('ERS_ComboPM1',{effectQuality:policy.effect({skillId:null,setName:'EffectSet_ELSWORD_DASH_JUMP_XZ'}),position:[100*frame,500,0]});ownerTimes.set(e.id,time);}
    time+=1/60;runtime.step(1/60,{});
  }
  const parents=births.filter(p=>p.name==='ERS_ComboPM1'),rings=births.filter(p=>p.name==='ERS_ComboP05');
  assert.equal(parents.length,3);assert.equal(rings.length,3);
  const delays=rings.map(p=>p.time-parents.find(parent=>parent.time<=p.time&&Math.abs(parent.time-p.time)<.04).time);
  assert.ok(delays.every(t=>Math.abs(t-1/60)<1e-9));
  for(const parent of parents)assert.ok(births.some(p=>p.name==='ERS_ComboP01'&&p.time>parent.time&&p.time-parent.time<.12),'inner layer before source outer ring expires');
});
test('Source callback rune mesh particles have a bounded prepared pool before command input',()=>{
  const budget=collectEffectMeshBudget(profile,index,[],{effectQuality:DEFAULT_EFFECT_QUALITY});
  assert.ok(budget.templates.has('ERS_ComboPM1'));assert.ok(budget.templates.has('ERS_ComboP05'));
  assert.ok(budget.demands.get('ERS_ComboP02')?.views>0);
});
for(const facing of [-1,1])for(const height of [300,1000])test(`Sword Fire airborne source descent completes at ${facing}/${height}`,()=>{
  const f=fixture({skillId:21016,facing,distance:1500});f.a.y+=height;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','fixture');
  cast(f);assert.equal(f.a.state,'ESSI_SA_EMK_SWORD_FIRE');assert.deepEqual(f.a.passiveSpeed,{x:-1,y:-1});
  let heldTime=null,descent=false;for(let frame=0;frame<180;frame++){steps(f.sim,1);if(f.a.state==='ESSI_SA_EMK_SWORD_FIRE'&&f.a.animationTime>1.3){descent ||= f.a.vy<0;
      if(f.a.animationStopped){if(heldTime===null)heldTime=f.a.animationTime;assert.equal(f.a.animationTime,heldTime);}}
  }
  assert.ok(descent);assert.ok(f.sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='ESSI_SA_EMK_SWORD_FIRE_LANDING'));
  assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='DamageEffect_EMK_SwordFire_Fire_Attack'));
  assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.y,2840);assert.equal(f.a.skillDownAccel,undefined);
});
test('Sword Fire medium density caps flame parents without delaying the source first packet',()=>{
  const t=index.templates.SwordFire_FM01,budget=particlePresentationBudget(t,t.fields.NumParticles,-1,DEFAULT_EFFECT_QUALITY);
  assert.equal(budget.divisor,1);assert.equal(budget.max,3);assert.equal(t.fields.NumParticles,40);
  const births=[],runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push(p.name)});
  runtime.add(t.name,{position:[0,500,0]});for(let i=0;i<6;i++)runtime.step(1/60,{});
  assert.ok(births.includes(t.name));assert.ok([...runtime.particles.values()].filter(p=>p.name===t.name).length<=3);
  assert.equal(particlePresentationBudget(t,40,-1,FULL_EFFECT_QUALITY).max,40);
});
for(const full of [false,true])test(`66XZ held second Z reaches ${full?'full':'tap release'} without a third edge`,()=>{
  const f=fixture({distance:1500});f.a.mp=100;f.sim.enter(f.a,'RSI_DASH_COMBO_X','fixture');
  // Original66X EPT1 enters214 directly; release its animation after the
  // original .25 minimum and before1, independent of the old XZ frame count.
  let released=false;
  steps(f.sim,170,frame=>{
    if(!full&&f.a.state==='ESSI_ERS_XZ_CHARGE'&&Math.fround(f.a.animationTime)>=Math.fround(.25))released=true;
    return {pressed:frame===10?['Z']:[],held:frame>=10&&!released?['Z']:[]};
  });
  assert.ok(f.sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='ESSI_ERS_XZ_CHARGE'));
  assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name===(full?'ELSWORD_RUNE_SLAYER_COMBO_FULL_CHARGE_XZZ':'ELSWORD_RUNE_SLAYER_COMBO_XZZ')));
  assert.equal(f.sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='ESSI_ERS_DASH_COMBO_XZ'),false,'historical short XZ is not the original136→214 branch');
  if(full)assert.equal(f.a.sourceRuneSlayer.groundRuneCreated,false,'original215 frame consumes the charge ready byte');
});
test('Phoenix original colour/source timer and user v26 display budget stay separate while buff expiration retires images',()=>{
  assert.equal(AFTERIMAGE_REFERENCE.intervalSeconds,.02);assert.equal(PHOENIX_AFTERIMAGE_INTERVAL_SECONDS,.1);
  assert.deepEqual(source.target.phoenixColor.args,[1,.157,0,1]);const f=fixture();f.sim.grantBuff(f.a,f.a,46,1);
  assert.equal(phoenixAfterimageEnabled(f.a),true);const clock=createAfterimageClock(10);
  const frames=Array.from({length:30},()=>clock.step(1/60,true));assert.equal(frames[0].capture,0);
  assert.ok(frames.slice(1,7).every(frame=>frame.capture===null));assert.equal(frames[7].capture,1);
  for(let i=0;i<30;i++)clock.step(1/60,false);assert.ok(frames.at(-1).alpha.every(a=>a===0));
  f.a.buffs=[];assert.equal(phoenixAfterimageEnabled(f.a),false);
});
for(const facing of [-1,1])test(`Phoenix absorbs original CAN_REFLEX projectile geometry and grants exactly10MP ${facing}`,()=>{
  const f=fixture({facing});f.b.mp=100;f.sim.grantBuff(f.a,f.b,46,1);const hp=f.b.hp;
  f.sim.createEffect(f.a,{NAME:'FIREBALL_SMALL_DOWN_ELSWORD'},{birthAnchor:{position:[f.b.x-30*facing,f.b.y+100,0],facing,rotation:[0,facing<0?180:0,0],customPosition:true}});
  f.sim.tickEffects(0);assert.equal(f.b.hp,hp);assert.equal(f.b.mp,110);
  for(let i=0;i<20;i++)f.sim.tickEffects(1/60);
  assert.equal(f.sim.state.events.filter(e=>e.type==='projectileAbsorbed').length,1);
});
test('Phoenix absorption respects CAN_REFLEX bit rather than magic damage colour',()=>{
  const f=fixture();f.b.mp=100;f.sim.grantBuff(f.a,f.b,46,1);const hp=f.b.hp;
  const e=f.sim.createEffect(f.a,{NAME:'FIREBALL_SMALL_DOWN_ELSWORD'},{birthAnchor:{position:[f.b.x-30,f.b.y+100,0],facing:1,rotation:[0,0,0],customPosition:true}});
  e.damage.DAMAGE_DATA.CAN_REFLEX=0;f.sim.tickEffects(0);assert.ok(f.b.hp<hp);
  assert.equal(f.sim.state.events.filter(e=>e.type==='projectileAbsorbed').length,0);
});
for(const facing of [-1,1])test(`Splash Explosive (21018) follows animation mark and original mesh-death launch ${facing}`,()=>{
  const f=fixture({skillId:21018,facing});cast(f);steps(f.sim,140);
  const raw=source.target.damage.DamageEffect_SA_ERS_SplashExplosion_Attack_2;
  assert.equal(source.target.splashIdentity.skillId,21018);assert.equal(source.target.splashSkill.args[1].m_eID,21018);
  assert.equal(source.target.splashSet.args[1].EFFECT0.START_TIME,.36);assert.equal(raw.DAMAGE_DATA.REACT_TYPE,5);
  const hits=f.sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='rs');assert.equal(hits.length,2);
  assert.equal(hits[0].data.REACT_TYPE,2);assert.equal(hits[1].data.REACT_TYPE,5);assert.equal(hits[1].data.BACK_SPEED_Y,1000);
  assert.ok(hits[1].time-hits[0].time>=.8&&hits[1].time-hits[0].time<.86);
  assert.ok(hits[0].time<.36,'default source animation timer consumes the production action speed');
});
