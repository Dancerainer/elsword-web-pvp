import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const contract=read('contracts/rf-command-reactions-source-v9.json'),profile=read('packages/combat-core/rf-profile.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const rootPath=p=>new URL('../../'+p,import.meta.url);
const map={sceneId:'source-hit-unit-v9',lines:[{lineId:0,start:[-6000,0,0],end:[6000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const make=(extra={})=>createSimulation({profile,map,preset:{passives:[],guildPassives:[],attributes:{hpMax:800000}},
  actors:[{id:'rf',team:0,x:0,y:0},{id:'target',team:1,x:150,y:0,facing:-1}],...extra});
const broadCollision=()=>[{kind:'sphere',center:[150,75,0],radius:200}];
const serialized=s=>JSON.parse(JSON.stringify(s.snapshot()));
const sourcePaths=contract.sourceFiles.map(f=>rootPath('.cache/native-reference/'+f.relativePath));
test('fixed source file/blob bytes and independent control-flow excerpts are verified',()=>{
  for(const [i,f] of contract.sourceFiles.entries()){
    assert.ok(existsSync(sourcePaths[i]),f.relativePath+' cache must be prepared');
    const b=readFileSync(sourcePaths[i]);assert.equal(sha(b),f.sha256);assert.equal(b.length,f.bytes);
    assert.equal(createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'),f.gitBlob);
  }
  for(const section of contract.sourceSections){
    const text=readFileSync(rootPath('.cache/native-reference/'+section.relativePath)).toString('latin1');
    const lines=text.match(/[^\n]*\n|[^\n]+$/g);
    const b=Buffer.from(lines.slice(section.lineStart-1,section.lineEnd).join(''),'latin1');assert.equal(sha(b),section.sha256,section.name);
    for(const marker of section.markers)assert.ok(b.includes(Buffer.from(marker,'ascii')),section.name+': '+marker);
  }
  const always=readFileSync(rootPath('.cache/native-reference/KTDXLIB/Always.h')).toString('latin1');
  assert.match(always,/^\s*#define\s+BALANCE_BLADE_MASTER_20130117\b/m);
  assert.match(always,/^\s*#define\s+GROUND_HIT\b/m);
  assert.match(always,/^\s*#define\s+FIX_FORCE_DOWN_INITIALIZE_BUG\b/m);
  assert.doesNotMatch(always,/^\s*#define\s+BOUNDING_COMBO_TEST\b/m);
});
test('runtime profile retains independent target declarations and original clip key hashes',()=>{
  for(const e of contract.targetStates){
    const actual=profile.states[e.state];assert.deepEqual(actual.sourcePc,e.sourcePc,e.state);
    for(const [key,value] of Object.entries(e.fields))assert.deepEqual(actual.raw[key],value,e.state+':'+key);
    const clip=contract.animationSources.find(c=>c.name===actual.raw.ANIM_NAME);assert.ok(clip,e.state);
    assert.equal(actual.clip.decodedKeysSha256,clip.decodedKeysSha256);assert.equal(actual.clip.durationSeconds,clip.durationSeconds);
  }
  for(const effect of contract.targetEffects)assert.deepEqual(profile.damageEffects[effect.name],{raw:effect.raw,sourcePc:effect.sourcePc});
});
test('all inspected direct windows preserve source strict start/end and never hit after crossing an entire window',()=>{
  for(const [state,start,end] of [['RSI_DASH_COMBO_X',.27,.4],['RSI_DASH_COMBO_X',.65,.81],['RSI_JUMP_COMBO_X',.17,.23],['RRF_DASH_JUMP_COMBO_XX_LANDING',.01,.04]]){
    for(const [before,after,expected] of [[start-.01,start,0],[end-.01,end,0],[start-.01,end+.01,0],[start,(start+end)/2,1]]){
      const s=make(),a=s.actor('rf');s.enter(a,state,'source-window-fixture');s.drainEvents();a.animationTime=after;
      s.checkCharacterAttack(a,before,after);assert.equal(s.drainEvents().filter(e=>e.type==='attackWindow').length,expected,`${state} ${before}->${after}`);
    }
  }
});
test('66X SimpleInit clears its shared target history once at .63 even in the gap; exactly two source stages hit',()=>{
  const s=make({collisionSampler:broadCollision}),a=s.actor('rf');s.enter(a,'RSI_DASH_COMBO_X','source-stage-fixture');s.drainEvents();
  a.animationTime=.3;s.checkCharacterAttack(a,.28,.3);assert.equal(s.actor('target').hp,798480);
  a.animationTime=.35;s.checkCharacterAttack(a,.3,.35);assert.equal(s.actor('target').hp,798480);
  a.animationTime=.63;s.checkCharacterAttack(a,.62,.63);assert.deepEqual(a.hits,{});
  a.animationTime=.64;s.checkCharacterAttack(a,.63,.64);assert.deepEqual(a.hits,{});
  a.animationTime=.66;s.checkCharacterAttack(a,.64,.66);assert.equal(s.actor('target').hp,797480);
  a.animationTime=.7;s.checkCharacterAttack(a,.66,.7);assert.equal(s.actor('target').hp,797480);
  const events=s.drainEvents(),hits=events.filter(e=>e.type==='hit');assert.equal(hits.length,2);
  assert.deepEqual(hits.map(e=>[e.data.DAMAGE.PHYSIC,e.data.BACK_SPEED_X]),[[1.52,0],[1,profile.physics.RUN_SPEED*1.4]]);
  assert.equal(events.filter(e=>e.type==='characterDamageDataChanged').length,1);
});
test('66X has one second-stage hit when its first punch misses, and a fresh state starts a new first-stage history',()=>{
  let collide=false;const s=make({collisionSampler:()=>collide?broadCollision():[]}),a=s.actor('rf');
  s.enter(a,'RSI_DASH_COMBO_X','source-stage-fixture');s.drainEvents();a.animationTime=.3;s.checkCharacterAttack(a,.28,.3);
  a.animationTime=.64;s.checkCharacterAttack(a,.62,.64);collide=true;
  a.animationTime=.7;s.checkCharacterAttack(a,.64,.7);s.checkCharacterAttack(a,.7,.7);assert.equal(s.actor('target').hp,799000);
  s.enter(a,'RSI_DASH_COMBO_X','new-command-fixture');a.animationTime=.3;s.checkCharacterAttack(a,.28,.3);
  assert.equal(s.actor('target').hp,797480);assert.equal(a.fired.includes('dash-x-damage-data-next'),false);
});
test('66X source stage latch survives complete JSON restoration before and after its timer',()=>{
  for(const restoredAfterStage of [false,true]){
    const s=make({collisionSampler:broadCollision}),restored=make({collisionSampler:broadCollision}),a=s.actor('rf');
    s.enter(a,'RSI_DASH_COMBO_X','source-stage-fixture');a.animationTime=.3;s.checkCharacterAttack(a,.28,.3);
    a.animationTime=restoredAfterStage?.635:.625;
    if(restoredAfterStage)s.checkCharacterAttack(a,.625,.635);
    s.drainEvents();restored.restore(serialized(s));
    let stageChanges=0;
    for(let i=0;i<120;i++){
      s.step(1/120);restored.step(1/120);assert.deepEqual(serialized(s),serialized(restored));
      const originalEvents=s.drainEvents(),restoredEvents=restored.drainEvents();assert.deepEqual(originalEvents,restoredEvents);
      stageChanges+=originalEvents.filter(e=>e.type==='characterDamageDataChanged').length;
    }
    assert.equal(s.actor('target').hp,797480);assert.equal(stageChanges,restoredAfterStage?0:1);
  }
});

const pose=read('artifacts/rf/runtime-pose.json'),effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),read('artifacts/rf/fx/index.json'));
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/rf/'+p)]));
async function nativeMake(distance=150,facing=1){
  return make({nativeGeometry:await createNativeGeometry({bytes:readFileSync(rootPath('artifacts/native/geometry.wasm')),map}),
    nativeCommands:await createNativeCommands({bytes:readFileSync(rootPath('artifacts/native/commands.wasm'))}),
    ...createNativeSamplers({characterPose:pose,effectIndex,effectPoses,profile}),
    actors:[{id:'rf',team:0,x:0,y:0,facing,attributes:{animationSpeedMultiplier:1.3,moveSpeedMultiplier:1.3,jumpSpeedMultiplier:1.21}},
      {id:'target',team:1,x:distance*facing,y:0,facing:-facing}]});
}
test('original helper/bone poses produce both 66X hits at near/far starts and mirrored facing',async()=>{
  for(const distance of [80,300])for(const facing of [1,-1]){
    const s=await nativeMake(distance,facing);s.enter(s.actor('rf'),'RSI_DASH_COMBO_X','source-command-fixture');s.drainEvents();
    for(let i=0;i<120;i++)s.step(1/120,{}, {snapshot:false});
    const hits=s.drainEvents().filter(e=>e.type==='hit');assert.deepEqual(hits.map(e=>e.data.DAMAGE.PHYSIC),[1.52,1]);
    assert.equal(s.actor('target').hp,797480);assert.equal(hits.every(e=>e.data.REACT_TYPE===2),true);
  }
});
test('target UP then air X DOWN and low-Z pickup retain distinct source reactions, with no forced FLY or ground snap',async()=>{
  const s=await nativeMake(),a=s.actor('rf'),b=s.actor('target');
  s.applyHit(a,b,profile.states.RSI_COMBO_ZZXX.raw.DAMAGE_DATA,{kind:'character'});
  assert.equal(b.state,'RSI_DAMAGE_AIR_UP');assert.equal(b.vy,1800);assert.equal(b.flyCount,0);
  b.y=25;b.grounded=false;b.lineId=null;b.vy=-40;b.invincible=false;
  s.applyHit(a,b,profile.states.RSI_JUMP_COMBO_X.raw.DAMAGE_DATA,{kind:'character'});
  assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN');assert.equal(b.vy,0);assert.equal(b.y,25);assert.equal(b.grounded,false);
  s.applyHit(a,b,profile.damageEffects.DamageEffect_RF_COMBO_Z.raw.DAMAGE_DATA,{kind:'effect',attackPosition:[a.x,0,a.z]});
  assert.equal(b.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(b.y,25);assert.equal(b.grounded,false);assert.equal(b.vy,0);
  assert.equal(s.drainEvents().some(e=>e.type==='stateChanged'&&e.state?.includes('AIR_FLY')),false);
});
test('high-air and threshold cases preserve source height branches instead of guaranteeing every Z can pick up',async()=>{
  const s=await nativeMake(),a=s.actor('rf'),b=s.actor('target');b.y=500;b.grounded=false;b.lineId=null;
  s.applyHit(a,b,profile.states.RSI_JUMP_COMBO_X.raw.DAMAGE_DATA,{kind:'character'});assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN');
  s.applyHit(a,b,profile.damageEffects.DamageEffect_RF_COMBO_Z.raw.DAMAGE_DATA,{kind:'effect'});
  assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(b.vy,700);
  b.knockdown.now=100;
  s.applyHit(a,b,{DAMAGE:{PHYSIC:.01},REACT_TYPE:1},{kind:'character'});
  assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');assert.equal(b.vy,0);
});
