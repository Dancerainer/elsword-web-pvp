import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {DEFAULT_EFFECT_QUALITY,ACTIVE_ARMOR_CAST_EFFECT_SET} from '../../packages/effect-runtime/presentation-quality.mjs';

const names=['Ring_SI_A_ES_Endurance02','Ring_SI_A_ES_Endurance01','Light_SI_A_ES_Endurance03'];
for(const id of ['LK','RS','IS','GM','BH','CA'])test(id+' normal native armor keycast uses source startup packets and retires without cold quad slots',async t=>{
  // Real source poses, original map and native consumers; only shader readiness
  // and texture transport are omitted. This is CPU lifecycle/allocation evidence.
  const elesis=['GM','BH','CA'].includes(id),skillId=elesis?28218:21218;
  const {sim,a,b,profile}=elesisFixture(id,{skillId,gap:1400}),{effectIndex,samplers}=elesisAssets(id);
  const index={templates:Object.fromEntries(names.map(name=>[name,{...effectIndex.templates[name],textures:{},untexturedPlane:true}]))};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('armor-cast',new Vector3(0,0,10),scene);
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  let view;
  try{
    view=await createEffectsView({scene,engine,index,profile,samplers,effectQuality:DEFAULT_EFFECT_QUALITY,loadout:a.loadout});
    await view.prewarmActors([a]);const slots=view.proof().quadDrawSlots;
    assert.equal(slots,elesis?6:3,'finite actual-owner startup reservation');
    sim.drainEvents();const events=[],peaks=Object.fromEntries(names.map(name=>[name,0])),first={};
    const before={state:a.state,hp:a.hp,targetHp:b.hp,mp:a.mp};
    for(let frame=0;frame<180;frame++){
      sim.step(1/60,frame===0?{[a.id]:{pressed:['A'],held:['A']}}:{},{snapshot:false});
      const packet=sim.drainEvents();events.push(...packet);for(const event of packet)view.event(event,sim.state);
      view.step(1/60,sim.state);view.render();
      const proof=view.proof({includeDraws:true}),draws=proof.nativeParticleDraws;
      for(const name of names){const count=draws.counts[name]??0;peaks[name]=Math.max(peaks[name],count);if(count&&first[name]===undefined)first[name]=frame/60;}
      for(const sequence of draws.sequences.filter(sequence=>names.includes(sequence.name))){
        assert.deepEqual(sequence.quality,{level:'high',particleDivisor:1});assert.equal(sequence.densityDivisor,1);
      }
      assert.equal(proof.quadDrawSlots,slots,'no extra slot on cast frame '+frame);
      if(frame===0){assert.equal(a.state,before.state,'no-state skill does not replace motion');assert.ok(a.mp<before.mp);}
    }
    assert.equal(events.filter(event=>event.type==='skillStarted'&&event.skillId===skillId).length,1);
    assert.equal(events.filter(event=>event.type==='sound'&&event.name==='Elsword_Endurance.ogg').length,1);
    assert.equal(events.filter(event=>event.type==='effectSet'&&event.name===ACTIVE_ARMOR_CAST_EFFECT_SET).length,elesis?2:1);
    assert.deepEqual(names.map(name=>peaks[name]),elesis?[4,4,2]:[2,2,1]);
    assert.ok(first[names[0]]<.15);assert.ok(first[names[1]]<.32);
    assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);
    assert.equal(a.hp,before.hp);assert.equal(b.hp,before.targetHp);
    assert.equal(events.filter(event=>event.type==='hit'||event.type==='destructionRageStarted'||event.type==='elesisBurstStarted').length,0);
    const buffId=elesis?238:18,buff=a.buffs.find(buff=>buff.templateId===buffId),duration=elesis?7:5;
    assert.ok(buff,'finite startup retirement does not end the original armor buff');
    assert.equal(buff.factorId,elesis?423:714);assert.equal(buff.finalizers.find(row=>row.kind==='time').sourceDuration,duration);
    const starts=events.filter(event=>event.type==='effectStarted'&&event.setName===ACTIVE_ARMOR_CAST_EFFECT_SET);
    const retained=starts.filter(event=>view.hasEffect(event.effectId));
    // Original buff238 owns three display handles until its seven-second
    // finalizer expires, although each finite startup emitter has ended.
    // Check exact identities; unrelated or duplicate parents must still fail.
    assert.equal(starts.length,elesis?6:3);
    assert.deepEqual(retained.map(event=>[event.name,event.actorId,event.buffTemplateId]).sort(),elesis?names.map(name=>[name,a.id,238]).sort():[]);
    assert.equal(view.proof().activeEffectParents,retained.length);
    assert.deepEqual(sim.state.effects.filter(effect=>effect.setName===ACTIVE_ARMOR_CAST_EFFECT_SET).map(effect=>effect.id).sort((x,y)=>x-y),
      retained.map(event=>event.effectId).sort((x,y)=>x-y));
    for(const event of retained){const owner=sim.state.effects.find(effect=>effect.id===event.effectId);
      assert.equal(owner.buffTemplateId,238);assert.equal(owner.ownerId,a.id);assert.equal(owner.name,event.name);}
    assert.ok(starts.filter(event=>event.buffTemplateId==null).every(event=>!view.hasEffect(event.effectId)),'explicit cast group already retired');
    let buffFinishedAt=null;
    for(let frame=180;frame<480;frame++){
      sim.step(1/60,{}, {snapshot:false});const packet=sim.drainEvents();events.push(...packet);for(const event of packet)view.event(event,sim.state);
      view.step(1/60,sim.state);view.render();
      assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().quadDrawSlots,slots);
      if(buffFinishedAt===null&&!a.buffs.some(value=>value.templateId===buffId))buffFinishedAt=sim.state.time;
    }
    assert.ok(buffFinishedAt>=duration&&buffFinishedAt<=duration+.05,'unchanged original buff duration');
    assert.equal(events.filter(event=>event.type==='buffFinished'&&event.actorId===a.id&&event.templateId===buffId).length,1);
    for(const event of retained){assert.equal(view.hasEffect(event.effectId),false);
      assert.equal(events.filter(end=>end.type==='effectEnded'&&end.effectId===event.effectId&&end.reason==='buff-finished').length,1);}
    assert.equal(view.proof().activeEffectParents,0);assert.equal(sim.state.effects.length,0);
    assert.equal(a.buffs.some(value=>value.templateId===buffId),false);
    t.diagnostic(JSON.stringify({profession:id,skillId,first,peaks,slots,particlesRetiredBySeconds:3,
      retainedAt3Seconds:retained.map(event=>({id:event.effectId,name:event.name,buffTemplateId:event.buffTemplateId})),buffFinishedAt,finalParents:0}));
  }finally{view?.clear();scene.dispose();engine.dispose();}
});
