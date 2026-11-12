/** Independent fixed-source assignments and actual 2016 data/skeleton path.
 * No test below is labelled a measured original-client input trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instantiateNativeNasod} from '../../packages/native-source/nasod.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {nasodSnapshot} from '../../packages/combat-core/nasod-guard.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url)),json=p=>JSON.parse(read(p));
const contract=json('contracts/rf-native-nasod-v11.json'),target=json('contracts/rf-nasod-target-v11.json');
const profile=json('packages/combat-core/rf-profile.json'),manifest=json('artifacts/native/manifest.json');
const index=json('contracts/rf-core-shield-fx-index-v11.json'),pose=json('artifacts/rf/runtime-pose.json');
const map={...json('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...json('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const digest=b=>createHash('sha256').update(b).digest('hex');
const base=Object.freeze({stateId:0,footOnLineNow:true,attackerFrontFuture:true,hyperRemaining:10,
  level:2,gauge:40,parrying:false,canParry:false,guardRemaining:0,attacking:false,superArmor:false,
  held:false,grappled:false,riding:false,elapsed:0,helperLive:true,right:true,random:1,damageFlags:0,extraType:0});
const native=await instantiateNativeNasod(read('artifacts/native/nasod.wasm'));
const evaluate=(kind,override={})=>native.evaluate(kind,{...base,...override});

test('compiled module and byte-preserved source blocks have pinned provenance',()=>{
  assert.equal(digest(read('artifacts/native/nasod.wasm')),contract.module.sha256);
  for(const source of contract.referenceFiles){const raw=read('.cache/native-source-runtime/'+source.relativePath);
    assert.equal(digest(raw),source.sha256);assert.equal(raw.length,source.bytes);}
  for(const block of contract.extractions){const raw=read('.cache/native-source-runtime/'+block.file),lines=raw.toString('latin1').split(/(?<=\n)/);
    const bytes=Buffer.from(lines.slice(block.lines[0]-1,block.lines[1]).join(''),'latin1');
    // Whole function extractor may exclude the final newline; fragments retain it.
    assert.ok(digest(bytes)===block.sha256||digest(bytes.subarray(0,bytes.length-(bytes.at(-2)===13?2:1)))===block.sha256);
  }
  assert.equal(contract.evidenceClass,'reference-V5-not2016');assert.equal(contract.targetClientMeasured,false);
});
test('literal target small parry/set/extra enums are separately retained',()=>{
  assert.equal(target.smallState.raw.ANIM_NAME,'GuardBigFront');assert.equal(target.smallState.raw.ANIM_SPEED,1.2);
  assert.deepEqual(target.smallState.raw.IMMUNITY_LIST_AT_THIS_STATE,{'1':25,'2':52,'3':77});
  assert.deepEqual(target.blockedExtraTypes,{EDT_MANA_DAMAGE:16,EDT_DAMAGE_RATE:26,EDT_WATER_HOLD:34,EDT_ATTACK_ALL_TEAM:47});
  assert.deepEqual(Object.values(target.effectSet.raw).filter(v=>typeof v==='object').map(v=>[v.NAME,v.EFFECT_TYPE,v.TRACE]),
    [['raven_bead_shield_01',8,1],['raven_bead_shield_02',8,1]]);
});
test('source outer gate rejects each explicit flag and permits nonexcluded extra types',()=>{
  assert.equal(evaluate('guard').guarded,true);
  for(const key of ['attacking','superArmor','held','grappled','riding'])assert.equal(evaluate('guard',{[key]:true}).guarded,false,key);
  for(const key of ['footOnLineNow','attackerFrontFuture'])assert.equal(evaluate('guard',{[key]:false}).guarded,false,key);
  for(const flag of [1,2,4,8,16,32])assert.equal(evaluate('guard',{damageFlags:flag}).guarded,false,'flag '+flag);
  for(const extraType of [1,2,3,4])assert.equal(evaluate('guard',{extraType}).guarded,false,'extra '+extraType);
  assert.equal(evaluate('guard',{hyperRemaining:0}).guarded,false);
  assert.equal(evaluate('guard',{level:0}).guarded,false);
  assert.equal(evaluate('guard',{level:0,canParry:true,parrying:true}).guarded,true);
});
test('complete original state interval and exactly three jump/combo exclusions execute',()=>{
  for(const stateId of [1,2,3,200,201,202,...Array.from({length:19},(_,i)=>100+i)])
    assert.equal(evaluate('guard',{stateId}).guarded,false,'state '+stateId);
  assert.equal(evaluate('guard',{stateId:99}).guarded,true);assert.equal(evaluate('guard',{stateId:119}).guarded,true);
  assert.equal(evaluate('guard',{stateId:105,parrying:true}).guarded,true);
});
test('original Start consumes one level and20 gauge, sets flags and exact helper assignments',()=>{
  const out=evaluate('start',{right:false,random:0});
  assert.equal(out.gauge,20);assert.equal(out.level,1);assert.equal(out.guardRemaining,.5);
  assert.equal(out.parrying,true);assert.equal(out.canParry,true);assert.equal(out.attacking,false);assert.equal(out.delayedAttack,false);
  assert.deepEqual(out.helper,{scale:Math.fround(1.3),guardAnimation:true,offset:[-100,170,0],
    outlineColor:[Math.fround(.968),Math.fround(.443),0,1]});
  assert.equal(out.smallCharacterAnimation,true);assert.equal(out.soundCalls,1);
  assert.equal(evaluate('start',{random:1}).smallCharacterAnimation,false);
});
test('absent helper cannot invent a DoParrying resource consumption',()=>{
  const out=evaluate('start',{helperLive:false,gauge:20,level:1});
  assert.equal(out.gauge,20);assert.equal(out.level,1);assert.equal(out.canParry,true);assert.equal(out.helper.guardAnimation,false);
});
test('strict negative timer clears flag; exact zero preserves the original flag',()=>{
  let out=evaluate('timer',{parrying:true,canParry:true,guardRemaining:.5,elapsed:.25});
  assert.equal(out.guardRemaining,.25);assert.equal(out.canParry,true);
  out=evaluate('timer',{parrying:true,canParry:true,guardRemaining:.25,elapsed:.25});
  assert.equal(out.guardRemaining,0);assert.equal(out.canParry,true);
  assert.equal(evaluate('timer',{canParry:true,guardRemaining:.25,elapsed:.251}).canParry,false);
  assert.equal(evaluate('timer',{canParry:true,guardRemaining:0,elapsed:.01}).canParry,true);
});
test('End clears parry flags and requests original restore; malformed ABI rejected',()=>{
  const out=evaluate('end',{parrying:true,canParry:true,guardRemaining:.3});
  assert.deepEqual([out.parrying,out.canParry,out.guardRemaining,out.restored],[false,false,0,true]);
  assert.throws(()=>evaluate('guard',{gauge:NaN}),/finite/);assert.throws(()=>evaluate('guard',{level:6}),/bounded/);
  assert.throws(()=>evaluate('start',{random:2147483647}),/bounded/);
  assert.throws(()=>native.evaluate('guard',{...base,footOnLineNow:1}),/boolean/);
});
async function make({facing=-1,orbs=0,startX=2022.98,startY=2840,gap=120,lineId=6}={}){
  const n=await createNativeRuntime({manifest,map,loadBinary:file=>read('artifacts/native/'+file)});
  const samplers=createNativeSamplers({profile,characterPose:pose,effectIndex:{templates:{}},effectPoses:{}});
  const s=createSimulation({profile,map,...samplers,nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeNasod:n.nasod,
    preset:{doubleTapWindowSeconds:.24,guildPassives:[]},seed:2016,versions:n.versions,
    actors:[{id:'rf',team:0,position:[startX,startY,0],lineId},
      {id:'target',team:1,position:[startX+gap,startY,0],lineId,facing,awakening:{orbs}}]});
  return {s,a:s.actor('rf'),b:s.actor('target'),n};
}
function ready(f){f.b.awakening.remaining=20;f.b.core.gauge=40;f.s.updateCoreLevel(f.b);}
const smallDamage={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,HIT_TYPE:1};
test('host Now foot threshold is strict30 and independent of Future grounded',async()=>{
  const f=await make();ready(f);f.b.grounded=false;
  f.b.y=f.b.landPosition[1]+29.99;assert.equal(f.s.canGuard(f.b,f.a,smallDamage),true);
  f.b.y=f.b.landPosition[1]+30;assert.equal(f.s.canGuard(f.b,f.a,smallDamage),false);
  f.b.y=f.b.landPosition[1]-30;assert.equal(f.s.canGuard(f.b,f.a,smallDamage),false);
  f.b.y=f.b.landPosition[1];f.b.state='RSI_JUMP_UP';assert.equal(f.s.canGuard(f.b,f.a,smallDamage),false);
  f.b.state='RSI_JUMP_COMBO_X';assert.equal(f.s.canGuard(f.b,f.a,smallDamage),true);
});
test('actual Ctrl awakening and Z Z native source/skeleton attack creates guard and both2016 FX',async()=>{
  const f=await make({orbs:1});
  for(let i=0;i<90;i++)f.s.step(1/60,{target:i===0?{pressed:['CTRL'],held:['CTRL']}:{}},{snapshot:false});
  assert.equal(f.b.core.level,2);assert.equal(f.b.core.gauge,40);assert.equal(f.b.core.helperLive,true);
  f.s.drainEvents();
  for(let i=0;i<48;i++)f.s.step(1/60,{rf:{pressed:i===0||i===8?['Z']:[],held:i===0||i===8?['Z']:[]}},{snapshot:false});
  const hits=f.s.state.events.filter(e=>e.type==='hit'),guards=f.s.state.events.filter(e=>e.type==='coreGuardStarted');
  assert.equal(hits.length,1);assert.equal(hits[0].origin.kind,'character');assert.equal(hits[0].guarded,true);
  // Target RSI_COMBO_ZZ PHYSIC1.9; no passive/critical in this fixture.
  assert.equal(f.b.hp,50000-1000*1.9*.25);assert.equal(guards.length,1);assert.equal(guards[0].state,'RSI_PARRYING_SMALL');
  assert.deepEqual([f.b.core.gauge,f.b.core.level],[20,1]);assert.equal(f.b.core.helper.scale,Math.fround(1.3));
  const effects=f.s.state.events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_RAVEN_PARRING');
  assert.deepEqual(effects.map(e=>e.name),['raven_bead_shield_01','raven_bead_shield_02']);
  for(const e of effects){assert.equal(e.birthAnchor.customPosition,true);assert.deepEqual(e.birthAnchor.rotation,[1,0,0]);
    assert.equal(e.definition.TRACE,1);assert.ok(index.templates[e.name]);}
});
test('continuous guard has one start/one consumption; re-entry after timer expiry consumes next level',async()=>{
  const f=await make();ready(f);f.b.vx=100;
  assert.equal(f.s.applyHit(f.a,f.b,smallDamage).guarded,true);assert.equal(f.b.vx,70);
  const serial=f.b.stateSerial;assert.deepEqual([f.b.core.gauge,f.b.core.level],[20,1]);
  assert.equal(f.s.applyHit(f.a,f.b,smallDamage).guarded,true);
  assert.equal(f.b.stateSerial,serial);assert.equal(f.b.core.gauge,20);
  const expired=f.n.nasod.evaluate('timer',nasodSnapshot(f.b,{elapsed:.51}));
  f.b.core.guardRemaining=expired.guardRemaining;f.b.core.canParry=expired.canParry;
  assert.equal(f.s.applyHit(f.a,f.b,{...smallDamage,REACT_TYPE:2}).guarded,true);
  assert.equal(f.b.state,'RSI_PARRYING');assert.deepEqual([f.b.core.gauge,f.b.core.level],[0,0]);
  assert.equal(f.b.core.helperLive,true);assert.equal(f.b.core.canParry,true);
  assert.equal(f.s.state.events.filter(e=>e.type==='coreGuardStarted').length,2);
});
test('actual66X two native attack windows guard twice with only one level consumption',async()=>{
  const f=await make({startX:1000,startY:3080,gap:320,lineId:2});ready(f);
  for(let i=0;i<48;i++)f.s.step(1/60,{rf:{pressed:i===0||i===2?['RIGHT']:i===3?['X']:[],
    held:i===0||i>=2?['RIGHT']:[],released:i===1?['RIGHT']:[]}},{snapshot:false});
  const hits=f.s.state.events.filter(e=>e.type==='hit');
  // Independent2016 data PHYSIC1.52 / NEXT PHYSIC1 and source .25 shield.
  assert.deepEqual(hits.map(e=>e.amount),[1000*1.52*.25,1000*1*.25]);assert.ok(hits.every(e=>e.guarded));
  assert.equal(f.s.state.events.filter(e=>e.type==='coreGuardStarted').length,1);
  assert.equal(f.s.state.events.filter(e=>e.type==='coreGuard').length,2);
  assert.deepEqual([f.b.core.gauge,f.b.core.level],[20,1]);
  assert.equal(f.s.state.events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_RAVEN_PARRING').length,4);
});
test('gauge grows independently while consumed guard level is frozen; End restores size/state',async()=>{
  const f=await make();ready(f);f.s.applyHit(f.a,f.b,smallDamage);
  f.b.core.gauge=65;f.s.updateCoreLevel(f.b);assert.equal(f.b.core.level,1);
  f.s.enter(f.b,'RSI_WAIT','explicit guard end fixture');
  assert.deepEqual([f.b.core.parrying,f.b.core.canParry,f.b.core.guardRemaining],[false,false,0]);
  assert.equal(f.b.core.level,3);assert.equal(f.b.core.helper.scale,Math.fround(1.6));assert.equal(f.b.core.phase,'idle');
});
test('original guard animation end chooses Wait or lowered JumpDown rather than held movement',async()=>{
  const f=await make();ready(f);f.s.applyHit(f.a,f.b,smallDamage);
  f.s.endState(f.b,{held:new Set(['RIGHT'])});assert.equal(f.b.state,'RSI_WAIT');assert.equal(f.b.core.parrying,false);
  f.s.applyHit(f.a,f.b,smallDamage);f.b.grounded=false;f.b.y+=80;f.b.vy=100;const y=f.b.y;
  f.s.endState(f.b,{held:new Set(['RIGHT'])});assert.equal(f.b.state,'RSI_JUMP_DOWN');assert.equal(f.b.y,y-45);
});
test('rear/ground-hit/mana damage rejection and unrelated ExtraDamage remain source-specific',async()=>{
  const f=await make();ready(f);
  f.a.x=f.b.x+150;assert.equal(f.s.canGuard(f.b,f.a,smallDamage),false);f.a.x=f.b.x-150;
  assert.equal(f.s.canGuard(f.b,f.a,{...smallDamage,HIT_TYPE:26}),false);
  for(const id of [16,26,34,47])assert.equal(f.s.canGuard(f.b,f.a,{...smallDamage,BEHAVIOR:{EXTRA_DAMAGE:{EXTRA_DAMAGE_TYPE:id}}}),false);
  assert.equal(f.s.canGuard(f.b,f.a,{...smallDamage,BEHAVIOR:{EXTRA_DAMAGE:{EXTRA_DAMAGE_TYPE:14}}}),true);
});
test('JSON snapshot includes timer/consumed level/helper/FX event provenance and deterministic continuation',async()=>{
  const f=await make();ready(f);f.s.applyHit(f.a,f.b,smallDamage);f.s.tickEffects(.001);
  const state=JSON.parse(JSON.stringify(f.s.snapshot())),copy=await make();copy.s.restore(state);
  assert.equal(state.actors[1].core.parrying,true);assert.equal(state.actors[1].core.canParry,true);
  assert.equal(state.events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_RAVEN_PARRING').length,2);
  for(let i=0;i<4;i++){f.s.step(1/60);copy.s.step(1/60);}
  assert.deepEqual(JSON.parse(JSON.stringify(copy.s.snapshot())),JSON.parse(JSON.stringify(f.s.snapshot())));
});
test('extracted original shield layers retain0.2 lifetime/caps/trigger and source DDS hashes',()=>{
  assert.equal(index.templates.raven_bead_shield_01.fields.Lifetime,.2);
  assert.equal(index.templates.raven_bead_shield_01.fields.TriggerCount,1);
  assert.equal(index.templates.raven_bead_shield_02.fields.TriggerTime,.1);
  assert.equal(index.templates.raven_bead_shield_02.fields.Emitrate,30);
  assert.deepEqual(Object.keys(index.templates),['raven_bead_shield_01','raven_bead_shield_02']);
  for(const row of Object.values(index.templates))for(const texture of Object.values(row.textures)){
    assert.ok(texture.file.startsWith('core-shield-fx/textures/'));assert.equal(texture.source.sha256.length,64);
    // The integration build copies this task's fx output to artifacts/rf/core-shield-fx
    // (tools/assets/character/build_rf_nasod_guard.py --output artifacts/rf), and the
    // task-local default path tools/assets/character/build_rf_nasod_guard.py uses is
    // artifacts/rf-core-shield-v11. Accept either instead of pinning one build layout.
    const relative=texture.file.replace('core-shield-fx/','');
    const roots=['artifacts/rf/core-shield-fx/','artifacts/rf-core-shield-v11/fx/'];
    const fixture=roots.map(root=>root+relative).find(candidate=>existsSync(new URL('../../'+candidate,import.meta.url)));
    assert.ok(fixture,'Missing extracted shield texture '+relative+' in '+roots.join(' or '));
    const png=read(fixture);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
  const runtime=createEffectRuntime({index,seed:2016});
  for(const name of Object.keys(index.templates)){const emitter=runtime.add(name,{position:[70,100,0],facing:1});assert.ok(emitter);}
  runtime.step(1/30,{});assert.ok(runtime.particles.size>0);
});
