import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {legacyFixturePreset} from '../helpers/rf-passive-fixture-v12.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
// Agent worktrees may read the existing production artifacts without copying
// client/resource bundles or sharing a writable build cache.
const fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const nativeRoot=process.env.RF_NATIVE_FIXTURE_ROOT??fixtureRoot;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/native/')?nativeRoot:file.startsWith('artifacts/')?fixtureRoot:project,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(read('artifacts/rf/fx/index.json'),read('artifacts/rf/buff-fx/index.json'),read('artifacts/rf/shadow-weapon-fx/index.json'),read('artifacts/rf/skill-fx-v11/index.json')));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(f=>[f,read('artifacts/rf/'+f)]));
const samplers=()=>createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses});
const native=()=>createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:file=>readFileSync(resolve(nativeRoot,'artifacts/native',file))});
async function make(id,{allowBannedDiagnostic=false}={}){const n=await native();const s=createSimulation({profile,map,preset:{...legacyFixturePreset,
  // Explicit source-consumer diagnostic only; the shipped PvP preset remains banned.
  ...(allowBannedDiagnostic?{bannedSkillIds:[]}:{}),loadout:[{skillId:id},null,null,null,null,null,null,null]},
  actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,guildPassives:[]},{id:'target',team:1,position:[1858.11,2840,0],lineId:6,facing:1,guildPassives:[]}],
  ...samplers(),nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
  nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,seed:2016,versions:n.versions});
  // Loading the module manifest alone did not exercise these two consumers.
  // Keep the full skill suite on the same actual hit/guard path as the browser.
  assert.equal(s.versions.criticalRuntime,'original-cpp-wasm');
  assert.equal(s.versions.nasodRuntime,'original-cpp-wasm');
  assert.equal(s.versions.manaBreakRuntime,'original-cpp-wasm');
  return s;
}
// Independent target declaration costs, not values recorded from simulation.
const costs=[[24025,100,6],[24026,200,13],[24027,150,10],[24028,300,20],[24032,80,7],
  [24217,20,7],[24218,30,5],[24219,30,4],[24203,50,7],[24204,30,4],[24006,300,21],
  [24007,300,23],[24205,40,7],[24206,40,9],[24010,100,10],[24603,300,180],
  [24008,150,12],[24009,200,15],[24029,180,14],[900,0,300]];
