/** Literal source schedules and real shipped poses. Never target-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeCommandsRecovery} from '../../packages/native-source/commands.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
const path=f=>new URL('../../'+f,import.meta.url),read=f=>JSON.parse(readFileSync(path(f)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const contract=read('contracts/rf-xx2x-source-v12.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx'].map(f=>read('artifacts/rf/'+f+'/index.json')));
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const poses=Object.fromEntries(collectEffectPoseFiles(index,visual).map(f=>[f,read('artifacts/rf/'+f)]));
const runtime=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:f=>readFileSync(path('artifacts/native/'+f))});
const native=await createNativeCommandsRecovery({base:runtime.commands,bytes:readFileSync(path('artifacts/native/commands-recovery.wasm'))});
const direct='RSI_OVER_TAKER_COMBO_XXdownX',derived='RSI_OVER_TAKER_COMBO_XXfrontXXdownX';
const diagnostics=[];
test.after(()=>{if(process.env.XX2X_DIAGNOSTICS)writeFileSync(path('reports/rf-xx2x-current-trajectories-v12.json'),
  JSON.stringify({evidenceClass:'current-host diagnostic; independent literal source expectations remain in tests',
    targetClientMeasured:false,targetGoldenTraces:0,trajectories:diagnostics},null,2)+'\n');});
function actor(state,time,extra={}){return {state,animationTime:time,animationBeforeTime:time-.01,animationOneshotTimer:time-.01,
  x:100,y:200,z:300,facing:1,grounded:true,vx:0,vy:0,mp:100,stats:{moveSpeedMultiplier:1},passiveSpeed:{x:-1,y:-1},
  sourceCommandFlags:0,landPosition:[100,200,300],...extra};}
function make({facing=1,gap=150,position=[-1000,3080,0],lineId=2}={}){
  return createSimulation({profile,map,preset,seed:2016,
    actors:[{id:'rf',team:0,position,lineId,facing,passives:[]},
      {id:'target',team:1,position:[position[0]+facing*gap,position[1],position[2]],lineId,facing:-facing,passives:[]}],
    ...createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:runtime.geometry,nativeCommands:native,nativeSkills:runtime.skills,nativeSkillValues:runtime.skillValues,versions:runtime.versions});
}
const step=(s,input={})=>s.step(1/60,input,{snapshot:false});
const advance=(s,n,input={})=>{for(let i=0;i<n;i++)step(s,input);};
function wait(s,fn,input={},label='expected state'){
  for(let i=0;i<180&&!fn();i++)step(s,input);assert.ok(fn(),label);
}
function enterXX(s,held=[]){
  const a=s.actor('rf');step(s,{pressed:['X'],held});advance(s,10,{held});step(s,{pressed:['X'],held});
  wait(s,()=>a.state==='RSI_COMBO_XX',{held},'second X');
}
function enterDown(s){const a=s.actor('rf');enterXX(s);advance(s,10);step(s,{pressed:['X'],held:['DOWN']});
  wait(s,()=>a.state===direct,{held:['DOWN']},'XX2X');}

test('original .3 front-punch particle is indexed/prewarmed and emitted; land consumer gap remains explicit',()=>{
  const fx=read('artifacts/rf/xx2x-fx/index.json'),name='Raven_attackX3Front_Particle01';
  assert.deepEqual(profile.effectTemplates[name],fx.templates[name]);
  assert.ok(collectEffectTemplates(profile,fx,[]).has(name));
  const s=make({facing:1,gap:0}),a=s.actor('rf');enterDown(s);advance(s,90);
  const events=s.drainEvents(),command=events.filter(e=>e.type==='originalRecoveredParticle'&&e.name===name);
  assert.equal(command.length,1);assert.equal(command[0].supported,true);
  const visual=events.filter(e=>e.type==='effectStarted'&&e.name===name);
  assert.equal(visual.length,1);assert.deepEqual(visual[0].birthAnchor.position,command[0].position);
  assert.equal(events.filter(e=>e.type==='unsupported'&&String(e.id).includes('native-command-particle')).length,0);
  const notes=[],births=[],display=createEffectRuntime({index:fx,nativeRandom:runtime.effectRandom,
    onBirth:p=>births.push(p.name),onUnsupported:e=>notes.push(e)});
  display.add(name,{position:command[0].position,facing:a.facing});
  let maximum=0;
  for(let i=0;i<90;i++){display.step(1/60);maximum=Math.max(maximum,display.count);
    for(const p of display.particles.values())assert.equal(p.values.Texture,'ColorBallGray.dds');}
  assert.ok(maximum>0&&maximum<=10);assert.ok(births.length>0);assert.equal(display.count,0);
  assert.ok(notes.some(n=>n.id===name+':land'),'source UseLand clamp/bounce remains an explicitly unsupported consumer');
});

test('XX2X target source is four UP_SPINE children with independent target values and no direct melee box',()=>{
  assert.equal(contract.targetClientMeasured,false);assert.equal(contract.targetGoldenTraces,0);
  assert.deepEqual(profile.states[direct].raw,contract.targetStates[direct].raw);
  assert.deepEqual(profile.states[derived].raw,contract.targetStates[derived].raw);
  const parent=profile.damageEffects.DamageEffect_RSI_OVER_TAKER_XX_DOWN_X.raw;
  assert.deepEqual(parent,contract.targetDamageEffects.DamageEffect_RSI_OVER_TAKER_XX_DOWN_X.raw);
  assert.deepEqual([0,1,2,3].map(i=>parent['CREATE_DAMAGE_EFFECT'+i].EVENT_TIME),[.01,.11,.21,.31]);
  assert.ok([0,1,2,3].every(i=>parent['CREATE_DAMAGE_EFFECT'+i].DAMAGE_EFFECT_NAME==='DamageEffect_RSI_OVER_TAKER_UP_SPINE'));
  assert.equal(parent.DAMAGE_DATA.NO_DAMAGE,1);assert.equal(parent.FOLLOW_LINE_NEW,1);assert.equal(parent.FOLLOW_ON_LINE,1);
  const child=profile.damageEffects.DamageEffect_RSI_OVER_TAKER_UP_SPINE.raw;
  assert.deepEqual(child,contract.targetDamageEffects.DamageEffect_RSI_OVER_TAKER_UP_SPINE.raw);
  assert.equal(child.DAMAGE_DATA.DAMAGE.MAGIC,2.22);assert.equal(child.DAMAGE_DATA.FORCE_DOWN,3.13);
  assert.equal(child.DAMAGE_DATA.HIT_ADD_MP,4.38);assert.equal(child.ATTACK_TIME_END,.1);assert.equal(child.USE_GLOBAL_TIME,1);
  assert.equal(profile.states[direct].raw.DAMAGE_DATA,undefined);assert.equal(profile.states[direct].raw.EFFECT_SET_LIST,undefined);
});

test('newly compiled XX2X callback emits source .3 particle, .3666 MP4 parent at GetPos, .4333 camera only once',()=>{
  for(const facing of [-1,1]){
    const a=actor(direct,.3,{facing,sourceCommandDirection:[.6,.8,0],animationBeforeTime:.29,animationOneshotTimer:.29});
    let r=native.runNow(a,profile);assert.equal(r.handled,true);assert.deepEqual(r.damageCommands,[]);
    assert.equal(r.particleCommands.length,1);assert.deepEqual(r.particleCommands[0].position,[100+facing*9,200+facing*12,300]);
    a.animationTime=.3666;a.animationBeforeTime=.36;a.animationOneshotTimer=.36;r=native.runNow(a,profile);
    assert.equal(r.mp,96);assert.equal(r.damageCommands.length,1);assert.equal(r.damageCommands[0].name,'DamageEffect_RSI_OVER_TAKER_XX_DOWN_X');
    assert.deepEqual(r.damageCommands[0].position,[100,200,300]);assert.equal(r.damageCommands[0].count,1);
    a.mp=r.mp;a.animationTime=.4;a.animationBeforeTime=.3666;a.animationOneshotTimer=.3666;
    assert.deepEqual(native.runNow(a,profile).damageCommands,[]);
    a.animationTime=.4333;a.animationBeforeTime=.43;a.animationOneshotTimer=.43;r=native.runNow(a,profile);
    assert.equal(r.disabledCameraCalls,1);assert.equal(r.mp,96);assert.deepEqual(r.damageCommands,[]);
    a.animationTime=.5;a.animationBeforeTime=.4333;a.animationOneshotTimer=.4333;
    assert.equal(native.runNow(a,profile).disabledCameraCalls,0);
  }
});

test('XX2X missing MP keeps source magic fail and coarse callback preserves if/else-if priority',()=>{
  for(const mp of [0,3.999]){const r=native.runNow(actor(direct,.37,{mp,animationBeforeTime:.36,animationOneshotTimer:.36}),profile);
    assert.deepEqual(r.damageCommands,[]);assert.equal(r.magicFailCalls,1);assert.equal(r.mp,Math.fround(mp));}
  assert.equal(native.runNow(actor(direct,.37,{mp:4,animationBeforeTime:.36,animationOneshotTimer:.36}),profile).mp,0);
  const r=native.runNow(actor(direct,.8,{animationBeforeTime:0,animationOneshotTimer:0}),profile);
  assert.equal(r.particleCommands.length,1);assert.deepEqual(r.damageCommands,[]);assert.equal(r.mp,100);
  assert.equal(r.disabledCameraCalls,0,'source else-if does not synthesize skipped callbacks');
});

test('direct XX2X state ends by source animation end/air loss; derived does not bind the direct MP4 callback',()=>{
  assert.equal(native.handlesEvent(actor(direct,.2)),true);
  const loss=native.runEvent(actor(direct,.2,{grounded:false}),{},profile);
  assert.equal(loss.state,'RSI_JUMP_DOWN');assert.equal(loss.y,155);
  assert.equal(native.runEvent(actor(direct,2,{animationStopped:true}),{},profile).state,'RSI_WAIT');
  const a=actor(derived,.37,{mp:100,animationBeforeTime:.36,animationOneshotTimer:.36});
  assert.equal(native.runNow(a,profile).handled,false);assert.equal(native.runNow(a,profile).mp,100);
  assert.deepEqual(native.runNow(a,profile).damageCommands,[]);
});

for(const facing of [-1,1])for(const gap of [0,150,350])test(`real XX2X facing${facing} gap${gap} emits four real-mesh children and retires`,()=>{
  const s=make({facing,gap,position:[-facing*1000,3080,0]}),a=s.actor('rf');enterDown(s);
  assert.equal(a.animationName,'OT_ComboX3Front_New');advance(s,180);
  const events=s.drainEvents(),calls=events.filter(e=>e.type==='originalRecoveredCommand'&&e.name==='DamageEffect_RSI_OVER_TAKER_XX_DOWN_X');
  assert.equal(calls.length,1);const parent=calls[0];
  const children=events.filter(e=>e.type==='damageChildCreated'&&e.parentEffectId===parent.effectId);
  assert.deepEqual(children.map(e=>e.eventTime),[.01,.11,.21,.31]);
  assert.ok(children.every(e=>e.name==='DamageEffect_RSI_OVER_TAKER_UP_SPINE'));
  for(const child of children){
    const distance=(child.position[0]-parent.position[0])*facing;
    assert.ok(distance>=1000*child.eventTime-1e-5&&distance<=1000*(child.eventTime+1/60)+1e-5);
    assert.equal(child.position[1],3080);assert.equal(child.position[2],0);
  }
  assert.equal(events.filter(e=>e.type==='hit'&&e.origin?.id===parent.effectId).length,0);
  const ids=new Set(children.map(e=>e.effectId)),hits=events.filter(e=>e.type==='hit'&&ids.has(e.origin?.id));
  assert.ok(hits.length>0,'actual UP_SPINE helper intersects the actual target helper');
  assert.ok(hits.every(e=>e.data.DAMAGE.MAGIC===2.22));
  assert.ok(hits.every(hit=>hit.time-children.find(child=>child.effectId===hit.origin.id).time<=.1+1/60+1e-8),
    'target USE_GLOBAL_TIME attack window ends at .1, independently of the mesh duration');
  diagnostics.push({kind:'direct-real-input',facing,gap,parent,children,hits,final:{x:a.x,y:a.y,state:a.state,mp:a.mp,
    targetHP:s.actor('target').hp,targetState:s.actor('target').state}});
  assert.equal(s.state.effects.filter(e=>e.damage).length,0);assert.equal(a.state,'RSI_WAIT');
});

for(const facing of [-1,1])test(`derived XX6X2X facing${facing} keeps one raw EffectSet parent with .3/110 anchor and no MP4 duplicate`,()=>{
  const s=make({facing,gap:2200,position:[-facing*1000,3080,0]}),a=s.actor('rf'),held=[facing===1?'RIGHT':'LEFT'];
  enterXX(s,held);advance(s,10,{held});step(s,{pressed:['X'],held});
  wait(s,()=>a.state==='RSI_OVER_TAKER_COMBO_XXfrontX',{held});
  wait(s,()=>a.animationTime>=.2,{held});step(s,{pressed:['X'],held});
  wait(s,()=>a.state==='RSI_OVER_TAKER_COMBO_XXfrontXX',{held});
  wait(s,()=>a.animationTime>=.2,{held});step(s,{pressed:['X'],held:['DOWN']});
  wait(s,()=>a.state===derived,{held:['DOWN']});const mp=a.mp;advance(s,180);
  const events=s.drainEvents(),parents=events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_RSI_OVER_TAKER_XX_DOWN_X');
  assert.equal(parents.length,1);assert.equal(events.filter(e=>e.type==='originalRecoveredCommand'&&e.name==='DamageEffect_RSI_OVER_TAKER_XX_DOWN_X').length,0);
  assert.equal(parents[0].definition.POSITION_OFFSET_X,110);
  assert.deepEqual(parents[0].birthAnchor.position.slice(1),[3080,0]);
  assert.equal(a.mp,mp);const children=events.filter(e=>e.type==='damageChildCreated'&&e.parentEffectId===parents[0].effectId);
  assert.deepEqual(children.map(e=>e.eventTime),[.01,.11,.21,.31]);
  assert.ok(children.every(e=>e.name==='DamageEffect_RSI_OVER_TAKER_UP_SPINE'));
  diagnostics.push({kind:'derived-real-input',facing,parents,children,mpBefore:mp,mpAfter:a.mp});
});

for(const facing of [-1,1])for(const kind of ['wall','step-edge'])test(`real XX2X ${kind} facing${facing} remains finite on original collision map`,()=>{
  const position=kind==='wall'?[facing*2100,2840,0]:[facing*1560,3080,0];
  const lineId=kind==='wall'?(facing===1?6:0):2;
  const s=make({facing,gap:0,position,lineId}),a=s.actor('rf');enterDown(s);advance(s,180);
  const events=s.drainEvents(),calls=events.filter(e=>e.type==='originalRecoveredCommand'&&e.name==='DamageEffect_RSI_OVER_TAKER_XX_DOWN_X');
  assert.equal(calls.length,1);
  const children=events.filter(e=>e.type==='damageChildCreated'&&e.parentEffectId===calls[0].effectId);
  assert.deepEqual(children.map(e=>e.eventTime),[.01,.11,.21,.31]);
  assert.ok(children.every(child=>child.position.every(Number.isFinite)));
  assert.equal(s.state.effects.filter(e=>e.damage).length,0);
  // This regression protects lifecycle and real-input routing. Native full3D
  // edge/radius projection remains a gap; no current positions are client gold.
  diagnostics.push({kind,facing,parent:calls[0],children,final:{x:a.x,y:a.y,state:a.state}});
});
