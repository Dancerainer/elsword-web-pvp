import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {actionAnimationSpeed,actionUsesItemAnimationSpeed} from '../../packages/combat-core/action-animation-speed.mjs';
import {skillLabel} from '../../packages/localization/skills.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(resolve(root,p)));
const profile=read('packages/combat-core/rf-profile.json');
const frozen=read('tests/fixtures/rf-skill-animation-speed-v6.json');
const source=read('contracts/rf-skill-animation-speed-source-v6.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const map={sceneId:'action-speed-source-gates-v6',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LT_NORMAL'}]};
const dt=1/120;
const close=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-10,`${label}: ${actual} != ${expected}`);
function make(multiplier=1,extra={}){
  return createSimulation({profile,map,preset:{passives:[],guildPassives:[],bannedSkillIds:[],
    buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1,
    attributes:{hpMax:800000,mpMax:1000,criticalRate:5,criticalAttack:1.5,animationSpeedMultiplier:multiplier,moveSpeedMultiplier:1,jumpSpeedMultiplier:1}},
    actors:[{id:'rf',team:0,x:0,y:0,facing:1},{id:'target',team:1,x:9000,y:0,facing:-1}],...extra});
}

test('frozen speed expectations retain20 target actives,36 traits,33 action tables and original default/false distinction',()=>{
  assert.equal(source.targetClientMeasured,false);assert.equal(frozen.targetClientMeasured,false);
  assert.equal(sha(readFileSync(resolve(root,source.fixture))),source.fixtureSha256);
  assert.equal(frozen.rows.length,20);assert.equal(frozen.rows.flatMap(r=>r.branches).length,36);
  assert.equal(frozen.rows.flatMap(r=>r.states).length,33);
  assert.equal(frozen.rows.flatMap(r=>r.states).filter(s=>!s.originalItemAbility).length,13);
  assert.deepEqual(profile.skillCatalog.filter(s=>s.topTier&&!s.passive).map(s=>s.skillId).sort((a,b)=>a-b),
    frozen.rows.map(s=>s.skillId).sort((a,b)=>a-b));
  for(const row of frozen.rows){
    const skill=profile.skillCatalog.find(s=>s.skillId===row.skillId);
    assert.deepEqual(skill.states,row.states.map(s=>s.state));
    assert.deepEqual(skill.branches.map(b=>({id:b.id,memoType:b.memoType,rawPositions:b.rawPositions})),row.branches);
    for(const state of row.states){
      const definition=profile.states[state.state];
      for(const field of ['ANIM_SPEED','APPLY_ANIM_SPEED_BY_ITEM_ABILITY','TRANSITION']){
        assert.equal(Object.hasOwn(definition.raw,field),Object.hasOwn(state.raw,field),state.state+' presence '+field);
        assert.deepEqual(definition.raw[field],state.raw[field],state.state+' raw '+field);
      }
      assert.equal(definition.animationName,state.animationName);
      assert.equal(state.hyperAliasPresent,false);
      assert.equal(Object.hasOwn(profile.states,state.state+'_HYPER'),false);
    }
  }
});

test('Original names identify MegaDrill24203, ChargedBolt24032 and PowerAssault24027 independently',()=>{
  assert.equal(skillLabel(24203),'Mega Drill Break');
  assert.equal(skillLabel(24032),'[Enhanced] Charged Bolt');
  assert.equal(skillLabel(24027),'[Enhanced] Power Assault');
  const drill=frozen.rows.find(s=>s.skillId===24203).states[0];
  assert.equal(drill.originalItemAbility,true);assert.equal(drill.webItemAbility,false);
  assert.deepEqual(drill.expectedSpeeds,[1.5,1.5,1.5]);
  assert.equal(source.userRule.evidenceClass,'user-requested-web-correction');
});