for(const [id,mp,cd] of costs)test(`RF ${id}: actual Garpai cast cost, clock, original pose, finite state and JSON resume`,async()=>{
  const a=await make(id,{allowBannedDiagnostic:id===900}),actor=a.actor('rf');a.drainEvents();
  assert.deepEqual(actor.passives,[24400,24401,24402,24403,24404,24405]);
  // Original326a9860 adds the24405 delta to the prior stage's2000 magic.
  const magicDelta=Math.fround(Math.fround(1.075)-1+4.999999873689376e-5);
  assert.equal(actor.stats.physicalAttack,2000);assert.equal(actor.stats.magicAttack,Math.fround(2000+2000*magicDelta));
  a.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
  assert.equal(actor.mp,300-mp);assert.equal(actor.cooldowns[id],cd);
  assert.equal(a.state.events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
  for(let i=0;i<24;i++){a.step(1/60,{}, {snapshot:false});a.drainEvents();}
  const snapshot=JSON.parse(JSON.stringify(a.snapshot()));const b=await make(id,{allowBannedDiagnostic:id===900});b.restore(snapshot);
  for(let i=0;i<360;i++){a.step(1/60,{}, {snapshot:false});b.step(1/60,{}, {snapshot:false});a.drainEvents();b.drainEvents();}
  assert.deepEqual(JSON.parse(JSON.stringify(a.snapshot())),JSON.parse(JSON.stringify(b.snapshot())));
  assert.equal(actor.skillId,null,`skill ${id} must leave its action`);
  assert.ok(!a.state.unsupported.some(n=>n.id.startsWith('pose:')));
  function finite(v){if(typeof v==='number')assert.ok(Number.isFinite(v));else if(v&&typeof v==='object')Object.values(v).forEach(finite);}finite(a.snapshot());
});
test('PvP ban rejects equipment and stale restored slots; other actives and declared traits select',async()=>{
  const s=await make(24025);
  assert.throws(()=>s.configureLoadout([{skillId:900},null,null,null,null,null,null,null]),/Banned skill 900/);
  const actor=s.actor('rf'),mp=actor.mp;
  actor.loadout[0]={skillId:900,branchId:'none'};
  s.step(1/60,{pressed:['A']},{snapshot:false});
  assert.equal(actor.mp,mp);assert.equal(actor.skillId,null);
  assert.ok(s.state.events.some(e=>e.type==='skillRejected'&&e.skillId===900&&e.reason==='pvp-disabled'));
  for(const id of [24400,24401,24402,24403,24404,24405])
    assert.throws(()=>s.configureLoadout([{skillId:id},null,null,null,null,null,null,null]));
  s.configureLoadout([{skillId:24025,branchId:'memo-11'},null,null,null,null,null,null,null]);
  assert.throws(()=>s.configureLoadout([{skillId:24025,branchId:'memo-9999'},null,null,null,null,null,null,null]),/trait/);
});
test('ChargedBolt dispatches exact source names; awakening never invents a missing hyper alias',async()=>{
  for(const awakened of [false,true]){const s=await make(24032),actor=s.actor('rf');
    if(awakened)actor.awakening.remaining=10;
    s.step(1/60,{pressed:['A']},{snapshot:false});
    for(let i=0;i<60;i++)s.step(1/60,{}, {snapshot:false});
    const commands=s.state.events.filter(e=>e.type==='originalSkillCommand');
    assert.deepEqual(commands.map(e=>e.name),['RAVEN_OVER_TAKER_CHARGED_BOLT','Flare_Raven_Overtaker_Sp1a_ChargedBolt02']);
    assert.ok(commands[0].position.every(Number.isFinite));}
});
test('all36 target traits survive selection, cost/CD policy and full cast lifecycle',async()=>{
  // The V53 common consumer contract closes these target memo hooks. Caller
  // limitations remain in unsupported; MI_CRITICAL keeps the user's 25%
  // defence product rule and is not relabelled original-client execution.
  const recovered=new Set(['MI_MAXIMIZE','MI_CRITICAL','MI_FASTEST','MI_LIGHT','MI_HEAVY','MI_ABSORB','MI_ENHANCE',
    'MI_BRILLIANT','MI_USEFUL','MI_HUGE','MI_PERSISTENT','MI_CHECK_AND_KILL_1','MI_CHECK_AND_KILL_2','MI_WICKED']);
  let count=0;
  for(const skill of profile.skillCatalog.filter(s=>s.topTier&&!s.passive))for(const branch of skill.branches){
    const s=await make(skill.skillId);s.configureLoadout([{skillId:skill.skillId,branchId:branch.id},null,null,null,null,null,null,null]);
    const a=s.actor('rf'),policy=createSkillTraitPolicy(skill,branch.id);a.mp=1000;a.mpMax=1000;
    s.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
    assert.equal(a.mp,1000-skill.mpCost*policy.mpMultiplier);
    assert.equal(a.cooldowns[skill.skillId],skill.cooldown*policy.cooldownMultiplier);
    assert.equal(a.skillContext.traitPolicy.branchId,branch.id);
    assert.ok(recovered.has(branch.memoTypeName),'Explicitly recovered RF memo hook');
    assert.equal(a.skillContext.traitPolicy.targetConsumerVerified,true);
    if(branch.memoTypeName==='MI_CRITICAL'){
      assert.equal(a.skillContext.traitPolicy.evidenceClass,'user-custom-lethal-25-percent-defence-v2');
      assert.ok(a.skillContext.traitPolicy.unsupported.some(row=>row.includes('bypass consumer unavailable')));
    }
    for(let i=0;i<360;i++){s.step(1/60,{}, {snapshot:false});s.drainEvents();}
    assert.equal(a.skillId,null);count++;
  }
  assert.equal(count,36);
});
test('Shadow strict follow-up window, upgraded Z, native3-bomb X and single return execute',async()=>{
  const z=await make(24217),za=z.actor('rf');z.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<6;i++)z.step(1/60,{}, {snapshot:false});
  z.step(1/60,{pressed:['Z']},{snapshot:false});assert.equal(za.state,'RSI_SI_A_RF_SHADOW_STEP');
  for(let i=0;i<7;i++)z.step(1/60,{}, {snapshot:false});
  z.step(1/60,{pressed:['Z']},{snapshot:false});assert.equal(za.state,'RSI_SHADOW_STEP_Z_UPGRADE');
  const x=await make(24217),xa=x.actor('rf');x.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<14;i++)x.step(1/60,{}, {snapshot:false});
  x.step(1/60,{pressed:['X']},{snapshot:false});assert.equal(xa.state,'RSI_SHADOW_STEP_X_UPGRADE');
  assert.equal(xa.mp,280,'No old VC passive +10MP assumption');
  for(let i=0;i<8;i++)x.step(1/60,{}, {snapshot:false});
  const bullets=x.state.events.filter(e=>e.type==='effectStarted'&&/^DAMAGE_EFFECT_SHADOW_BACK_SLIDE_BULLET_[123]$/.test(e.name));
  assert.equal(bullets.length,3);assert.ok(xa.mp>=280,'Target hit-MP gain remains independent');
  const r=await make(24217),ra=r.actor('rf');r.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<9;i++)r.step(1/60,{}, {snapshot:false});
  const before=ra.x;r.step(1/60,{pressed:['A']},{snapshot:false});assert.equal(ra.state,'RSI_SHADOW_BACK_SLIDE_UPGRADE');
  const returnX=ra.x;for(let i=0;i<5;i++)r.step(1/60,{}, {snapshot:false});
  assert.ok((ra.x-returnX)*ra.facing<0,'Authored negative return speed is preserved');
  r.step(1/60,{pressed:['A']},{snapshot:false});assert.equal(ra.state,'RSI_SHADOW_BACK_SLIDE_UPGRADE');
  for(let i=0;i<120;i++)r.step(1/60,{}, {snapshot:false});assert.equal(ra.skillId,null);assert.ok(Number.isFinite(before));
});
test('new ValkNEW callback creates8 authored spears and their source descent/death children',async()=>{
  const s=await make(24029);s.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<110;i++)s.step(1/60,{}, {snapshot:false});
  assert.equal(s.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_ROT_VALKYRIESJAVELIN_NEW').length,8);
  assert.ok(s.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.name==='DamageEffect_ROT_VALKYRIESJAVELIN_EXPLOSION_NEW'));
});
test('Archenemy creates4, preserves native30s follow and excludes special skill launch',async()=>{
  const s=await make(24008),a=s.actor('rf');s.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<120;i++)s.step(1/60,{}, {snapshot:false});
  assert.equal(a.sourceArcEnemy.data.length,4);assert.equal(a.sourceArcEnemy.effects.length,4);
  for(const e of a.sourceArcEnemy.effects){assert.equal(e.maxLifeTime,30);assert.equal(e.attackTime[1],0);}
  const target=s.actor('target');s.acceptedSkillHit(a,target,{}, {skillId:24025,kind:'character',impactPoint:[target.x,target.y,target.z]});
  assert.equal(a.sourceArcEnemy.data.length,4);
  s.acceptedSkillHit(a,target,{}, {kind:'character',impactPoint:[target.x,target.y,target.z]});
  assert.equal(a.sourceArcEnemy.data.length,3);assert.equal(a.sourceArcEnemy.effects[0].maxLifeTime,Math.fround(.35));
  assert.equal(a.sourceArcEnemy.effects[0].lockOnUnitUID,2);
});
test('relationship throw uses original .8/40,130 and source hit/death child recovery team gate',async()=>{
  const s=await make(900,{allowBannedDiagnostic:true}),a=s.actor('rf');s.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<70;i++)s.step(1/60,{}, {snapshot:false});
  assert.ok(s.state.events.some(e=>e.type==='originalSkillCommand'&&e.name==='RELATIONSHIP_SKILL_THROW_LV2'&&e.threshold===.8));
  assert.ok(s.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.name==='RELATIONSHIP_SKILL_LV2'));
  const e=s.createEffect(a,{NAME:'RELATIONSHIP_SKILL_LV2'},{birthAnchor:{position:[a.x,a.y,a.z],facing:a.facing}});
  a.hp=400000;a.mp=100;const target=s.actor('target'),hp=target.hp,mp=target.mp;
  const shapes=[{kind:'sphere',center:[a.x,a.y+100,a.z],radius:5000}];
  s.checkRecoveryHits(e,a,shapes,e.damage.DAMAGE_DATA);
  assert.equal(a.hp,800000);assert.equal(a.mp,300);assert.equal(target.hp,hp);assert.equal(target.mp,mp);
  assert.ok(a.buffs.some(b=>b.templateId===208&&b.behaviors.some(r=>r.kind==='mpInterval')));
});
