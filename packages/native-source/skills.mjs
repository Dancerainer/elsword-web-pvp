/** Exact V5 callback execution. Target 2016 differences remain in the audit. */
export const nativeSkillsContract=Object.freeze({schema:3,referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'reference-V5-not2016',targetClientMeasured:false,outputFloats:33,
  chargedBoltCallbackPhase:'OnFrameMove/Now animation track',chargedBoltTargetBinaryVerified:false,
  wildChargeTargetCompatible:false,limitCrusherCancellation:'common-host-boundary',
  arcEnemyGroups:Object.freeze({frame:25,hyperFrame:70,follow:26,hit:27}),arcSnapshotWords:304,
  arcConditionalBranch:'SERV_SKILL_NOTE explicitly enabled; target2016 native binding unverified',
  arcTargetDamageMultiplierVerified:false,arcSpecialHyperExclusionVerified:false,
  shadowSnapshotWords:48,shadowTargetBindingVerified:false,
  drillGroups:Object.freeze({future:56,now:57,end:58}),drillSnapshotWords:25,
  skillMotionGroups:Object.freeze({powerAssaultFuture:59,sevenBurstFuture:60}),
  extraGroups:Object.freeze({valkyrieStart:61,valkyrieNow:62,valkyrieEnd:63,wildReadyNow:64,wildChargeStart:65,wildChargeEnd:66,wildChargeEvent:67,wildChargeNow:68}),
  extraReferenceCommit:'a1bcdabf39ee1699873b587b40cedefcce61c7f0',extraReferenceEvidence:'2026-reconstructed-V5-not2016',
  xCrashGroup:69,xCrashSnapshotWords:6,xCrashTargetBinaryVerified:false,
  effectHyperModeExport:'skills_effect_hyper_mask',effectHyperModeTargetBinaryVerified:false,
  drillTargetBinaryVerified:false,drillHelpers:'original creation/follow requests; factory handles supplied by host, no inferred lifespan',
  shadowBranch:'SERV_RAVEN_VETERAN_COMMANDER explicit reference compile branch; no automatic target2016 passive/upgrade flags'});
const number=(v,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(Math.fround(v)))throw new TypeError(name+' must be finite binary32');return v;};
const uint=(v,name,max=0xffffffff)=>{if(!Number.isInteger(v)||v<0||v>max)throw new TypeError(name+' must be an unsigned integer within ABI range');return v;};
const sint=(v,name,min=-2147483648,max=2147483647)=>{if(!Number.isInteger(v)||v<min||v>max)throw new TypeError(name+' must be a signed integer within ABI range');return v;};
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3)throw new TypeError(name+' requires an explicit three-component vector');return v.map(x=>number(x,name));};
const arcNames=['RAVEN_OVER_TAKER_ARC_ENEMY','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO','RAVEN_OVER_TAKER_FLYING_IMPACT',
  'RAVEN_OVER_TAKER_ARC_ENEMY_HYPER','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO_HYPER','RAVEN_OVER_TAKER_FLYING_IMPACT_HYPER'];
