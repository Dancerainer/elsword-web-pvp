/** Expectations frozen from original target Lua, separately from simulation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const contract=JSON.parse(readFileSync(new URL('../../contracts/vc-gatling-source-v4.json',import.meta.url)));
const LOOP='RSI_SA_RWT_HELLFIRE_GATLING_LOOP',NORMAL='DamageEffect_SA_RWT_HellFire_Explosion',HEAT=NORMAL+'_OverHit';
const vector=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<.025,`${a} != ${b}`));
test('Gatling profile declarations equal frozen original target sources, including omitted loop closure',()=>{
  for(const source of Object.values(contract.luaSources))assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'),source.sha256);
  for(const field of ['effectSets','damageEffects'])for(const [name,record]of Object.entries(contract[field]))assert.deepEqual(vcProfile[field][name],record,name);
  for(const [name,record]of Object.entries(contract.states))assert.deepEqual(vcProfile.states[name].raw,record.raw,name);
  const normal=vcProfile.damageEffects[NORMAL].raw,heat=vcProfile.damageEffects[HEAT].raw;
  assert.equal(normal.DAMAGE_DATA.DAMAGE.MAGIC,1.86);assert.equal(heat.DAMAGE_DATA.DAMAGE.MAGIC,2.5854);
  assert.equal(normal.DAMAGE_DATA.PVP_RATE,.7);
  for(let i=0;i<8;i++){
    const row=normal['CREATE_DAMAGE_EFFECT'+i];assert.equal(row.EVENT_TIME,contract.targetFacts.childExplosionTimes[i]);
    assert.deepEqual([row.OFFSET_X??0,row.OFFSET_Y??0,row.OFFSET_Z??0],contract.targetFacts.childExplosionOffsets[i]);
  }
  assert.deepEqual(contract.missingTemplates,[]);
});

for(const facing of [-1,1])for(const overheated of [false,true])test(`Gatling target loop anchor, eight children and heat penalty; facing ${facing}, heat ${overheated}`,()=>{
  const f=vcFixture({skillId:24020,position:[-600,3080,0],gap:9000,facing});
  f.sim.step(1/60,{pressed:['A']},{snapshot:false});f.sim.drainEvents();
  f.a.sourceVeteranCommander.loop=overheated?17:0;f.a.sourceVeteranCommander.maxLoop=overheated?18:1;
  f.sim.enter(f.a,LOOP,'target-loop-position-test');const stateSerial=f.a.stateSerial;
  const history=f.sim.drainEvents(),roots=[],children=[],self=[];
  for(let tick=0;tick<90;tick++){
    f.sim.step(1/120,{},{snapshot:false});const events=f.sim.drainEvents();history.push(...events);
    for(const event of events){
      if(event.type==='effectStarted'&&event.name===(overheated?HEAT:NORMAL)){
        roots.push(event);const bip=f.sim.effectAnchorSampler({definition:{BONE_NAME:'Bip01'}},f.a).position;
        vector(event.birthAnchor.position,[bip[0]+350*facing,bip[1]+35,bip[2]]);
      }
      if(event.type==='effectStarted'&&event.name==='DamageEffect_SA_RWT_HellFire_ExplosionFX')children.push(event);
      if(event.type==='overheatHpChanged')self.push(event);
    }
  }
  assert.equal(roots.length,1);assert.equal(roots[0].ownerStateSerial,stateSerial);
  const root=roots[0],links=history.filter(e=>e.type==='damageChildCreated'&&e.parentEffectId===root.effectId),
    spawned=links.map(link=>children.find(e=>e.effectId===link.effectId));
  // Parent identity is retained by generated child effects, not guessed from
  // the global total (the source end set creates additional FX of its own).
  assert.equal(spawned.length,8);assert.ok(spawned.every(Boolean));
  for(let i=0;i<8;i++){
    const offset=contract.targetFacts.childExplosionOffsets[i];
    vector(spawned[i].birthAnchor.position,root.birthAnchor.position.map((n,j)=>n+offset[j]*(j===1?1:facing)));
  }
  assert.equal(self.length,overheated?1:0);if(overheated){assert.equal(self[0].name,HEAT);assert.ok(self[0].amount>0);}
  assert.ok(!history.some(e=>e.type==='effectStarted'&&e.name.startsWith('RAVEN_HELLFIRE_GATLING_')));
});

test('actual normal and overheat Gatling casts execute only the selected target loop chain',()=>{
  for(const heat of [false,true]){
    const f=vcFixture({skillId:24020,gap:9000}),events=[];
    for(let tick=0;tick<720;tick++){
      f.sim.step(1/60,tick===0||heat&&tick%4===0?{pressed:['A']}:{},{snapshot:false});events.push(...f.sim.drainEvents());
    }
    assert.equal(events.filter(e=>e.type==='skillStarted').length,1);
    const started=events.filter(e=>e.type==='effectStarted');
    assert.equal(started.filter(e=>e.name===NORMAL).length,contract.adapterChoices.normalLoops);
    assert.equal(started.filter(e=>e.name===HEAT).length,heat?contract.adapterChoices.overheatLoops-contract.adapterChoices.normalLoops:0);
    assert.equal(events.filter(e=>e.type==='overheatIcon').length,heat?1:0);
    assert.ok(!started.some(e=>e.name.startsWith('RAVEN_HELLFIRE_GATLING_')));
  }
});

test('actual overheat Gatling keeps complete loop/child state within the owner packet budget',()=>{
  const f=vcFixture({skillId:24020,gap:20000}),remote=vcFixture({skillId:24020,gap:20000});let peak=0,roots=0;
  for(let tick=0;tick<720;tick++){
    f.sim.step(1/60,tick===0||tick<240&&tick%2===0?{pressed:['A']}:{},{snapshot:false});f.sim.drainEvents();
    const packet=encodeOwnedState(f.sim,'vc',{frameSeq:tick});peak=Math.max(peak,Buffer.byteLength(JSON.stringify(packet)));
    assert.equal(packet.effects.length,f.sim.state.effects.filter(e=>e.ownerId==='vc'&&!e.dead).length);
    if(tick%10===0){
      validateOwnedReferences(packet,remote.a,vcProfile,remote.map);applyOwnedState(remote.sim,'vc',packet);remote.sim.drainEvents();
      for(const sent of packet.effects)if([NORMAL,HEAT].includes(sent.name)){
        const received=remote.sim.state.effects.find(e=>e.networkSourceId===sent.id||e.id===sent.id);
        assert.ok(received);assert.deepEqual(received.definition,sourceDefinition(sent.name));
        assert.deepEqual(received.childCounts,sent.childCounts);roots++;
      }
    }
  }
  assert.ok(roots>0);assert.ok(peak<96*1024);
});
function sourceDefinition(name){return contract.effectSets['EffectSet_SA_RWT_HellFire_Loop'+(name===HEAT?'_OverHit':'')].raw.EFFECT0;}
