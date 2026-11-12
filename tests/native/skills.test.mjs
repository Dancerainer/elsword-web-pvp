import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instantiateNativeSkills,originalShadowGroups} from '../../packages/native-source/skills.mjs';
const bytes=await readFile(new URL('../../.cache/native-skills-generated/skills.wasm',import.meta.url));
const compiled=await WebAssembly.compile(bytes);
const bridge=await instantiateNativeSkills(compiled);
const base={time:.5,before:.4,dt:1/60,hp:100,hpMax:100,held:true};

test('omitted EffectSet power uses owner power; explicit WildCharge power remains absolute',()=>{
  const valk=bridge.evaluate({...base,kind:62,time:.02,before:0,power:.7,grounded:true,
    position:[0,0,0],rotation:[0,0,0],direction:[1,0,0],landY:0,isRight:true,
    skillExtra:{nowSpeedX:0,nowSpeedY:0,passiveSpeedX:-1,passiveSpeedY:-1,disableGravity:true,downAccel:0,gravityAccel:-980,damageReducePercent:0}});
  const command=valk.commands.find(c=>c.name==='EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW');assert.ok(command);
  assert.equal('power' in command,false,'sealed sink default1 must not override the cast power');
  const dash=bridge.evaluate({...base,kind:3,time:.02,before:0,charge:10,power:1.5});
  assert.equal(dash.commands.find(c=>c.name==='EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK').power,3);
});

