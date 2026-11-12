/** Skill callback/host phase integration. Expectations are literal source
 * assignments and target tables, not captured output or an original trace.
 * RF_SKILL_TEST_ROOT optionally targets a completed parent checkout read-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.env.RF_SKILL_TEST_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const url=p=>pathToFileURL(resolve(root,p)),read=p=>JSON.parse(readFileSync(url(p),'utf8'));
const {createSimulation}=await import(url('packages/combat-core/index.mjs'));
const {createNativeRuntime}=await import(url('packages/native-source/runtime.mjs'));
const {createNativeSamplers}=await import(url('packages/combat-assets/index.mjs'));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const pose=read('artifacts/rf/runtime-pose.json'),manifest=read('artifacts/native/manifest.json');
const clone=structuredClone,drillState='RSI_A_RF_MEGADRILL_BREAK';
// Independent literal values read from2016 RSI_A_RF_MEGADRILL_BREAK,
// checked against the target bytes/statement ledger by the source audit.
const expectedNext={CAMERA_CRASH_TIME:.3,CAMERA_CRASH_GAP:20,PVP_RATE:.6,CLEAR_SCREEN:0,HIT_GAP:.1,
  STOP_TIME_ATT:0,TECH_POINT:50,STOP_TIME_DEF:0,HIT_ADD_MP:.5,BACK_SPEED_X:-600,DAMAGE_TYPE:1,HIT_TYPE:1,
  REACT_TYPE:2,CAN_REVENGE:0,RE_ATTACK:1,FORCE_FLY:1,ATTACK_TRIGGER_TYPE:1,IGNORE_DEFENCE:1,
  APPLIED_SKILL_ID:24203,DAMAGE:{MAGIC:2.92}};
// HIT_GAP is carried through the native binary32 snapshot; other target fields
// remain the complete original declaration object at this host boundary.
const routedNext={...expectedNext,HIT_GAP:Math.fround(expectedNext.HIT_GAP)};
const rawDrill=profile.states[drillState].raw;
const idByState={[drillState]:24203,RSI_SI2_POWER_ASSAULT:24027,RSI_SI3_SEVEN_BURST:24028};

async function make(state=drillState,{facing=1,hand=true,movementOption=1}={}){
  const n=await createNativeRuntime({manifest,map,loadBinary:file=>readFileSync(url('artifacts/native/'+file))});
  const samplers=createNativeSamplers({profile,characterPose:pose,effectIndex:{templates:{}},effectPoses:{}});
  const calls=[],data=[],attackRaw=[],beforeCommon=[];
  const nativeSkills={contract:n.skills.contract,evaluate(args){const result=n.skills.evaluate(args);calls.push({args:clone(args),result:clone(result)});return result;}};
  const collisionSampler=(actor,options)=>{attackRaw.push(clone(options.raw));return samplers.collisionSampler(actor,options);};
  const s=createSimulation({profile,map,
    preset:{...preset,passives:[],attributes:{...preset.attributes,moveSpeedMultiplier:movementOption,animationSpeedMultiplier:1},
      loadout:[{skillId:idByState[state]},null,null,null,null,null,null,null]},
    actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing}],
    ...samplers,collisionSampler,effectAnchorSampler:hand?samplers.effectAnchorSampler:undefined,
    nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills,nativeSkillValues:n.skillValues,seed:2016,versions:n.versions});
  const a=s.actor('rf');s.enter(a,state,'source-callback-integration-fixture');a.skillId=idByState[state];
  // Isolate state callbacks from independent EffectSet hits. Their values and
  // geometry are not replaced; these cases do not assert full skill damage.
  s.state.effects=[];s.drainEvents();
  const common=s.processSpeedFactors.bind(s);
  s.processSpeedFactors=actor=>{beforeCommon.push({vx:actor.vx,passiveSpeed:clone(actor.passiveSpeed),sourceMegaDrill:clone(actor.sourceMegaDrill)});return common(actor);};
  // Observe the selected attack data at the existing common collision boundary;
  // there is no generated hit outcome or fake original expected trajectory.
  s.checkGroundHits=(actor,damage)=>data.push(clone(damage));
  s.checkHits=(actor,shapes,damage)=>data.push(clone(damage));
  return {s,a,calls,data,attackRaw,beforeCommon};
}
function interval(f,now,before,{oneshot=0,hits}={}){
  f.a.animationTime=now;f.a.animationBeforeTime=before;f.a.animationOneshotTimer=oneshot;
  f.a.animationSpeedOverride=0;f.a.animationSpeedRamp=null;f.a.animationStopped=false;
  if(hits)f.a.hits=clone(hits);
  f.calls.length=f.data.length=f.attackRaw.length=f.beforeCommon.length=0;
  f.s.step(.001,{}, {snapshot:false});
}
const stageCall=(f,kind)=>f.calls.find(c=>c.args.kind===kind);

test('actual target declarations and source callback thresholds are independently pinned',()=>{
  const original=readFileSync(url('.cache/native-source-runtime/X2Lib/X2GURaven.cpp'));
  assert.equal(createHash('sha256').update(original).digest('hex'),'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237');
  for(const marker of ['EventTimerOneshot( 0.5f )','EventTimerOneshot( 1.0f )','EventTimerOneshot( m_fDamageDataChangeTime )','EventTimerOneshot( 0.35f )','EventTimerOneshot( 0.9f )','EventTimerOneshot( 2.633f )'])
    assert.ok(original.includes(Buffer.from(marker)));
  assert.equal(rawDrill.DAMAGEDATA_CHANGE_TIME,1.17);
  assert.deepEqual(rawDrill.DAMAGE_DATA_NEXT,expectedNext);
  assert.equal(expectedNext.RE_ATTACK,1);assert.equal(expectedNext.HIT_GAP,.1);assert.equal(expectedNext.BACK_SPEED_X,-600);
  assert.equal(expectedNext.IGNORE_DEFENCE,1);assert.deepEqual(expectedNext.DAMAGE,{MAGIC:2.92});
  const unit=readFileSync(url('.cache/native-source-runtime/X2Lib/X2GameUnit.h'));
  assert.equal(createHash('sha256').update(unit).digest('hex'),'072559b9b5dbfcc8520906e1b775198470fc514635e766d50428ecaa9aa1cbb5');
  assert.ok(unit.toString('latin1').split('\n').slice(1125,1129).join('\n').includes('return fRunSpeed;'));
  const unitSource=readFileSync(url('.cache/native-source-runtime/X2Lib/X2GameUnit.cpp'));
  assert.equal(createHash('sha256').update(unitSource).digest('hex'),'764868222f4e728bb4e14297126844177106076183d4f099548ecb78da0ee923');
  assert.ok(unitSource.toString('latin1').split('\n').slice(3197,3198).join('\n').includes('m_OrgPhysicParam.fRunSpeed'));
});
test('Mega .5 original Now clears host shared hit history; Now and Future consume the same old interval',async()=>{
  const f=await make();interval(f,.5,.49,{hits:{target:{lastTime:.3}}});
  assert.deepEqual(f.a.hits,{});assert.equal(stageCall(f,57).result.drillMutation.clearHitHistory,true);
  assert.deepEqual([stageCall(f,57).args.time,stageCall(f,57).args.before,stageCall(f,57).args.oneshot],
    [stageCall(f,56).args.time,stageCall(f,56).args.before,stageCall(f,56).args.oneshot]);
  assert.equal(f.a.sourceMegaDrill.damageStage,0);assert.equal(f.a.sourceMegaDrillNowSupported,true);
});
test('Mega 1.0 retains native attack-box and data mutations through collision routing',async()=>{
  const f=await make();interval(f,1,.99,{hits:{target:{lastTime:.8}}});
  const d=f.a.sourceMegaDrill;assert.equal(d.damageStage,0);
  assert.deepEqual([d.lhandEnabled,d.swordEnabled,d.reAttack,d.hitGap,d.backSpeedX],[true,false,true,Math.fround(.1),0]);
  assert.deepEqual(f.a.hits,{});
  // .75 is inside the target's second melee window. Direct call checks the
  // host's chosen data/boxes without inventing a combat input trajectory.
  f.s.checkCharacterAttack(f.a,.74,.75);
  assert.ok(f.data.length);assert.equal(f.data.at(-1).BACK_SPEED_X,0);assert.equal(f.data.at(-1).RE_ATTACK,1);
  const disabled=Object.values(f.attackRaw.at(-1).DISABLE_ATTACK_BOX).map(x=>x.toLowerCase());
  assert.ok(disabled.includes('sword'));assert.ok(!disabled.includes('lhand1'));
});
test('Mega1.17 reloads complete NEXT and does not retain 1.0 zero knockback or SimpleInit defaults',async()=>{
  const f=await make();interval(f,1,.99);interval(f,1.17,1.16,{hits:{target:{lastTime:1.1}}});
  const d=f.a.sourceMegaDrill;assert.equal(d.damageStage,1);
  assert.deepEqual([d.reAttack,d.hitGap,d.backSpeedX],[true,Math.fround(.1),-600]);assert.deepEqual(f.a.hits,{});
  f.s.checkCharacterAttack(f.a,1.2,1.3);assert.ok(f.data.length);
  assert.deepEqual(f.data.at(-1),routedNext,'complete original next table, including defense/damage/react flags');
  interval(f,1.25,1.24);assert.deepEqual(f.data.at(-1),routedNext,'later frame cannot reinstall SimpleInit or 1.0 fields');
});
test('Mega large old interval keeps original else-if first branch and does not select NEXT by time alone',async()=>{
  const f=await make();interval(f,1.3,0,{hits:{target:{lastTime:.1}}});
  assert.equal(stageCall(f,57).result.drillMutation.clearHitHistory,true);
  assert.equal(stageCall(f,57).result.drillMutation.damageOverridden,null);
  assert.equal(f.a.sourceMegaDrill.damageStage,0);assert.equal(f.a.sourceMegaDrill.reAttack,false);
  assert.ok(f.data.length);assert.equal(f.data.at(-1).DAMAGE_TYPE,rawDrill.DAMAGE_DATA.DAMAGE_TYPE);
  assert.deepEqual(f.data.at(-1).DAMAGE,rawDrill.DAMAGE_DATA.DAMAGE);assert.equal(f.data.at(-1).BACK_SPEED_X,800);
});
test('Mega does not repeat the .5 event once before/oneshot have been consumed',async()=>{
  const f=await make();interval(f,.5,.49);
  interval(f,.5,.5,{oneshot:.5,hits:{target:{lastTime:.5}}});
  assert.equal(stageCall(f,57).result.drillMutation.clearHitHistory,false);assert.ok('target' in f.a.hits);
});
test('Mega original OrgPhysicParam dash getter uses raw RUN_SPEED despite equipment movement option',async()=>{
  for(const facing of [1,-1]){
    const f=await make(drillState,{facing,movementOption:1.3});assert.notEqual(f.a.stats.moveSpeedMultiplier,1);
    interval(f,.27,.26);
    assert.equal(stageCall(f,56).args.megaDrill.dashSpeed,Math.fround(profile.physics.RUN_SPEED));
    assert.equal(f.beforeCommon.at(-1).vx,Math.fround(Math.fround(profile.physics.RUN_SPEED)*Math.fround(1.2))*facing);
  }
});
test('Mega original End restores boxes and entering another state removes its private stage',async()=>{
  const f=await make();interval(f,1,.99);f.calls.length=0;f.s.enter(f.a,'RSI_WAIT','source-state-exit-fixture');
  assert.deepEqual(stageCall(f,58).result.drillMutation.enabledBoxes,{Lhand1:false,Sword:true});
  assert.equal(f.a.sourceMegaDrill,undefined);assert.equal(f.a.sourceMegaDrillNowSupported,undefined);
});
test('Mega requires actual hand bone and documents a missing sample instead of manufacturing one',async()=>{
  const f=await make(drillState,{hand:false});interval(f,.5,.49);
  assert.equal(stageCall(f,57),undefined);assert.equal(f.a.sourceMegaDrillNowSupported,undefined);
  assert.ok(f.a.unsupported.some(x=>x.id==='mega-drill-hand-bone'));
  assert.equal(stageCall(f,56).args.megaDrill.handPosition.length,3,'Future never reads this unused snapshot bone');
});
test('Power .35/.9 applies separate passive and current speed before common factors for both facings',async()=>{
  for(const facing of [1,-1]){
    const f=await make('RSI_SI2_POWER_ASSAULT',{facing});f.a.vx=123*facing;f.a.passiveSpeed.x=42;
    interval(f,.35,.34);assert.equal(f.beforeCommon.at(-1).passiveSpeed.x,1500);assert.equal(f.beforeCommon.at(-1).vx,123*facing);
    interval(f,.9,.89);assert.equal(f.beforeCommon.at(-1).passiveSpeed.x,0);assert.equal(f.beforeCommon.at(-1).vx,1000*facing);
  }
});
test('Seven2.633 applies original −700 current recoil before common factors for both facings',async()=>{
  for(const facing of [1,-1]){
    const f=await make('RSI_SI3_SEVEN_BURST',{facing});f.a.vx=123*facing;f.a.passiveSpeed.x=42;
    interval(f,2.633,2.63);assert.equal(f.beforeCommon.at(-1).vx,-700*facing);assert.equal(f.beforeCommon.at(-1).passiveSpeed.x,42);
  }
});
test('source phase clocks/fields survive JSON restore in independent native modules',async()=>{
  const f=await make();interval(f,1,.99);f.s.drainEvents();
  const restored=await make();restored.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));restored.a=restored.s.actor('rf');
  interval(f,1.17,1.16);interval(restored,1.17,1.16);
  assert.deepEqual(restored.a.sourceMegaDrill,f.a.sourceMegaDrill);assert.deepEqual(restored.a.hits,f.a.hits);
  assert.deepEqual(stageCall(restored,57).args,stageCall(f,57).args);
});
