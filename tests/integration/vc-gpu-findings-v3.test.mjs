/** Reproduce four concrete browser findings using actual assets. This does not
 * replace browser screenshots or an original-client comparison. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/vc',path)))]));
const cases=[24213,24217,24020,24023,24605];
// User v8 suppresses residual fire after accepted bomb contacts. Keep the
// original normal skill cases and exercise the missing-frame presentation on
// the supported miss -> natural expiry -> ground-fire path independently.
const scenarios=[...cases.map(skillId=>({skillId,mode:'normal',gap:800})),
  ...[24213,24217].flatMap(skillId=>[{skillId,mode:'hit',gap:160},{skillId,mode:'miss',gap:20000}])];
const reported=/RVC_C_dashJumpX_hitGround_P05_1:bone|raven_SA_hellFire_hit_0[1-5]:bone|SA_RVC_IGNITION_CROW_INCINERATION_P0[12]:birth|EffectSet_RVC_Flame_Buster_P05:land/;

test('browser-reported VC attachment and land-plane failures remain absent through real skill lifecycles',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('vc-bindings',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  let f=vcFixture();
  const profile={...vcProfile,skillCatalog:vcProfile.skillCatalog.filter(s=>cases.includes(s.skillId))};
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,loadout:cases.map(skillId=>({skillId})),
    samplers:{effectAnchorSampler:(...args)=>f.sim.effectAnchorSampler(...args),effectBoneSampler:(...args)=>f.sim.effectBoneSampler(...args)}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  let gatlingStarts=0,crowBirths=0,flameStarts=0,originalMissingFrame=0;
  for(const {skillId,mode,gap} of scenarios){
    view.clear();f=vcFixture({skillId,position:[-600,3080,0],gap});f.sim.drainEvents();
    const eventCounts={};
    const projectileIds=new Set(),contacts=new Set(),secondary=[],ended=new Map(),missingBefore=originalMissingFrame;
    for(let frame=0;frame<720;frame++){
      const input=frame===0?{pressed:['A'],held:['A']}:skillId===24217&&mode!=='normal'&&frame===15?{pressed:['X']}:{};
      f.sim.step(1/60,input,{snapshot:false});
      for(const e of f.sim.drainEvents()){
        eventCounts[e.type]=(eventCounts[e.type]??0)+1;
        if(e.type==='effectStarted'&&/^DAMAGE_EFFECT_(?:NAPALM_GRENADE|SHADOW_BACK_SLIDE)_BULLET_[123]$/.test(e.name))projectileIds.add(e.effectId);
        if(e.type==='effectContact'&&projectileIds.has(e.origin?.id))contacts.add(e.origin.id);
        if(e.type==='damageSecondaryCreated')secondary.push(e);
        if(e.type==='effectEnded')ended.set(e.effectId,e);
        if(e.type==='effectStartParticles'&&e.name==='DamageEffect_SA_RWT_HellFire_Explosion'){
          gatlingStarts++;assert.ok(Array.isArray(e.impactPoint)&&e.impactPoint.every(Number.isFinite));
        }
        if(e.type==='effectStarted'&&/^SA_RVC_IGNITION_CROW_INCINERATION_P0[12]$/.test(e.name)){
          crowBirths++;assert.equal(e.sourceTargetMeshBound,true);assert.ok(e.birthAnchor.position.every(Number.isFinite));
        }
        if(e.type==='effectStartParticles'&&e.entries.some(x=>x.entry.PARTICLE_NAME==='EffectSet_RVC_Flame_Buster_P05'))flameStarts++;
        view.event(e,f.sim.state);
        if(e.type==='effectStarted'&&['DAMAGE_EFFECT_SHADOW_BURSTER_Flame_Damage','DamageEffect_RVC_Napalm_Grenade_Flame_Damage'].includes(e.name)){
          const sequence=view.proof({includeDraws:true}).nativeParticleDraws.sequences.findLast(s=>s.name==='RVC_C_dashJumpX_hitGround_P05_1');
          assert.ok(sequence);assert.deepEqual(sequence.position,[0,10,0],'source missing Dummy01 zero plus original Y10 offset');originalMissingFrame++;
        }
        if(e.type==='effectStarted')assert.ok(!e.name.startsWith('RAVEN_HELLFIRE_GATLING_'),
          'target2016 cast must not execute the obsolete V5 bullet/impact chain');
        if(e.type==='effectStartParticles'&&e.entries.some(x=>x.entry.PARTICLE_NAME==='EffectSet_RVC_Flame_Buster_P05')){
          const sequence=view.proof({includeDraws:true}).nativeParticleDraws.sequences.findLast(s=>s.name==='EffectSet_RVC_Flame_Buster_P05');
          assert.ok(Number.isFinite(sequence.landPosition));assert.equal(sequence.landPosition,f.a.landPosition[1]);
        }
      }
      view.step(1/60,f.sim.state);view.render();
    }
    assert.equal(eventCounts.skillStarted,1,'actual skill '+skillId+'/'+mode+' started');
    assert.deepEqual(view.proof().unsupported.filter(n=>reported.test(n)),[],'reported errors for '+skillId+'/'+mode);
    if(mode!=='normal'){
      assert.equal(projectileIds.size,3,'actual '+skillId+' emits all three bombs');
      const residualStarts=secondary.filter(e=>projectileIds.has(e.parentEffectId));
      if(mode==='hit'){
        assert.equal(contacts.size,3,'all three bombs accept enemy contacts');assert.equal(residualStarts.length,0,'hit bombs create no residual-fire successor');
        assert.equal(originalMissingFrame,missingBefore,'hit path never pretends to exercise residual missing-frame declarations');
        for(const id of projectileIds)assert.equal(ended.get(id)?.reason,'hit-limit');
      }else{
        assert.equal(contacts.size,0);assert.equal(residualStarts.length,3,'each expired miss creates its original ground-check successor');
        for(const id of projectileIds)assert.equal(ended.get(id)?.reason,'template-life-time');
        assert.ok(originalMissingFrame-missingBefore>=3,'actual missed bombs reach residual missing-frame presentation');
      }
    }
  }
  assert.ok(gatlingStarts>0);assert.equal(crowBirths,8);assert.ok(flameStarts>0);assert.ok(originalMissingFrame>0);
  view.clear();f=vcFixture({gap:20000});f.sim.drainEvents();
  f.sim.createEffect(f.a,{NAME:'RAVEN_HELLFIRE_GATLING_IMPACT'},
    {birthAnchor:{position:[-600,3080,0],facing:1}});
  f.sim.step(1/60,{},{snapshot:false});let emptyStarts=0;
  for(const e of f.sim.drainEvents()){
    view.event(e,f.sim.state);
    if(e.type==='effectStartParticles'&&e.name==='RAVEN_HELLFIRE_GATLING_IMPACT'){
      emptyStarts++;assert.deepEqual(e.impactPoint,[0,0,0],'unhit original DamageData default, never a guessed birth origin');
      const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
      for(let n=1;n<=5;n++)assert.deepEqual(sequences.findLast(s=>s.name==='raven_SA_hellFire_hit_0'+n).position,[0,0,0]);
    }
  }
  assert.equal(emptyStarts,1);
  t.diagnostic('Actual normal Napalm, Shadow, Gatling, Incineration and Flame Buster casts; bomb hit/miss paths independently verified; original missing names remain separate evidence');
});
