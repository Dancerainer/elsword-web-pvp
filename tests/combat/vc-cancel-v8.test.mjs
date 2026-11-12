// Explicit v8 equipment inputs retain the historical physical input timings.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
/** Target declarations / fixedV5 literals and user-requested air follow-up
 * invariants are independent expectations. Explicit historical production equipment,
 * converted motion samples, WASM consumers and original Garpai geometry run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcProductionFixture,vcProductionPreset} from '../helpers/vc-production-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60,ZX='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX',ZXX=ZX+'X',FINISH='RVC_DASH_JUMP_COMBO_XX_FINISH';
const tick=(f,input={})=>{f.sim.step(dt,{vc:input},{snapshot:false});return f.sim.drainEvents();};
const setup=(facing,skillId=24221)=>{
  const f=vcProductionFixture({actor:{facing,position:[-700*facing,3080,0]},preset:{attributes:beforeBalanceV3(vcProductionPreset).attributes,loadout:[{skillId},...Array(7).fill(null)]}});
  return {...f,buffer:createInputBuffer({sampledLevels:true}),events:[]};
};
function change(f,key,down){f.buffer[down?'down':'up'](key,f.sim.state.time+.001);}
function consume(f){const es=tick(f,f.buffer.consume(f.sim.state.time+dt));f.events.push(...es);return es;}
function airChain(f,mode,{at=null}={}){
  const d=f.a.facing>0?'RIGHT':'LEFT';
  for(let i=0;i<160;i++){
    if(i===0||i===2)change(f,d,true);if(i===1||i===10)change(f,d,false);
    if(i===3)change(f,'UP',true);if(i===4)change(f,'UP',false);
    const shots=mode==='zx'?[[10,'Z'],[20,'X']]:mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:
      mode==='x'?[[10,'X']]:mode==='xx'?[[10,'X'],[20,'X']]:[[10,'X'],[20,'X'],[40,'X'],[70,'X']];
    for(const[at,key]of shots){if(i===at)change(f,key,true);if(i===at+1)change(f,key,false);}
    consume(f);
    const n=mode==='zx'?ZX:mode==='zxx'?ZXX:mode==='x'?'RSI_DASH_JUMP_COMBO_X':mode==='xxStart'?'RVC_DASH_JUMP_COMBO_XX_START':mode==='xLoop'?'RVC_DASH_JUMP_COMBO_XX_LOOP':FINISH;
    const threshold=at??(mode==='zx'?.42:mode==='zxx'?.24:mode==='x'?.433:mode==='xLoop'?.001:.3);
    if(f.a.state===n&&f.a.animationTime>threshold+.025&&!f.a.grounded)return;
  }
  assert.fail('physical ground668 chain did not reach its requested aerial cancel phase '+mode);
}
for(const facing of[-1,1])for(const mode of['zx','zxx','x','xx','xxxx','xLoop'])for(const next of['66Z','66X','skill'])for(const turn of next==='skill'?[1]:[-1,1])
test(`v8 equipment physical668 ${mode} → ${next}, facing${facing}, turn${turn}`,()=>{
  const f=setup(facing);airChain(f,mode);
  const before={y:f.a.y,vy:f.a.vy,time:f.a.animationTime,state:f.a.state};
  if(mode==='zx')assert.ok(before.time<.635,'test the early window, not stopped.966 pose');
  if(next==='skill')change(f,'A',true);
  else{
    const d=facing*turn>0?'RIGHT':'LEFT';
    change(f,d,true);consume(f);change(f,d,false);consume(f);
    change(f,d,true);change(f,next.at(-1),true);
  }
  consume(f);
  const expected=next==='skill'?'RSI_A_RWT_BARRAGE_ATTACK_AIR':next==='66Z'?'RSI_DASH_JUMP_COMBO_Z':'RSI_DASH_JUMP_COMBO_X';
  assert.equal(f.a.state,expected);assert.equal(f.a.grounded,false);
  assert.equal(f.a.facing,facing*turn);
  assert.ok(f.a.vy<2200,'cancellation does not create another dash-jump launch');
  if(next!=='skill')assert.equal(f.a.skillId,null);
  assert.ok(!f.events.some(e=>e.type==='stateChanged'&&e.actorId==='vc'&&e.state==='RSI_JUMP_LANDING'));
});
for(const facing of[-1,1])for(const mode of['zx','zxx','x','xxStart'])for(const next of['66Z','skill'])
test(`production ${mode} rejects ${next} before its aerial recovery (${facing})`,()=>{
  const f=setup(facing);airChain(f,mode,{at:mode==='zxx'||mode==='xxStart'?.02:.1});
  const prior=f.a.state;
  if(next==='skill'){assert.equal(f.sim.skillAvailability('vc',0).available,false);change(f,'A',true);consume(f);}
  else{
    const d=facing>0?'RIGHT':'LEFT';change(f,d,true);consume(f);change(f,d,false);consume(f);change(f,d,true);change(f,'Z',true);consume(f);
  }
  assert.equal(f.a.state,prior,'illegal early input must not bypass its startup');
});
for(const facing of[-1,1])test(`earlyZX follow-ups never accumulate positive lifts across ten repeats (${facing})`,()=>{
  const f=setup(facing);f.a.grounded=false;f.a.lineId=null;f.a.y=9000;f.a.vy=0;
  f.sim.enter(f.a,'RSI_DASH_JUMP','explicit-high-air-trajectory');
  let previous='',phase=-1,dir=facing>0?'RIGHT':'LEFT';const heights=[];
  for(let i=0;i<800&&heights.length<10;i++){
    change(f,'Z',false);change(f,'X',false);
    if(f.a.state==='RSI_DASH_JUMP'&&previous!==f.a.state)change(f,'Z',true);
    if(f.a.state==='RSI_DASH_JUMP_COMBO_Z'&&f.a.animationTime>.07&&!(f.a.sourceCommandFlags&2))change(f,'X',true);
    if(f.a.state===ZX&&phase<0&&f.a.animationTime>.43){phase=0;dir=f.a.facing>0?'LEFT':'RIGHT';heights.push(f.a.y);}
    if(phase>=0){if(phase===0||phase===2)change(f,dir,true);else change(f,dir,false);
      if(phase===2)change(f,'Z',true);phase=phase===3?-1:phase+1;}
    previous=f.a.state;consume(f);
  }
  assert.equal(heights.length,10);
  for(let i=1;i<heights.length;i++)assert.ok(heights[i]<=heights[i-1]+.01,JSON.stringify(heights));
});
for(const facing of[-1,1])test(`earlyZX continuation guard survives JSON/network snapshot and clears on fullZXX (${facing})`,()=>{
  const f=setup(facing);airChain(f,'zx');const d=facing>0?'RIGHT':'LEFT';
  change(f,d,true);consume(f);change(f,d,false);consume(f);change(f,d,true);change(f,'Z',true);consume(f);
  assert.equal(f.a.sourceVeteranCommander.airFollowupNoLift,true);
  assert.doesNotThrow(()=>validateOwnedState(encodeOwnedState(f.sim,'vc')));
  const copy=setup(facing);copy.sim.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));
  let completeZxx=false;
  for(let i=0;i<180;i++){
    const keys={pressed:i===5||i===17?['X']:[],held:[]};tick(f,keys);tick(copy,keys);
    assert.deepEqual(JSON.parse(JSON.stringify(copy.sim.snapshot())),JSON.parse(JSON.stringify(f.sim.snapshot())));
    if(f.a.state===ZXX){completeZxx=true;if(f.a.animationTime>.08)assert.equal(f.a.sourceVeteranCommander.airFollowupNoLift,undefined);}
  }
  assert.ok(completeZxx,'guard does not suppress the requested secondX/fullZXX route');
  assert.equal(f.a.sourceVeteranCommander.airFollowupNoLift,undefined);
});
// Independently transcribed target2016 named fields. Original196's .93 is a
// direction-only literal; it does not create an ordinary skill gate.
const gates=[
  [24025,'RSI_SI1_MAXIMUM_CANNON',1.65,1.65,false],
  [24218,'RSI_A_RWT_FLAME_SWORD_GROUND',.566,.566,false],
  [24213,'RSI_A_RVC_NAPALM_GRENADE',1.1,1.1,false],
  [24214,'RSI_A_RWT_MENTAL_BREAK',.325,.56,false],
  [24028,'RSI_SI3_SEVEN_BURST',1.85,1.85,false],
  [24034,'RSI_SA_RWT_REVOLVER_CANNON_OVER_END',.5,.5,true],
  [24022,'RVC_SI_SA_IGNITION_CROW_FIRE',.4,.3,false],
  [24022,'RVC_SI_SA_IGNITION_CROW_FIRE_OVERHEAT',.4,.3,true],
  [24022,'RVC_SI_SA_IGNITION_CROW_OVERHEAT_END',.45,.45,true],
  [24023,'RVC_SI_SA_IGNITION_CROW_INCINERATION_FIRE',.4,.3,false],
  [24023,'RVC_SI_SA_IGNITION_CROW_INCINERATION_FIRE_OVERHEAT',.4,.3,true],
  [24023,'RVC_SI_SA_IGNITION_CROW_INCINERATION_OVERHEAT_END',.45,.45,true],
  [24024,'RVC_SI_SA_DEADLY_RAID_FINISH',1.5,1.5,false],
  [24024,'RVC_SI_SA_DEADLY_RAID_FINISH_OVERHEAT',1.5,1.5,true],
  [24024,'RVC_SI_SA_DEADLY_RAID_END',.95,.95,true],
];
function toSkillGate(f,skillId,state,at,hot){
  for(let i=0;i<900;i++){
    const heat=i<220&&i%2===0&&hot;
    if(i===0||heat)change(f,'A',true);else change(f,'A',false);
    consume(f);
    if(f.a.state===state&&f.a.animationTime>at+.02)return;
  }
  assert.fail('actual cast never reaches recovery '+state);
}
for(const facing of[-1,1])for(const[skillId,state,skillAt,dashAt,hot]of gates)for(const kind of['skill',...(dashAt===null?[]:['66Z','66Z-next-packet'])])
test(`actual cast ${skillId}${hot?' hot':''} ${state} accepts ${kind}, facing${facing}`,()=>{
  const f=setup(facing,skillId),nextSkill=skillId===24218?24221:24218;f.a.loadout[1]={...f.a.loadout[0],skillId:nextSkill};
  toSkillGate(f,skillId,state,kind==='skill'?skillAt:dashAt,hot);
  assert.equal(f.a.grounded,true);
  if(kind==='skill'){assert.equal(f.sim.skillAvailability('vc',1).available,true);change(f,'S',true);consume(f);
    const expected=nextSkill===24218?'RSI_A_RWT_FLAME_SWORD_GROUND':'RSI_A_RWT_BARRAGE_ATTACK_STAND';
    if(f.a.sourcePendingState){assert.equal(f.a.sourcePendingState.state,expected);consume(f);}assert.equal(f.a.state,expected);}
  else{
    const d=facing>0?'RIGHT':'LEFT';change(f,d,true);consume(f);change(f,d,false);consume(f);change(f,d,true);
    if(kind==='66Z')change(f,'Z',true);
    consume(f);
    if(kind!=='66Z'){if(f.a.sourcePendingState?.state==='RSI_DASH')consume(f);assert.equal(f.a.state,'RSI_DASH','physical66 cancels the cast recovery');change(f,'Z',true);consume(f);}
    if(f.a.sourcePendingState?.state==='RSI_DASH')consume(f);
    if(f.a.sourcePendingState?.state==='RSI_DASH_COMBO_Z')consume(f);
    assert.equal(f.a.state,'RSI_DASH_COMBO_Z');assert.equal(f.a.skillId,null);
  }
});
for(const facing of[-1,1])for(const[skillId,state,at]of[[24025,'RSI_SI1_MAXIMUM_CANNON',1.65],[24215,'RSI_A_RF_BREAKING_FIST',.62],[24214,'RSI_A_RWT_MENTAL_BREAK',.73]])
test(`actual ${skillId} uses target ATTACK_CANCEL_AFTER→freshZ (${facing})`,()=>{
  const f=setup(facing,skillId);toSkillGate(f,skillId,state,at,false);change(f,'Z',true);consume(f);
  if(f.a.sourcePendingState){assert.equal(f.a.sourcePendingState.state,'RSI_COMBO_Z');consume(f);}
  assert.equal(f.a.state,'RSI_COMBO_Z');assert.equal(f.a.skillId,null);
});
