import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeParticleColorChannel,writeNativeParticleColor} from '../../apps/web/particle-color.mjs';

test('source renderer uploads a packed DWORD, rather than unrestricted float diffuse colour',()=>{
  const bytes=readFileSync(new URL('../../.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050');
  const source=bytes.toString('latin1').split('\n');
  for(const line of [3981,3994,4007,4028])assert.match(source[line-1],/pVertices->color = \(DWORD\)pPart->m_Color/);
});
test('packed native vertex colour saturates before texture modulation and keeps byte rounding',()=>{
  assert.equal(nativeParticleColorChannel(100),1);
  assert.equal(nativeParticleColorChannel(-1),0);
  assert.equal(nativeParticleColorChannel(.5),128/255);
  assert.equal(nativeParticleColorChannel(1/255),1/255);
  const out=new Float32Array(8);writeNativeParticleColor(out,4,[1,.5,-5,100]);
  assert.deepEqual(Array.from(out.slice(0,4)),[0,0,0,0]);
  assert.deepEqual(Array.from(out.slice(4)),[1,Math.fround(128/255),0,1]);
  // Alpha=100 is a real declaration, not a malformed input. Saturating AFTER
  // texture multiplication makes a 1%-alpha feather fully opaque; DWORD
  // conversion before modulation retains its original 1% feather.
  const alphaTexel=.01;
  assert.equal(nativeParticleColorChannel(100)*alphaTexel,.01);
  assert.equal(Math.min(1,100*alphaTexel),1);
});

test('real source hit templates retain authored alpha 100 but upload bounded diffuse channels',()=>{
  const index=JSON.parse(readFileSync(new URL('../../contracts/rf-fx-index.json',import.meta.url)));
  for(const name of ['DamageImpact','DamageImpactRed','DamageImpactCore']){
    const initial=index.templates[name].events.find(event=>event.property==='Color'&&event.start===0&&!event.fade).value;
    assert.equal(initial[3],100,name);assert.equal(nativeParticleColorChannel(initial[3]),1);
  }
});
