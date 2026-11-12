/** Source consumers and adapter consistency; no target-client golden hits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {downHitFixture,startDownHit,downHitFrame,observeDownHit} from '../../tools/combat/rf_down_hit_audit_v16.mjs';
const contract=JSON.parse(readFileSync(new URL('../../contracts/rf-down-hit-source-v16.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=s=>JSON.parse(JSON.stringify(s.snapshot()));

test('actual fixed source method and phase hashes remain separate from simulation observations',()=>{
  assert.equal(contract.targetClientMeasured,false);assert.equal(contract.originalClientMeasurementCount,0);
  for(const file of contract.sourceFiles){
    const raw=readFileSync(new URL('../../'+file.path,import.meta.url));
    assert.equal(sha(raw),file.sha256,file.path);assert.equal(raw.length,file.bytes);
    const lines=raw.toString('latin1').match(/[^\n]*\n|[^\n]+$/g);
    for(const span of file.methods??[]){
      const body=Buffer.from(lines.slice(span.firstLine-1,span.lastLine).join(''),'latin1');
      assert.equal(sha(body.subarray(0,body.lastIndexOf(125)+1)),span.sha256,span.signature);
    }
    for(const span of file.lineSpans??[]){
      assert.equal(sha(Buffer.from(lines.slice(span.firstLine-1,span.lastLine).join(''),'latin1')),span.sha256,span.meaning);
    }
  }
});

test('original full JumpZ declarations and helper input remain unchanged by this audit',async()=>{
  const {s}=await downHitFixture();
  for(const [name,raw] of Object.entries(contract.targetStates))assert.deepEqual(s.profile.states[name].raw,raw);
  assert.deepEqual(contract.targetStates.RSI_JUMP_COMBO_Z.ATTACK_TIME0,{'1':.11,'2':100});
  assert.deepEqual(contract.targetStates.RSI_JUMP_COMBO_Z.DISABLE_ATTACK_BOX,{'1':'Lhand1'});
  assert.equal(contract.targetStates.RSI_JUMP_COMBO_Z.DAMAGE_DATA.DAMAGE.PHYSIC,1.78);
  assert.equal(sha(readFileSync(new URL('../../'+contract.helperInput.path,import.meta.url))),contract.helperInput.sha256);
});

for(const lineId of [3,4,5,9,10])for(const facing of [-1,1])
test(`source platform ${lineId}, facing ${facing}: complete close input retains every eligible collision`,async()=>{
  for(const gap of [0,20,70])for(const mode of ['held','release-before-z','ordered-same']){
    const result=await observeDownHit({lineId,facing,gap,mode});
    assert.equal(result.eligibleOverlapRejectedCount,0,'No unfiltered active original helper overlap may disappear');
    assert.equal(result.physicsExits.length,0,'Landing physics cannot erase the attack before its collision consumer');
    assert.ok(result.inputs.length>=90,'All input packets are recorded');
    assert.ok(result.samples.every(x=>x.helpers.every(h=>h.source.helper!=='ATTACK_SPHERE1_Lhand1')),'target disable policy stays enforced');
    if(result.landingActiveOverlapCount)assert.ok(result.landingAcceptedCount>0||result.samples.some(x=>x.grounded&&x.priorHit),
      'Landing collision is consumed or correctly blocked by accepted-hit memory');
  }
});

for(const facing of [-1,1])for(const dash of [false,true])for(const mode of ['held','release-before-z','ordered-same'])
test(`original-map edge low-air input lifecycle/JSON restore: ${facing}, dash ${dash}, ${mode}`,async()=>{
  const options={lineId:4,position:'end',targetFloor:'lower',gap:0,facing,dash,mode};
  const f=await downHitFixture(options),g=await downHitFixture(options);startDownHit(f);
  for(let i=0;i<3;i++)downHitFrame(f,{held:['DOWN']});g.s.restore(json(f.s));
  for(let i=0;i<120;i++){downHitFrame(f,{held:['DOWN']});downHitFrame(g,{held:['DOWN']});}
  assert.deepEqual(json(f.s),json(g.s));
});

test('strict .11 gate uses current advanced pose; pre-gate overlap does not call the collision consumer',async()=>{
  const result=await observeDownHit({gap:70,delay:2});
  for(const sample of result.samples){
    assert.equal(sample.active,sample.after>.11&&sample.after<100);
    if(!sample.active)assert.equal(sample.checkHitsCalled,false);
    assert.ok(Number.isFinite(sample.before)&&sample.after>=sample.before);
  }
  assert.equal(result.eligibleOverlapRejectedCount,0);
});

test('bulk audit reuses only immutable sampler/native inputs and matches independent fresh simulations',async()=>{
  for(const options of [{gap:0,delay:2},{lineId:3,facing:-1,dash:true,mode:'release-before-z'},
    {lineId:4,position:'end',gap:0,targetFloor:'lower',mode:'ordered-same',attackSpeed:1.5}]){
    const fresh=await observeDownHit(options),reused=await observeDownHit({...options,reuseReadOnlyInputs:true});
    assert.deepEqual(reused,fresh);
  }
});

test('invalid fixtures cannot invent an authored platform, alter a helper, or spawn target off the source line',async()=>{
  for(const options of [{lineId:7},{position:'outside'},{gap:1},{facing:0},{attackSpeed:4},{delay:.5},{dash:1},
    {mode:'invented'},{lineId:5,position:'end',facing:1,gap:70}])
    await assert.rejects(()=>downHitFixture(options),/Invalid bounded|outside the authored platform/);
});