test('original skills module has no hidden host imports and preserves provenance limits',()=>{
  assert.deepEqual(WebAssembly.Module.imports(compiled),[]);
  assert.equal(bridge.contract.wildChargeTargetCompatible,false);
});
test('unchanged V5 wild charge charges by elapsed seconds plus lost HP percentage',()=>{
  const result=bridge.evaluate({...base,kind:2,hp:90,previousHp:100,charge:1});
  assert.equal(result.charge,Math.fround(11+Math.fround(1/60)));
  assert.equal(result.previousHp,90);assert.equal(result.stateChange,0);
  assert.equal(result.commonBoundaryCalls,2);
});
test('V5 full-charge effect fires once and release wins even if animation loops',()=>{
  const full=bridge.evaluate({...base,kind:2,charge:10,afterFull:0});
  assert.equal(full.effectMask,1);assert.equal(full.sounds,1);
  assert.equal(full.afterFull,Math.fround(1/60));
  const later=bridge.evaluate({...base,kind:2,charge:10,afterFull:full.afterFull,held:false});
  assert.equal(later.effectMask,0);assert.equal(later.stateChange,2);
  assert.equal(bridge.evaluate({...base,kind:2,charge:10,afterFull:2.98}).stateChange,0);
  assert.equal(bridge.evaluate({...base,kind:2,charge:10,afterFull:3}).stateChange,2,'frame callback adds elapsed time before EventProcess');
  assert.equal(bridge.evaluate({...base,kind:2,charge:10,afterFull:3.01}).stateChange,2);
});
test('native dash caps original charge and emits the original damage-effect scale',()=>{
  const r=bridge.evaluate({...base,kind:3,time:.02,before:0,charge:12,power:1.5});
  assert.equal(r.charge,10);assert.equal(r.effectPower,3);assert.equal(r.effectMask,2);
  const end=bridge.evaluate({...base,kind:3,ended:true,grounded:false});
  assert.equal(end.stateChange,4);assert.equal(end.offsetY,-45);
});
test('original Limit Crusher does not release before .45 and does not lose its falling branch',()=>{
  assert.equal(bridge.evaluate({...base,kind:4,time:.449,held:false}).stateChange,0);
  assert.equal(bridge.evaluate({...base,kind:4,time:.45,held:false}).stateChange,5);
  assert.equal(bridge.evaluate({...base,kind:4,time:.2,held:true,grounded:false}).stateChange,4);
  assert.equal(bridge.evaluate({...base,kind:4,time:.2,held:true,ended:true}).stateChange,5);
  assert.equal(bridge.evaluate({...base,kind:4}).cancellationBoundaryCalls,3);
});
test('source callbacks use explicit state and can interleave separate simulations without leakage',async()=>{
  const second=await instantiateNativeSkills(compiled);
  const a=bridge.evaluate({...base,kind:2,charge:4,afterFull:0});
  second.evaluate({...base,kind:2,charge:10,afterFull:4});
  assert.deepEqual(bridge.evaluate({...base,kind:2,charge:4,afterFull:0}),a);
  assert.throws(()=>bridge.evaluate({...base,kind:70}),RangeError);
  assert.throws(()=>bridge.evaluate({...base,kind:2,hp:NaN}),TypeError);
  assert.throws(()=>bridge.evaluate({...base,kind:2,hpMax:0}),RangeError);
});
test('original VectorLockOn interpolates manual direction with supplied target and curve speed',()=>{
  const r=bridge.vectorLockOn({position:[0,0,0],manualDirDegree:[180/Math.PI,0,0],targetPosition:[0,100,0],curveSpeed:1,dt:.1});
  assert.ok(Math.abs(r.manualDirDegree[0]-.9*180/Math.PI)<.00002);
  assert.ok(Math.abs(r.manualDirDegree[1]-.1*180/Math.PI)<.00002);
  assert.equal(r.manualDirDegree[2],0);
  const zero=bridge.vectorLockOn({position:[0,0,0],manualDirDegree:[0,0,0],targetPosition:[100,0,0],curveSpeed:1,dt:.02});
  assert.ok(Math.abs(zero.manualDirDegree[0]-.02*180/Math.PI)<.000002);
  assert.throws(()=>bridge.vectorLockOn({position:[0,0,0],manualDirDegree:[0,0,0],targetPosition:[0,1,0],curveSpeed:NaN,dt:.01}),TypeError);
});
test('original Flame Sword dispatch chooses the grounded or aerial successor without playing Wait10',()=>{
  assert.equal(bridge.evaluate({...base,kind:5,grounded:true}).stateChange,7);
  assert.equal(bridge.evaluate({...base,kind:5,grounded:false}).stateChange,6);
});
test('original end callbacks return wait/jump and preserve the XCrash falling offset',()=>{
  for(const kind of [8,9,10,11,12,14,16,17,18,20,22,23]){
    assert.equal(bridge.evaluate({...base,kind,ended:false}).stateChange,0);
    assert.equal(bridge.evaluate({...base,kind,ended:true,grounded:true}).stateChange,3);
    assert.equal(bridge.evaluate({...base,kind,ended:true,grounded:false}).stateChange,4);
  }
  assert.equal(bridge.evaluate({...base,kind:19,ended:true,grounded:false}).offsetY,-45);
});
test('original WeaponCrash skip checks held input after .66, while Valkyrie waits for landing',()=>{
  assert.equal(bridge.evaluate({...base,kind:13,time:.66,inputMask:16}).stateChange,0);
  assert.equal(bridge.evaluate({...base,kind:13,time:.661,inputMask:16}).stateChange,3);
  assert.equal(bridge.evaluate({...base,kind:21,ended:true,grounded:false}).stateChange,0);
  assert.equal(bridge.evaluate({...base,kind:21,ended:true,grounded:true}).stateChange,9);
});
const charged={...base,kind:24,position:[100,200,300],rotation:[10,20,30],direction:[.6,0,.8],landY:150,isRight:true};
test('ChargedBolt original normal damage fires at .4 with exact Now timer and direction-dependent origin',()=>{
  assert.deepEqual(bridge.evaluate({...charged,time:.399,before:.39}).commands,[]);
  assert.deepEqual(bridge.evaluate({...charged,time:.4,before:.4}).commands,[],'source before<.4 is strict');
  assert.deepEqual(bridge.evaluate({...charged,time:.42,before:.39,oneshot:.4}).commands,[],'source oneshot gate suppresses repeats');
  const right=bridge.evaluate({...charged,time:.4,before:.39,power:1.2});
  assert.equal(right.commands.length,1);const cmd=right.commands[0];
  assert.equal(cmd.name,'RAVEN_OVER_TAKER_CHARGED_BOLT');assert.equal(cmd.type,'damage');
  assert.deepEqual(cmd.position,[100,200,300]);assert.deepEqual(cmd.rotation,[10,20,30]);
  assert.equal(cmd.power,Math.fround(1.2));assert.equal(cmd.landY,150);assert.equal(cmd.animationTime,Math.fround(.4));
  assert.equal(right.disabledPresentationCalls.cutIn,1);assert.equal(right.disabledPresentationCalls.worldColor,1);
  const left=bridge.evaluate({...charged,time:.4,before:.39,isRight:false,memo:true}).commands[0];
  assert.equal(left.name,'RAVEN_OVER_TAKER_CHARGED_BOLT_MEMO');
  assert.deepEqual(left.position,[118,200,324]);assert.deepEqual(left.rotation,[10,200,30]);
  assert.equal(left.name.includes('HYPER'),false);
});
test('ChargedBolt original .7 particle preserves position, authored rotation, landY, and .8 camera is disabled',()=>{
  const r=bridge.evaluate({...charged,time:.7,before:.69});assert.equal(r.commands.length,1);
  assert.equal(r.commands[0].type,'particle');assert.equal(r.commands[0].name,'Flare_Raven_Overtaker_Sp1a_ChargedBolt02');
  assert.deepEqual(r.commands[0].position,[88,250,284]);assert.deepEqual(r.commands[0].rotation,[10,20,30]);assert.equal(r.commands[0].landY,150);
  const l=bridge.evaluate({...charged,time:.7,before:.69,isRight:false}).commands[0];
  assert.deepEqual(l.position,[112,250,316]);assert.deepEqual(l.rotation,[10,20,30]);
  const camera=bridge.evaluate({...charged,time:.8,before:.79});assert.deepEqual(camera.commands,[]);assert.equal(camera.disabledPresentationCalls.camera,1);
  assert.equal(camera.commonBoundaryCalls,1);
});
test('ChargedBolt original else-if preserves first-event priority across large animation interval',()=>{
  const r=bridge.evaluate({...charged,time:.9,before:0});assert.equal(r.commands.length,1);
  assert.equal(r.commands[0].type,'damage');assert.equal(r.disabledPresentationCalls.camera,0);
  const later=bridge.evaluate({...charged,time:.95,before:.9,oneshot:.9});assert.deepEqual(later.commands,[]);
});
test('ChargedBolt requires explicit geometry inputs and roundtrips without hidden sink state',async()=>{
  assert.throws(()=>bridge.evaluate({...base,kind:24}),/requires original position/);
  assert.throws(()=>bridge.evaluate({...charged,direction:[NaN,0,0]}),TypeError);
  const first=bridge.evaluate({...charged,time:.4,before:.39});
  const other=await instantiateNativeSkills(compiled);other.evaluate({...charged,time:.7,before:.69,isRight:false});
  assert.deepEqual(bridge.evaluate({...charged,time:.4,before:.39}),first);
});
const arcBase={...charged,kind:25,memo:false,time:1.5,before:1.49,oneshot:1.2,direction:[1,0,0],
  arcEnemy:{data:[],effects:[],cooldown:0,nextHandle:1,zDirection:[0,0,1],randValues:[0,3,6,9],newEffectMaxLifeTime:30}};
