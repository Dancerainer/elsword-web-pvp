/** Explicit host boundary for unchanged RF107 reference-V5 C++ callbacks. */
export const NATIVE_COMMAND_RULE='rf-original-v5-callbacks-v3';
export const nativeCommandContract=Object.freeze({referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'reference-V5-not2016',targetClientMeasured:false,fullUserExecuted:false});
const names=['', 'RSI_WAIT','RSI_WALK','RSI_JUMP_READY','RSI_JUMP_DOWN','RSI_JUMP_LANDING',
  'RSI_DASH_JUMP_LANDING','RSI_DASH_JUMP_COMBO_Z','RSI_DASH_JUMP_COMBO_ZZ','RSI_DASH_JUMP_COMBO_ZZ_Landing',
  'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING','RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',
  'RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X','RSI_COMBO_ZZXX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','DASH_REQUEST',
  'RSI_DAMAGE_AIR_SMALL','RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK',
  'RSI_COMBO_Z','RSI_COMBO_ZZ','RSI_COMBO_ZZZ','RSI_COMBO_ZZZZ','RSI_COMBO_ZZX','RSI_COMBO_X','RSI_COMBO_XX','RSI_COMBO_XXX',
  'RRF_DASH_JUMP_COMBO_X','RRF_DASH_JUMP_COMBO_XX','RRF_DASH_JUMP_COMBO_XX_LANDING','RRF_COMBO_ZZXFRONTX','RRF_COMBO_ZZXFRONTXX',
  'RSI_OVER_TAKER_COMBO_XXfrontX','RSI_OVER_TAKER_COMBO_XXdownX','AWAKEN_REQUEST','UNSUPPORTED_ZZZX',
  'RSI_OVER_TAKER_COMBO_XXfrontXX','RSI_OVER_TAKER_COMBO_XXfrontXX2','RSI_OVER_TAKER_COMBO_XXfrontXX3',
  'RSI_OVER_TAKER_COMBO_XXfrontXX4','RSI_OVER_TAKER_COMBO_XXfrontXXdownX'];
