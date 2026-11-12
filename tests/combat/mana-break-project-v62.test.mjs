/** Current Web/native consumer acceptance, not original-client measurement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {fixture,read} from '../helpers/rs-fixture.mjs';
import {encodeOwnedState,applyOwnedState,validateOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
import {manaBreakGauge} from '../../apps/web/hud-values.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
const base=fixture(),native=base.sim;
function make(profession='RS',locked=true){
 const id=profession.toLowerCase(),sim=createSimulation({profile:read(`packages/combat-core/${id}-profile.json`),
  preset:read(`config/${id}-preset.json`),map:base.map,seed:2016,
  actors:[{id:'a',professionId:profession,team:0,position:[2022.98,2840,0],lineId:6,loadout:Array(8).fill(null),passives:[],guildPassives:[]},
   {id:'b',professionId:profession,team:1,position:[2500,2840,0],lineId:6,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
  nativeGeometry:native.nativeGeometry,nativeSkillValues:native.nativeSkillValues,nativeCritical:native.nativeCritical,nativeManaBreak:native.nativeManaBreak});
 const a=sim.actor('a');a.mp=300;if(locked)a.canNotAttackTime=100;return {sim,a,b:sim.actor('b')};
}
for(const profession of ['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'])test(`${profession}: actual Gauge no bar for short combo taps; intentional hold charges only after .5 and keeps100 minimum`,()=>{
 const {sim,a}=make(profession);let max=0;
 for(let n=0;n<80;n++){
  const down=n%4<2;sim.step(1/60,{a:{held:down?['Z']:[],pressed:n%4===0?['Z']:[],released:n%4===2?['Z']:[]}},{snapshot:false});
  max=Math.max(max,manaBreakGauge(a).charge);
 }assert.equal(max,0,'short repeated taps must never reveal a transient charge bar');
 for(let n=0;n<29;n++){sim.step(1/60,{a:{held:['X'],pressed:n===0?['X']:[]}},{snapshot:false});assert.equal(a.manaBreak.charge,0);}
 sim.step(1/60,{a:{held:['X']}},{snapshot:false});assert.equal(a.manaBreak.charge,0,'threshold Event precedes first eligible Gauge frame');
 sim.step(1/60,{a:{held:['X']}},{snapshot:false});assert.ok(a.manaBreak.charge>0);assert.ok(a.manaBreak.charge<3);
 assert.equal(a.manaBreak.minimumCharge,100);assert.equal(a.manaBreak.pendingCost,0);assert.equal(a.manaBreak.active,false);
 for(let n=0;n<50;n++)sim.step(1/60,{a:{held:['X']}},{snapshot:false});
 assert.ok(a.manaBreak.charge>=100);sim.step(1/60,{a:{released:['X']}},{snapshot:false});assert.equal(manaBreakGauge(a).charge,0);
});
test('actual RS sampled Z combo keeps changing attack states without exposing the short-tap bar',()=>{
 const {sim,a}=make('RS',false),buffer=createSampledKeyboardBuffer();let max=0;
 for(let n=0;n<180;n++){
  if(n%8===0)buffer.down('Z',n/60);if(n%8===3)buffer.up('Z',n/60);
  sim.step(1/60,{a:buffer.consume((n+1)/60)},{snapshot:false});max=Math.max(max,a.manaBreak.charge);
 }assert.equal(max,0);assert.ok(sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='a'&&e.state.includes('COMBO_Z')).length>=3);
});
test('actual owned and critical samples retain the partial intent clock; continuation is packet-identical',()=>{
 const f=make(),peer=make();for(let n=0;n<13;n++)f.sim.step(1/60,{a:{held:['Z']}},{snapshot:false});
 const report=encodeOwnedState(f.sim,'a',{epoch:0,frameSeq:1});validateOwnedState(report);
 assert.deepEqual(encodeCriticalAction(report,{id:1}).actor.manaBreak,report.actor.manaBreak);
 const wire=decodeNetworkBinary(encodeNetworkBinary(report));assert.deepEqual(wire.actor.manaBreak,report.actor.manaBreak);
 applyOwnedState(peer.sim,'a',wire);
 for(let n=0;n<30;n++){
  for(const q of [f,peer])q.sim.step(1/60,{a:{held:['Z']}},{snapshot:false});
  assert.deepEqual(peer.a.manaBreak,f.a.manaBreak);
 }
 const bad=structuredClone(report);bad.actor.manaBreak.holdIntent.z=.51;assert.throws(()=>validateOwnedState(bad));
});
test('deliberate hold still reserves once, preserves last reaction/KD and spends only after .7 stop',()=>{
 const {sim,a,b}=make();for(let n=0;n<80;n++)sim.step(1/60,{a:{held:['Z']}},{snapshot:false});
 a.knockdown.now=73;const charge=a.manaBreak.charge;
 const hit=sim.applyHit(b,a,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.00001},REACT_TYPE:2,FORCE_DOWN:0,STOP_TIME_DEF:0,BACK_SPEED_X:0,BACK_SPEED_Y:0},{kind:'character'});
 assert.equal(hit.accepted,true);assert.equal(a.state,'RSI_DAMAGE_BIG_FRONT');assert.equal(a.manaBreak.pendingCost,charge);
 const mp=a.mp;sim.applyHit(b,a,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:2},{kind:'character'});assert.equal(a.mp,mp);
 for(let n=0;n<30;n++)sim.step(1/60,{}, {snapshot:false});assert.equal(a.state,'RSI_DAMAGE_BIG_FRONT');assert.equal(a.mp,mp);assert.equal(a.knockdown.now,73);
 for(let n=0;n<60&&a.manaBreak.pendingDown;n++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(a.manaBreak.pendingDown,undefined);assert.equal(a.knockdown.now,73);
 assert.equal(sim.state.events.filter(e=>e.type==='manaBreakConsumed').length,1);assert.ok(a.mp<mp-charge+1);
});
test('a remote owner report keeps its sampled intent/latch; absence of a foreign keyboard packet is not a release',()=>{
 const source=make(),peer=make();peer.sim.networkOwnerId='b';
 for(let n=0;n<13;n++)source.sim.step(1/60,{a:{held:['Z']}},{snapshot:false});
 applyOwnedState(peer.sim,'a',encodeOwnedState(source.sim,'a',{epoch:0,frameSeq:1}));
 const partial=structuredClone(peer.a.manaBreak.holdIntent);
 peer.sim.step(1/60,{}, {snapshot:false});assert.deepEqual(peer.a.manaBreak.holdIntent,partial);
 for(let n=0;n<30;n++)source.sim.step(1/60,{a:{held:['Z']}},{snapshot:false});
 applyOwnedState(peer.sim,'a',encodeOwnedState(source.sim,'a',{epoch:0,frameSeq:2}));
 const before=peer.a.manaBreak.charge;assert.equal(peer.a.manaBreak.canCharge,true);
 peer.sim.step(1/60,{}, {snapshot:false});
 // Frozen source DetonationFrameMove18..42 consumes one Event latch and
 // explicitly writes false. No foreign packet may invent a new Event.
 assert.equal(peer.a.manaBreak.canCharge,false);
 assert.equal(peer.a.manaBreak.charge,Math.fround(before+Math.fround(130*Math.fround(1/60))));
 assert.equal(peer.a.manaBreak.holdIntent.z,.5);
});
