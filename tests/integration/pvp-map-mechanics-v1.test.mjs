import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {invincibleBungeeHp} from '../../packages/combat-core/map-mechanics.mjs';
import {normalTrackingActorPoints,advanceLineCamera} from '../../apps/web/camera-line-basis.mjs';
import {advanceShadowStepCandidate} from '../../packages/combat-core/shadow-step.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {createOwnedRelayPacer} from '../../apps/server/owned-relay-pacer.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:root+'artifacts'});
async function fixture(sceneId,lineId,{professionId='RF',facing=1,yOffset=0,extraActors=[]}={}){
  const selected=assets.forScene(sceneId),{native,samplers}=await selected.createRuntime();
  const line=selected.map.lines.find(l=>l.lineId===lineId),position=line.start.map((n,i)=>(n+line.end[i])/2);
  position[1]+=yOffset;
  const sim=createSimulation({profile:assets.profile,profiles:assets.profiles,presets:assets.presets,preset:assets.preset,
    map:selected.map,versions:selected.versions,commonBuffs:assets.commonBuffs,actors:[{id:'subject',team:0,professionId,position,lineId,facing},...extraActors],seed:2016,
    ...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  return {sim,actor:sim.actor('subject'),map:selected.map,line,native};
}
const step=(sim,n,inputs={})=>{for(let i=0;i<n;i++)sim.step(1/60,{subject:inputs});};
const close=(a,b,tolerance=.1)=>assert.ok(Math.abs(a-b)<tolerance,a+' != '+b);

test('all three professions move along the real ElTree upper diagonal without world-X distance compression',async()=>{
  for(const professionId of ['RF','LK','VC']){
    const {sim,actor,line}=await fixture('eltreedown',29,{professionId});
    const start=[actor.x,actor.z],length=Math.hypot(line.end[0]-line.start[0],line.end[2]-line.start[2]);
    sim.enter(actor,'RSI_WALK','test');actor.applyMotionOffset=false;
    const speed=sim.profileFor(actor).physics.WALK_SPEED*actor.stats.moveSpeedMultiplier-sim.profileFor(actor).physics.RELOAD_ACCEL/60;
    step(sim,6,{held:['RIGHT']});
    close(Math.hypot(actor.x-start[0],actor.z-start[1]),speed*.1,.2);
    close((actor.z-start[1])/(actor.x-start[0]),(line.end[2]-line.start[2])/(line.end[0]-line.start[0]),.001);
    assert.ok(length>speed*.1);assert.equal(actor.lineId,29);
  }
});

test('RF Shadow Step range consumes real diagonal displacement and its native passive speed is not shortened',async()=>{
  const {sim,actor}=await fixture('eltreedown',19);
  actor.mp=actor.mpMax;sim.configureLoadout([{skillId:24217},...Array(7).fill(null)],actor.id);
  sim.step(1/60,{subject:{pressed:['A']}});assert.equal(actor.state,'RSI_SI_A_RF_SHADOW_STEP');
  const start=[actor.x,actor.z];step(sim,12);
  assert.ok(Math.hypot(actor.x-start[0],actor.z-start[1])>170,'shadow movement should retain full authored speed');
  const candidate={x:30,z:40,grounded:true,state:'RSI_SI_A_RF_SHADOW_STEP',
    sourceShadowStep:{remaining:100,range:100,lastX:0,lastZ:0,stageElapsed:0}};
  advanceShadowStepCandidate(candidate,null,{dt:.01,profile:{states:{[candidate.state]:{raw:{PASSIVE_SPEED_X:1000}}}}});
  assert.equal(candidate.sourceShadowStep.remaining,50);
});

test('walking through the actual linked ElTree bend preserves travel speed after each corner in both directions',async()=>{
  for(const professionId of ['RF','LK','VC'])for(const facing of [-1,1]){
    const {sim,actor}=await fixture('eltreedown',facing===1?20:26,{professionId,facing});
    sim.enter(actor,'RSI_WALK','linked-curve');actor.applyMotionOffset=false;
    const p=sim.profileFor(actor),speed=p.physics.WALK_SPEED*actor.stats.moveSpeedMultiplier-p.physics.RELOAD_ACCEL/60;
    let distance=0,prior=[actor.x,actor.z];const visited=new Set([actor.lineId]);
    for(let i=0;i<20;i++){
      sim.step(1/60,{subject:{held:[facing===1?'RIGHT':'LEFT']}});
      distance+=Math.hypot(actor.x-prior[0],actor.z-prior[1]);prior=[actor.x,actor.z];visited.add(actor.lineId);
    }
    assert.ok(visited.size>=3,JSON.stringify([...visited]));
    assert.ok(distance>speed*(20/60)*.98,JSON.stringify({professionId,facing,distance,expected:speed/3}));
  }
});

test('each authored portal waits strictly over .7s, locks input and cannot immediately return from its destination',async()=>{
  const first=await fixture('peita-spiral-corridor-pvp',16);
  for(const line of first.map.lines.filter(l=>l.type==='LINE_TYPE.LT_POTAL')){
    const {sim,actor,map}=await fixture(first.map.sceneId,line.lineId);
    sim.step(1/60);assert.equal(actor.lineId,line.lineId);assert.equal(actor.mapMechanics.portalNotice.serial,1);
    step(sim,40);assert.equal(actor.lineId,line.lineId);
    step(sim,4);assert.equal(actor.lineId,line.nativeFields.TELEPORT_LINE);
    assert.ok(actor.inputLock>0);
    const target=map.lines.find(l=>l.lineId===line.nativeFields.TELEPORT_LINE);
    const targetIsPortal=target.type==='LINE_TYPE.LT_POTAL';
    if(targetIsPortal)assert.equal(actor.mapMechanics.portalReady,false);
    const center=target.start.map((v,i)=>(v+target.end[i])/2);
    [actor.x,actor.y,actor.z].forEach((v,i)=>close(v,center[i],.15));
    step(sim,90);assert.equal(actor.lineId,target.lineId,'must leave the target portal first');
    const saved=JSON.parse(JSON.stringify(sim.snapshot()));sim.restore(saved);
    assert.equal(sim.actor('subject').mapMechanics.portalReady,!targetIsPortal);
  }
});

test('Besma conveyors carry a waiting actor at signed 220 native units/s regardless of facing',async()=>{
  for(const id of [2,5,6,9])for(const facing of [-1,1]){
    const {sim,actor,line}=await fixture('besma-air-ship-pvpmap',id,{facing});
    actor.applyMotionOffset=false;const start=actor.x;
    step(sim,30);close(actor.x-start,line.nativeFields.SPEED*.5,.2);
    assert.equal(actor.facing,facing);assert.equal(actor.state,'RSI_WAIT');
  }
});

test('Sander jump pads force authored inward directions, launch speed and .5s input lock',async()=>{
  for(const [id,facing]of [[17,1],[18,-1]]){
    const {sim,actor}=await fixture('sander-villiage-pvpmap',id,{facing:-facing});
    sim.step(1/60);assert.equal(actor.facing,facing);assert.ok(actor.pendingPlatformJump);
    sim.step(1/60);assert.equal(actor.grounded,false);assert.equal(actor.state,'RSI_JUMP_UP');
    assert.ok(actor.vx*facing>3500);assert.ok(actor.vy>1800);assert.ok(actor.inputLock>.4);
  }
});

test('camera responds on the two Sander steps before the pads with original component speed',async()=>{
  for(const [id,x]of [[11,-1400],[12,1400]]){
    const {actor,map}=await fixture('sander-villiage-pvpmap',id);
    const state=advanceLineCamera(actor,map,.1,null);
    assert.deepEqual(state.relative,[Math.sign(x)*400,300,0]);assert.deepEqual(state.final,[x,300,0]);
    const complete=advanceLineCamera(actor,map,.25,state);assert.deepEqual(complete.relative,[x,300,0]);
    const normal=normalTrackingActorPoints(actor,map,0,{});
    const shifted=normalTrackingActorPoints(actor,map,0,{}, {dt:0,previous:complete});
    close(shifted.eye[0]-normal.eye[0],x);close(shifted.eye[1]-normal.eye[1],300);
    actor.lastTouchLineId=0;const back=advanceLineCamera(actor,map,.1,complete);
    close(back.relative[0],x-Math.sign(x)*400);close(back.relative[1],0);
  }
});

test('Hope Bridge waits 2s and returns in air-down above its original middle line with a nonfatal 10% HP penalty',async()=>{
  for(const professionId of ['RF','LK','VC']){
    const {sim,actor,map}=await fixture('velder-bridge-hope-stage-pvp',15,{professionId});
    const hp=actor.hp;actor.forceInvincible=10;
    sim.step(1/60);assert.equal(actor.mapMechanics.bungeeLineId,15);
    step(sim,119);assert.equal(actor.hp,hp);assert.equal(actor.lineId,15);
    step(sim,3);close(actor.hp,hp-actor.hpMax*.1,.001);
    assert.equal(actor.state,'RSI_DAMAGE_AIR_DOWN');assert.equal(actor.lastTouchLineId,11);
    assert.equal(actor.grounded,false);assert.ok(actor.y>1260);assert.ok(actor.forceInvincible>7);
    step(sim,60);assert.ok(actor.grounded);assert.ok(['RSI_DAMAGE_AIR_DOWN_LANDING','RSI_DAMAGE_STANDUP_FRONT'].includes(actor.state));
    const target=map.lines.find(l=>l.lineId===11);close(actor.x,(target.start[0]+target.end[0])/2,2);
  }
});

test('an actual fall in the bridge gap reaches the bungee line instead of rolling back onto the bridge',async()=>{
  const {sim,actor}=await fixture('velder-bridge-hope-stage-pvp',15,{yOffset:700});
  actor.grounded=false;actor.lineId=null;sim.enter(actor,'RSI_JUMP_DOWN','test-falling');
  step(sim,120);assert.ok(actor.mapMechanics.bungeeLineId===15||actor.mapMechanics.returnSerial>0,JSON.stringify({y:actor.y,line:actor.lineId,land:actor.landPosition}));
});

test('a real ground Z can pick up the vulnerable bridge return before air-down landing',async()=>{
  const {sim,actor}=await fixture('velder-bridge-hope-stage-pvp',15,{extraActors:[
    {id:'helper',professionId:'RF',team:1,position:[2384,1260,-6129],lineId:11,facing:1}]});
  sim.step(1/60);step(sim,121);
  assert.equal(actor.state,'RSI_DAMAGE_AIR_DOWN');assert.ok(actor.y>1260);
  const accepted=[],original=sim.applyHit.bind(sim);
  sim.applyHit=(a,b,data,origin)=>{const before=b.state,result=original(a,b,data,origin);
    if(result?.accepted)accepted.push({attackerId:a.id,targetId:b.id,before,after:b.state});return result;};
  sim.step(1/60,{helper:{pressed:['Z']}});step(sim,30);
  assert.ok(accepted.some(h=>h.attackerId==='helper'&&h.targetId==='subject'&&h.before==='RSI_DAMAGE_AIR_DOWN'
    &&/^RSI_DAMAGE_SMALL_/.test(h.after)),JSON.stringify(accepted));
});

const bridgePlayers=[{id:'subject',team:0},{id:'teammate',team:0},{id:'enemy-a',team:1},{id:'enemy-b',team:1}]
  .map(p=>({...p,professionId:'RF',loadout:Array(8).fill(null)}));
async function bridgeRoom(){
  const f=await fixture('velder-bridge-hope-stage-pvp',11,{extraActors:bridgePlayers.slice(1)
    .map((p,i)=>({...p,position:[2000+i*250,1260,-6129],lineId:11,facing:1}))});
  const templates=structuredClone(f.sim.state.actors);
  const pvp=new PvpMatch({players:bridgePlayers,map:f.map,seed:2016,versions:f.sim.versions,onRespawn(id){
    const i=f.sim.state.actors.findIndex(a=>a.id===id);f.sim.state.actors[i]=structuredClone(templates[i]);return f.sim.state.actors[i];}});
  return {...f,pvp};
}
test('actual teammate-position resurrection during a bridge fall retains invincibility, takes10% and lands down',async()=>{
  const {sim,pvp,map}=await bridgeRoom();pvp.start(sim);pvp.advance(10,sim);
  const dead=sim.actor('subject');dead.hp=0;dead.deathComplete=true;
  dead.mapMechanics.portalSerial=7;dead.mapMechanics.lockRemaining=99;dead.mapMechanics.portalReady=false;
  pvp.advance(0,sim);pvp.advance(12-1/60,sim);
  const mate=sim.actor('teammate'),bottom=map.lines.find(l=>l.lineId===15);
  [mate.x,mate.y,mate.z]=[2484,700,-6129];mate.grounded=false;mate.lineId=null;
  mate.lastTouchLineId=15;mate.landPosition=bottom.start.map((v,i)=>(v+bottom.end[i])/2);
  sim.enter(mate,'RSI_JUMP_DOWN','actual-falling-teammate');
  sim.step(1/60);pvp.advance(1/60,sim);
  const actor=sim.actor('subject');assert.notEqual(actor,dead);assert.equal(actor.grounded,false);
  assert.equal(actor.mapMechanics.portalSerial,7,'portal display notices remain monotonic across revival');
  assert.equal(actor.mapMechanics.lockRemaining,0);assert.equal(actor.mapMechanics.portalReady,true);
  assert.equal(actor.lastTouchLineId,15);assert.equal(actor.forceInvincible,5);
  assert.deepEqual([actor.x,actor.y,actor.z],[mate.x,mate.y,mate.z]);
  let n=0;while(actor.mapMechanics.returnSerial===0){assert.ok(n++<200);sim.step(1/60);pvp.advance(1/60,sim);}
  assert.equal(actor.hp,actor.hpMax*.9);assert.equal(actor.state,'RSI_DAMAGE_AIR_DOWN');
  assert.equal(actor.lastTouchLineId,11);assert.ok(actor.forceInvincible>2);
  const hit=sim.injectHit({attackerId:'enemy-a',targetId:'subject',damageData:sim.profileFor(actor).states.RSI_COMBO_Z.raw.DAMAGE_DATA});
  assert.equal(hit.accepted,false,'resurrection protection prevents a pickup hit');
  const states=[];for(let i=0;i<45;i++){sim.step(1/60);pvp.advance(1/60,sim);states.push(actor.state);}
  assert.ok(states.includes('RSI_DAMAGE_AIR_DOWN_LANDING'));assert.ok(actor.forceInvincible>1);
  assert.equal(actor.hp,actor.hpMax*.9);assert.deepEqual(pvp.state.score,[0,1]);
});

test('real owner room preserves one bridge penalty during respawn protection and rejects stale-life/repeated loss',async t=>{
  const {sim,pvp,map}=await bridgeRoom(),driver=createLocalOwnerBattleDriver({match:{id:'bridge-room',players:bridgePlayers},
    simulation:sim,pvp,manual:true,clock:()=>0,emit(){},finish(){}});t.after(()=>driver.stop());
  for(const p of bridgePlayers)driver.ready(p.id);driver.tick(10);
  const report=(seq)=>encodeOwnedState(sim,'subject',{epoch:driver.snapshot().ownership.actors.subject.epoch,frameSeq:seq});
  const submit=value=>driver.submitInput('subject',{frames:[{held:[],frameSeq:value.frameSeq}],owner:value});
  const dead=report(1);dead.actor.hp=0;dead.actor.deathComplete=true;submit(dead);driver.tick(.1);driver.tick(12);
  const actor=sim.actor('subject'),oldHp=actor.hp;
  const f=await fixture(map.sceneId,15);f.actor.forceInvincible=5;f.sim.step(1/60);step(f.sim,122);
  const incoming=report(2);Object.assign(incoming.actor,encodeOwnedState(f.sim,'subject',{epoch:0,frameSeq:0}).actor);
  submit(incoming);assert.equal(actor.hp,oldHp*.9);
  const ordinary=report(3);ordinary.actor.hp=0;submit(ordinary);assert.equal(actor.hp,oldHp*.9);
  const duplicate={...incoming,frameSeq:4,actor:{...incoming.actor,hp:oldHp*.8}};submit(duplicate);assert.equal(actor.hp,oldHp*.9);
  const oldLife={...incoming,epoch:1,frameSeq:5};assert.equal(submit(oldLife).ignored,'old-life');assert.equal(actor.hp,oldHp*.9);
});

test('bungee penalty floors HP at1 and invincible owner reports permit one bounded environment loss',async()=>{
  const {sim,actor,map}=await fixture('velder-bridge-hope-stage-pvp',15);
  const previous=structuredClone(actor);actor.hp=5;sim.step(1/60);step(sim,122);
  assert.equal(actor.hp,1);assert.equal(actor.death,false);
  const incoming=structuredClone(actor);incoming.hp=Math.max(1,previous.hp-previous.hpMax*.1);
  incoming.mapMechanics.lastReturn.hpBefore=previous.hp;incoming.mapMechanics.lastReturn.hpAfter=incoming.hp;
  assert.equal(invincibleBungeeHp(previous,incoming,map),incoming.hp);
  previous.mapMechanics.returnSerial=1;assert.equal(invincibleBungeeHp(previous,incoming,map),previous.hp);
});

test('portal/bungee/jump snapshots retain serials, geometry references and locks through the owner wire',async()=>{
  const {sim,actor,map}=await fixture('peita-spiral-corridor-pvp',16);step(sim,45);
  const wire=encodeOwnedState(sim,actor.id,{epoch:1,frameSeq:60});
  assert.doesNotThrow(()=>validateOwnedState(wire));
  assert.doesNotThrow(()=>validateOwnedReferences(wire,actor,sim.profileFor(actor),map,{profiles:sim.profiles,actors:sim.state.actors}));
  assert.equal(wire.actor.mapMechanics.portalReady,false);
});

test('actual portal survives replaced split snapshots and a queued old life cannot cross respawn',async()=>{
  const {sim,actor,map}=await fixture('peita-spiral-corridor-pvp',16);
  const producer=createOwnedRelayDelta(),consumer=createOwnedRelayDelta(),received=[],timers=new Set();
  let now=0;
  const pacer=createOwnedRelayPacer({clock:()=>now,timers:{
    setTimeout(fn,ms){const timer={fn,due:now+ms,unref(){}};timers.add(timer);return timer;},
    clearTimeout(timer){timers.delete(timer);}},
    send:packet=>received.push(validateOwnedState(consumer.decode(packet)))});
  const offer=(epoch,frameSeq)=>{
    const state=encodeOwnedState(sim,actor.id,{epoch,frameSeq});
    const packet=producer.encodeSplit(actor.id,state);
    if(packet.baseline)consumer.decode(packet.baseline);
    pacer.offer(actor.id,packet.value);return state;
  };
  offer(1,0);
  step(sim,40);now=10;offer(1,40);
  step(sim,5);now=20;const teleported=offer(1,45);
  assert.equal(teleported.actor.lineId,33);assert.equal(teleported.actor.mapMechanics.portalSerial,2);
  assert.equal(received.length,1);
  now=50;for(const timer of [...timers])if(timer.due<=now&&timers.delete(timer))timer.fn();
  assert.deepEqual(received.at(-1),teleported);
  validateOwnedReferences(received.at(-1),actor,sim.profileFor(actor),map,{profiles:sim.profiles,actors:sim.state.actors});
  now=60;step(sim,1);offer(1,46);const retired=[...timers];
  pacer.clear(actor.id);actor.mapMechanics.portalReady=true;actor.mapMechanics.lockRemaining=0;
  const revived=offer(2,0);
  now=100;for(const timer of retired)timer.fn();
  assert.deepEqual(received.at(-1),revived);assert.equal(received.length,3);
  assert.equal(pacer.performance().pending,0);
});
