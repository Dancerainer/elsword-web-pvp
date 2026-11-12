import test from 'node:test';
import assert from 'node:assert/strict';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {FULL_EFFECT_QUALITY,DEFAULT_EFFECT_QUALITY,normalizeEffectQuality,showsDamageParticle,showsCharacterHit,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';
const template=(name,fields={},repeated={})=>({name,kind:'particle',unsupported:[],events:[],fields:{NumParticles:80,Emitrate:100,Lifetime:.9,TriggerCount:80,...fields},repeated});
test('fixed-V5 medium gate keeps default/low/medium and suppresses only high entries',()=>{
  for(const show of [undefined,2,1,'OL_LOW','OL_MEDIUM'])assert.equal(showsDamageParticle({SHOW_LEVEL:show},DEFAULT_EFFECT_QUALITY),true);
  for(const show of [0,'OL_HIGH'])assert.equal(showsDamageParticle({SHOW_LEVEL:show},DEFAULT_EFFECT_QUALITY),false);
  for(const show of [0,1,2])assert.equal(showsDamageParticle({SHOW_LEVEL:show},FULL_EFFECT_QUALITY),true);
  assert.equal(showsCharacterHit({actorId:'friend',targetId:'enemy'},'me',DEFAULT_EFFECT_QUALITY),false);
  for(const event of [{actorId:'me',targetId:'enemy'},{actorId:'enemy',targetId:'me'}])assert.equal(showsCharacterHit(event,'me',DEFAULT_EFFECT_QUALITY),true);
});
test('density budgets keep singleton cues, mesh bodies, zero counts and original source records intact',()=>{
  const t=template('dense');assert.deepEqual(particlePresentationBudget(t,80,80,DEFAULT_EFFECT_QUALITY),{divisor:8,max:10,limit:10});
  for(const [kind,max,limit]of [['particle',1,1],['particle',80,1],['mesh',80,80]])assert.deepEqual(particlePresentationBudget({...t,kind},max,limit,DEFAULT_EFFECT_QUALITY),{divisor:1,max,limit});
  assert.equal(particlePresentationBudget(t,80,0,DEFAULT_EFFECT_QUALITY).limit,0);
  assert.equal(particlePresentationBudget(t,80,-1,DEFAULT_EFFECT_QUALITY).limit,-1);
  assert.equal(t.fields.Emitrate,100);assert.equal(t.fields.NumParticles,80);
  for(const q of [{level:'medium',particleDivisor:0},{level:'middle',particleDivisor:8},{level:'high',particleDivisor:2}])assert.throws(()=>normalizeEffectQuality(q),TypeError);
});
test('dense parent is thinned once; its singleton trace children keep full draw passes and retire normally',()=>{
  const main=template('main',{}, {TraceParticleList:['child']}),child=template('child',{NumParticles:1,Emitrate:100,TriggerCount:1,Lifetime:.3,DrawCount:2});
  const index={templates:{main,child}},seen=[];
  for(const divisor of [1,4,8,16]){
    const r=createEffectRuntime({index,effectQuality:{level:'medium',particleDivisor:divisor}}),e=r.add('main');
    for(let i=0;i<65;i++)r.step(1/60,{});
    const children=[...r.emitters.values()].filter(v=>v.name==='child');
    assert.ok(children.length>0);assert.ok(children.every(v=>v.divisor===1&&v.max===1&&v.limit===1));
    seen.push({divisor,count:e.count,max:e.max});
    for(let i=0;i<100;i++)r.step(1/60,{});
    assert.equal(r.count,0);assert.equal(r.emitters.size,0);
    r.clear();assert.equal(r.count,0);
  }
  assert.deepEqual(seen.map(v=>v.count),[80,20,10,5]);assert.deepEqual(seen.map(v=>v.max),[80,20,10,5]);
});
test('retained hit sequences recompute overrides without compounding density and preserve zero trigger',()=>{
  const r=createEffectRuntime({index:{templates:{hit:template('hit')}},effectQuality:DEFAULT_EFFECT_QUALITY});
  const e=r.add('hit',{triggerCount:16,triggerWait:true});assert.equal(e.limit,2);
  for(const count of [8,8,1,0,16]){r.retrigger(e.id,{triggerCount:count,emitRate:160});assert.equal(e.limit,count===0?0:count===1?1:Math.ceil(count/8));assert.equal(e.divisor,count===1?1:8);}
  assert.equal(e.options.emitRate,160);assert.equal(e.sourceMax,80);
});
test('full quality remains the exact runtime default, including RNG, birth values and lifecycle',()=>{
  const index={templates:{source:template('source',{Emitradius:{random:[1,8]},TriggerCount:10})}};
  // Use a vector radius: independent runtime random sampling must match byte for byte.
  index.templates.source.fields.Emitradius=[{random:[1,8]},0,0];
  const a=createEffectRuntime({index}),b=createEffectRuntime({index,effectQuality:FULL_EFFECT_QUALITY});a.add('source');b.add('source');
  for(let i=0;i<100;i++){a.step(1/60,{});b.step(1/60,{});assert.deepEqual([...a.particles.values()],[...b.particles.values()]);assert.deepEqual([...a.emitters.values()],[...b.emitters.values()]);}
});