const arcState=(result,extra={})=>({...result.arcEnemy,zDirection:[0,0,1],...extra});
const f=Math.fround;
test('unchanged Archenemy frame creates four original spears, offsets, reset times and target-provided mesh lifetime',()=>{
  const r=bridge.evaluate(arcBase);assert.equal(r.arcEnemy.data.length,4);assert.equal(r.commands.filter(x=>x.type==='damage').length,4);
  assert.equal(r.randConsumed,4);assert.equal(r.timerRestarted,true);assert.equal(r.arcEnemy.cooldown,0);
  assert.equal(r.animationOneshotTimer,f(1.2),'source EventTimerOneshot is a read-only guard; skin controller advancement owns its update');
  assert.deepEqual(r.arcEnemy.data.map(x=>x.offsetPosition),[[f(-202*f(.9)),108,21],[f(-198*f(.9)),175.5,21],[f(-184*f(.9)),238.5,22],[f(-149*f(.9)),288,21]]);
  assert.deepEqual(r.arcEnemy.data.map(x=>x.offsetRotation),[[0,0,0],[0,0,-17],[0,0,-36],[0,0,-54]]);
  for(const [i,x] of r.arcEnemy.effects.entries()){
    assert.equal(x.name,'RAVEN_OVER_TAKER_ARC_ENEMY');assert.equal(x.handle,i+1);assert.equal(x.alive,true);
    assert.equal(x.maxLifeTime,30,'provided from target LifeType/LifeTime, not fabricated timer expiry');
    assert.equal(x.animationResetTime,f([0,3,6,9][i]*f(.1)));
    assert.deepEqual(x.rotation,[10,20,30+[0,-17,-36,-54][i]]);
    assert.deepEqual(x.moveAxis,[10,20,30]);assert.deepEqual(x.attackTime,[0,0]);
    const coeff=f([.05,.06,.07,.08][i]),initial=[f(100+r.arcEnemy.data[i].offsetPosition[0]),200+r.arcEnemy.data[i].offsetPosition[1],300+r.arcEnemy.data[i].offsetPosition[2]];
    assert.deepEqual(x.position,initial.map(v=>f(f(v*coeff)+f(v*f(1-coeff)))),'source invokes its CommonFrameMove follow loop in the creation frame');
  }
  const left=bridge.evaluate({...arcBase,isRight:false,memo:true});
  assert.equal(left.arcEnemy.effects[0].name,'RAVEN_OVER_TAKER_ARC_ENEMY_MEMO');
  const target=f(100-f(-202*f(.9))),co=f(.05);
  assert.equal(left.arcEnemy.effects[0].position[0],f(f(target*co)+f(target*f(1-co))));
  assert.equal(left.arcEnemy.effects.some(x=>x.name.includes('HYPER')),false);
});
test('Archenemy original visual thresholds and else-if priority use Now animation and source oneshot',()=>{
  assert.deepEqual(bridge.evaluate({...arcBase,time:.6665,before:.65}).commands,[]);
  for(const [at,before,index] of [[.6666,.65,1],[.8,.79,2],[1,.99,3],[1.1333,1.12,4]]){
    const r=bridge.evaluate({...arcBase,time:at,before,oneshot:0});
    assert.equal(r.commands.length,1);assert.equal(r.commands[0].type,'mesh');
    assert.equal(r.commands[0].name,'Raven_Overtaker_Sp2a_FlyingImpact_Start_0'+index);
    assert.deepEqual(r.commands[0].position,[100,200,300]);assert.equal(r.randConsumed,0);
  }
  const large=bridge.evaluate({...arcBase,time:1.6,before:0,oneshot:0});assert.equal(large.commands.length,1);
  assert.equal(large.commands[0].type,'mesh');assert.equal(large.arcEnemy.data.length,0);
  const noRepeat=bridge.evaluate({...arcBase,before:1.49,oneshot:1.5});assert.equal(noRepeat.arcEnemy.data.length,0);
});
test('original follow fragment normalizes direction and uses per-frame coefficients, not guessed time smoothing',()=>{
  const start=bridge.evaluate(arcBase),prior=start.arcEnemy.effects;
  const r=bridge.evaluate({...arcBase,kind:26,dt:.02,position:[140,200,300],direction:[2,0,0],arcEnemy:arcState(start,{cooldown:.3})});
  assert.equal(r.arcEnemy.cooldown,f(f(.3)-f(.02)));
  for(const [i,x] of r.arcEnemy.effects.entries()){
    const coeff=f([.05,.06,.07,.08][i]);const target=f(140+start.arcEnemy.data[i].offsetPosition[0]);
    assert.equal(x.position[0],f(f(target*coeff)+f(prior[i].position[0]*f(1-coeff))));
  }
  const otherDt=bridge.evaluate({...arcBase,kind:26,dt:.5,position:[140,200,300],direction:[2,0,0],arcEnemy:arcState(start)});
  assert.deepEqual(otherDt.arcEnemy.effects.map(x=>x.position),r.arcEnemy.effects.map(x=>x.position));
});
test('original hit callback locks one spear to defender, launches it and retains remaining handles',()=>{
  const start=bridge.evaluate(arcBase);
  const hit=bridge.evaluate({...arcBase,kind:27,arcEnemy:arcState(start,{defenderType:'unit',dummyDamage:false,defender:{type:'user',uid:0xf0000001}})});
  assert.equal(hit.arcEnemy.data.length,3);assert.equal(hit.arcEnemy.data[0].handle,2);assert.equal(hit.arcEnemy.cooldown,f(.3));
  const first=hit.arcEnemy.effects[0];assert.equal(first.lockOnUnitUID,0xf0000001);assert.equal(first.lockOnNPCUID,-1,'X2DamageEffect.h LockOnData original constructor');
  assert.deepEqual(first.attackTime,[0,9999]);assert.equal(first.dirSpeed,3000);assert.equal(first.nowLifeTime,0);
  assert.equal(first.maxLifeTime,f(.35));assert.equal(first.landY,0);assert.equal(first.position[0],f(start.arcEnemy.effects[0].position[0]-150));
  assert.equal(first.alive,true,'released original handle stays live after ArcEnemyData destructor');assert.equal(hit.sounds,1);
  assert.equal(hit.commands.some(x=>x.type==='destroyDamageEffect'&&x.handle===1),false);
  const npc=bridge.evaluate({...arcBase,kind:27,isRight:false,arcEnemy:arcState(start,{defenderType:'unit',dummyDamage:false,defender:{type:'npc',uid:123}})});
  assert.equal(npc.arcEnemy.effects[0].lockOnNPCUID,123);assert.equal(npc.arcEnemy.effects[0].lockOnUnitUID,0xffffffff);
  assert.equal(npc.arcEnemy.effects[0].position[0],f(start.arcEnemy.effects[0].position[0]+150));
});
test('original hit eligibility respects dummy, missing defender, non-unit and cooldown without inventing skill-type exclusions',()=>{
  const start=bridge.evaluate(arcBase);
  for(const extra of [{defenderType:'unit',dummyDamage:true,defender:{type:'user',uid:3}},
    {defenderType:'effect',dummyDamage:false,defender:{type:'user',uid:3}},
    {defenderType:'unit',dummyDamage:false,defender:null},
    {defenderType:'unit',dummyDamage:false,defender:{type:'user',uid:3},cooldown:.1}]){
    const r=bridge.evaluate({...arcBase,kind:27,arcEnemy:arcState(start,extra)});assert.equal(r.arcEnemy.data.length,4);assert.equal(r.sounds,0);
  }
  assert.equal(bridge.contract.arcSpecialHyperExclusionVerified,false);
  assert.equal(bridge.contract.arcTargetDamageMultiplierVerified,false);
});
test('original missing-effect cleanup destroys other owned spears and recast destroys old handles without stale pointers',()=>{
  const start=bridge.evaluate(arcBase);const expired=JSON.parse(JSON.stringify(start.arcEnemy));expired.effects[0].alive=false;
  const cleaned=bridge.evaluate({...arcBase,kind:26,arcEnemy:{...expired,zDirection:[0,0,1]}});
  assert.deepEqual(cleaned.arcEnemy.data,[]);assert.equal(cleaned.arcEnemy.effects.every(x=>!x.alive),true);
  assert.deepEqual(cleaned.commands.filter(x=>x.type==='destroyDamageEffect').map(x=>x.handle),[2,3,4]);
  const recast=bridge.evaluate({...arcBase,arcEnemy:arcState(start,{randValues:[1,2,3,4],newEffectMaxLifeTime:30})});
  assert.deepEqual(recast.arcEnemy.data.map(x=>x.handle),[5,6,7,8]);assert.equal(recast.arcEnemy.effects.length,4);
  assert.deepEqual(recast.commands.filter(x=>x.type==='destroyDamageEffect').map(x=>x.handle),[1,2,3,4]);
});
test('Archenemy snapshot restores into a separate WASM instance and rejects missing or corrupted host fields',async()=>{
  const start=bridge.evaluate(arcBase);const restored=JSON.parse(JSON.stringify(arcState(start)));
  const other=await instantiateNativeSkills(compiled);
  const input={...arcBase,kind:26,position:[150,200,300],arcEnemy:restored};
  const expected=bridge.evaluate(input);other.evaluate({...arcBase,kind:25,memo:true});assert.deepEqual(other.evaluate(input),expected);
  assert.throws(()=>bridge.evaluate({...arcBase,arcEnemy:{...arcBase.arcEnemy,randValues:undefined}}),/explicit original rand/);
  assert.throws(()=>bridge.evaluate({...arcBase,arcEnemy:{...arcBase.arcEnemy,newEffectMaxLifeTime:undefined}}),TypeError);
  assert.throws(()=>bridge.evaluate({...arcBase,kind:26,arcEnemy:{...restored,effects:restored.effects.map((x,i)=>i===0?{...x,position:[NaN,0,0]}:x)}}),TypeError);
  assert.throws(()=>bridge.evaluate({...arcBase,kind:27,arcEnemy:restored}),/defenderType/);
  assert.throws(()=>bridge.evaluate({...arcBase,arcEnemy:{...arcBase.arcEnemy,randValues:[0,1,2,32768]}}),TypeError);
  assert.throws(()=>bridge.evaluate({...arcBase,kind:26,arcEnemy:{...restored,effects:restored.effects.map((x,i)=>i===0?{...x,lockOnNPCUID:-2}:x)}}),TypeError);
});