const ids=new Map(names.map((name,id)=>[name,id]));
// Presentation identity from the frozen ABI registrations, including the
// unbound landing probe and recovery FrameMove-only XXX/forward successors.
// Movement/request slots and received-damage callbacks (18..22) are excluded.
export const RAVEN_COMMAND_PRESENTATION_STATES=Object.freeze([
  ...names.slice(7,17),...names.slice(23,38),...names.slice(40),
]);
const futures=new Set([8,10,13,14,15,26,31,32,34]),events=new Set([7,8,9,10,12,13,14,15,18,19,20,21,22,23,24,25,26,27,28,29,31,32,33,34,35]);
const number=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(Math.fround(v)))throw new TypeError(label+' must be finite binary32');return v;};
function bits(input={}) {
  const held=new Set(input.held??[]),pressed=new Set(input.pressed??[]);
  let out=0;
  for(const [key,mask] of [['Z',1],['X',2],['DOWN',4],['AWAKEN',524288]])if(pressed.has(key))out|=mask;
  for(const [key,mask] of [['RIGHT',8],['LEFT',16],['UP',32],['DOWN',64],['Z',512],['X',1024],['A',2048],
    // The web eight-key layout places the original fourth skill key C on F.
    ['S',4096],['D',8192],['C',16384],['F',16384],['Q',32768],['W',65536],['E',131072],['R',262144]])if(held.has(key))out|=mask;
  if(input.pureDoubleRight)out|=128;if(input.pureDoubleLeft)out|=256;
  if(pressed.has('DASH')){if(held.has('RIGHT'))out|=128;if(held.has('LEFT'))out|=256;}
  return out;
}
export async function createNativeCommands({bytes,module}={}) {
  const result=await WebAssembly.instantiate(module??bytes,{}),e=(result.instance??result).exports;
  if(!(e.memory instanceof WebAssembly.Memory)||e.command_abi_version?.()!==3||e.result_count?.()!==22||typeof e.run_callback!=='function'||typeof e.result_ptr!=='function')
    throw new TypeError('Native RF command ABI mismatch');
  function run(phase,a,input,profile,elapsed=0,{canDown=false}={}) {
    const def=profile.states[a.state];if(!def)throw new TypeError('Unknown RF state');
    const p=profile.physics,period=def.clip?.durationSeconds;
    const ended=a.animationStopped||Number.isFinite(period)&&a.animationTime>period-Math.max(period/10,.03);
    const args=[phase,ids.get(a.state)??0,elapsed,a.animationTime,a.animationBeforeTime??a.animationTime,a.animationOneshotTimer??0,
      a.vx*a.facing,a.vy,a.passiveSpeed?.x??-1,a.passiveSpeed?.y??-1,p.G_ACCEL,p.MAX_G_SPEED,
      p.WALK_SPEED*a.stats.moveSpeedMultiplier,a.sourceCommandFlags??0,bits(input),a.facing,a.grounded?1:0,ended?1:0,a.y,a.canNotJumpTime??0,canDown?1:0,
      a.landPosition?.[1]??0,a.lastAttackerFront===false?0:1,period??0,a.canNotAttackTime??0,a.reAttackZ1Time??0,a.reAttackZ1Right?1:0,a.mp??0,
      a.sourceDashJumpEffectHandle??0,a.awakening?.orbs??0,a.awakening?.remaining??0,a.passivePolicy?.awakening?.canReawaken?1:0];
    for(const [i,v] of args.entries())number(v,'native command arg '+i);
    if(e.recovery_source_marker?.()===11){
      const windows=[0,1].flatMap(i=>{const w=def.raw['EVENT_PROCESS_TIME'+i];return [w?.['1']??0,w?.['2']??9999,w?.['3']??9999];});
      windows.forEach((n,i)=>number(n,'recovery event window '+i));e.set_recovery_windows(...windows);
      const direction=a.sourceCommandDirection??[1,0,0];
      const position=[a.x??0,a.y??0,a.z??0,...direction];position.forEach((n,i)=>number(n,'recovery position '+i));
      e.set_recovery_position(...position);
      if(e.set_recovery_hand_position){
        const hand=a.sourceCommandHandPosition??[0,0,0];hand.forEach((n,i)=>number(n,'recovery hand position '+i));
        e.set_recovery_hand_position(...hand);
      }
    }
    const handled=!!e.run_callback(...args),ptr=e.result_ptr();
    if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+88>e.memory.buffer.byteLength)throw new RangeError('Native command result pointer');
    const v=Array.from(new Float32Array(e.memory.buffer,ptr,22));
    const damageCommands=[];
    if(e.recovery_damage_count?.()>0){
      const p=e.recovery_damage_position();
      if(!Number.isInteger(p)||p<0||p%4||p+12>e.memory.buffer.byteLength)throw new RangeError('Recovery damage position pointer');
      // Earlier recovery modules have only the ZXX callback. A newly compiled
      // module exposes the literal source name tag, never infer it from state.
      const kind=e.recovery_damage_kind?.()??1;
      const name=({1:'DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',2:'DamageEffect_RSI_OVER_TAKER_XX_DOWN_X'})[kind];
      if(!name)throw new TypeError('Unsupported recovery damage name tag '+kind);
      damageCommands.push({name,position:Array.from(new Float32Array(e.memory.buffer,p,3)),count:e.recovery_damage_count(),
        sourceCommit:'a1bcdabf39ee1699873b587b40cedefcce61c7f0',evidenceClass:'2026-reconstructed-2015-reference-not2016'});
    }
    const particleCommands=[];
    if(e.recovery_particle_count?.()>0){
      const p=e.recovery_particle_position();
      if(!Number.isInteger(p)||p<0||p%4||p+12>e.memory.buffer.byteLength)throw new RangeError('Recovery particle position pointer');
      const xxxMask=e.recovery_xxx_particle_mask?.()??0;
      if(!Number.isInteger(xxxMask)||xxxMask<0||xxxMask>7)throw new TypeError('Unsupported recovery XXX particle mask');
      const names=xxxMask?[[1,'Smoke_Raven_ComboX03'],[2,'Smoke_Raven_ComboX01'],[4,'Flare_Raven_ComboX02']].filter(([bit])=>xxxMask&bit).map(([,name])=>name):['Raven_attackX3Front_Particle01'];
      for(const name of names)particleCommands.push({name,position:Array.from(new Float32Array(e.memory.buffer,p,3)),count:xxxMask?1:e.recovery_particle_count(),
        sourceCommit:'a1bcdabf39ee1699873b587b40cedefcce61c7f0',evidenceClass:'2026-reconstructed-2015-reference-not2016'});
    }
    return {handled,vx:v[0]*a.facing,vy:v[1],passiveSpeed:{x:v[2],y:v[3]},flags:v[4],state:names[v[5]]||null,
      y:v[6],canNotJumpTime:v[7],animationBeforeTime:v[8],animationOneshotTimer:v[9],
      canNotAttackTime:v[14],reAttackZ1Time:v[15],reAttackZ1Right:!!v[16],mp:v[17],
      effectSetCalls:v[18],magicFailCalls:v[19],disabledCameraCalls:v[20],sourceDashJumpEffectHandle:v[21],damageCommands,particleCommands,
      unsupportedManualDamageCalls:e.recovery_manual_damage_calls?.()??0,
      boundaryCalls:{future:v[10],event:v[11],start:v[12],down:v[13]}};
  }
  return Object.freeze({ruleVersion:NATIVE_COMMAND_RULE,contract:nativeCommandContract,recoverySourceMarker:e.recovery_source_marker?.()??0,
    supportsXxxFrameMove:typeof e.set_recovery_hand_position==='function'&&typeof e.recovery_xxx_particle_mask==='function',
    handlesFuture:a=>futures.has(ids.get(a.state)),handlesEvent:a=>events.has(ids.get(a.state)),
    runFuture:(a,input,profile,elapsed)=>run(0,a,input,profile,elapsed),
    runEvent:(a,input,profile,options)=>run(1,a,input,profile,0,options),runStart:(a,profile)=>run(2,a,{},profile),
    runNow:(a,profile)=>run(3,a,{},profile),runEnd:(a,profile)=>run(4,a,{},profile),
    // Deliberately unbound: hardcoded V5 landing windows differ from target2016.
    probeLandingEvent:(a,input,profile,options)=>run(1,a,input,profile,0,options)});
}

