import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {ADD_SOURCE_CLOCK_CUES,particlePresentationBudget,createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const indexes=[...['lp','mm','de'].map(id=>json('contracts/'+id+'-fx-index.json')),json('contracts/mm-apocalypse-fx-index-v1.json')];
const templates=Object.assign({},...indexes.map(index=>index.templates));
const medium={...DEFAULT_EFFECT_QUALITY,sourceFamily:'add'};

test('Add sparse source clocks retain their original capacity and first birth under medium display',()=>{
  let shortWindows=0;
  for(const name of ADD_SOURCE_CLOCK_CUES){
    const t=templates[name];assert.ok(t,name);
    assert.equal(particlePresentationBudget(t,t.fields.NumParticles,t.fields.TriggerCount??-1,medium).divisor,1,name);
    // Compare the preserved first packet against the independently converted
    // source declarations, not an expected count recorded from this runtime.
    if(typeof t.fields.Emitrate!=='number'||!(t.fields.Emitrate>0)||!(t.fields.TriggerTime>0)||t.fields.TriggerTime>.2)continue;
    const full=createEffectRuntime({index:{templates:{[name]:t}},effectQuality:FULL_EFFECT_QUALITY});
    const reduced=createEffectRuntime({index:{templates:{[name]:t}},effectQuality:medium});
    full.add(name);reduced.add(name);let fullFirst=null,reducedFirst=null;
    for(let frame=0;frame<30;frame++){full.step(1/120,{});reduced.step(1/120,{});if(full.count&&fullFirst===null)fullFirst=frame;if(reduced.count&&reducedFirst===null)reducedFirst=frame;}
    assert.equal(reducedFirst,fullFirst,name);shortWindows++;
  }
  assert.ok(shortWindows>0,'exercise actual short-window declarations');
});

test('Add dense display reduction retains first packet and all mesh layers without changing other careers',()=>{
  const dense=Object.values(templates).find(t=>t.kind==='particle'&&t.fields.NumParticles>=40&&!ADD_SOURCE_CLOCK_CUES.has(t.name));assert.ok(dense);
  const source=structuredClone(dense),budget=particlePresentationBudget(dense,dense.fields.NumParticles,-1,medium);
  assert.equal(budget.divisor,4);assert.equal(budget.firstSourcePacket,true);assert.deepEqual(dense,source);
  for(const t of Object.values(templates).filter(t=>t.kind==='mesh'))assert.equal(particlePresentationBudget(t,20,-1,medium).divisor,1,t.name);
  assert.equal(particlePresentationBudget({name:'unrelated-career',kind:'particle'},80,-1,DEFAULT_EFFECT_QUALITY).divisor,8);
  assert.equal(particlePresentationBudget(dense,dense.fields.NumParticles,-1,FULL_EFFECT_QUALITY).divisor,1);
});

test('Add skills and commands share moderate density while preserving every source-clock exception',()=>{
  const profile=json('packages/combat-core/lp-profile.json'),policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  assert.equal(policy.effect({skillId:29026}).sourceFamily,'add');
  const state=[...policy.comboStates][0];assert.ok(state);assert.equal(policy.actor({state,skillId:null}).sourceFamily,'add');
  assert.equal(policy.characterHit({origin:{skillId:null}}).sourceFamily,'add');
});