export const originalDrillGroups=nativeSkillsContract.drillGroups;
const drillInvalidHandle=0xffffffff;
const drillFloatFields={nowSpeedX:0,dashSpeed:1,damageChangeTime:2,hitGap:5,backSpeedX:6};
const drillBoolFields={reAttack:4,lhandEnabled:7,swordEnabled:8,luaTableOpen:9,particleExists:12,meshExists:13};
const drillHandleFields={particleHandle:10,meshHandle:11,createdParticleHandle:17,createdMeshHandle:18};
function drillView(e){
  if(typeof e.skills_drill_snapshot_ptr!=='function'||typeof e.skills_drill_snapshot_words!=='function'||e.skills_drill_snapshot_words()!==25)
    throw new TypeError('Missing native MegaDrill snapshot ABI');
  const ptr=e.skills_drill_snapshot_ptr();
  if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+100>e.memory.buffer.byteLength)throw new RangeError('MegaDrill snapshot pointer out of bounds');
  const d=new DataView(e.memory.buffer,ptr,100);
  return {f:i=>d.getFloat32(i*4,true),u:i=>d.getUint32(i*4,true),
    sf:(i,v)=>d.setFloat32(i*4,number(v,'MegaDrill field '+i),true),su:(i,v)=>d.setUint32(i*4,uint(v,'MegaDrill field '+i),true),
    clear:()=>new Uint8Array(e.memory.buffer,ptr,100).fill(0)};
}
function writeDrill(e,s){
  if(!s)throw new TypeError('Explicit MegaDrill snapshot required');
  const d=drillView(e);d.clear();
  for(const [field,i] of Object.entries(drillFloatFields))d.sf(i,s[field]);
  for(const [field,i] of Object.entries(drillBoolFields)){
    if(typeof s[field]!=='boolean')throw new TypeError('Explicit MegaDrill '+field+' required');d.su(i,s[field]?1:0);
  }
  for(const [field,i] of Object.entries(drillHandleFields))d.su(i,uint(s[field],'MegaDrill '+field));
  d.su(3,uint(s.hitListSize,'MegaDrill hitListSize',4));d.su(24,uint(s.damageStage,'MegaDrill damageStage',1));
  vector(s.handPosition,'MegaDrill Bip01_L_Hand').forEach((v,i)=>d.sf(14+i,v));
  if(s.dashSpeed<0||s.hitGap<0)throw new RangeError('Invalid MegaDrill speed or gap');
}
function readDrill(e,previous,kind,time){
  const d=drillView(e),s=structuredClone(previous);
  for(const [field,i] of Object.entries(drillFloatFields))s[field]=number(d.f(i),'MegaDrill result '+field);
  for(const [field,i] of Object.entries(drillBoolFields))s[field]=!!d.u(i);
  for(const [field,i] of Object.entries(drillHandleFields))s[field]=d.u(i);
  s.hitListSize=d.u(3);s.damageStage=d.u(24);
  const helperRequests=[],flags=d.u(22),basis={position:[...s.handPosition],animationTime:Math.fround(time),phase:'OnFrameMove/Now',evidenceClass:'reference-V5-not2016'};
  if(flags&1)helperRequests.push({...basis,type:'createParticleHandle',name:'Flare_Raven_MagnumBlaster06',returnedHandle:s.createdParticleHandle});
  if(flags&2)helperRequests.push({...basis,type:'createMeshHandle',name:'Raven_MagnumBlaster01_Mesh',returnedHandle:s.createdMeshHandle});
  if(flags&4)helperRequests.push({...basis,type:'followParticleHandle',handle:s.particleHandle});
  if(flags&8)helperRequests.push({...basis,type:'followMeshHandle',handle:s.meshHandle});
  return {megaDrill:s,drillMutation:{phase:kind===56?'OnFrameMoveFuture':kind===57?'OnFrameMove/Now':'StateEnd',
    clearHitHistory:!!d.u(20),attackBoxMask:d.u(21),damageOverridden:d.u(19)?'DAMAGE_DATA_NEXT':null,
    attackDataMutation:kind===57&&d.u(21)?{reAttack:s.reAttack,hitGap:s.hitGap,backSpeedX:s.backSpeedX}:null,
    enabledBoxes:{Lhand1:s.lhandEnabled,Sword:s.swordEnabled},helperRequests,
    helperFactoryAndLifetimeVerified:false,commonSimpleInitWholeConsumerExecuted:false}};
}
function arcView(e){
  if(typeof e.skills_arc_snapshot_ptr!=='function'||typeof e.skills_arc_snapshot_words!=='function'||e.skills_arc_snapshot_words()!==304)
    throw new TypeError('Missing native Archenemy snapshot ABI');
  const ptr=e.skills_arc_snapshot_ptr();
  if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+1216>e.memory.buffer.byteLength)throw new RangeError('Archenemy snapshot pointer out of bounds');
  const d=new DataView(e.memory.buffer,ptr,1216);
  return {f:(i)=>d.getFloat32(i*4,true),u:(i)=>d.getUint32(i*4,true),i:(i)=>d.getInt32(i*4,true),
    sf:(i,v)=>d.setFloat32(i*4,number(v,'Archenemy field '+i),true),su:(i,v)=>d.setUint32(i*4,uint(v,'Archenemy field '+i),true),
    si:(i,v)=>d.setInt32(i*4,sint(v,'Archenemy field '+i),true),
    clear:()=>new Uint8Array(e.memory.buffer,ptr,1216).fill(0)};
}
function writeArc(e,arc,kind,time,before,oneshot){
  if(!arc||!Array.isArray(arc.data)||arc.data.length>4||!Array.isArray(arc.effects)||arc.effects.length>8)
    throw new TypeError('Archenemy requires explicit data (up to4) and effects (up to8) snapshots');
  const a=arcView(e);a.clear();a.su(0,arc.data.length);a.sf(1,arc.cooldown);a.su(2,uint(arc.nextHandle,'Archenemy nextHandle',0xfffffffb));
  if(!arc.nextHandle)throw new TypeError('Archenemy nextHandle must be nonzero');
  const defender=arc.defender??null;
  if(kind===27&&(!['unit','effect','none'].includes(arc.defenderType)||typeof arc.dummyDamage!=='boolean'))
    throw new TypeError('Archenemy hit requires explicit defenderType and dummyDamage');
  a.su(3,arc.defenderType==='unit'?0:1);a.su(4,arc.dummyDamage===true?1:0);a.su(5,defender?1:0);
  if(defender){if(!['user','npc','other'].includes(defender.type))throw new TypeError('Invalid Archenemy defender type');
    a.su(6,defender.type==='user'?0:defender.type==='npc'?1:2);a.su(7,uint(defender.uid,'Archenemy defender UID',defender.type==='npc'?0x7fffffff:0xffffffff));}
  a.su(8,arc.effects.length);vector(arc.zDirection,'Archenemy zDirection').forEach((v,i)=>a.sf(9+i,v));
  if(kind===25||kind===70){
    if(!Array.isArray(arc.randValues)||arc.randValues.length!==4)throw new TypeError('Archenemy FrameMove requires four explicit original rand() values');
    arc.randValues.forEach((v,i)=>a.su(12+i,uint(v,'Archenemy rand() value',32767)));
    a.sf(16,arc.newEffectMaxLifeTime);
    const spawning=Math.fround(before)<Math.fround(1.5)&&Math.fround(time)>=Math.fround(1.5)&&Math.fround(oneshot)<Math.fround(1.5);
    if(spawning&&arc.effects.filter(x=>x.alive).length-arc.data.length>4)throw new RangeError('Archenemy effect storage capacity exceeded');
  }
  const handles=new Set();
  for(const [i,x] of arc.effects.entries()){
    const b=64+i*24;uint(x.handle,'Archenemy effect handle');
    if(!x.handle||handles.has(x.handle))throw new TypeError('Archenemy effect handles must be distinct and nonzero');handles.add(x.handle);
    const name=arcNames.indexOf(x.name);if(name<0)throw new TypeError('Unknown original Archenemy effect name');
    if(typeof x.alive!=='boolean'||typeof x.hasMesh!=='boolean')throw new TypeError('Archenemy effect liveness must be explicit');
    a.su(b,x.handle);a.su(b+1,name+1);a.su(b+2,x.alive?1:0);a.su(b+3,x.hasMesh?1:0);
    for(const [field,off] of [['position',4],['rotation',7],['moveAxis',10]])vector(x[field],'Archenemy effect '+field).forEach((v,j)=>a.sf(b+off+j,v));
    for(const [field,off] of [['power',13],['landY',14],['animationResetTime',15],['dirSpeed',18],['nowLifeTime',19],['maxLifeTime',20]])a.sf(b+off,x[field]);
    a.su(b+16,x.lockOnUnitUID);a.si(b+17,sint(x.lockOnNPCUID,'Archenemy NPC UID',-1));
    if(!Array.isArray(x.attackTime)||x.attackTime.length!==2)throw new TypeError('Archenemy effect requires attackTime');
    a.sf(b+21,x.attackTime[0]);a.sf(b+22,x.attackTime[1]);
  }
  if(arc.nextHandle<=Math.max(0,...handles))throw new TypeError('Archenemy nextHandle must exceed existing handles');
  const owned=new Set();
  for(const [i,x] of arc.data.entries()){
    const b=32+8*i;uint(x.handle,'Archenemy owned handle');
    if(!x.handle||owned.has(x.handle)||!handles.has(x.handle))throw new TypeError('Archenemy owned handles must be distinct and present in effect snapshot');owned.add(x.handle);
    a.su(b,x.handle);vector(x.offsetPosition,'Archenemy offsetPosition').forEach((v,j)=>a.sf(b+1+j,v));
    vector(x.offsetRotation,'Archenemy offsetRotation').forEach((v,j)=>a.sf(b+4+j,v));
  }
}
function readArc(e,previous,time){
  const a=arcView(e);if(a.u(0)>4||a.u(8)>8||a.u(4)>4||a.u(5)>4)throw new RangeError('Invalid original Archenemy result count');
  const effects=[],data=[],commands=[];
  for(let i=0;i<a.u(0);++i){const b=32+8*i;data.push({handle:a.u(b),offsetPosition:[a.f(b+1),a.f(b+2),a.f(b+3)],offsetRotation:[a.f(b+4),a.f(b+5),a.f(b+6)]});}
  for(let i=0;i<a.u(8);++i){const b=64+24*i;
    const x={handle:a.u(b),name:arcNames[a.u(b+1)-1],alive:!!a.u(b+2),hasMesh:!!a.u(b+3),position:[a.f(b+4),a.f(b+5),a.f(b+6)],
      rotation:[a.f(b+7),a.f(b+8),a.f(b+9)],moveAxis:[a.f(b+10),a.f(b+11),a.f(b+12)],power:a.f(b+13),landY:a.f(b+14),
      animationResetTime:a.f(b+15),lockOnUnitUID:a.u(b+16),lockOnNPCUID:a.i(b+17),dirSpeed:a.f(b+18),nowLifeTime:a.f(b+19),
      maxLifeTime:a.f(b+20),attackTime:[a.f(b+21),a.f(b+22)]};effects.push(x);
    if(a.u(b+23))commands.push({type:'damage',...x,animationTime:Math.fround(time),phase:'OnFrameMove/Now',evidenceClass:'reference-V5-conditional-branch-not2016'});
    else if(x.alive)commands.push({type:'effectMeshUpdate',...x,evidenceClass:'reference-V5-not2016'});
  }
  for(const old of previous.effects)if(old.alive&&!effects.some(x=>x.handle===old.handle&&x.alive))commands.push({type:'destroyDamageEffect',handle:old.handle,evidenceClass:'reference-V5-not2016'});
  for(let i=0;i<a.u(4);++i){const b=256+12*i;commands.push({type:'mesh',name:'Raven_Overtaker_Sp2a_FlyingImpact_Start_0'+a.u(b),
    position:[a.f(b+1),a.f(b+2),a.f(b+3)],rotation:[a.f(b+4),a.f(b+5),a.f(b+6)],moveAxis:[a.f(b+7),a.f(b+8),a.f(b+9)],
    animationTime:Math.fround(time),phase:'OnFrameMove/Now',evidenceClass:'reference-V5-not2016'});}
  for(const x of data){vector(x.offsetPosition,'original Archenemy result offsetPosition');vector(x.offsetRotation,'original Archenemy result offsetRotation');}
  for(const x of effects){for(const field of ['position','rotation','moveAxis'])vector(x[field],'original Archenemy result '+field);
    for(const field of ['power','landY','animationResetTime','dirSpeed','nowLifeTime','maxLifeTime'])number(x[field],'original Archenemy result '+field);
    x.attackTime.forEach(v=>number(v,'original Archenemy result attackTime'));}
  return {arcEnemy:{data,effects,cooldown:a.f(1),nextHandle:a.u(2)},commands,randConsumed:a.u(5),timerRestarted:!!a.u(3)};
}
export const originalShadowGroups=Object.freeze({
  dashInit:28,dashStartFuture:29,dashStart:30,dashFrame:31,dashEvent:32,dashEnd:33,
  thrustInit:34,thrustStart:35,thrustEvent:36,
  backSlideStartFuture:37,backSlideStart:38,backSlideFrame:39,backSlideEvent:40,backSlideEnd:41,
  backSlideEndFrame:42,backSlideEndEvent:43,
  busterInit:44,busterStart:45,busterFrame:46,busterEvent:47,
  enhancedThrustInit:48,enhancedThrustStart:49,enhancedThrustEvent:50,
  punisherInit:51,punisherStart:52,punisherEvent:53,selectAttack:54,reset:55,
});
const shadowFlags=['frameStop','hasEquippedSkill','hasUnit','enableThrust','enableThrustEnhance','enablePunisher',
  'enableBackSlide','activeCombo','skillIcon','memo6','memo7','specialAttackAccepted','isMyUnit','hasGageUI','hasAfterImage'];
