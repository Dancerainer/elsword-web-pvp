/** Independent compiled Raven callback snapshots + actual sampled-key chains. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createVeteranCommands,vcReferenceCommandSkillCancelAllowed} from '../../packages/combat-core/vc-commands.mjs';
const oracle=JSON.parse(readFileSync(new URL('../../contracts/vc-air-command-source-v3.json',import.meta.url)));
const empty=()=>({held:new Set(),pressed:new Set()});

test('air command Event/Future matches 1296 independently compiled unchanged Raven callback snapshots',()=>{
  const commands=createVeteranCommands({},null);
  assert.equal(oracle.targetClientMeasured,false);assert.equal(oracle.cases.length,1296);
  for(const c of oracle.cases){
    const state=oracle.states[c.state],def={...vcProfile.states[state],clip:{durationSeconds:10}};
    // The source oracle explicitly supplies IsAnimationEnd independently of
    // its clock. Keep that boundary rather than deriving the oracle from JS.
    const p={...vcProfile,physics:{...vcProfile.physics,WALK_SPEED:575},states:{[state]:def}};
    const a={state,animationTime:c.time,animationStopped:c.ended,animationBeforeTime:c.time-.001,animationOneshotTimer:0,
      grounded:!!(c.mask&4),facing:1,sourceCommandFlags:c.phase==='event'?c.mask&1:0,vx:c.phase==='event'?0:-100,vy:c.phase==='event'?0:-100,
      y:1000,passiveSpeed:{x:-1,y:-1},stats:{moveSpeedMultiplier:1},hp:100,hpMax:100,passivePolicy:{veteran:{hpLimit:.2}},
      sourceVeteranCommander:{loop:1},skillDisableGravity:true};
    const keys=empty();
    if(c.phase==='event'){
      keys.pressed.add('A');keys.held.add('A');if(c.mask&2)keys.pressed.add('X');
      // v4 intentionally widens the target follow-up window from the user's
      // explicit reproduction. This old oracle remains evidence of V5 only.
      const skill=vcReferenceCommandSkillCancelAllowed(a,def,keys),r=commands.runEvent(a,keys,p);
      const requested=skill?'SKILL_REQUEST':r.state;
      assert.equal(requested,oracle.requestStates[c.requested],JSON.stringify(c));
      if(!skill){assert.equal(r.flags,c.flags,JSON.stringify(c));assert.equal(a.skillDisableGravity,c.gravityDisabled,JSON.stringify(c));}
    }else{
      if(c.mask&2)keys.held.add('DOWN');if(c.mask&1)keys.held.add('RIGHT');
      const r=commands.runFuture(a,keys,p,1/60);
      assert.ok(Math.abs(r.vx-c.vx)<.00002,JSON.stringify(c));assert.ok(Math.abs(r.vy-c.vy)<.00002,JSON.stringify(c));
      assert.equal(r.flags,c.flags,JSON.stringify(c));
    }
  }
});

function physicalTakeoff(buffer,time,i,facing,mode){
  const direction=facing>0?'RIGHT':'LEFT';
  if(i===0||i===2)buffer.down(direction,time);if(i===1||i===10)buffer.up(direction,time);
  if(i===3)buffer.down('UP',time);if(i===4)buffer.up('UP',time);
  const attacks=mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:[[10,'X'],[20,'X'],[40,'X'],[70,'X']];
  for(const [frame,key]of attacks){if(i===frame)buffer.down(key,time);if(i===frame+1)buffer.up(key,time);}
}

for(const facing of[-1,1])for(const [state,at,mode]of[
 ['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX',.45,'zxx'],
 ['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',.27,'zxx'],
 ['RVC_DASH_JUMP_COMBO_XX_LOOP',.05,'xxxx'],
 ['RVC_DASH_JUMP_COMBO_XX_FINISH',.32,'xxxx'],
])test(`${mode} cancels ${state} into actual airborne Haze, facing ${facing}`,()=>{
  const {sim,a}=vcFixture({skillId:24221,position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true}),events=[];let sent=false;
  for(let i=0;i<180;i++){
    const time=sim.state.time+.001;physicalTakeoff(buffer,time,i,facing,mode);
    if(!sent&&a.state===state&&a.animationTime>=at){assert.equal(a.grounded,false);buffer.down('A',time);sent=true;}
    else if(sent)buffer.up('A',time);
    sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
  }
  assert.ok(sent,'physical command reaches the source cancellation window');
  assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===24221).length,1);
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.state==='RSI_A_RWT_BARRAGE_ATTACK_AIR'));
  assert.equal(a.state,'RSI_WAIT');assert.ok(!a.skillDisableGravity);
});

for(const facing of[-1,1])for(const mode of['zxx','xxxx'])test(`${mode} landing immediately accepts next sampled 668 chain, facing ${facing}`,()=>{
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true}),events=[];let second=-1;
  for(let i=0;i<360;i++){
    if(second<0&&i>20&&a.state==='RSI_JUMP_LANDING')second=i;
    const relative=second<0?i:i-second;
    physicalTakeoff(buffer,sim.state.time+.001,relative,facing,mode);
    sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
  }
  assert.ok(second>0);const target=mode==='zxx'?'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX':'RVC_DASH_JUMP_COMBO_XX_FINISH';
  assert.equal(events.filter(e=>e.type==='stateChanged'&&e.state===target).length,2);
  const landed=events.find(e=>e.type==='stateChanged'&&e.actorId==='vc'&&e.state==='RSI_JUMP_LANDING');
  const nextDash=events.find(e=>e.type==='stateChanged'&&e.actorId==='vc'&&e.state==='RSI_DASH'&&e.time>landed.time);
  assert.ok(nextDash.time-landed.time<=4/60,'new dash does not wait out landing animation');
});

test('same sampled packet X takes precedence over skill in 668X, next fresh skill press can cancel',()=>{
  const {sim,a}=vcFixture({skillId:24221,position:[-700,3080,0],gap:2500});
  const buffer=createInputBuffer({sampledLevels:true});let sent=-1,follow=-1;const events=[];
  for(let i=0;i<150;i++){
    const time=sim.state.time+.001;physicalTakeoff(buffer,time,i,1,'xxxx');
    if(sent<0&&a.state==='RSI_DASH_JUMP_COMBO_X'&&a.animationTime>.44){buffer.down('A',time);buffer.down('X',time);sent=i;}
    else if(i===sent+1){buffer.up('A',time);buffer.up('X',time);}
    else if(sent>=0&&i===sent+2){buffer.down('A',time);follow=i;}
    else if(i===follow+1)buffer.up('A',time);
    sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
    if(i===sent){assert.equal(a.state,'RSI_DASH_JUMP_COMBO_X');assert.equal(a.sourceCommandFlags&1,1);}
    if(i===follow&&follow>=0)assert.equal(a.state,'RSI_A_RWT_BARRAGE_ATTACK_AIR');
  }
  assert.ok(sent>=0&&follow===sent+2);assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===24221).length,1);
});

for(const facing of[-1,1])test(`four physical air X presses produce first / two hot / finish shots exactly once, facing ${facing}`,()=>{
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const buffer=createInputBuffer({sampledLevels:true}),events=[];
  for(let i=0;i<165;i++){
    physicalTakeoff(buffer,sim.state.time+.001,i,facing,'xxxx');
    sim.step(1/60,{vc:buffer.consume(sim.state.time+1/60)},{snapshot:false});events.push(...sim.drainEvents());
  }
  assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name==='DAMAGE_EFFECT_DASH_JUMP_X_BULLET').length,2);
  assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name==='DAMAGE_EFFECT_DASH_JUMP_X_BULLET_LOOP').length,2);
  assert.equal(events.filter(e=>e.type==='overheatHpChanged'&&e.name==='DAMAGE_EFFECT_DASH_JUMP_Xloop_BULLET_HIT').length,2);
  assert.equal(a.sourceVeteranCommander.loop,0);assert.equal(a.state,'RSI_WAIT');
});