// Expected values below come from the frozen C++ method text, not a JS
// simulator. These exercise the old reference branch, not target2016 proof.
const shadowFixture=(extra={})=>({
  stepTimeLeft:.6,backSlideTimeLeft:.6,teleportRange:6,skillCooldown:7,skillLevel:1,
  passiveSpeedX:1000,mp:50,stateTime:.3,stepCooldown:0,backSlideLevel:1,comboLoopCount:0,
  thrustPower:1.5,enhancedThrustPower:1.7,punisherPower:2,busterPower:1.8,
  afterImage:false,alpha:1,alphaBlend:false,alphaObject:false,gageAlpha:255,
  damagePhysical:10,damageMagic:20,damagePerSecond:30,statePower:1,randomRoll:.9,
  dashSuccessor:'dash',requestedAttack:'thrust',reactionRequest:'none',
  ...extra,flags:{frameStop:false,hasEquippedSkill:true,hasUnit:true,enableThrust:false,
    enableThrustEnhance:false,enablePunisher:false,enableBackSlide:false,activeCombo:false,
    skillIcon:true,memo6:false,memo7:false,specialAttackAccepted:false,isMyUnit:false,
    hasGageUI:true,hasAfterImage:true,...extra.flags},
});
const shadowInput=(operation,shadowStep=shadowFixture(),extra={})=>({...charged,...extra,
  kind:originalShadowGroups[operation],shadowStep});
