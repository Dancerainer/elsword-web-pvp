/** Independent pinned source and literal callback cases; no target-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createNativeCommands,createNativeCommandsRecovery} from '../../packages/native-source/commands.mjs';
const path=p=>new URL('../../'+p,import.meta.url),read=p=>JSON.parse(readFileSync(path(p)));
const profile=read('packages/combat-core/rf-profile.json'),contract=read('contracts/rf-combo-recovery-source-v11.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const base=await createNativeCommands({bytes:readFileSync(path('artifacts/native/commands.wasm'))});
const native=await createNativeCommandsRecovery({base,bytes:readFileSync(path('artifacts/native/commands-recovery.wasm'))});
function actor(state,time,extra={}){return {state,animationTime:time,animationBeforeTime:time,animationOneshotTimer:0,
  x:100,y:200,z:300,facing:1,grounded:true,vx:0,vy:0,stats:{moveSpeedMultiplier:1},passiveSpeed:{x:-1,y:-1},
  sourceCommandFlags:0,landPosition:[100,200,300],...extra};}
function event(a,input={}){const r=native.runEvent(a,input,profile);a.sourceCommandFlags=r.flags;return r;}

const recoverySource='.cache/reference-combat-fixes-v11/X2GURaven.cpp',
  composedSource='artifacts/native/commands-recovery/commands-recovery.generated.cpp';
function sourceBodies(){
  const b=readFileSync(path('.cache/reference-combat-fixes-v11/X2GURaven.cpp'));
  assert.equal(sha(b),contract.sourceSha256);assert.equal(b.length,contract.sourceBytes);
  const lines=b.toString('latin1').match(/[^\n]*\n|[^\n]+$/g);
  return contract.functions.map(f=>{
    const body=Buffer.from(lines.slice(f.startLine-1,f.endLine).join('').replace(/[\r\n]+$/,''),'latin1');
    assert.equal(sha(body),f.sha256,f.name);
    return {name:f.name,body};
  });
}
test('recovery WASM bytes retain their independent contract and unmeasured-client boundary',()=>{
  const wasm=readFileSync(path('artifacts/native/commands-recovery.wasm'));
  assert.equal(sha(wasm),contract.wasm.sha256);assert.equal(wasm.length,contract.wasm.bytes);
  assert.equal(native.recoveryContract.targetClientMeasured,false);
});
test('repaired Raven source and selected function bodies match their retained hashes',{
  skip:existsSync(path(recoverySource))?false:'Repaired Raven source unavailable: '+recoverySource,
},()=>{sourceBodies();});
test('composed recovery source retains its independently sealed canonical bytes',{
  skip:existsSync(path(composedSource))?false:'Historical composed source unavailable: '+composedSource,
},()=>{
  assert.equal(sha(readFileSync(path(composedSource))),contract.generatedCppCanonicalSha256);
});
const missingCompositionInputs=[recoverySource,composedSource].filter(file=>!existsSync(path(file)));
test('composed recovery source preserves every selected repaired function body',{
  skip:missingCompositionInputs.length?'Original composition inputs unavailable: '+missingCompositionInputs.join(', '):false,
},()=>{
  const compiled=readFileSync(path(composedSource),'latin1');
  for(const {name,body}of sourceBodies()){
    // The composed unit is canonicalized to LF-only so its hash cannot depend on
    // checkout eol settings. Each pinned body must therefore appear unchanged
    // apart from that documented CRLF->LF normalization; no other byte may move.
    const normalized=body.toString('latin1').replace(/\r\n/g,'\n');
    assert.ok(compiled.includes(body.toString('latin1'))||compiled.includes(normalized),
      name+' must be copied unchanged modulo the recorded line-ending rule');
  }
});

test('wrapper rejects baseline bytes under recovery identity and preserves unrelated callbacks',async()=>{
  await assert.rejects(createNativeCommandsRecovery({base,bytes:readFileSync(path('artifacts/native/commands.wasm'))}),/Pinned recovery/);
  const a=actor('RSI_JUMP_COMBO_X',.2,{grounded:false,y:500,landPosition:[100,0,300]});
  assert.deepEqual(native.runEvent(a,{},profile),base.runEvent(a,{},profile));
});

test('XX third X uses reference forward/down mapping on both facings with original .55 strict fire',()=>{
  for(const facing of [-1,1])for(const [held,next] of [
    [[facing===1?'RIGHT':'LEFT'],'RSI_OVER_TAKER_COMBO_XXfrontX'],[['DOWN'],'RSI_OVER_TAKER_COMBO_XXdownX'],[[],'RSI_COMBO_XXX']]){
    const a=actor('RSI_COMBO_XX',.3,{facing});
    assert.equal(event(a,{pressed:['X'],held}).flags,1);a.animationTime=.55;
    assert.equal(event(a,{held}).state,null);a.animationTime=.551;
    assert.equal(event(a,{held}).state,next);assert.equal(a.sourceCommandFlags,0);
  }
  const a=actor('RSI_COMBO_XX',.551);assert.equal(event(a,{pressed:['X'],held:['RIGHT']}).flags,0);
});

test('third-X latch requires forward held, preserves target .2/.66/.56 window, then auto finishes',()=>{
  for(const facing of [-1,1]){
    const key=facing===1?'RIGHT':'LEFT';
    for(const [t,held,armed] of [[.199,[key],false],[.2,[key],true],[.659,[key],true],[.66,[key],false],[.3,[],false]]){
      const a=actor('RSI_OVER_TAKER_COMBO_XXfrontX',t,{facing});
      const r=event(a,{pressed:['X'],held});assert.equal(r.flags===1,armed,`${t} ${held}`);
    }
    const a=actor('RSI_OVER_TAKER_COMBO_XXfrontX',.3,{facing});event(a,{pressed:['X'],held:[key]});
    a.animationTime=.56;assert.equal(event(a).state,null);
    a.animationTime=.561;assert.equal(event(a).state,'RSI_OVER_TAKER_COMBO_XXfrontXX');
    assert.equal(event(actor('RSI_OVER_TAKER_COMBO_XXfrontX',.561)).state,'RSI_OVER_TAKER_COMBO_XXfrontXX4');
  }
});

test('fourth/fifth-X preserve distinct Down and plain X latches and priority',()=>{
  for(const [state,plain] of [['RSI_OVER_TAKER_COMBO_XXfrontXX','RSI_OVER_TAKER_COMBO_XXfrontXX2'],
    ['RSI_OVER_TAKER_COMBO_XXfrontXX2','RSI_OVER_TAKER_COMBO_XXfrontXX3']]){
    for(const [held,flag,next] of [[['DOWN'],1,'RSI_OVER_TAKER_COMBO_XXfrontXXdownX'],[[],2,plain]]){
      const a=actor(state,.2);assert.equal(event(a,{pressed:['X'],held}).flags,flag);
      a.animationTime=.6;assert.equal(event(a).state,null);a.animationTime=.601;assert.equal(event(a).state,next);
    }
    assert.equal(event(actor(state,.7),{pressed:['X'],held:['DOWN']}).flags,0);
    assert.equal(event(actor(state,.601)).state,'RSI_OVER_TAKER_COMBO_XXfrontXX4');
    assert.equal(event(actor(state,.601,{sourceCommandFlags:3})).state,'RSI_OVER_TAKER_COMBO_XXfrontXXdownX');
  }
});

test('sixth X permits only down branch; finisher/down launcher are terminal and air loss subtracts radius1.5',()=>{
  const a=actor('RSI_OVER_TAKER_COMBO_XXfrontXX3',.3);assert.equal(event(a,{pressed:['X']}).flags,0);
  assert.equal(event(a,{pressed:['X'],held:['DOWN']}).flags,1);a.animationTime=.801;
  assert.equal(event(a).state,'RSI_OVER_TAKER_COMBO_XXfrontXXdownX');
  assert.equal(event(actor('RSI_OVER_TAKER_COMBO_XXfrontXX3',.801)).state,'RSI_OVER_TAKER_COMBO_XXfrontXX4');
  for(const state of ['RSI_OVER_TAKER_COMBO_XXfrontXX4','RSI_OVER_TAKER_COMBO_XXfrontXXdownX']){
    assert.equal(event(actor(state,.3),{pressed:['X'],held:['RIGHT','DOWN']}).state,null);
    assert.equal(event(actor(state,profile.states[state].clip.durationSeconds,{animationStopped:true})).state,'RSI_WAIT');
  }
  for(const state of ['RSI_OVER_TAKER_COMBO_XXfrontX','RSI_OVER_TAKER_COMBO_XXfrontXX','RSI_OVER_TAKER_COMBO_XXfrontXX2',
    'RSI_OVER_TAKER_COMBO_XXfrontXX3','RSI_OVER_TAKER_COMBO_XXfrontXX4','RSI_OVER_TAKER_COMBO_XXfrontXXdownX']){
    const r=event(actor(state,.3,{grounded:false}));assert.equal(r.state,'RSI_JUMP_DOWN');assert.equal(r.y,155);
  }
});

test('ZXX Now is a source .31 one-shot spawning 60 units along saved line direction on both facings',()=>{
  for(const facing of [-1,1]){
    const a=actor('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',.3,{facing,sourceCommandDirection:[.6,.8,0],animationBeforeTime:.29,animationOneshotTimer:.29});
    assert.deepEqual(native.runNow(a,profile).damageCommands,[]);
    a.animationTime=.31;a.animationBeforeTime=.3;
    const r=native.runNow(a,profile);assert.equal(r.damageCommands.length,1);assert.equal(r.damageCommands[0].count,1);
    assert.deepEqual(r.damageCommands[0].position,[100+facing*36,200+facing*48,300]);
    a.animationOneshotTimer=.31;a.animationBeforeTime=.31;a.animationTime=.4;
    assert.deepEqual(native.runNow(a,profile).damageCommands,[]);
  }
});
