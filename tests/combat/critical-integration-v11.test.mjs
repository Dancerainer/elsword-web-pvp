/** Independent DamageReact integration expectations, not a target-client trace.
 * Fixed V5 a8438f3: GUUser 8940 gate / 9092-9098 head / 9118-9231 critical;
 * GameUnit 7214-7237 reaction filter / 2713-2740 integer state reduction.
 * Actual target RF profile, native map and optional original-pose sampler are
 * used; controlled head/roll/attack values isolate the source equations.
 * WildCharge's +30/-30 lifecycle is audited separately by the skill tests.
 * RNG below validates frozen HOST xorshift continuation, not the original
 * random-table category scheduling, which remains unmeasured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {instantiateNativeCritical} from '../../packages/native-source/critical.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
// No copied client/source/resource bundle. An unintegrated agent worktree can
// read the already-built ROOT artifact; CI may name its own fixture directory.
const fixtureRoot=process.env.RF_CRITICAL_FIXTURE_ROOT??
  (existsSync(resolve(project,'artifacts/native/critical.wasm'))?project:
    resolve(project,'../../rf-native-v11/elsword_2016_webpvp'));
const read=p=>readFileSync(resolve(project,p));
const fixture=p=>readFileSync(resolve(fixtureRoot,p));
const json=p=>JSON.parse(read(p));
const criticalBytes=fixture('artifacts/native/critical.wasm');
const criticalModule=await WebAssembly.compile(criticalBytes);
const criticalHash=createHash('sha256').update(criticalBytes).digest('hex');
const profile=json('packages/combat-core/rf-profile.json');
const map=JSON.parse(fixture('artifacts/scene/sander-garpai-rock-pvp/collision.json'));
const rawDamage=Object.freeze({DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.123456789},REACT_TYPE:7,HIT_TYPE:1});
const hash=b=>createHash('sha256').update(b).digest('hex');
const hitEvents=s=>s.state.events.filter(e=>e.type==='hit');
const criticalSounds=s=>s.state.events.filter(e=>e.type==='sound'&&e.name==='Critical_Hit.wav');
const head=[2,3,4];
const staticHead=(effect)=>{
  assert.equal(effect.definition.BONE_NAME,'Bip01_Head');
  assert.equal(effect.definition.POSITION_OFFSET_Y,70);
  return {position:[2,73,4]};
};
async function make({native=true,roll=.5,attacker={},defender={},anchor=staticHead,seed=2016}={}){
  const bridge=native?await instantiateNativeCritical(criticalModule):null;
  const calls={critical:[],reduction:[]};
  const observed=bridge?{
    evaluate:values=>{calls.critical.push(structuredClone(values));return bridge.evaluate(values);},
    reduceDamage:(amount,options)=>{calls.reduction.push({amount,options:structuredClone(options)});return bridge.reduceDamage(amount,options);}
  }:null;
  const s=createSimulation({profile,map,nativeCritical:observed,effectAnchorSampler:anchor,
    // This independent source-equation fixture keeps guild stat/RNG bonuses
    // separate from native critical and state-reduction expectations.
    preset:{passives:[],guildPassives:[],loadout:Array(8).fill(null)},seed,
    versions:{criticalModuleSha256:native?criticalHash:null},
    actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,passives:[],
      attributes:{hpMax:800000,criticalRate:.5,...attacker}},
      {id:'target',team:1,position:[2142.98,2840,0],lineId:6,facing:-1,passives:[],
        attributes:{hpMax:800000,...defender}}]});
  // A supplied defender-roll fixture is the existing native ABI boundary.
  // Omit this override in the snapshot test so the real core RNG executes.
  if(roll!==null)s.rng=()=>roll;
  s.drainEvents();
  return {s,a:s.actor('rf'),b:s.actor('target'),calls,bridge};
}

test('integration uses pinned original blocks and a no-import native module',()=>{
  const contract=json('contracts/rf-critical-source-v11.json');
  assert.equal(contract.referenceCommit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  assert.equal(contract.targetClientMeasured,false);
  for(const record of contract.files)assert.equal(hash(read('.cache/native-source-runtime/'+record.relativePath)),record.sha256);
  assert.deepEqual(WebAssembly.Module.imports(criticalModule),[]);
  assert.ok(contract.fragments.some(f=>f.lineStart===2713&&f.lineEnd===2740));
});

test('actual applyHit equality critical uses binary32 amount, red number and raw head+130 FX',async()=>{
  const {s,a,b,calls}=await make();
  const result=s.applyHit(a,b,rawDamage,{kind:'character'}),hit=hitEvents(s).at(-1);
  // CPP float input 123.456789 -> 123.456787109375, then *= float1.5.
  assert.equal(calls.critical[0].amount,123.456789);
  assert.equal(result.amount,185.1851806640625);
  assert.equal(b.hp,800000-185.1851806640625);
  assert.equal(hit.critical,true);
  assert.deepEqual(hit.damageNumber,{position:[2,73,4],style:'red'});
  assert.deepEqual(calls.critical[0].headX,head[0]);
  assert.deepEqual([calls.critical[0].headY,calls.critical[0].headZ],[3,4]);
  assert.deepEqual(hit.criticalFx,{name:'CriticalHit01',position:[2,133,4]});
  assert.equal(criticalSounds(s).length,1);
});

test('critical sound belongs to DamageReact receiver, as original this->PlaySound',async()=>{
  const {s,a,b}=await make();s.applyHit(a,b,rawDamage);
  assert.equal(criticalSounds(s).at(-1).actorId,b.id);
});

test('roll immediately above source equality is normal but still takes native float amount',async()=>{
  const {s,a,b}=await make({roll:.5001});
  const result=s.applyHit(a,b,rawDamage),hit=hitEvents(s).at(-1);
  assert.equal(result.amount,123.456787109375);
  assert.equal(hit.critical,false);assert.equal(hit.criticalFx,null);
  assert.equal(hit.damageNumber.style,'normal');assert.equal(criticalSounds(s).length,0);
});

test('missing original bone does not manufacture critical or damage-number positions',async()=>{
  const {s,a,b}=await make({anchor:()=>null});
  s.applyHit(a,b,rawDamage);const hit=hitEvents(s).at(-1);
  assert.equal(hit.amount,185.1851806640625);assert.equal(hit.critical,true);
  assert.equal(hit.damageNumber,null);assert.equal(hit.criticalFx,null);
  assert.ok(b.unsupported.some(x=>x.id==='critical-head-missing'));
});

test('original pose head is sampled before the hit changes the victim animation',async()=>{
  const pose=JSON.parse(fixture('artifacts/rf/runtime-pose.json'));
  const samplers=createNativeSamplers({profile,characterPose:pose,effectIndex:{templates:{}},effectPoses:{}});
  const {s,a,b}=await make({anchor:samplers.effectAnchorSampler});
  // Sampling is a source-pose fixture; only the +70/+40/+20 equation is gold.
  const before=samplers.effectAnchorSampler({definition:{BONE_NAME:'Bip01_Head'}},b).position;
  s.applyHit(a,b,{...rawDamage,REACT_TYPE:1});const hit=hitEvents(s).at(-1);
  assert.match(b.state,/RSI_DAMAGE_SMALL_/);
  assert.deepEqual(hit.damageNumber.position,before.map((x,i)=>i===1?x+70:x));
  assert.deepEqual(hit.criticalFx.position,before.map((x,i)=>i===1?Math.fround(Math.fround(Math.fround(x)+70)+40)+20:Math.fround(x)));
});

test('physical critical below one keeps amount; original magic path multiplies it',async()=>{
  for(const [DAMAGE_TYPE,DAMAGE,expected]of [[0,{PHYSIC:.1},100],[1,{MAGIC:.1},50]]){
    const {s,a,b}=await make({attacker:{criticalAttack:.5}});
    s.applyHit(a,b,{...rawDamage,DAMAGE_TYPE,DAMAGE});const hit=hitEvents(s).at(-1);
    assert.equal(hit.amount,expected);assert.equal(hit.critical,true);assert.equal(hit.damageNumber.style,'red');
  }
});

test('magic-only critical additions and raw APPLY_CRITICAL_DAMAGE_PERCENT reach native consumer',async()=>{
  const {s,a,b}=await make({attacker:{criticalRate:0,magicCriticalRate:.5,magicCriticalDamage:.25}});
  s.applyHit(a,b,{...rawDamage,DAMAGE_TYPE:1,DAMAGE:{MAGIC:.1},APPLY_CRITICAL_DAMAGE_PERCENT:.25});
  assert.equal(hitEvents(s).at(-1).amount,200);assert.equal(hitEvents(s).at(-1).critical,true);
  s.applyHit(a,b,{...rawDamage,DAMAGE:{PHYSIC:.1},APPLY_CRITICAL_DAMAGE_PERCENT:.25});
  assert.equal(hitEvents(s).at(-1).amount,100);assert.equal(hitEvents(s).at(-1).critical,false);
});

test('NO_DAMAGE and exact IsDamagedReaction exclusions bypass native critical and red/FX',async()=>{
  for(const data of [{...rawDamage,NO_DAMAGE:1},{...rawDamage,NO_DAMAGE:true},
    ...[0,6,10,14,17].map(REACT_TYPE=>({...rawDamage,REACT_TYPE}))]){
    const {s,a,b,calls}=await make({attacker:{criticalRate:1}});
    s.applyHit(a,b,data);const hit=hitEvents(s).at(-1);
    assert.equal(calls.critical.length,0,JSON.stringify(data));
    assert.equal(hit.critical,false);assert.equal(hit.criticalFx,null);assert.equal(hit.damageNumber.style,'normal');
    assert.equal(criticalSounds(s).length,0);
    if(data.NO_DAMAGE)assert.equal(hit.amount,0);
  }
});

test('dummy damage and grapple are not invented critical exclusions',async()=>{
  // Exact selected reference IsDamagedReaction switch excludes 0/6/10/14,
  // plus explicit macro candidates REFLECT17 and CREATE_DAMAGE_EFFECT11.
  // Create-effect-set12 passes this helper but GUUser7932 returns before the
  // helper is reached; test its earlier control flow separately below.
  for(const REACT_TYPE of [7,13,22]){
    const {s,a,b,calls}=await make({attacker:{criticalRate:1}});
    s.applyHit(a,b,{...rawDamage,REACT_TYPE});
    assert.equal(calls.critical.length,1,'type '+REACT_TYPE);assert.equal(hitEvents(s).at(-1).critical,true);
  }
});
test('create-effect contacts return before HP, critical and damage number consumers (GUUser7932)',async()=>{
  for(const REACT_TYPE of[11,12]){
    const {s,a,b,calls}=await make({attacker:{criticalRate:1}}),hp=b.hp,mp=a.mp;
    const result=s.applyHit(a,b,{...rawDamage,REACT_TYPE,STOP_TIME_DEF:.2,
      CREATE_DAMAGE_EFFECT_NAME:'RAVEN_NASOD_BALL',CREATE_EFFECT_SET_NAME:'EffectSet_Raven_Dash_Jump_Fire'},
      {impactPoint:[b.x,b.y,b.z],powerMultiplier:1});
    assert.ok(result.accepted);assert.equal(result.effectTrigger,true);assert.equal(b.hp,hp);assert.equal(a.mp,mp);
    // DamageReact submits STOP before returning. Its queue and scalar cache
    // are separate until the receiver's next ordinary outer update.
    assert.equal(b.hitStop,0);assert.deepEqual(b.sourceStopQueues.hit.at(-1),{remaining:Math.fround(.2),sourceId:a.id});
    assert.equal(calls.critical.length,0);assert.equal(hitEvents(s).length,0);
  }
});

test('original integer WildCharge reduction reaches actual hit before critical float multiplication',async()=>{
  const {s,a,b,calls}=await make();
  s.enter(b,'RSI_SA_RRF_WILD_CHARGING','explicit original percent-consumer fixture');
  b.skillDamageReducePercent=30;s.drainEvents();
  s.applyHit(a,b,rawDamage);
  assert.deepEqual(calls.reduction,[{amount:123.456789,options:{percent:30,ignoreStateDefence:false,penetrate:false}}]);
  // Native float(.7) multiply -> 86.41974639892578; critical *=float1.5.
  assert.equal(calls.critical[0].amount,86.41974639892578);
  assert.equal(hitEvents(s).at(-1).amount,129.62962341308594);
  assert.equal(b.state,'RSI_SA_RRF_WILD_CHARGING','source super armor keeps the charge state');
});

test('WildCharge percentage cap and IGNORE_STATE_DEFENCE bypass follow original nr_evaluate',async()=>{
  for(const [percent,IGNORE_STATE_DEFENCE,expected]of [[30,0,70],[30,1,100],[30,true,100],[130,0,0]]){
    const {s,a,b,calls}=await make({attacker:{criticalRate:0}});
    s.enter(b,'RSI_SA_RRF_WILD_CHARGING','explicit original integer reduction fixture');
    b.skillDamageReducePercent=percent;s.drainEvents();
    s.applyHit(a,b,{...rawDamage,DAMAGE:{PHYSIC:.1},IGNORE_STATE_DEFENCE});
    assert.equal(hitEvents(s).at(-1).amount,expected);
    assert.equal(calls.reduction.length,1);
  }
});

test('critical applies after original Nasod guard multiplier and armor does not filter red hit',async()=>{
  const {s,a,b,calls}=await make({attacker:{criticalRate:1}});
  b.awakening.remaining=20;b.core.gauge=40;s.updateCoreLevel(b);
  s.applyHit(a,b,{...rawDamage,DAMAGE:{PHYSIC:.1},REACT_TYPE:1});const hit=hitEvents(s).at(-1);
  assert.equal(hit.guarded,true);assert.equal(calls.critical[0].amount,25);
  assert.equal(hit.amount,37.5);assert.equal(hit.critical,true);assert.equal(hit.damageNumber.style,'red');
  const armored=await make();armored.b.superArmor=true;
  armored.s.applyHit(armored.a,armored.b,rawDamage);
  assert.equal(hitEvents(armored.s).at(-1).critical,true);
});

test('optional nativeCritical absence preserves the declared unsupported critical boundary',async()=>{
  const {s,a,b}=await make({native:false,attacker:{criticalRate:1}});
  s.applyHit(a,b,rawDamage);const hit=hitEvents(s).at(-1);
  assert.equal(s.versions.criticalRuntime,'unavailable');
  assert.equal(hit.amount,123.456789);assert.equal(hit.critical,false);assert.equal(hit.criticalFx,null);
});

test('frozen snapshot restores critical inputs and real host RNG, with repeatable native hits',async()=>{
  const first=await make({roll:null}),second=await make({roll:null});
  first.s.state.seed=2016;second.s.state.seed=2016;
  const initial=first.s.snapshot(),serialized=JSON.stringify(initial);
  assert.equal(Object.isFrozen(first.s.versions),true);
  const run=f=>{for(let i=0;i<4;i++)f.s.applyHit(f.s.actor('rf'),f.s.actor('target'),rawDamage);return f.s.snapshot();};
  const expectedCritical=[true,false,false,true];
  const expectedAmounts=[185.1851806640625,123.456787109375,123.456787109375,185.1851806640625];
  const result=run(first);
  assert.deepEqual(hitEvents(first.s).map(h=>h.critical),expectedCritical);
  assert.deepEqual(hitEvents(first.s).map(h=>h.amount),expectedAmounts);
  assert.equal(result.seed,60949599,'independent xorshift source equation from seed2016, four rolls');
  assert.deepEqual(run(second),result);
  first.s.actor('rf').stats.criticalRate=1;first.s.restore(initial);
  assert.equal(first.s.actor('rf').stats.criticalRate,.5);
  assert.deepEqual(run(first),result);assert.equal(JSON.stringify(initial),serialized,'restore/run cannot mutate supplied snapshot');
  assert.throws(()=>first.s.restore({...initial,versions:{...initial.versions,criticalModuleSha256:'different'}}),/version/);
});
