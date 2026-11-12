import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import {historicalRfPreset} from '../helpers/rf-historical-preset-v20.mjs';
/** The real-input tests below are current-simulation regressions. The expected
 * pickup is the user's reported target behavior, with a bounded web adapter;
 * none of these input traces is an original-client recording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {rfGroundPickupOwner,RF_Z_PICKUP_ADAPTER} from '../../packages/combat-core/reaction-owner-policy.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const path=p=>new URL('../../'+p,import.meta.url),read=p=>JSON.parse(readFileSync(path(p)));
const profile=read('packages/combat-core/rf-profile.json'),currentPreset=authoredEquipmentPreset(read('config/rf-preset.json')),preset=historicalRfPreset(currentPreset);
const map=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
const fx=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx','awakening-fx','core-shield-fx','critical-fx','skill-fx-v11','xx2x-fx','xxx-fx'].map(p=>read('artifacts/rf/'+p+'/index.json')));
const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),fx);
const effectPoses=Object.fromEntries(collectEffectPoseFiles(effectIndex,fx).map(p=>[p,read('artifacts/rf/'+p)]));
const characterPose=read('artifacts/rf/runtime-pose.json');
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(path('artifacts/native/'+p))});
const options={nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
  nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,nativeEffectRandom:native.effectRandom,versions:native.versions};
const clone=v=>JSON.parse(JSON.stringify(v));
function make({facing=1,gap=120,x=-650,y=3800,lineId=4,passives,productionPreset=false}={}){
  return createSimulation({profile,preset:productionPreset?currentPreset:preset,map,seed:2016,...options,
    ...createNativeSamplers({characterPose,effectIndex,effectPoses,profile}),
    actors:[{id:'rf',team:0,x,y,z:0,lineId,facing,...(passives?{passives}:{})},
      {id:'target',team:1,x:x+gap*facing,y,z:0,lineId,facing:-facing}]});
}
const proxy=(extra={})=>({name:RF_Z_PICKUP_ADAPTER.effect,setName:RF_Z_PICKUP_ADAPTER.effectSet,
  mainEffectName:RF_Z_PICKUP_ADAPTER.mainEffect,ownerId:'rf',skillId:null,definition:{TRACE_MORE:1},...extra});
const policy=(extra={})=>rfGroundPickupOwner({actor:{id:'rf',state:'RSI_COMBO_Z'},origin:{kind:'effect',skillId:null},
  effect:proxy(),data:{REACT_TYPE:1},ownerHeightAboveLand:0,victimHeightAboveLand:160,lineRadius:30,...extra});

test('bounded pickup retains the original strict 90 and 150 predicates without hoisting the later >200 event',()=>{
  assert.equal(policy().adapter,RF_Z_PICKUP_ADAPTER.id);
  assert.equal(policy({ownerHeightAboveLand:89.99}).heightAboveLand,89.99);
  assert.equal(policy({ownerHeightAboveLand:90}),null);
  assert.equal(policy({ownerHeightAboveLand:-1}),null);
  assert.equal(policy({victimHeightAboveLand:149.99}),null,'native victim <150 already selects Small without this adapter');
  assert.ok(policy({victimHeightAboveLand:150}));assert.ok(policy({victimHeightAboveLand:200}));
  assert.ok(policy({victimHeightAboveLand:200.01}));assert.ok(policy({victimHeightAboveLand:800}));
  for(const v of [NaN,Infinity,-Infinity])assert.equal(policy({victimHeightAboveLand:v}),null);
  assert.equal(policy({lineRadius:0}),null);
});

test('only the exact target RF body-Z TRACE proxy participates, never projectiles, active skills or RT_DOWN',()=>{
  for(const effect of [proxy({name:'ION_BULLET'}),proxy({setName:'OtherSet'}),proxy({mainEffectName:'OtherMesh'}),
    proxy({ownerId:'other'}),proxy({skillId:24007}),proxy({definition:{TRACE_MORE:0}})])assert.equal(policy({effect}),null);
  for(const data of [{REACT_TYPE:2},{REACT_TYPE:3},{REACT_TYPE:4},{REACT_TYPE:5}])assert.equal(policy({data}),null);
  assert.equal(policy({actor:{id:'rf',state:'RSI_JUMP_COMBO_Z'}}),null);
  assert.equal(policy({origin:{kind:'character'}}),null);
  assert.equal(policy({origin:{kind:'effect',skillId:24007}}),null);
});

function observeHits(s){
  const hit=s.applyHit.bind(s),accepted=[];
  s.applyHit=(a,b,data,origin)=>{
    const before={x:b.x,y:b.y,z:b.z,vy:b.vy,state:b.state,grounded:b.grounded,knockdown:clone(b.knockdown)};
    const result=hit(a,b,data,origin);
    if(result?.accepted)accepted.push({time:s.state.time,sourceState:a.state,origin:clone(origin),before,
      after:{x:b.x,y:b.y,z:b.z,vy:b.vy,state:b.state,animationName:b.animationName,
        blending:b.presentationTransition?.enabled,grounded:b.grounded,knockdown:clone(b.knockdown)}});
    return result;
  };
  return accepted;
}
function loopInputs(s,{delay=3,startZ=true,airForward=false,settleAnimationSeconds=null}={}){
  const a=s.actor('rf'),inputs=[];
  const step=(input={})=>{inputs.push({actorId:'rf',...input});s.step(1/60,inputs.at(-1),{snapshot:false});};
  const until=(fn,max=240,input={})=>{let n=0;while(!fn()&&n++<max)step(input);assert.ok(fn(),'real input sequence exhausted at '+a.state);};
  if(startZ)step({pressed:['Z']});
  for(const [state,key,next] of [['RSI_COMBO_Z','Z','RSI_COMBO_ZZ'],['RSI_COMBO_ZZ','X','RSI_COMBO_ZZX'],['RSI_COMBO_ZZX','X','RSI_COMBO_ZZXX']]){
    until(()=>a.state===state&&a.animationTime>=.1);step({pressed:[key]});until(()=>a.state===next);
  }
  const direction=airForward?[a.facing>0?'RIGHT':'LEFT']:[];
  until(()=>a.animationTime>=.6);step({pressed:['UP'],held:['UP',...direction]});
  for(let i=0;i<delay-1;i++)step({held:['UP',...direction]});
  step({pressed:['DOWN'],held:['DOWN',...direction]});step({pressed:['X'],held:['DOWN',...direction]});
  until(()=>a.grounded,240,{held:['DOWN',...direction]});step({pressed:['Z']});
  until(()=>a.state==='RSI_COMBO_Z');
  if(settleAnimationSeconds!==null)until(()=>a.animationTime>=settleAnimationSeconds);
  else for(let i=0;i<12;i++)step();
  return inputs;
}

for(const facing of [-1,1])for(const gap of [70,120,170])for(const delay of [1,3,8])
test(`real ZZXX82XZ gives ground pickup without teleport, facing${facing} gap${gap} 82delay${delay}`,()=>{
  const s=make({facing,gap,x:facing===1?-650:650}),hits=observeHits(s);s.drainEvents();
  loopInputs(s,{delay});
  // Source24402 may insert its own real explosion between these commands.
  // Compare the command trajectory, retaining both body and proxy Z hits.
  const commandHits=hits.filter(hit=>hit.origin.skillId==null);
  assert.deepEqual(commandHits.slice(0,5).map(h=>h.sourceState),['RSI_COMBO_Z','RSI_COMBO_ZZ','RSI_COMBO_ZZX','RSI_COMBO_ZZXX','RSI_JUMP_COMBO_X']);
  const pickup=commandHits.at(-1);assert.equal(pickup.sourceState,'RSI_COMBO_Z');assert.equal(pickup.before.state,'RSI_DAMAGE_AIR_DOWN');
  assert.ok(pickup.before.y>3800,'X was an actual airborne hit');
  assert.match(pickup.after.state,/^RSI_DAMAGE_SMALL_(FRONT|BACK)$/);
  assert.match(pickup.after.animationName,/^DamageSmall(Front|Back)$/);assert.equal(pickup.after.blending,false,'AirDown TRANSITION=0 immediately releases the rolling pose');
  assert.equal(pickup.after.y,pickup.before.y,'selecting a standing reaction does not snap the victim onto ground');
  assert.equal(pickup.after.x,pickup.before.x);assert.equal(pickup.after.z,pickup.before.z);
  assert.equal(pickup.after.grounded,false);assert.equal(pickup.after.vy,Math.min(0,pickup.before.vy),'no AirSmall +700 relaunch');
  assert.ok(pickup.after.knockdown.pending>=0,'normal reserve still owns the Z contribution');
  assert.equal(s.actor('target').grounded,true,'the falling victim lands normally');
  if(pickup.before.y-3800>=150)assert.equal(s.state.events.filter(e=>e.type==='nearGroundMeleePickup').length,1);
});

function proxyHit(s,height,{name='DamageEffect_RF_COMBO_Z',armor=false,kd=0}={}){
  const a=s.actor('rf'),b=s.actor('target');s.enter(a,'RSI_COMBO_Z','route-fixture');
  b.y=3800+height;b.grounded=false;b.lineId=null;b.vy=-600;b.superArmor=armor;b.knockdown.now=kd;
  const e=s.state.effects.find(e=>e.name==='DamageEffect_RF_COMBO_Z');assert.ok(e,'actual target Z declaration creates its proxy');
  if(name!==e.name){e.name=name;e.setName='independent-projectile';e.definition.TRACE_MORE=0;}
  const before=clone(b.knockdown),position=[b.x,b.y,b.z];
  const result=s.applyHit(a,b,profile.damageEffects.DamageEffect_RF_COMBO_Z.raw.DAMAGE_DATA,{kind:'effect',id:e.id,skillId:null});
  return {a,b,result,before,position,e};
}

test('independent projectiles and airborne owners retain the original air reaction',()=>{
  for(const [height,name] of [[160,'independent-projectile']]){
    const s=make(),{b,result}=proxyHit(s,height,{name});assert.equal(result.accepted,true);
    assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(b.grounded,false);
    assert.equal(s.state.events.some(e=>e.type==='nearGroundMeleePickup'),false);
  }
  const s=make(),a=s.actor('rf');a.y+=100;a.grounded=false;a.lineId=null;
  const {b}=proxyHit(s,160);assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');
});

test('high manual-route fixture selects source Small first, then the compiled >200 event returns to air after physics',()=>{
  const s=make(),{b,position}=proxyHit(s,800);
  assert.equal(b.state,'RSI_DAMAGE_SMALL_FRONT');assert.deepEqual([b.x,b.y,b.z],position);assert.equal(b.grounded,false);assert.equal(b.vy,-600);
  s.step(1/60,{}, {snapshot:false});
  assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.ok(b.y>3800+200);assert.equal(b.grounded,false);
  assert.ok(b.y<position[1]-45,'CommonFuture physics runs before the source leave-support callback lowers 45');
});

test('a real ground Z helper cannot hit or forcibly stand a distant high target',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');b.y+=800;b.grounded=false;b.lineId=null;b.vy=0;
  s.enter(b,'RSI_DAMAGE_AIR_DOWN','distant-high-target');const hp=b.hp;
  s.step(1/60,{pressed:['Z']},{snapshot:false});for(let i=0;i<10;i++)s.step(1/60,{}, {snapshot:false});
  assert.equal(b.hp,hp);assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN');assert.equal(s.state.events.some(e=>e.type==='nearGroundMeleePickup'),false);
  assert.equal(a.state,'RSI_COMBO_Z');
});

test('pickup cannot override a full KD down, superarmor or invincibility',()=>{
  const s=make(),{b,position}=proxyHit(s,160,{kd:100});
  assert.equal(b.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');assert.equal(b.knockdown.activated,true);assert.equal(b.knockdown.now,100);
  assert.deepEqual([b.x,b.y,b.z],position);assert.equal(s.state.events.some(e=>e.type==='nearGroundMeleePickup'),false);
  const t=make(),{b:armored}=proxyHit(t,160,{armor:true,kd:35});assert.equal(armored.state,'RSI_WAIT');assert.equal(armored.knockdown.now,35);
  assert.equal(t.state.events.some(e=>e.type==='nearGroundMeleePickup'),false);
  const u=make(),v=u.actor('target');v.invincible=true;const hp=v.hp;
  const blocked=proxyHit(u,160);assert.equal(blocked.result.accepted,false);assert.equal(v.hp,hp);
  const down=make(),target=down.actor('target');down.enter(target,'RSI_DAMAGE_DOWN_FRONT','existing-knockdown');const downHp=target.hp;
  const downHit=proxyHit(down,160);assert.equal(downHit.result.accepted,false);assert.equal(target.state,'RSI_DAMAGE_DOWN_FRONT');assert.equal(target.hp,downHp);
});

test('a platform-edge pickup follows the authored lower floor and does not fabricate a new support',()=>{
  const s=make({x:760,gap:10}),{b,position}=proxyHit(s,160);
  assert.match(b.state,/^RSI_DAMAGE_SMALL_/);assert.deepEqual([b.x,b.y,b.z],position);assert.equal(b.lineId,null);
  b.vx=900;
  for(let i=0;i<90;i++)s.step(1/60,{}, {snapshot:false});
  assert.ok(b.y<3800,'leaves platform 4 and lands on the authored lower line');
  assert.notEqual(b.lineId,4);
});

test('complete real-input state including pickup evidence replays identically through JSON restore',()=>{
  const a=make(),b=make(),hits=observeHits(a);loopInputs(a,{delay:3});assert.equal(hits.at(-1).after.state,'RSI_DAMAGE_SMALL_FRONT');
  b.restore(clone(a.snapshot()));
  for(let i=0;i<120;i++){a.step(1/60);b.step(1/60);assert.deepEqual(clone(a.snapshot()),clone(b.snapshot()));}
});

for(const facing of [-1,1])test(`three real loops reuse the final Z and preserve physical descent at facing${facing}`,()=>{
  const s=make({facing,x:facing===1?-650:650}),hits=observeHits(s),cycles=[];
  for(let cycle=0;cycle<3;cycle++){
    const start=hits.length;loopInputs(s,{delay:3,startZ:cycle===0});const cycleHits=hits.slice(start),last=cycleHits.at(-1);
    assert.equal(last.sourceState,'RSI_COMBO_Z');assert.match(last.after.state,/^RSI_DAMAGE_SMALL_/);
    assert.equal(last.before.y,last.after.y);assert.equal(last.after.vy,Math.min(0,last.before.vy));
    assert.ok(s.actor('target').y<last.before.y,'normal physics continues descending before the next loop');
    assert.ok(last.after.knockdown.now<100);cycles.push(cycleHits);
  }
  assert.equal(cycles[0][0].sourceState,'RSI_COMBO_Z');
  for(const cycle of cycles.slice(1))assert.equal(cycle[0].sourceState,'RSI_COMBO_ZZ','end Z belongs to the next loop; no extra new starting Z');
  assert.equal(s.state.events.some(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state==='RSI_COMBO_ZZZ'),false);
  assert.equal(s.state.events.some(e=>e.type==='stateChanged'&&e.actorId==='target'&&e.state==='RSI_DAMAGE_AIR_SMALL'),false,'source next-physics >200 check does not relaunch this falling pickup');
  for(let i=0;i<60;i++)s.step(1/60,{}, {snapshot:false});assert.equal(s.actor('target').grounded,true);
});

for(const facing of [-1,1])test(`same-direction air input runs the source JumpX movement and keeps two real loops linked at facing${facing}`,()=>{
  const s=make({facing,x:facing===1?-650:650}),hits=observeHits(s);
  for(let cycle=0;cycle<2;cycle++){
    const start=hits.length;loopInputs(s,{delay:3,startZ:cycle===0,airForward:true});const cycleHits=hits.slice(start);
    assert.ok(cycleHits.some(h=>h.sourceState==='RSI_JUMP_COMBO_X'),'real source air-direction motion brings the hand helper to the victim');
    const last=cycleHits.at(-1);assert.equal(last.sourceState,'RSI_COMBO_Z');assert.match(last.after.state,/^RSI_DAMAGE_SMALL_/);
    assert.equal(last.after.vy,Math.min(0,last.before.vy));
  }
});

for(const facing of [-1,1])for(const airForward of [false,true])
test(`historical40/23 and full guild grants preserve real linked pickup loops with source-timed Z at facing${facing} forward${airForward}`,()=>{
  const s=make({facing,x:facing===1?-650:650,productionPreset:true}),hits=observeHits(s);
  assert.equal(s.actor('rf').speedAttributeOptions.animationSpeedMultiplier,1.4);
  assert.equal(s.actor('rf').speedAttributeOptions.jumpSpeedMultiplier,1.23);
  for(let cycle=0;cycle<(airForward?2:3);cycle++){
    const start=hits.length;
    // Raven.cpp:7774 RSI_COMBO_Z_EventProcess accepts oneZ only at animation <=.3. A fixed
    // historical 12-packet wait plus the next input advances40% speed to
    // .3185 and is correctly rejected. Use explicit .2-animation timing.
    loopInputs(s,{delay:3,startZ:cycle===0,airForward,settleAnimationSeconds:.2});
    const cycleHits=hits.slice(start),last=cycleHits.at(-1);
    if(airForward)assert.ok(cycleHits.some(h=>h.sourceState==='RSI_JUMP_COMBO_X'),'forward input produces an actual air-X hit in each linked cycle');
    assert.equal(last.sourceState,'RSI_COMBO_Z');assert.match(last.after.state,/^RSI_DAMAGE_SMALL_/);
    assert.equal(last.after.y,last.before.y);assert.equal(last.after.vy,Math.min(0,last.before.vy));
    if(cycle>0)assert.equal(cycleHits[0].sourceState,'RSI_COMBO_ZZ','source latch links the prior end Z');
  }
});
