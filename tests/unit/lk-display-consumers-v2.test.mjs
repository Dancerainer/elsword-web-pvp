import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {writeNativeEffectBoneMatrix} from '../../apps/web/native-effect-bone-matrix.mjs';
import {createProjectedHitController,createProjectedHitView,projectedHitVertices,LK_SCREEN_FLASH} from '../../apps/web/projected-hit-effects.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {LK_SOURCE_CLOCK_CUES,particlePresentationBudget,DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const index=json('contracts/lk-fx-index.json'),profile=json('packages/combat-core/lk-profile.json');
function source(file){const expected=json('contracts/rf-native-runtime-sources.json').files.find(r=>r.relativePath===file);
  const raw=readFileSync(new URL('../../.cache/native-source-runtime/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),expected.sha256);return raw.toString('latin1');}
test('independent native sources prescribe the first hit projection and 1024x768 size conversion',()=>{
  const user=source('X2Lib/X2GUUser.cpp'),app=source('KTDXLIB/KTDXApp.h');
  assert.match(user,/projPos\.y -= 50\.0f;\s*projPos\.x \+= 50\.0f/);
  assert.match(user,/m_FrameDataNow\.unitCondition\.bHit == false && GetShowSmallGageAndName\(\)/);
  assert.match(app,/m_ViewPort\.Width\/1024\.0f/);assert.match(app,/m_ViewPort\.Height\/768\.0f/);
});
test('actual LK named window emits one projected sequence; earlier unnamed hit consumes the state first hit',()=>{
  const [state,s]=Object.entries(profile.states).find(([,s])=>Object.values(s.raw).some(v=>v?.['3']==='STR_KAAng'));
  const window=Object.entries(s.raw).find(([k,v])=>/^ATTACK_TIME/.test(k)&&v['3']==='STR_KAAng')[1];
  const a={id:'lk',state,animationTime:(window['1']+window['2'])/2};
  const c=createProjectedHitController({index,profile,project:()=>[400,300]});
  const e={type:'hit',actorId:'lk',origin:{kind:'character',id:'state-1',state,animationTime:a.animationTime,impactPoint:[20,90,3]}};
  c.event(e,a,{level:'high',particleDivisor:1});c.event(e,a,{level:'high',particleDivisor:1});c.step(.02);
  assert.equal(c.proof().emitted,1);assert.equal(c.runtime.count,1);assert.deepEqual([...c.runtime.particles.values()][0].position,[450,250,0]);
  c.clear();c.event({...e,origin:{...e.origin,animationTime:0}},a);c.event(e,a);assert.equal(c.proof().emitted,0);
});
test('RHW vertices keep screen center, original viewport-scaled size, upright UV and integer half-pixel position',()=>{
  const p={position:[400,300,0],values:{Size:[256,256,1],Rotate:[0,0,0]}};
  assert.deepEqual(projectedHitVertices(p,1024,768).slice(0,9),[271.5,427.5,0,271.5,171.5,0,527.5,427.5,0]);
  assert.deepEqual(projectedHitVertices(p,2048,1536).slice(0,3),[143.5,555.5,0]);
});
test('traced sword bone keeps full shear and translation through native-to-render matrix conjugation',()=>{
  const native=[1,2,3,0,4,5,6,0,7,8,9,0,100,200,300,1],out=new Array(16);
  writeNativeEffectBoneMatrix(native,out);
  assert.deepEqual(out,[.01,.02,-.03,0,.04,.05,-.06,0,-.07,-.08,.09,-0,1,2,-3,1]);
  assert.throws(()=>writeNativeEffectBoneMatrix([1,2],out),/Complete original/);
});
test('medium retains every sparse LK structural cue clock and original short wake bursts remain visible',()=>{
  for(const name of LK_SOURCE_CLOCK_CUES){const t=index.templates[name];assert.ok(t,name);
    assert.equal(particlePresentationBudget(t,t.fields.NumParticles,t.fields.TriggerCount??-1,DEFAULT_EFFECT_QUALITY).divisor,1,name);}
  for(const name of ['elswrod_demolition_wake_06','SA_EL_UNLIMITED_BLADE_P04','EffectSet_ELK_Grand_Slash_Cast_P17','EffectSet_ELK_Grand_Slash_Cast_P06']){
    const r=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY});r.add(name);let peak=0;
    for(let i=0;i<60;i++){r.step(1/60,{});peak=Math.max(peak,r.count);}assert.ok(peak>0,name);
  }
  const rf={name:'EffectSet_RRF_FLAME_BUSTER_EXPLO_03',kind:'particle'};
  assert.equal(particlePresentationBudget(rf,10,-1,DEFAULT_EFFECT_QUALITY).divisor,8,'RF density is unchanged');
});
test('Gigantic Slash original RHW white flash uses its authored screen position and .03-second lifetime',()=>{
  const native=source('KTDXLIB/KTDGParticleSystem.cpp');assert.match(native,/part.SetPos\( m_Position.GetRandomNumInRange\(\) \)/);
  const c=createProjectedHitController({index,profile,project:()=>{throw new Error('RHW Position must never be world-projected');}});
  assert.equal(c.startEffect({name:LK_SCREEN_FLASH,birthAnchor:{position:[-999,999,0]}},DEFAULT_EFFECT_QUALITY),true);
  c.step(.101);const p=[...c.runtime.particles.values()][0];assert.ok(p);assert.deepEqual(p.position,[640,480,1]);
  assert.equal(p.lifetime,.03);assert.deepEqual(p.values.Size,[1920,1200,1]);
  c.step(.016);assert.ok(p.values.Color[3]>0);c.step(.016);assert.equal(c.runtime.particles.has(p.id),false);
});
for(const profession of ['LK','BM'])test(`${profession} original screen flash produces RHW geometry and retires instead of entering the 3D skip path`,async t=>{
  const targetProfile=profession==='LK'?profile:json('packages/combat-core/bm-profile.json');
  const targetIndex=profession==='LK'?index:json('contracts/bm-fx-index.json');
  assert.equal(targetIndex.templates[LK_SCREEN_FLASH].declarationSha256,index.templates[LK_SCREEN_FLASH].declarationSha256,
    'The two skills consume the exact same original particle declaration');
  assert.ok(JSON.stringify(targetProfile.effectSets).includes(LK_SCREEN_FLASH),'The flash is actually requested by this profession');
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('flash-camera',new Vector3(0,0,5),scene);
  const view=createProjectedHitView({scene,engine,index:{templates:{[LK_SCREEN_FLASH]:targetIndex.templates[LK_SCREEN_FLASH]}},profile:targetProfile,assetBase:'/assets/'+profession.toLowerCase()+'/'});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});await view.prewarm();
  const event={name:LK_SCREEN_FLASH,effectId:'flash-1'};view.startEffect(event,DEFAULT_EFFECT_QUALITY);view.startEffect(event,DEFAULT_EFFECT_QUALITY);
  assert.equal(view.runtime.emitters.size,1);view.step(.101);view.step(.016);view.render();
  const mesh=scene.getMeshByName('projected-hit:'+LK_SCREEN_FLASH);assert.ok(mesh.isEnabled());assert.equal(mesh.getTotalVertices(),6);
  assert.ok(mesh.getVerticesData('position').every(Number.isFinite));assert.ok(mesh.getVerticesData('color')[3]>0);
  view.step(.016);view.render();assert.equal(mesh.isEnabled(),false);
});
