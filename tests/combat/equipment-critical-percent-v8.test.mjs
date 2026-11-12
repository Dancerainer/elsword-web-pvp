// Historical equipment inputs frozen at389e247; production v3 has separate coverage.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
/** Percent-point equipment and ratio-valued critical channels have separate
 * contracts. Expectations below are literal user50/40/50% plus the pinned
 * native inclusive comparison/additive equations, not generated hit gold.
 * One critical/skill-value module instance is reused; no pose/FX bundles load. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeCritical} from '../../packages/native-source/critical.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {evaluateHitCritical} from '../../packages/combat-core/critical-hit.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const ids=['RF','LK','VC'],expected={RF:{percent:50,ratio:.5},LK:{percent:40,ratio:.4},VC:{percent:50,ratio:.5}};
const profiles=Object.fromEntries(ids.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(ids.map(id=>[id,beforeBalanceV3(read(`config/${id.toLowerCase()}-preset.json`))]));
const [native,skillValues]=await Promise.all([
  instantiateNativeCritical(readFileSync(new URL('../../artifacts/native/critical.wasm',import.meta.url))),
  instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url))),
]);
const map={lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL'}]};
function observedNative(){const calls=[];return {calls,bridge:{...native,evaluate:values=>{calls.push(structuredClone(values));return native.evaluate(values);}}};}
function production(bridge=native){return createSimulation({profile:profiles.RF,profiles,preset:presets.RF,presets,nativeCritical:bridge,nativeSkillValues:skillValues,map,
  actors:ids.map((id,i)=>({id,professionId:id,team:i,position:[i*500,0,0],lineId:0}))});}
const selected=production(),near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const victim=id=>selected.actor(id==='RF'?'LK':'RF');
function evaluate(id,{roll,damageType=0,stats={},data={},traitPolicy={}}){
  const attacker=structuredClone(selected.actor(id)),{calls,bridge}=observedNative();Object.assign(attacker.stats,stats);
  const result=evaluateHitCritical(bridge,{amount:100,attacker,defender:victim(id),data:{DAMAGE_TYPE:damageType,...data},traitPolicy,roll,headPosition:[2,3,4]});
  assert.equal(calls.length,1);return {result,input:calls[0]};
}

for(const id of ids){
  test(`${id} current production equipment keeps${expected[id].percent} percent points while native consumes${expected[id].ratio}`,()=>{
    const a=selected.actor(id),p=presets[id];assert.equal(p.attributeSemantics,'source-equipment-pvp-baseline-and-final-options');
    assert.equal(a.formulaRules.attributeSemantics,p.attributeSemantics);assert.equal(p.attributes.criticalRate,expected[id].percent);
    assert.equal(a.equipmentAttributes.criticalRate,expected[id].percent);assert.equal(a.stats.criticalRate,expected[id].percent);
    assert.equal(a.mpMax,360);assert.deepEqual(a.formulaRules.sourceEquipmentBaseline.items.map(i=>i.enhancement),[9,9,9,9,9]);
    const {input,result}=evaluate(id,{roll:.99});assert.equal(input.criticalRate,expected[id].ratio);
    near(result.effectiveRate,expected[id].ratio);assert.equal(result.critical,false,'equipment50/40% must not become guaranteed critical');
  });
  for(const damageType of[0,1])test(`${id} native physical/magic type${damageType} is inclusive at equipment boundary and normal immediately above`,()=>{
    const base=expected[id].ratio;
    for(const [roll,critical]of[[base-.0001,true],[base,true],[base+.0001,false]]){
      const {result,input}=evaluate(id,{roll,damageType});assert.equal(input.criticalRate,base);assert.equal(result.critical,critical);
      assert.equal(result.soundCalls,critical?1:0);assert.equal(result.amount,critical?150:100);near(result.defenderRoll,roll);
    }
  });
  test(`${id} real applyHit uses the same probability conversion for below/equal/above boundary`,()=>{
    const base=expected[id].ratio;
    for(const [roll,critical]of[[base-.0001,true],[base,true],[base+.0001,false]]){
      const {calls,bridge}=observedNative(),sim=production(bridge),a=sim.actor(id),b=sim.actor(id==='RF'?'LK':'RF');sim.rng=()=>roll;sim.drainEvents();
      const outcome=sim.applyHit(a,b,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},PVP_RATE:1,REACT_TYPE:7,HIT_TYPE:-1,
        HIT_ADD_MP:0,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0},{kind:'character'});
      assert.equal(outcome.accepted,true);assert.ok(outcome.amount>0);assert.equal(calls.length,1);assert.equal(calls[0].criticalRate,base);
      const hit=sim.state.events.find(e=>e.type==='hit');assert.ok(hit);assert.equal(hit.critical,critical);
      assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.field==='original-critical').length,critical?1:0);
    }
  });
  test(`${id} passive critical ratio+.1 is added after percent conversion and stays a ratio`,()=>{
    const base=expected[id].ratio;
    const {input,result}=evaluate(id,{roll:base+.05,stats:{passiveCriticalRate:.1}});
    assert.equal(input.criticalRate,base);assert.equal(input.passiveCriticalRate,.1);assert.equal(result.critical,true);near(result.effectiveRate,base+.1);
    assert.equal(evaluate(id,{roll:base+.1001,stats:{passiveCriticalRate:.1}}).result.critical,false);
  });
  test(`${id} damage-data critical ratio+.2 keeps its probability units`,()=>{
    const base=expected[id].ratio,{input,result}=evaluate(id,{roll:base+.15,data:{CRITICAL_RATE:.2}});
    assert.equal(input.extraCriticalRate,.2);assert.equal(result.critical,true);near(result.effectiveRate,base+.2);
    assert.equal(evaluate(id,{roll:base+.2001,data:{CRITICAL_RATE:.2}}).result.critical,false);
  });
  test(`${id} magic and shadow critical additions stay ratios and do not affect physical attacks`,()=>{
    const base=expected[id].ratio,stats={magicCriticalRate:.2,shadowCriticalRate:.05};
    const magic=evaluate(id,{roll:base+.2,stats,damageType:1});
    assert.equal(magic.input.magicCriticalRate,.2);assert.equal(magic.input.shadowCriticalRate,.05);assert.equal(magic.result.critical,true);near(magic.result.effectiveRate,base+.25);
    const physical=evaluate(id,{roll:base+.0001,stats,damageType:0});assert.equal(physical.result.critical,false);near(physical.result.effectiveRate,base);
  });
  test(`${id} maximized branch and damage-data rate1 remain guaranteed even with roll1`,()=>{
    for(const options of[{traitPolicy:{forceCritical:true}},{data:{CRITICAL_RATE:1}}]){
      const {input,result}=evaluate(id,{roll:1,...options});assert.equal(input.extraCriticalRate,1);assert.equal(result.critical,true);
      near(result.effectiveRate,expected[id].ratio+1);assert.equal(result.amount,150);assert.equal(result.soundCalls,1);
    }
  });
}

test('historical authored equipment ratio .5 still reaches native as .5 and retains the inclusive boundary',()=>{
  const preset=authoredEquipmentPreset(presets.RF),{calls,bridge}=observedNative();preset.attributes.criticalRate=.5;
  const sim=createSimulation({profile:profiles.RF,preset,nativeCritical:bridge,nativeSkillValues:skillValues,map,
    actors:[{id:'old-rf',team:0,position:[0,0,0],lineId:0,passives:[],guildPassives:[]},{id:'old-target',team:1,position:[500,0,0],lineId:0,passives:[],guildPassives:[]}]});
  const attacker=sim.actor('old-rf'),defender=sim.actor('old-target');assert.equal(attacker.stats.criticalRate,.5);
  assert.equal(attacker.formulaRules.attributeSemantics,'equipment-combat-values-and-final-options');
  for(const [roll,critical]of[[.4999,true],[.5,true],[.5001,false]]){
    const result=evaluateHitCritical(bridge,{attacker,defender,data:{DAMAGE_TYPE:0},roll});assert.equal(result.critical,critical);near(result.effectiveRate,.5);
  }
  assert.ok(calls.every(input=>input.criticalRate===.5),'historical ratio is never divided by100');
});

test('critical conversion leaves production stats, source equipment and native module unchanged',()=>{
  for(const id of ids){assert.equal(selected.actor(id).stats.criticalRate,expected[id].percent);assert.equal(presets[id].attributes.criticalRate,expected[id].percent);}
  const module=new WebAssembly.Module(readFileSync(new URL('../../artifacts/native/critical.wasm',import.meta.url)));
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
});