const shadow=(operation,s=shadowFixture(),extra={})=>bridge.evaluate(shadowInput(operation,s,extra));

test('Shadow original Init commands preserve authored filenames and require explicit flags',()=>{
  assert.equal(shadow('dashInit').commands[0].name,'Raven_SI_A_RF_Shadow_Step_Mesh01.X');
  for(const op of ['thrustInit','busterInit','enhancedThrustInit','punisherInit'])
    assert.equal(shadow(op).commands[0].name,'Raven_SI_A_RF_Thrust_Mesh01.X');
  assert.equal(bridge.contract.shadowTargetBindingVerified,false);
  const missing=shadowFixture();delete missing.flags.enableThrust;
  assert.throws(()=>shadow('dashEvent',missing),/Explicit Shadow flag/);
});
test('original Shadow StartFuture uses range*100/speed before memo6 speed multiplication',()=>{
  const normal=shadow('dashStartFuture');assert.equal(normal.shadowStep.stepTimeLeft,f(.6));
  const memo=shadow('dashStartFuture',shadowFixture({flags:{memo6:true}}));
  assert.equal(memo.shadowStep.stepTimeLeft,f(.6));assert.equal(memo.shadowStep.passiveSpeedX,1300);
  for(const extra of [{passiveSpeedX:0},{flags:{hasEquippedSkill:false}},{flags:{hasUnit:false}}])
    assert.equal(shadow('dashStartFuture',shadowFixture(extra)).shadowStep.stepTimeLeft,0);
});
test('original Shadow render Start/End hide and restore enemy gauge and afterimage',()=>{
  const start=shadow('dashStart');const s=start.shadowStep;
  assert.equal(s.alphaObject,true);assert.equal(s.alphaBlend,true);assert.equal(s.alpha,f(.1));
  assert.equal(s.gageAlpha,0);assert.equal(s.afterImage,true);
  const end=shadow('dashEnd',s).shadowStep;
  assert.equal(end.alphaObject,false);assert.equal(end.alphaBlend,false);assert.equal(end.alpha,1);
  assert.equal(end.gageAlpha,255);assert.equal(end.afterImage,false);assert.equal(end.stepTimeLeft,0);
  assert.equal(shadow('dashStart',shadowFixture({flags:{isMyUnit:true}})).shadowStep.gageAlpha,255);
});
test('Shadow original FrameMove decrements only when Now is not frame-stopped and clamps at zero',()=>{
  assert.equal(shadow('dashFrame',shadowFixture(),{dt:.1}).shadowStep.stepTimeLeft,f(f(.6)-f(.1)));
  assert.equal(shadow('dashFrame',shadowFixture({flags:{frameStop:true}}),{dt:.1}).shadowStep.stepTimeLeft,f(.6));
  assert.equal(shadow('dashFrame',shadowFixture({stepTimeLeft:.02}),{dt:.1}).shadowStep.stepTimeLeft,0);
  assert.equal(shadow('backSlideFrame',shadowFixture({flags:{frameStop:true}}),{dt:.1}).shadowStep.backSlideTimeLeft,f(.6));
});
test('original Shadow expiry selects explicit dash host result or falling offset -45',()=>{
  assert.equal(shadow('dashEvent',shadowFixture({stepTimeLeft:0})).shadowSuccessor,'dash');
  assert.equal(shadow('dashEvent',shadowFixture({stepTimeLeft:0,dashSuccessor:'wait'})).shadowSuccessor,'wait');
  const air=shadow('dashEvent',shadowFixture({stepTimeLeft:0}),{grounded:false});
  assert.equal(air.shadowSuccessor,'jumpDown');assert.equal(air.offsetY,-45);
  assert.equal(shadow('backSlideEvent',shadowFixture({backSlideTimeLeft:0})).shadowSuccessor,'backSlideEnd');
});
test('Shadow Z strict .2 window and old passive gate are preserved; no flags fabricate a followup',()=>{
  assert.equal(shadow('dashEvent',shadowFixture({stateTime:.2,flags:{enableThrust:true}}),{inputMask:16}).shadowSuccessor,null);
  const z=shadow('dashEvent',shadowFixture({mp:0,flags:{enableThrust:true}}),{inputMask:16});
  assert.equal(z.shadowSuccessor,'thrust');assert.equal(z.shadowStep.mp,0,'balance20130117 basic thrust has no extra 10MP');
  assert.equal(shadow('dashEvent',shadowFixture(),{inputMask:16}).shadowSuccessor,null);
  assert.equal(shadow('dashEvent',shadowFixture(),{inputMask:32}).shadowSuccessor,null);
});
test('original X branches consume 10MP only through supplied old passive flags',()=>{
  for(const [flag,successor] of [['enablePunisher','punisher'],['enableThrustEnhance','enhancedThrust']]){
    const result=shadow('dashEvent',shadowFixture({flags:{[flag]:true}}),{inputMask:32});
    assert.equal(result.shadowSuccessor,successor);assert.equal(result.shadowStep.mp,40);
    const failed=shadow('dashEvent',shadowFixture({mp:9,flags:{[flag]:true}}),{inputMask:32});
    assert.equal(failed.shadowSuccessor,null);assert.equal(failed.shadowStep.mp,9);assert.equal(failed.shadowHostBoundary.infoCalls,1);
  }
  const buster=shadow('dashEvent',shadowFixture({flags:{enableThrust:true,enableBackSlide:true}}),{inputMask:32});
  assert.equal(buster.shadowSuccessor,'buster');assert.equal(buster.shadowStep.mp,40);
});
test('original reset writes cooldown minus old passive level and preserves negative values without clamping',()=>{
  const result=shadow('reset',shadowFixture({stepCooldown:7,backSlideLevel:2,comboLoopCount:3,flags:{activeCombo:true,isMyUnit:true}}));
  assert.equal(result.shadowHostBoundary.cooldownWrite,5);assert.equal(result.shadowStep.stepCooldown,0);
  assert.equal(result.shadowStep.comboLoopCount,0);assert.equal(result.shadowStep.flags.activeCombo,false);
  assert.equal(result.shadowStep.flags.skillIcon,true);assert.equal(result.shadowHostBoundary.skillUiCalls,1);
  assert.equal(shadow('reset',shadowFixture({stepCooldown:1,backSlideLevel:2})).shadowHostBoundary.cooldownWrite,-1);
});
test('old back-slide signed duration is preserved, demonstrating target negative-speed mapping gap',()=>{
  assert.equal(shadow('backSlideStartFuture',shadowFixture({teleportRange:6.8})).shadowStep.backSlideTimeLeft,f(.6),'original int cast discards fraction');
  const negative=shadow('backSlideStartFuture',shadowFixture({passiveSpeedX:-1000}));
  assert.equal(negative.shadowStep.backSlideTimeLeft,f(-.6));
  assert.equal(shadow('backSlideEvent',negative.shadowStep).shadowSuccessor,'backSlideEnd','no invented abs(speed)');
  const start=shadow('backSlideStart');assert.equal(start.shadowHostBoundary.afterImageColor,0xffcccccc);
  assert.equal(start.shadowStep.flags.activeCombo,true);assert.equal(start.shadowStep.comboLoopCount,1);
  const end=shadow('backSlideEnd',start.shadowStep).shadowStep;
  assert.equal(end.afterImage,false);assert.equal(end.alpha,1);assert.equal(end.gageAlpha,255);assert.equal(end.backSlideTimeLeft,0);
});
test('old back-slide X keeps original independent if branches and double MP consumption',()=>{
  const result=shadow('backSlideEvent',shadowFixture({flags:{enablePunisher:true,enableThrust:true,enableBackSlide:true}}),{inputMask:32});
  assert.equal(result.shadowSuccessor,'buster');assert.equal(result.shadowStep.mp,30,'punisher branch then independent enhance-if/else buster branch');
});
test('Shadow Buster original Now oneshot emits original target-present effect set without guessed damage power',()=>{
  assert.equal(shadow('busterFrame',shadowFixture(),{time:.009,before:0}).commands.length,0);
  const result=shadow('busterFrame',shadowFixture(),{time:.01,before:0,oneshot:0});
  assert.equal(result.commands.length,1);assert.equal(result.commands[0].name,'EffectSet_Raven_Shadow_Buster');
  assert.equal(result.commands[0].phase,'OnFrameMove/Now');assert.equal('power' in result.commands[0],false);
  assert.equal(shadow('busterFrame',shadowFixture(),{time:.02,before:.01,oneshot:.01}).commands.length,0);
  assert.equal(shadow('busterStart').shadowStep.statePower,f(1.8));
});
test('original thrust starts scale explicit damage, memo7 reaction, and all endings retain falling offset',()=>{
  const basic=shadow('thrustStart',shadowFixture({flags:{memo7:true}})).shadowStep;
  assert.equal(basic.damagePhysical,15);assert.equal(basic.damageMagic,30);assert.equal(basic.damagePerSecond,45);
  assert.equal(basic.statePower,1.5);assert.equal(basic.reactionRequest,'bigDamage','BALANCE_BLADE_MASTER_20130117 removes old 60% roll');
  const enhanced=shadow('enhancedThrustStart').shadowStep;
  assert.equal(enhanced.damagePhysical,17);assert.equal(enhanced.statePower,1,'original enhanced start does not assign state power');
  assert.equal(shadow('punisherStart').shadowStep.statePower,2);
  for(const operation of ['thrustEvent','enhancedThrustEvent','punisherEvent','busterEvent','backSlideEndEvent']){
    assert.equal(shadow(operation,shadowFixture(),{ended:false}).shadowSuccessor,null);
    assert.equal(shadow(operation,shadowFixture(),{ended:true}).shadowSuccessor,'wait');
    const air=shadow(operation,shadowFixture(),{ended:true,grounded:false});assert.equal(air.shadowSuccessor,'jumpDown');assert.equal(air.offsetY,-45);
  }
});
test('Shadow snapshot JSON replay has no hidden state across module instances',async()=>{
  const first=shadow('dashStart').shadowStep;
  const snapshot=JSON.parse(JSON.stringify(first));
  const other=await instantiateNativeSkills(compiled);
  other.evaluate(shadowInput('punisherStart'));
  const input=shadowInput('dashFrame',snapshot,{dt:.05});
  assert.deepEqual(other.evaluate(input),bridge.evaluate(input));
  assert.deepEqual(snapshot,first);
});