/** Prefer the separately pinned reconstruction only for its selected bindings.
 * The old source module/probes keep their original byte and behavior evidence.
 */
export async function createNativeCommandsRecovery({base,bytes,module}={}){
  if(!base?.runEvent||!base?.runNow)throw new TypeError('Baseline command runtime required');
  const recovered=await createNativeCommands({bytes,module});
  if(recovered.recoverySourceMarker!==11)throw new TypeError('Pinned recovery command module required');
  const eventStates=new Set(['RSI_COMBO_XX','RSI_OVER_TAKER_COMBO_XXfrontX','RSI_OVER_TAKER_COMBO_XXfrontXX',
    'RSI_OVER_TAKER_COMBO_XXfrontXX2','RSI_OVER_TAKER_COMBO_XXfrontXX3','RSI_OVER_TAKER_COMBO_XXfrontXX4',
    'RSI_OVER_TAKER_COMBO_XXfrontXXdownX','RSI_OVER_TAKER_COMBO_XXdownX']);
  const nowStates=new Set(['RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX','RSI_OVER_TAKER_COMBO_XXdownX',
    ...(recovered.supportsXxxFrameMove?['RSI_COMBO_XXX']:[])]);
  return Object.freeze({...base,ruleVersion:'rf-source-recovery-v11',
    recoveryContract:Object.freeze({sourceCommit:'a1bcdabf39ee1699873b587b40cedefcce61c7f0',
      sourceSha256:'b6c8db97bea7d086a430ca069f4c047c9fb0290dc6f659906ba871e685c4e641',
      evidenceClass:'2026-reconstructed-2015-reference-not2016',targetClientMeasured:false}),
    handlesEvent:a=>eventStates.has(a.state)||base.handlesEvent(a),
    runEvent:(a,input,profile,options)=>(eventStates.has(a.state)?recovered:base).runEvent(a,input,profile,options),
    runNow:(a,profile)=>(nowStates.has(a.state)?recovered:base).runNow(a,profile)});
}
