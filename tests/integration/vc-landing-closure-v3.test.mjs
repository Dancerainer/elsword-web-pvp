import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createLandingEffects,airDownLandingState} from '../../apps/web/landing-effects.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const index=read('artifacts/vc/fx/index.json'),source=read('contracts/rf-landing-fx-index-v1.json'),proof=read('contracts/vc-landing-reuse-v3.json');

test('VC landing roots are the frozen original minor declarations and reuse existing RF bytes',()=>{
  for(const name of ['DropDown','GroundShockWave','AirDownTick','DownSmoke']){
    const actual=index.templates[name],expected=source.templates[name];assert.ok(actual,name);
    for(const key of ['fields','events','source','declarationSha256','unsupported'])assert.deepEqual(actual[key],expected[key],name+'/'+key);
    assert.equal(actual.sharedResourceEvidence.index,'artifacts/rf/landing-fx/index.json');
  }
  for(const file of proof.sharedFiles){const bytes=readFileSync(new URL('../../artifacts/vc/'+file.file,import.meta.url));
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  assert.equal(proof.resourceCopies,0);assert.equal(proof.resourceConversions,0);
});

test('VC runtime air-down landing produces all source common effects, then retires without missing templates',()=>{
  const runtime=createEffectRuntime({index}),landing=createLandingEffects({runtime});
  const a={id:'vc',x:10,y:3080,z:0,facing:-1,state:'RSI_WAIT',stateSerial:1,animationTime:0,landPosition:[10,3080,0]},state={actors:[a]};
  const step=()=>{landing.step(state);runtime.step(1/60,state);};
  step();a.state=airDownLandingState;a.stateSerial++;a.animationTime=0;step();
  a.animationTime=.03;step();a.animationTime=.47;step();
  assert.deepEqual(landing.proof().triggers,{DropDown:1,GroundShockWave:1,AirDownTick:1,DownSmoke:2});
  assert.ok(runtime.count>0);assert.deepEqual([...runtime.notes],[]);
  for(let n=0;n<240;n++)step();
  assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);assert.deepEqual([...runtime.notes],[]);
});