for(const row of frozen.rows)test(`skill${row.skillId}: 0.5/1/1.5 action clocks, all traits and awakened entry obey frozen gates`,()=>{
  for(const [i,multiplier] of frozen.multipliers.entries())for(const awakened of [false,true])
    for(const branchId of ['none',...row.branches.map(b=>b.id)]){
      const s=make(multiplier),a=s.actor('rf');
      a.awakening.remaining=awakened?30:0;
      s.configureLoadout([{skillId:row.skillId,branchId},null,null,null,null,null,null,null]);
      s.step(dt,{pressed:['A'],held:['A']},{snapshot:false});
      assert.equal(a.state,row.states[0].state);
      assert.equal(a.skillId,row.skillId);assert.equal(a.skillContext.hyperState,awakened);
      assert.equal(a.skillContext.traitPolicy.branchId,branchId);
      const expected=row.states[0].expectedSpeeds[i],definition=profile.states[a.state];
      close(s.animationSpeed(a),expected,a.state+' target');
      close(a.animationTargetSpeed,expected,a.state+' controller target');
      const before=a.animationTime,ramp=a.animationSpeedRamp?structuredClone(a.animationSpeedRamp):null;
      s.advanceAnimation(a,definition,.11);
      // Independently frozen gate chooses the speed; native SetPlaySpeed's
      // linear ramp integral chooses the animation position, including Nuclear.
      const integral=t=>t<ramp?.durationSeconds?t*t/(2*ramp.durationSeconds):t-(ramp?.durationSeconds??0)/2;
      const delta=ramp?expected*(integral(ramp.elapsedSeconds+.11)-integral(ramp.elapsedSeconds)):.11*expected;
      close(a.animationTime-before,delta,a.state+' event/pose position');
    }
});

test('all33 raw action tables and successor transitions consume their own speed gate, including FlameSword Fly',()=>{
  for(const row of frozen.rows)for(const state of row.states)for(const [i,multiplier] of frozen.multipliers.entries()){
    const s=make(multiplier),a=s.actor('rf');a.skillId=row.skillId;a.skillContext={key:'A',level:1,branchId:'none'};
    s.enter(a,state.state,'independent-source-speed-fixture');
    close(s.animationSpeed(a),state.expectedSpeeds[i],state.state);
    assert.equal(actionUsesItemAnimationSpeed(profile.states[state.state]),state.webItemAbility);
    const ramp=a.animationSpeedRamp;
    if(state.raw.TRANSITION===0)assert.equal(ramp,null);
    else if(ramp)close(ramp.durationSeconds,Math.max(profile.states[state.state].clip.durationSeconds/10,.03)/state.expectedSpeeds[i],state.state+' transition');
  }
  const flame=frozen.rows.find(s=>s.skillId===24218);
  assert.deepEqual(flame.states.map(s=>s.webItemAbility),[true,true,false]);
});

test('resolved final action-stat changes preserve false gates, while hit/world stops independently pause fixed MegaDrill',()=>{
  for(const row of frozen.rows)for(const state of row.states){
    const s=make(),a=s.actor('rf');a.skillId=row.skillId;a.skillContext={key:'A',level:1,branchId:'none'};s.enter(a,state.state,'resolved-additional-stat-fixture');
    // ResetAnimSpeed receives GetAnimSpeedValue, which is already composed.
    // This probes the consumer boundary without inventing a supported RF speed
    // Buff template or its unacquired additional-stat composition.
    for(const value of [.5,1.5,1.8]){
      a.stats.animationSpeedMultiplier=value;
      close(s.animationSpeed(a),state.authoredSpeed*(state.webItemAbility?value:1),state.state+' composed stat gate');
    }
  }
  const s=make(.5),a=s.actor('rf');a.skillId=24203;s.enter(a,'RSI_A_RF_MEGADRILL_BREAK','stop-fixture');
  a.hitStop=.1;s.step(.05,{}, {snapshot:false});close(a.animationTime,0,'hit-stop preserves fixed clock');
  a.hitStop=0;a.worldStop=.1;s.step(.05,{}, {snapshot:false});close(a.animationTime,0,'world-stop preserves fixed clock');
  a.worldStop=0;s.step(.05,{}, {snapshot:false});close(a.animationTime,.075,'unfrozen fixed clock resumes');
});

test('animation speed override0 and death override preserve controller precedence',()=>{
  const s=make(1.5),a=s.actor('rf'),definition=profile.states.RSI_A_RF_MEGADRILL_BREAK;
  for(const override of [0,.5,2]){a.animationSpeedOverride=override;assert.equal(actionAnimationSpeed(a,definition),override);}
  a.animationSpeedOverride=null;a.hp=0;s.enter(a,'RSI_DIE_FRONT','source-death');
  assert.equal(s.animationSpeed(a),.5);
});