const shadowFloatFields={stepTimeLeft:0,backSlideTimeLeft:1,teleportRange:2,skillCooldown:3,passiveSpeedX:5,
  mp:6,stateTime:7,stepCooldown:9,thrustPower:12,enhancedThrustPower:13,punisherPower:14,busterPower:15,
  alpha:17,gageAlpha:20,damagePhysical:21,damageMagic:22,damagePerSecond:23,statePower:24,randomRoll:37};
const shadowIntFields={skillLevel:4,backSlideLevel:10,comboLoopCount:11};
const shadowStateTags=Object.freeze({thrust:10,enhancedThrust:11,punisher:12,backSlide:13,backSlideEnd:14,buster:15,finish:16});
const shadowSuccessors=Object.freeze({3:'wait',4:'jumpDown',10:'thrust',11:'enhancedThrust',12:'punisher',13:'backSlide',14:'backSlideEnd',15:'buster',16:'finish',17:'dash'});
function shadowView(e){
  if(typeof e.skills_shadow_snapshot_ptr!=='function'||typeof e.skills_shadow_snapshot_words!=='function'||e.skills_shadow_snapshot_words()!==48)
    throw new TypeError('Missing original Shadow snapshot ABI');
  const ptr=e.skills_shadow_snapshot_ptr();
  if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+192>e.memory.buffer.byteLength)throw new RangeError('Shadow snapshot pointer out of bounds');
  const d=new DataView(e.memory.buffer,ptr,192);
  return {f:i=>d.getFloat32(i*4,true),u:i=>d.getUint32(i*4,true),i:i=>d.getInt32(i*4,true),
    sf:(i,v)=>d.setFloat32(i*4,number(v,'Shadow field '+i),true),su:(i,v)=>d.setUint32(i*4,uint(v,'Shadow field '+i),true),
    si:(i,v)=>d.setInt32(i*4,sint(v,'Shadow field '+i),true),clear:()=>new Uint8Array(e.memory.buffer,ptr,192).fill(0)};
}
function writeShadow(e,s,kind){
  if(!s||!s.flags)throw new TypeError('Original Shadow snapshot and explicit reference flags required');
  const d=shadowView(e);d.clear();
  for(const [field,index] of Object.entries(shadowFloatFields))d.sf(index,s[field]);
  for(const [field,index] of Object.entries(shadowIntFields))d.si(index,s[field]);
  // Original signed speed division can produce negative duration. Preserve it
  // across snapshots: the original event callback consumes <=0 directly.
  if(s.skillLevel<1||s.skillLevel>30||s.mp<0||s.stateTime<0||s.randomRoll<0||s.randomRoll>1)
    throw new RangeError('Invalid original Shadow state');
  let bits=0;shadowFlags.forEach((field,i)=>{
    if(typeof s.flags[field]!=='boolean')throw new TypeError('Explicit Shadow flag '+field+' required');
    if(s.flags[field])bits|=1<<i;
  });d.su(8,bits);
  for(const [field,index] of [['afterImage',16],['alphaBlend',18],['alphaObject',19]]){
    if(typeof s[field]!=='boolean')throw new TypeError('Explicit Shadow '+field+' required');d.su(index,s[field]?1:0);
  }
  if(!['wait','dash'].includes(s.dashSuccessor))throw new TypeError('Explicit Common StateChangeDashIfPossible result required');
  d.si(31,s.dashSuccessor==='dash'?17:3);
  if(!(s.requestedAttack in shadowStateTags))throw new TypeError('Original requested attack symbol required');d.si(25,shadowStateTags[s.requestedAttack]);
  if(!['none','bigDamage'].includes(s.reactionRequest))throw new TypeError('Explicit Shadow damage reaction symbol required');d.si(36,s.reactionRequest==='bigDamage'?2:0);
  if([32,40,54,55].includes(kind)&&s.stepCooldown>0&&!s.flags.hasUnit)throw new TypeError('Original cooldown reset requires an existing unit');
}
function readShadow(e,previous,state){
  const d=shadowView(e),s=structuredClone(previous);
  for(const [field,index] of Object.entries(shadowFloatFields))s[field]=d.f(index);
  for(const [field,index] of Object.entries(shadowIntFields))s[field]=d.i(index);
  shadowFlags.forEach((field,i)=>s.flags[field]=!!(d.u(8)&1<<i));
  s.afterImage=!!d.u(16);s.alphaBlend=!!d.u(18);s.alphaObject=!!d.u(19);
  s.reactionRequest=d.i(36)===2?'bigDamage':'none';
  for(const [field] of Object.entries(shadowFloatFields))number(s[field],'Original Shadow result '+field);
  const successor=state?shadowSuccessors[state]:null;
  if(state&&!successor)throw new RangeError('Unbound original Shadow symbolic successor');
  const mesh=d.u(26),commands=[];
  if(mesh)commands.push({type:'prepareMesh',name:mesh===1?'Raven_SI_A_RF_Shadow_Step_Mesh01.X':'Raven_SI_A_RF_Thrust_Mesh01.X'});
  return {shadowStep:s,shadowSuccessor:successor,commands,shadowHostBoundary:{meshPrepareCalls:d.u(27),infoCalls:d.u(28),skillUiCalls:d.u(29),
    dashRequests:d.u(30),specialAttackCalls:d.u(40),afterImageColor:d.u(35)||null,
    cooldownWrite:d.u(33)?d.f(32):null,targetNativeFlagsVerified:false}};
}
export function createNativeSkillsBridge(instanceOrExports){
  const e=instanceOrExports.exports??instanceOrExports;
  for(const name of ['skills_eval','skills_output_ptr','skills_output_count'])if(typeof e[name]!=='function')throw new TypeError('Missing native skills export '+name);
  if(!(e.memory instanceof WebAssembly.Memory)||e.skills_output_count()!==33)throw new TypeError('Native skills ABI mismatch');
  // Historical ABI modules remain readable for independent old proof. An old
  // module cannot silently accept group70 and leave an untouched Arc snapshot.
  const callbackGroupCount=typeof e.skills_callback_group_count==='function'?e.skills_callback_group_count():69;
  if(!Number.isInteger(callbackGroupCount)||callbackGroupCount<1||callbackGroupCount>70)throw new TypeError('Native callback group capability mismatch');
  const contract=Object.freeze({...nativeSkillsContract,callbackGroupCount,arcHyperFrameSupported:callbackGroupCount>=70});
  return Object.freeze({contract,vectorLockOn({position,manualDirDegree,targetPosition,curveSpeed,dt}){
    if(e.skills_vector_lockon_words?.()!==11||typeof e.skills_vector_lockon_eval!=='function')throw new TypeError('Missing original VectorLockOn ABI');
    const values=[...vector(position,'VectorLockOn position'),...vector(manualDirDegree,'VectorLockOn manualDirDegree'),
      ...vector(targetPosition,'VectorLockOn targetPosition'),number(curveSpeed,'VectorLockOn curveSpeed'),number(dt,'VectorLockOn dt')];
    if(dt<0||curveSpeed<0)throw new RangeError('Invalid VectorLockOn curve/time');
    const ptr=e.skills_vector_lockon_ptr();if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+44>e.memory.buffer.byteLength)throw new RangeError('VectorLockOn pointer out of bounds');
    const data=new Float32Array(e.memory.buffer,ptr,11);data.set(values);e.skills_vector_lockon_eval();
    const result=Array.from(data.slice(3,6));result.forEach(v=>number(v,'VectorLockOn output'));
    return {manualDirDegree:result,evidenceClass:'unchanged-fixed-V5-VectorLockOn; target-client-unverified'};
  },evaluate({kind,time,before=0,dt=0,hp,hpMax,charge=0,afterFull=0,
    previousHp=hp,held=false,ended=false,grounded=true,power=1,awakening=0,walkCancel=0,dashCancel=0,skillCancel=0,inputMask=0,
    position,rotation,direction,landY,isRight,memo=false,oneshot=0,arcEnemy,shadowStep,megaDrill,skillMotion,skillExtra,xCrash}){
    if(!Number.isInteger(kind)||kind<1||kind>callbackGroupCount)throw new RangeError('Unknown original skills callback group for this native module');
    if(kind>=24){
      for(const [name,value] of Object.entries({position,rotation,direction}))if(!Array.isArray(value)||value.length!==3)
        throw new TypeError('Skill callback requires original '+name+' vector');
      if(typeof isRight!=='boolean'||typeof memo!=='boolean')throw new TypeError('Skill callback requires explicit facing and boolean memo');
      number(landY,'Skill callback landY');
    }
    position??=[0,0,0];rotation??=[0,0,0];direction??=[0,0,0];landY??=0;isRight??=true;
    const values=[time,before,dt,hp,hpMax,charge,afterFull,previousHp,power,awakening,walkCancel,dashCancel,skillCancel,
      ...position,...rotation,...direction,landY,oneshot];
    values.forEach((v,i)=>number(v,'skills argument '+i));
    if(dt<0||hpMax<=0||charge<0||afterFull<0||!Number.isInteger(inputMask)||inputMask<0||inputMask>32767)throw new RangeError('Invalid skills callback state');
    const arcKind=kind>=25&&kind<=27||kind===70,shadowKind=kind>=28&&kind<=55,drillKind=kind>=56&&kind<=58,motionKind=kind>=59&&kind<=60,extraKind=kind>=61&&kind<=66;
    if(arcKind)writeArc(e,arcEnemy,kind,time,before,oneshot);
    if(shadowKind)writeShadow(e,shadowStep,kind);
    if(drillKind)writeDrill(e,megaDrill);
    let motionBuffer;
    if(motionKind){
      if(typeof e.skills_motion_snapshot_ptr!=='function'||typeof e.skills_motion_snapshot_words!=='function'||e.skills_motion_snapshot_words()!==2)
        throw new TypeError('Missing native skill motion snapshot ABI');
      const p=e.skills_motion_snapshot_ptr();
      if(!Number.isInteger(p)||p<0||p%4||p+8>e.memory.buffer.byteLength)throw new RangeError('Skill motion pointer out of bounds');
      if(!skillMotion)throw new TypeError('Explicit skill motion snapshot required');
      motionBuffer=new Float32Array(e.memory.buffer,p,2);
      motionBuffer.set([number(skillMotion.nowSpeedX,'Skill motion nowSpeedX'),number(skillMotion.passiveSpeedX,'Skill motion passiveSpeedX')]);
    }
    let extraBuffer;
    if(extraKind){
      if(typeof e.skills_extra_snapshot_ptr!=='function'||e.skills_extra_snapshot_words?.()!==8)throw new TypeError('Missing native extra-skill ABI');
      const p=e.skills_extra_snapshot_ptr();if(!Number.isInteger(p)||p<0||p%4||p+32>e.memory.buffer.byteLength)throw new RangeError('Extra-skill pointer out of bounds');
      if(!skillExtra||typeof skillExtra.disableGravity!=='boolean')throw new TypeError('Explicit extra-skill motion required');
      extraBuffer=new Float32Array(e.memory.buffer,p,8);
      extraBuffer.set(['nowSpeedX','nowSpeedY','passiveSpeedX','passiveSpeedY','disableGravity','downAccel','gravityAccel','damageReducePercent'].map(k=>k==='disableGravity'?Number(skillExtra[k]):number(skillExtra[k],'Extra-skill '+k)));
    }
    let xCrashBuffer;
    if(kind===69){
      if(typeof e.skills_xcrash_snapshot_ptr!=='function'||e.skills_xcrash_snapshot_words?.()!==6)throw new TypeError('Missing original XCrash snapshot ABI');
      const p=e.skills_xcrash_snapshot_ptr();if(!Number.isInteger(p)||p<0||p%4||p+24>e.memory.buffer.byteLength)throw new RangeError('XCrash pointer out of bounds');
      if(!xCrash)throw new TypeError('Explicit XCrash bone and saved position required');
      if(typeof xCrash.hyperState!=='boolean')throw new TypeError('Explicit XCrash registered Hyper state flag required');
      xCrashBuffer=new Float32Array(e.memory.buffer,p,6);
      xCrashBuffer.set([...vector(xCrash.bonePosition,'XCrash Now Bip01'),...vector(xCrash.savedPosition,'XCrash m_vXCrashPos')]);
    }
    e.skills_eval(kind,time,before,dt,hp,hpMax,charge,afterFull,previousHp,held?1:0,ended?1:0,grounded?1:0,power,kind===69?(xCrash.hyperState?1:0):awakening,walkCancel,dashCancel,skillCancel,inputMask,
      ...position,...rotation,...direction,landY,isRight?1:0,memo?1:0,oneshot);
    const ptr=e.skills_output_ptr();
    if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+132>e.memory.buffer.byteLength)throw new RangeError('Native skills output pointer out of bounds');
    const f=Array.from(new Float32Array(e.memory.buffer,ptr,33));
    if(f.some(v=>!Number.isFinite(v)))throw new RangeError('Nonfinite original skills result');
    const commands=[];
    if(f[12])commands.push({type:'damage',name:{1:'RAVEN_OVER_TAKER_CHARGED_BOLT',2:'RAVEN_OVER_TAKER_CHARGED_BOLT_MEMO',3:'RRF_X_CRASH_NODAMAGE',4:'RRF_X_CRASH_NODAMAGE_HYPER'}[f[12]],
      position:f.slice(13,16),rotation:f.slice(16,19),landY:f[19],power:f[20],animationTime:f[29],threshold:Math.fround(kind===69?1.31:.4),
      phase:'OnFrameMove/Now',evidenceClass:'reference-V5-not2016'});
    if(f[21])commands.push({type:'particle',name:'Flare_Raven_Overtaker_Sp1a_ChargedBolt02',
      position:f.slice(22,25),rotation:f.slice(25,28),landY:f[28],animationTime:f[29],threshold:Math.fround(.7),
      phase:'OnFrameMove/Now',evidenceClass:'reference-V5-not2016'});
    const arcResult=arcKind?readArc(e,arcEnemy,time):null;
    if(arcResult)commands.push(...arcResult.commands);
    const shadowResult=shadowKind?readShadow(e,shadowStep,f[3]):null;
    const drillResult=drillKind?readDrill(e,megaDrill,kind,time):null;
    // A legacy sealed module has no getter. Keep its unchanged fixed-callback
    // values explicit, rather than making EffectSet inspect live state later.
    // Only WildCharge's dash passes GetRemainHyperModeTime()>0 in these groups.
    const effectHyperMask=typeof e.skills_effect_hyper_mask==='function'?uint(e.skills_effect_hyper_mask(),'Effect Hyper mask',31):
      kind===3&&awakening>0?f[4]&2:0;
    if(shadowResult){commands.push(...shadowResult.commands);
      if(f[4]&4)commands.push({type:'effectSet',name:'EffectSet_Raven_Shadow_Buster',hyperMode:!!(effectHyperMask&4),animationTime:Math.fround(time),phase:'OnFrameMove/Now',threshold:Math.fround(.01),
        evidenceClass:'unchanged fixed-V5 ShadowBuster callback; target binding and owner power candidate'});}
    for(const [bit,name] of [[1,'EffectSet_WILD_CHARGE_MAX'],[2,'EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK'],[8,'EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW'],[16,'EffectSet_RF_WILD_CHARGE_CHARGING']])
      // Only the WildCharge dash supplies an explicit power argument. The
      // sealed EffectSink's default1 is a host placeholder, not the original
      // PlayEffectSet default-1 (EffectSet.cpp1800), which resolves owner power
      // at234..271. In particular Valk's omitted argument must retain the
      // selected trait coefficient. Do not multiply an explicit dash result twice.
      if(f[4]&bit)commands.push({type:'effectSet',name,...(bit===2?{power:f[5]}:{}),hyperMode:!!(effectHyperMask&bit),animationTime:Math.fround(time),phase:'OnFrameMove/Now',
        evidenceClass:bit===8?'2026-reconstructed-V5-not2016':'unchanged-fixed-V5-callback; target-charge-adapter-separate'});
    return {charge:f[0],afterFull:f[1],previousHp:f[2],stateChange:f[3],effectMask:f[4],effectHyperMask,effectPower:f[5],sounds:f[6],
      offsetY:f[7],commonBoundaryCalls:f[8],cancellationBoundaryCalls:f[9],callbackGroup:f[11],commands,
      disabledPresentationCalls:{camera:f[30],cutIn:f[31],worldColor:f[32]},
      animationOneshotTimer:typeof e.skills_oneshot_timer==='function'?e.skills_oneshot_timer():null,
      ...(arcResult?{arcEnemy:arcResult.arcEnemy,randConsumed:arcResult.randConsumed,timerRestarted:arcResult.timerRestarted}:{}),
      ...(drillResult??{}),
      ...(xCrashBuffer?{xCrash:{savedPosition:Array.from(xCrashBuffer.slice(3,6))}}:{}),
      ...(motionKind?{skillMotion:{nowSpeedX:number(motionBuffer[0],'Skill motion result nowSpeedX'),passiveSpeedX:number(motionBuffer[1],'Skill motion result passiveSpeedX')}}:{}),
      ...(extraKind?{skillExtra:Object.fromEntries(['nowSpeedX','nowSpeedY','passiveSpeedX','passiveSpeedY','disableGravity','downAccel','gravityAccel','damageReducePercent'].map((k,i)=>[k,k==='disableGravity'?!!extraBuffer[i]:number(extraBuffer[i],'Extra skill result '+k)]))}:{}),
      ...(shadowResult?{shadowStep:shadowResult.shadowStep,shadowSuccessor:shadowResult.shadowSuccessor,shadowHostBoundary:shadowResult.shadowHostBoundary}:{})};
  }});
}
export async function instantiateNativeSkills(bytesOrModule){const result=await WebAssembly.instantiate(bytesOrModule,{});return createNativeSkillsBridge(result.instance??result);}
