import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEffectRuntime,compileEvents,sampleEvents} from '../../packages/effect-runtime/index.mjs';
import {createAwakeningEffects,awakeningEmitRate,awakeningAttachments} from '../../apps/web/awakening-effects.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-awakening-fx-index.json',import.meta.url)));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const pose=JSON.parse(readFileSync(new URL('../../artifacts/rf/runtime-pose.json',import.meta.url)));
const samplers=createNativeSamplers({characterPose:pose,effectIndex:{templates:{}},effectPoses:{},profile});
const sourceReport=JSON.parse(readFileSync(new URL('../../reports/rf-awakening-fx-v8.json',import.meta.url)));
const gameUnitBytes=readFileSync(new URL('../../.cache/native-reference/X2Lib/X2GameUnit.cpp',import.meta.url));
assert.equal(createHash('sha256').update(gameUnitBytes).digest('hex'),sourceReport.references.find(r=>r.relativePath==='X2Lib/X2GameUnit.cpp').sha256);
const gameUnitSource=gameUnitBytes.toString('latin1');
const auraSource=gameUnitSource.slice(gameUnitSource.indexOf('void CX2GameUnit::HyperModeBuffEffectOnFrameMove()'));
// Expected routes come from the hash-pinned native callback, independently of
// the web binding table: right-facing four GetFramePos calls, then left four.
const sourceBones=[...auraSource.matchAll(/GetFramePos\(\s*&pos,\s*m_pFrame_(Bip01_\w+)\s*\)/g)].slice(0,8).map(m=>m[1]);
assert.equal(sourceBones.length,8);
const actor=()=>({id:'rf',hp:800000,x:5300,y:1100,z:0,facing:1,state:'RSI_WAIT',stateSerial:1,
  animationName:'Wait',animationTime:.2,animationLoop:true,applyMotionOffset:false,
  awakening:{remaining:60,full:false}});
function fixture(a=actor()){
  const runtime=createEffectRuntime({index}),aura=createAwakeningEffects({runtime,samplers,maxHyperModeTime:30});
  const state={actors:[a]};
  const step=(dt=1/60)=>{aura.step(state);runtime.step(dt,state);};
  return {a,state,runtime,aura,step};
}

test('two original Energy DDS declarations retain source final size fade and original rotation ranges',()=>{
  for(const t of Object.values(index.templates)){
    assert.deepEqual(t.unsupported,[]);assert.equal(t.fields.Lifetime,.2);assert.equal(t.fields.NumParticles,60);
    assert.ok(t.textures['Energy.dds']);const c=compileEvents(t,()=>.5);
    assert.deepEqual(sampleEvents(c,0).Size,[90,128,1]);assert.deepEqual(sampleEvents(c,.1).Size,[109,84,1]);
    assert.deepEqual(sampleEvents(c,.2).Size,[128,40,1]);assert.equal(sampleEvents(c,.05).Color[3],1);
    assert.equal(sampleEvents(c,.2).Color[3],0);assert.equal(sampleEvents(c,0).DirSpeed,400);
  }
  assert.equal(sampleEvents(compileEvents(index.templates.HyperBoostRightBlack),0).Rotate[2],112.5);
  assert.equal(sampleEvents(compileEvents(index.templates.HyperBoostLeftBlack),0).Rotate[2],67.5);
});

test('all one/two/three bead awakenings own four native bone emitters, no per-frame allocation',()=>{
  for(const [remaining,full] of [[30,false],[60,false],[90,true]]){
    const f=fixture();Object.assign(f.a.awakening,{remaining,full});
    for(let n=0;n<240;n++)f.step();
    assert.equal(f.aura.proof().emitters,4);assert.equal(f.runtime.emitters.size,4);
    assert.ok(f.aura.proof().activeParticles>0);assert.ok(f.runtime.count<=240);
    assert.deepEqual([...f.runtime.notes],[]);
  }
});

test('right and left facing route the four emitters to the exact original character bones',()=>{
  const f=fixture();
  for(const facing of [1,-1]){
    f.a.facing=facing;f.step();
    const attachments=f.aura.proof().attachments;
    assert.equal(attachments.length,4);
    for(const [i,row] of attachments.entries()){
      const bone=sourceBones[i+(facing>0?0:4)];
      assert.equal(row.bone,bone);
      assert.deepEqual(row.position,samplers.effectAnchorSampler({definition:{BONE_NAME:bone}},f.a).position);
      assert.ok(row.position.every(Number.isFinite));assert.equal(row.billboard,'BT_ALL');assert.equal(row.trace,true);
    }
  }
});

test('hit reaction, skill and animation-state changes do not cancel actor-owned awakening flames',()=>{
  const f=fixture();for(let n=0;n<12;n++)f.step();
  const handles=[...f.runtime.emitters.keys()];
  for(const state of ['RSI_DAMAGE_SMALL_FRONT','RSI_WAIT','RSI_SA_BOMB','RSI_DASH']){
    f.a.state=state;f.a.stateSerial++;f.a.skillId=state==='RSI_SA_BOMB'?24032:null;f.step();
    assert.deepEqual([...f.runtime.emitters.keys()],handles);assert.equal(f.aura.proof().emitters,4);
  }
});

test('native rate thresholds use the per-bead maximum and preserve boundary inequalities',()=>{
  assert.deepEqual(awakeningEmitRate(9.999,30),[15,20]);assert.deepEqual(awakeningEmitRate(10,30),[20,30]);
  assert.deepEqual(awakeningEmitRate(14.999,30),[20,30]);assert.deepEqual(awakeningEmitRate(15,30),[30,40]);
  const f=fixture();for(const [remaining,range] of [[90,[30,40]],[14,[20,30]],[9,[15,20]]]){
    f.a.awakening.remaining=remaining;f.step();assert.ok(f.aura.proof().attachments.every(row=>JSON.stringify(row.emitRate)===JSON.stringify(range)));
  }
});

test('native Trace moves existing Energy particles with their bone, not only newly born particles',()=>{
  const moving=fixture(),stationary=fixture();for(let n=0;n<10;n++){moving.step();stationary.step();}
  const old=[...moving.runtime.particles.keys()];moving.a.x+=100;moving.step();stationary.step();
  let comparisons=0;
  for(const id of old){const p=moving.runtime.particles.get(id),q=stationary.runtime.particles.get(id);if(!p||!q)continue;
    assert.ok(Math.abs(p.position[0]-q.position[0]-100)<1e-9);assert.equal(p.position[1],q.position[1]);comparisons++;
  }
  assert.ok(comparisons>0);
});

test('awakening expiry, death and reset destroy the original sequences and their tails immediately',()=>{
  for(const change of [a=>a.awakening.remaining=0,a=>a.hp=0]){
    const f=fixture();for(let n=0;n<12;n++)f.step();assert.ok(f.runtime.count>0);
    change(f.a);f.step();assert.equal(f.aura.proof().emitters,0);assert.equal(f.runtime.count,0);
    assert.equal(f.runtime.emitters.size,0);
  }
  const f=fixture();for(let n=0;n<12;n++)f.step();f.aura.clear();assert.equal(f.runtime.count,0);
  f.step();assert.equal(f.runtime.emitters.size,4,'restore an awakened snapshot recreates exactly four handles');
});

test('aura DDS materials are included in login prewarm without selecting a skill',()=>{
  const names=collectEffectTemplates(profile,index,[]);
  assert.deepEqual([...names].sort(),['HyperBoostLeftBlack','HyperBoostRightBlack']);
});