const originalMap={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const nativeManifest=read('artifacts/native/manifest.json');
const native=await createNativeRuntime({manifest:nativeManifest,map:originalMap,
  loadBinary:file=>readFileSync(resolve(root,'artifacts/native',file))});

test('real RF437/408 buff grant, reapply and expiration preserve all20 skill action-speed gates',()=>{
  for(const row of frozen.rows)for(const [i,multiplier]of frozen.multipliers.entries()){
    const s=make(multiplier,{nativeSkillValues:native.skillValues}),a=s.actor('rf');
    a.skillId=row.skillId;a.skillContext={key:'A',level:1,branchId:'none'};
    s.enter(a,row.states[0].state,'real-buff-speed-fixture');
    close(s.animationSpeed(a),row.states[0].expectedSpeeds[i],'before buff');
    assert.ok(s.grantBuff(a,a,437,3));assert.ok(a.buffs.some(b=>b.templateId===408));assert.equal(a.stats.criticalRate,100);
    close(s.animationSpeed(a),row.states[0].expectedSpeeds[i],'buff active');
    s.grantBuff(a,a,437,3);assert.equal(a.buffs.filter(b=>b.templateId===408).length,1);
    close(s.animationSpeed(a),row.states[0].expectedSpeeds[i],'buff reapplied');
    s.advanceActorBuffs(a,6.01);assert.equal(a.buffs.some(b=>b.templateId===408),false);assert.equal(a.stats.criticalRate,5);
    close(s.animationSpeed(a),row.states[0].expectedSpeeds[i],'buff expired');
  }
});

function makeDrill(multiplier,branchId='none',awakened=false){
  const s=make(multiplier,{map:originalMap,nativeGeometry:native.geometry,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,versions:native.versions,
    // Explicit fixture bone input isolates unchanged native timer decisions;
    // production original-bone sampling is exercised by full-skills-integration.
    effectAnchorSampler:(_effect,a)=>({position:[a.x,a.y+100,a.z],facing:a.facing}),
    collisionSampler:a=>[{kind:'sphere',center:[a.x,a.y+75,a.z],radius:120}],
    actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},
      {id:'target',team:1,position:[1950,2840,0],lineId:6,facing:1,attributes:{animationSpeedMultiplier:1}}]});
  const a=s.actor('rf');a.awakening.remaining=awakened?30:0;
  s.configureLoadout([{skillId:24203,branchId},null,null,null,null,null,null,null]);return s;
}

test('MegaDrill native damage phases, hit ledger and JSON continuation are deterministic across item speed0.5/1/1.5',()=>{
  const branches=['none','memo-33','memo-42'];
  for(const branch of branches)for(const awakened of [false,true]){
    const runs=frozen.multipliers.map(m=>makeDrill(m,branch,awakened));
    const observed=runs.map(()=>[]);let restored;
    for(let step=0;step<240;step++)for(const [index,s]of runs.entries()){
      s.step(dt,step===0?{pressed:['A']}: {},{snapshot:false});
      const a=s.actor('rf'),b=s.actor('target');
      observed[index].push({state:a.state,animationTime:a.state==='RSI_A_RF_MEGADRILL_BREAK'?a.animationTime:null,x:a.x,y:a.y,damageStage:a.sourceMegaDrill?.damageStage??null,
        hitLedger:structuredClone(a.hits),targetHp:b.hp,events:s.drainEvents().filter(e=>['hit','characterDamageDataChanged','characterHitHistoryCleared'].includes(e.type))});
      if(index===0&&step===77){restored=makeDrill(.5,branch,awakened);restored.restore(JSON.parse(JSON.stringify(s.snapshot())));}
      else if(index===0&&step>77){restored.step(dt,{}, {snapshot:false});restored.drainEvents();assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(s.snapshot())));}
    }
    assert.deepEqual(observed[0],observed[1]);assert.deepEqual(observed[1],observed[2]);
    assert.ok(observed[0].some(o=>o.damageStage===1),'original Now callback must select DAMAGE_DATA_NEXT');
    assert.ok(observed[0].some(o=>o.targetHp<800000),'declared character hit must execute');
  }
});

test('nine native modules remain frozen and camera translation preserves its independently pinned source bodies',()=>{
  assert.equal(frozen.nativeModules.length,10);
  assert.deepEqual(Object.keys(nativeManifest.modules).sort(),frozen.nativeModules.map(m=>m.name).sort());
  for(const m of frozen.nativeModules){
    if(m.name==='camera'){
      const evidence=JSON.parse(readFileSync(resolve(root,'reports/camera-translation-v28.json')));
      assert.equal(evidence.previousCamera.sha256,m.sha256);
      assert.deepEqual(nativeManifest.modules.camera.originalFunctions,evidence.previousCamera.originalFunctions);
      assert.equal(sha(readFileSync(resolve(root,'artifacts/native',m.file))),evidence.moduleSha256);
      continue;
    }
    assert.equal(nativeManifest.modules[m.name].sha256,m.sha256);
    assert.equal(sha(readFileSync(resolve(root,'artifacts/native',m.file))),m.sha256);
  }
});
