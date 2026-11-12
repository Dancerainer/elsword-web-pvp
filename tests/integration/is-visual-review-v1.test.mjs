import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visualReviewCases} from '../../tools/visual-review-cases.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {DEFAULT_EFFECT_QUALITY,particlePresentationBudget,IS_SOURCE_CLOCK_CUES} from '../../packages/effect-runtime/presentation-quality.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';

const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
const index=read('contracts/is-fx-index.json');

test('IS sparse original sword bodies and tether strips still appear on their .1 second source clock at medium density',()=>{
  assert.equal(IS_SOURCE_CLOCK_CUES.size,5);
  for(const name of IS_SOURCE_CLOCK_CUES){
    const template=index.templates[name];
    assert.equal(template.fields.Emitrate,10);
    assert.equal(template.fields.NumParticles,name.includes('maelstrom')?2:3);
    const runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY});
    const emitter=runtime.add(name);runtime.step(.11);
    assert.equal(emitter.particles.size,1,name+' first particle must appear by .11s');
    assert.equal(emitter.divisor??emitter.presentationDivisor??particlePresentationBudget(template,template.fields.NumParticles,0,DEFAULT_EFFECT_QUALITY).divisor,1);
  }
  for(const name of ['SI_SA_EIS_Blade_Rain_P07','SI_A_EIS_SwordBlasting_P03']){
    const template=index.templates[name];
    assert.equal(particlePresentationBudget(template,template.fields.NumParticles,0,DEFAULT_EFFECT_QUALITY).divisor,8,
      name+' dense shower/spark field keeps thinning');
  }
});

test('IS browser matrix covers all20 allowed PvP skills normal/awake in both directions with explicit air entry',()=>{
  const profile=read('packages/combat-core/is-profile.json'),preset=read('config/is-preset.json');
  const skills=profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.state&&!preset.bannedSkillIds.includes(s.skillId));
  assert.equal(skills.length,20);
  const rows=visualReviewCases('IS',skills);assert.equal(rows.length,80);
  assert.equal(new Set(rows.map(r=>[r.skillId,r.mode,r.facing].join('/'))).size,80);
  for(const skill of skills){
    const cases=rows.filter(r=>r.skillId===skill.skillId);assert.equal(cases.length,4);
    assert.deepEqual([...new Set(cases.map(r=>r.mode))].sort(),['awakened','normal']);
    assert.deepEqual([...new Set(cases.map(r=>r.facing))].sort(),[-1,1]);
    assert.ok(cases.every(r=>r.inputMode===(skill.skillId===21024?'air':'default')));
  }
  assert.equal(visualReviewCases('IS',skills,{focused:true}).length,20);
});

test('first IS cast prewarms fixed callback roots including the Final Strike vortex before any birth',()=>{
  const profile=read('packages/combat-core/is-profile.json');
  const prepared=collectEffectTemplates(profile,index,[{skillId:21021}]);
  for(const name of ['ElswordFinalStrikeBlackHoleEffect','ElswordFinalStrikeBlackHole','ElswordFinalStrikeAttackBox',
    'elsword_A_finalStrike_01','elsword_A_finalStrike_16','ElswordSheath02'])assert.ok(prepared.has(name),name);
});

test('existing VC review keeps exact focused8 and production62 branch cases',()=>{
  const profile=read('packages/combat-core/vc-profile.json'),preset=read('config/vc-preset.json');
  const skills=profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.state&&!preset.bannedSkillIds.includes(s.skillId));
  assert.equal(visualReviewCases('VC',skills).length,62);
  assert.equal(visualReviewCases('VC',skills,{focused:true}).length,8);
  assert.throws(()=>visualReviewCases('RF',[]),TypeError);
});
