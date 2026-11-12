import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cast,steps,profile} from '../helpers/rs-fixture.mjs';
import {runeSlayerSkillEvent,runeSlayerEffectHitMemory} from '../../packages/combat-core/rs-skills.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {index} from '../helpers/rs-fixture.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import source from '../../contracts/rs-splash-phoenix-source-v3.json' with {type:'json'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Splash/Phoenix independent source file/blob identities and fragments remain frozen',()=>{
  for(const f of source.references){const bytes=readFileSync(f.cachePath);assert.equal(sha(bytes),f.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),f.gitBlob);
    const lines=bytes.toString('latin1').split(/\r?\n/);for(const part of f.fragments)
      assert.equal(sha(Buffer.from(lines.slice(part.firstLine-1,part.lastLine).join('\n'),'latin1')),part.sha256);
  }
  for(const f of Object.values(source.targetSources))assert.equal(sha(readFileSync(f.path)),f.sha256);
});
test('Audited RS raw records are unchanged; native first/second reactions and mesh times stay original',()=>{
  assert.deepEqual(profile.damageEffects.DamageEffect_SA_ERS_SplashExplosion_Attack.raw,source.splash.marking);
  assert.deepEqual(profile.damageEffects.DamageEffect_SA_ERS_SplashExplosion_Attack_2.raw,source.splash.explosion);
  assert.deepEqual(profile.damageEffects.DamageEffect_SA_ERS_PhoenixTalon.raw,source.phoenix.raw);
  assert.equal(source.splash.markingMesh.fields.LifeTime,.8);assert.equal(source.splash.explosionMesh.fields.LifeTime,.5);
  assert.equal(source.phoenix.raw.DAMAGE_DATA_NEXT.REACT_TYPE,2);assert.equal(source.phoenix.raw.DAMAGE_DATA_NEXT.STOP_TIME_DEF,.7);
});
const input=(held=[])=>({held:new Set(held),pressed:new Set()});
function contacts(f){const rows=[],apply=f.sim.applyParticipantHit.bind(f.sim);f.sim.applyParticipantHit=(a,b,data,origin)=>{
  const out=apply(a,b,data,origin);if(out.accepted&&a.id==='rs')rows.push({data,state:b.state,vy:b.vy,fly:b.flyCount,stop:b.hitStop,
    stopRequest:b.sourceStopQueues?.hit?.at(-1)&&{...b.sourceStopQueues.hit.at(-1)},origin,time:f.sim.state.time});return out;
};return rows;}
for(const facing of [-1,1])for(const awake of [false,true]){
  test(`Splash real original geometry: marking stagger, timely explosion launch ${facing}/${awake}`,()=>{
    const f=fixture({skillId:21018,facing});if(awake)f.a.awakening.remaining=60;
    const rows=contacts(f);cast(f);steps(f.sim,130);
    assert.equal(rows.length,2);assert.equal(rows[0].data.REACT_TYPE,2);assert.equal(rows[0].data.DAMAGE.MAGIC,5.47);
    assert.equal(rows[1].data.REACT_TYPE,5);assert.equal(rows[1].data.DAMAGE.MAGIC,14.76);
    assert.ok(rows[1].state.startsWith('RSI_DAMAGE_AIR_FLY_'));assert.equal(rows[1].vy,1000);assert.equal(rows[1].fly,0);
    // The original direct StateStart set uses animation .36 (EffectSet
    // default), followed by the independently authored .8 global mesh life.
    // The prior fixed wall-clock bound silently assumed ESTT_CUSTOM.
    const sourceClock=source.splash.independentExpectations.markBirth/f.sim.animationSpeed(f.a,profile.states.ESSI_SA_ERS_SPLASH_EXPLOSION)+source.splash.markingMesh.fields.LifeTime;
    assert.ok(rows[1].time>=sourceClock&&rows[1].time<sourceClock+4/60,'animation mark birth + original global mesh life, not passive range extension');
  });
  test(`Phoenix actual ascending and returning contacts both react ${facing}/${awake}`,()=>{
    const f=fixture({skillId:21015,facing});if(awake)f.a.awakening.remaining=60;
    const rows=contacts(f);cast(f);steps(f.sim,180);
    const ascending=rows.filter(r=>r.data.REACT_TYPE===16),returning=rows.filter(r=>r.data.DAMAGE.MAGIC===14.53);
    assert.ok(ascending.length>3);assert.ok(ascending.every(r=>r.fly===0&&r.vy===700));
    assert.equal(returning.length,1);assert.equal(returning[0].data.REACT_TYPE,2);
    assert.equal(returning[0].data.STOP_TIME_DEF,.7);
    assert.deepEqual(returning[0].stopRequest,{remaining:Math.fround(.7),sourceId:'rs'},'original setter appends; next User update refreshes the scalar cache');
    assert.match(returning[0].state,/RSI_DAMAGE_(?:BIG_|AIR_SMALL)/);
  });
}
test('Splash exact held-key skip boundary, automatic end and airborne successor follow declared callback',()=>{
  for(const [time,keys,expected] of [[1.399,['Z'],false],[1.4,['RIGHT'],false],[1.401,[],false],[1.401,['Z'],true],[1.401,['Q'],true],[1.9,[],true]]){
    const f=fixture({skillId:21018});cast(f);f.a.animationTime=time;
    assert.equal(runeSlayerSkillEvent(f.sim,f.a,input(keys)),true);
    assert.equal(f.a.state==='RSI_WAIT',expected,`${time}/${keys}`);
  }
  const f=fixture({skillId:21018});cast(f);f.a.animationTime=1.401;f.a.grounded=false;f.a.lineId=null;
  runeSlayerSkillEvent(f.sim,f.a,input(['RIGHT']));assert.equal(f.a.state,'RSI_JUMP_DOWN');assert.equal(f.a.skillId,null);
});
test('Faster Splash held input recovers after animation1.4 while marking survives and later explodes',()=>{
  const f=fixture({skillId:21018});f.a.stats.animationSpeedMultiplier=f.a.buffBaseStats.animationSpeedMultiplier=f.a.equipmentAttributes.animationSpeedMultiplier=1.8;cast(f);let saved,recoveryClock;
  for(let i=0;i<170;i++){const before=f.a.animationTime;steps(f.sim,1,{held:['Z']});if(f.a.state==='RSI_WAIT'){
    recoveryClock=before;
    saved=f.sim.state.effects.find(e=>e.name==='DamageEffect_SA_ERS_SplashExplosion_Attack'&&!e.dead);break;
  }}
  // Faster animation can recover before the independent .8 global mesh
  // clock; changing state must preserve that mesh and its death explosion.
  assert.ok(saved);assert.ok(saved.meshLifetimeElapsed<Math.fround(source.splash.markingMesh.fields.LifeTime));
  assert.equal(saved.deleteOnStateEnd,false);
  steps(f.sim,45);assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId==='rs'&&e.data.REACT_TYPE===5));
  assert.ok(Math.fround(recoveryClock)>Math.fround(1.4)&&recoveryClock<1.4+1.8*3/60,'strict original held gate then pending apply, before natural animation end');
});
test('Phoenix expires only elapsed repeating-stage receipts and preserves returning one-shot receipt',()=>{
  const e={name:'DamageEffect_SA_ERS_PhoenixTalon',damage:profile.damageEffects.DamageEffect_SA_ERS_PhoenixTalon.raw,
    stage:0,hits:{expired:1,pending:1.26},hitGaps:{expired:.1,pending:.1}};
  runeSlayerEffectHitMemory(profile,e,1.35);assert.deepEqual(e.hits,{pending:1.26});assert.deepEqual(e.hitGaps,{pending:.1});
  e.stage=1;runeSlayerEffectHitMemory(profile,e,2);assert.deepEqual(e.hits,{pending:1.26});
});
for(const facing of [-1,1])test(`Splash explosion inherits original passive size for real geometry and owner restore ${facing}`,()=>{
  const f=fixture({skillId:21018,facing});cast(f);
  let child;for(let i=0;i<120&&!child;i++){steps(f.sim,1);child=f.sim.state.effects.find(e=>e.name==='DamageEffect_SA_ERS_SplashExplosion_Attack_2'&&!e.dead);}
  assert.ok(child);for(const key of ['SCALE_X','SCALE_Y','SCALE_Z'])assert.equal(child.definition[key],f.a.passivePolicy.runeSlayer.runeSizeMultiplier);
  const packet=encodeOwnedState(f.sim,'rs',{frameSeq:120,epoch:0}),peer=fixture({skillId:21018,facing});
  validateOwnedReferences(packet,peer.a,profile,peer.map);applyOwnedState(peer.sim,'rs',packet);
  const restored=peer.sim.state.effects.find(e=>e.networkId===child.id);assert.ok(restored);
  assert.equal(restored.sourceRuneLevel,child.sourceRuneLevel);assert.deepEqual(restored.definition,child.definition);
  assert.deepEqual(peer.sim.effectSampler(restored,peer.a,{profile}),f.sim.effectSampler(child,f.a,{profile}));
});
for(const facing of [-1,1])test(`Repeated owner reports preserve one returning Phoenix hit ${facing}`,()=>{
  const source=fixture({skillId:21015,facing,networkOwnerId:'rs'}),peer=fixture({skillId:21015,facing,networkOwnerId:'target'});
  const remote=createRemoteActionConsumer();remote.bind(peer.sim,'target',()=>0);
  const rows=contacts(peer);cast(source);
  for(let frame=0;frame<180;frame++){
    steps(source.sim,1);const packet=encodeOwnedState(source.sim,'rs',{frameSeq:frame,epoch:0});
    validateOwnedReferences(packet,peer.a,profile,peer.map);applyOwnedState(peer.sim,'rs',packet);steps(peer.sim,1);
  }
  assert.ok(rows.filter(r=>r.data.REACT_TYPE===16).length>3);
  assert.equal(rows.filter(r=>r.data.DAMAGE.MAGIC===14.53).length,1);
});
for(const name of ['ERS_SplashExplosionSL01','ERS_SplashExplosionSL02'])test(`Medium ${name} preserves overlapping rune particles through mark/explosion`,()=>{
  const born=[],runtime=createEffectRuntime({index,seed:2016,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>{if(p.name===name)born.push(p.age);}});
  const emitter=runtime.add(name,{position:[0,500,0]});assert.equal(emitter.divisor,1);
  const counts=[];for(let frame=0;frame<36;frame++){runtime.step(1/60,{});counts.push([...runtime.particles.values()].filter(p=>p.name===name).length);}
  assert.ok(born.length>=5);assert.ok(counts.slice(8).every(n=>n>0),'native10/s,.2s life must overlap instead of a .6s gap');
});
for(const name of ['ERS_SplashExplosionS01','ERS_SplashExplosionS02','ERS_SplashExplosionE01','ERS_SplashExplosionE02'])test(`Medium Splash short ${name} births original structural packet`,()=>{
  const births=[],runtime=createEffectRuntime({index,seed:2016,effectQuality:DEFAULT_EFFECT_QUALITY,onBirth:p=>births.push(p.name)});
  const emitter=runtime.add(name,{position:[0,500,0]});for(let i=0;i<12;i++)runtime.step(1/60,{});
  assert.equal(emitter.divisor,1);assert.ok(births.includes(name));
});