const extraFrame={...base,position:[100,400,0],rotation:[0,0,0],direction:[1,0,0],landY:0,isRight:true,memo:false,
  skillExtra:{nowSpeedX:70,nowSpeedY:15,passiveSpeedX:900,passiveSpeedY:10,disableGravity:false,downAccel:0,gravityAccel:-1500,damageReducePercent:7}};
test('Valk original start zeros Now and disables passive motion; source .001 and .48 phases remain independent',()=>{
  const start=bridge.evaluate({...extraFrame,kind:61});
  assert.deepEqual(start.skillExtra,{nowSpeedX:0,nowSpeedY:0,passiveSpeedX:-1,passiveSpeedY:-1,
    disableGravity:true,downAccel:0,gravityAccel:-1500,damageReducePercent:7});
  const first=bridge.evaluate({...extraFrame,kind:62,time:.02,before:0,skillExtra:start.skillExtra});
  assert.equal(first.commands.filter(c=>c.name==='EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW').length,1);
  assert.equal(first.skillExtra.disableGravity,true);assert.equal(first.skillExtra.downAccel,0);
  const fall=bridge.evaluate({...extraFrame,kind:62,time:.49,before:.47,oneshot:.001,skillExtra:start.skillExtra});
  assert.equal(fall.skillExtra.disableGravity,false);assert.equal(fall.skillExtra.downAccel,-3000);
  assert.equal(fall.commands.length,0);
  const end=bridge.evaluate({...extraFrame,kind:63,skillExtra:start.skillExtra});
  assert.equal(end.skillExtra.disableGravity,false);assert.equal(end.commonBoundaryCalls,1);
});
test('Wild original ready .3, charge +30/-30 reduction and charging-effect stop use distinct exact callbacks',()=>{
  const before=bridge.evaluate({...extraFrame,kind:64,time:.299,before:.28});assert.equal(before.commands.length,0);
  const fire=bridge.evaluate({...extraFrame,kind:64,time:.31,before:.299});
  assert.equal(fire.commands[0].name,'EffectSet_RF_WILD_CHARGE_CHARGING');
  assert.equal(bridge.evaluate({...extraFrame,kind:64,time:.33,before:.31,oneshot:.3}).commands.length,0);
  const start=bridge.evaluate({...extraFrame,kind:65});assert.equal(start.skillExtra.damageReducePercent,37);
  const end=bridge.evaluate({...extraFrame,kind:66,skillExtra:start.skillExtra});
  assert.equal(end.skillExtra.damageReducePercent,7);assert.equal(end.effectMask,32);
});
test('Wild separate Now68 preserves original seconds/lostHP while Event67 does not secretly advance charge',()=>{
  const next=bridge.evaluate({...extraFrame,kind:68,hp:90,previousHp:100,charge:1});
  assert.equal(next.charge,Math.fround(11+Math.fround(1/60)));assert.equal(next.previousHp,90);
  assert.equal(next.stateChange,0);
  const event=bridge.evaluate({...extraFrame,kind:67,hp:90,previousHp:100,charge:1,held:false});
  assert.equal(event.charge,1);assert.equal(event.previousHp,100);assert.equal(event.stateChange,2);
});
test('skill dispatch contains1..69 only; complete method count is distinct from callback groups',async()=>{
  const contract=JSON.parse(await readFile(new URL('../../.cache/native-skills-generated/source-contract.json',import.meta.url)));
  assert.equal(contract.functions.length+contract.extraFunctions.length,70);
  assert.equal(contract.callbackGroups,69);assert.equal(contract.callbackGroupCount,69);
  assert.deepEqual(contract.callbackGroupIds,Array.from({length:69},(_,i)=>i+1));assert.equal(contract.vectorLockOnSeparateExport,true);
  assert.throws(()=>bridge.evaluate({...extraFrame,kind:0}),/Unknown/);
  assert.throws(()=>bridge.evaluate({...extraFrame,kind:70}),/Unknown/);
});
