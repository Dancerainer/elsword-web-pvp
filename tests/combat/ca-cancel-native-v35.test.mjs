/** Actual target poses, original Garpai geometry and WASM execution.
 * Expected windows come from independent original2016 declarations and the
 * qualified EL callbacks. This is current host/native-adapter evidence,
 * not an original-client runtime golden. Missing charge clocks stay closed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const dt=1/60;
const authored={zzzX:{start:.153,inputEnd:.666,dispatch:.7},airXX:{start:0,inputEnd:100,dispatch:.5},shade:{start:.26,inputEnd:1}};
function device(facing=1,skillId=28214,gap=8000){
 const f=elesisFixture('CA',{position:[0,3080,0],gap,facing,skillId,passives:[],guildPassives:[]});
 const keyboard=createInputBuffer({sampledLevels:true});
 const source=()=>f.profile.states[f.a.state].sourceState??f.a.state;
 const step=()=>f.sim.step(dt,{[f.a.id]:keyboard.consume(f.sim.state.time+dt,dt)},{snapshot:false});
 const down=key=>keyboard.down(key,f.sim.state.time+.001),up=key=>keyboard.up(key,f.sim.state.time+.001);
 const tap=key=>{down(key);step();up(key);step();};
 const until=(predicate,message,limit=180)=>{for(let i=0;i<limit&&!predicate();i++)step();assert.ok(predicate(),message+'; '+source()+' @ '+f.a.animationTime);};
 const time=at=>{const serial=f.a.stateSerial;until(()=>f.a.animationTime>=at||f.a.stateSerial!==serial,'original animation clock '+at);assert.equal(f.a.stateSerial,serial,'source action survives to its declared clock');};
 const noContact=()=>assert.equal(f.sim.state.events.filter(e=>e.type==='hit'&&e.actorId===f.a.id).length,0,'distant actor cannot add unintended attacker STOP');
 return {...f,keyboard,source,step,down,up,tap,until,time,noContact};
}
function fullWire(d){
 const receiver=elesisFixture('CA',{position:[0,3080,0],gap:8000,facing:d.a.facing,skillId:d.a.skillId??28214,passives:[],guildPassives:[]});
 const packet=validateOwnedState(encodeOwnedState(d.sim,d.a.id,{epoch:0,frameSeq:d.sim.state.step}));
 const untouched=structuredClone(receiver.b);
 validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
 applyOwnedState(receiver.sim,receiver.a.id,packet);
 for(const field of ['state','stateSerial','animationTime','sourceCommandFlags','y','grounded','skillId','pendingPressed'])assert.deepEqual(receiver.a[field],d.a[field],'full owner reconstruction '+field);
 assert.deepEqual(receiver.b,untouched,'remote command reconstruction cannot mutate the receiving actor');
 const effects=receiver.sim.state.effects.filter(e=>e.ownerId===receiver.a.id);
 assert.equal(effects.length,packet.effects.length);
 assert.ok(effects.every(e=>e.definition),'all live effects reconstruct from frozen definitions');
}
function reachZZZX(d){
 d.tap('Z');assert.equal(d.source(),'ESI_COMBO_Z');
 d.time(.1);d.tap('Z');d.until(()=>d.source()==='ESI_COMBO_ZZ','sampled secondZ');
 d.time(.1);d.tap('Z');d.until(()=>d.source()==='ESI_COMBO_ZZZ','sampled thirdZ');
 d.time(.17);d.tap('X');d.until(()=>d.source()==='ESI_COMBO_SDK_ZZZX','sampled ZZZX');
 assert.deepEqual(d.profile.states[d.a.state].raw.EVENT_PROCESS_TIME0,{'1':authored.zzzX.start,'2':authored.zzzX.inputEnd,'3':authored.zzzX.dispatch});
}
function seedAirXX(d){
 d.sim.enter(d.a,'ESI_DASH_JUMP_COMBO_SDK_XX','native-original-668XX-seed');
 d.a.y=10000;d.a.grounded=false;d.a.lineId=null;d.a.vy=0;
 assert.deepEqual(d.profile.states[d.a.state].raw.EVENT_PROCESS_TIME0,{'1':authored.airXX.start,'2':authored.airXX.inputEnd,'3':authored.airXX.dispatch});
}

for(const facing of [-1,1]){
 test(`CA Native ${facing}: actual Z Z Z X X keys hit with both recovered final-command helpers`,()=>{
  const d=device(facing,28214,160);reachZZZX(d);d.time(.2);d.tap('X');
  d.until(()=>d.source()==='ESI_COMBO_SDK_ZZZXX','original native freshX continuation',120);
  // Validate reconstruction while the final command owns real live effects.
  for(let i=0;i<6;i++)d.step();fullWire(d);
  for(let i=0;i<180;i++)d.step();
  const events=d.sim.state.events;
  for(const name of ['DamageEffect_Combo_SDK_ZZZX','DamageEffect_Combo_SDK_ZZZXX']){
   const effectIds=events.filter(e=>e.type==='effectStarted'&&e.actorId===d.a.id&&e.name===name).map(e=>e.effectId);
   assert.ok(effectIds.length>0,'original helper starts: '+name);
   assert.ok(events.some(e=>e.type==='hit'&&e.actorId===d.a.id&&e.targetId===d.b.id&&e.origin?.kind==='effect'&&effectIds.includes(e.origin.id)),
     'real Native helper damages the opposing target: '+name);
  }
  fullWire(d);
 });
 test(`CA Native ${facing}: sampled ZZZX thenX uses the original input window and strict .7 dispatch`,()=>{
  const d=device(facing);reachZZZX(d);d.time(.2);d.tap('X');
  assert.equal(d.source(),'ESI_COMBO_SDK_ZZZX');assert.equal(d.a.sourceCommandFlags&1,1);
  let observedDispatch=false;
  for(let i=0;i<120&&!observedDispatch;i++){
   const serial=d.a.stateSerial,before=d.a.animationTime;d.step();
   if(d.a.stateSerial!==serial){assert.equal(d.source(),'ESI_COMBO_SDK_ZZZXX');assert.ok(before<=authored.zzzX.dispatch);observedDispatch=true;}
   else assert.ok(d.a.animationTime<=authored.zzzX.dispatch,'bufferedX dispatches on its first eligible packet');
  }
  assert.ok(observedDispatch);assert.equal(d.a.sourceCommandFlags,0,'consumed continuation does not repeat');d.noContact();fullWire(d);
 });
 test(`CA Native ${facing}: 668XX sampledX remains queued beyond .5 and original pose stop until actual support`,()=>{
  const d=device(facing);seedAirXX(d);d.down('X');d.step();d.up('X');d.step();
  assert.equal(d.source(),'ESI_DASH_JUMP_COMBO_SDK_XX');assert.equal(d.a.sourceCommandFlags&1,1);
  const serial=d.a.stateSerial;
  for(let frame=0;frame<30;frame++){d.step();assert.equal(d.a.grounded,false);assert.equal(d.a.stateSerial,serial);}
  assert.ok(d.a.animationStopped);assert.equal(d.a.sourceCommandFlags&1,1);fullWire(d);
  d.until(()=>d.a.grounded,'real Garpai support',600);d.until(()=>d.source()==='ESI_DASH_JUMP_COMBO_SDK_XXX','original landing X successor');
  assert.equal(d.source(),'ESI_DASH_JUMP_COMBO_SDK_XXX');assert.equal(d.a.sourceCommandFlags,0);d.noContact();fullWire(d);
 });
 test(`CA Native ${facing}: actual Garpai landing around .2 dispatches buffered 668XX before historical .5`,()=>{
  const d=device(facing);seedAirXX(d);d.down('X');d.step();d.up('X');d.step();d.time(.18);
  assert.ok(d.a.animationTime<.3);const serial=d.a.stateSerial;
  // Only seed the falling pose above the real line. Native integration must
  // discover and confirm support; no replacement line or forced grounded flag.
  d.a.x=0;d.a.y=3081;d.a.vy=-400;d.a.grounded=false;d.a.lineId=null;
  d.step();assert.equal(d.a.grounded,true,'actual native Garpai support query lands the actor');
  d.until(()=>d.a.stateSerial!==serial,'original support dispatch',3);
  assert.equal(d.source(),'ESI_DASH_JUMP_COMBO_SDK_XXX');d.noContact();fullWire(d);
 });
}

for(const mode of ['held','fresh'])test(`CA Native Shade Scratch ${mode} sampledX enters its attack only inside [.26,1)`,()=>{
 const d=device(1,28214);d.tap('A');assert.equal(d.source(),'SI_A_SCA_SHADE_SCRATCH');
 assert.deepEqual(d.profile.states[d.a.state].raw.EVENT_PROCESS_TIME0,{'1':authored.shade.start,'2':authored.shade.inputEnd,'3':authored.shade.start});
 if(mode==='held'){
  d.down('X');d.step();assert.ok(d.a.animationTime<authored.shade.start);assert.equal(d.source(),'SI_A_SCA_SHADE_SCRATCH');
  const serial=d.a.stateSerial;d.until(()=>d.a.stateSerial!==serial,'heldX at inclusive .26 enters attack',60);
 }else{d.time(.35);assert.ok(d.a.animationTime<authored.shade.inputEnd);d.down('X');d.step();}
 assert.equal(d.source(),'SI_A_SCA_SHADE_SCRATCH_ATTACK');d.noContact();fullWire(d);
});

for(const grounded of [true,false])test(`CA Native Ejection Buster attack end uses ${grounded?'ground JUMP_LANDING':'air JUMP_DOWN with 1.5 radius'}`,()=>{
 const d=device(grounded?1:-1,28035);d.down('A');d.step();d.up('A');
 assert.equal(d.a.skillId,28035);d.until(()=>d.source()==='SI_SA_SDK_EJECTION_BUSTER_ATTACK','releasing actual skill key enters attack',90);
 if(!grounded){d.a.y=10000;d.a.grounded=false;d.a.lineId=null;d.a.vy=0;}
 const serial=d.a.stateSerial,integrate=d.sim.integrate.bind(d.sim);let postPhysicsY;
 d.sim.integrate=(...args)=>{integrate(...args);if(args[0]===d.a)postPhysicsY=d.a.y;};
 d.until(()=>d.a.stateSerial!==serial,'attack callback resolves its own animation end',120);
 assert.equal(d.source(),grounded?'ESI_JUMP_LANDING':'ESI_JUMP_DOWN');
 assert.equal(d.a.grounded,grounded);
 if(!grounded)assert.equal(d.a.y,postPhysicsY-d.profile.referenceSemantics.lineRadius*1.5,'offset follows actual map physics exactly once');
 d.noContact();fullWire(d);
});

for(const freezeClock of ['hitStop','worldStop'])test(`CA Native sampledX survives ${freezeClock} while the original ZZZX clock stays frozen`,()=>{
 const d=device(freezeClock==='hitStop'?1:-1);reachZZZX(d);d.time(.2);
 const time=d.a.animationTime,serial=d.a.stateSerial;d.a[freezeClock]=.1;
 d.down('X');d.step();d.up('X');d.step();
 assert.equal(d.a.animationTime,time);assert.equal(d.a.stateSerial,serial);assert.ok(d.a.pendingPressed.includes('X'));
 for(let i=0;i<2;i++){d.step();assert.equal(d.a.animationTime,time);assert.equal(d.a.stateSerial,serial);}
 fullWire(d);
 d.until(()=>d.source()==='ESI_COMBO_SDK_ZZZXX','released freshX dispatches after its original .7 gate',120);
 assert.ok(!d.a.pendingPressed.includes('X'));assert.equal(d.a.sourceCommandFlags,0);d.noContact();fullWire(d);
});
