/** Independent expectations: target declarations, cited C++ branches, and
 * user-reported cancel/height invariants. Not original-client recordings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {vcAirSkillCancelAllowed} from '../../packages/combat-core/vc-air-skills.mjs';
import {burnVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {vcCommandAirDashCancelDirection} from '../../packages/combat-core/vc-commands.mjs';
const dt=1/60,H='RSI_A_RWT_BARRAGE_ATTACK_AIR',F='RSI_A_RWT_FLAME_SWORD_FLY',ZX='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX';
function tick(f,input={}){f.sim.step(dt,{vc:input},{snapshot:false});return f.sim.drainEvents();}
function airborne(skillId,facing=1){const f=vcFixture({skillId,position:[0,9000,0],gap:2500,facing});f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','explicit-high-air-fixture');return f;}
function toEnd(f){for(let i=0;i<200&&!f.a.animationStopped;i++)tick(f);assert.ok(f.a.animationStopped);assert.equal(f.a.grounded,false);}

for(const facing of[-1,1])for(const skillId of[24218,24221])test(`air skill ${skillId} holds one end pose, follows raw walk/Down, lands without JumpDown/roll (${facing})`,()=>{
  const f=airborne(skillId,facing),n=skillId===24218?F:H;
  tick(f,{pressed:['A']});assert.equal(f.a.state,n);toEnd(f);
  const t=f.a.animationTime,y=f.a.y;
  for(let i=0;i<8;i++){
    const events=tick(f);assert.equal(f.a.state,n);assert.equal(f.a.animationTime,t);
    assert.equal(f.a.sourcePendingState,undefined,'an ended airborne pose must not request JumpDown or landing');
    assert.ok(!events.some(e=>e.type==='sourceStateRequested'&&['RSI_JUMP_DOWN','RSI_JUMP_LANDING'].includes(e.state)));
  }
  assert.ok(f.a.y<y);
  const priorVy=f.a.vy;
  tick(f,{held:[facing>0?'RIGHT':'LEFT','DOWN']});
  assert.ok(Math.abs(f.a.vx-(f.profile.physics.WALK_SPEED-f.profile.physics.RELOAD_ACCEL*dt)*facing)<.01);
  assert.ok(f.a.vy<=priorVy-dt*f.profile.physics.G_ACCEL+.01||f.a.vy===f.profile.physics.MAX_G_SPEED);
  let landed=false;
  for(let i=0;i<360;i++){const es=tick(f);for(const e of es.filter(e=>e.type==='stateChanged')){assert.ok(!['RSI_JUMP_DOWN','RSI_DASH_JUMP_POWER_LANDING'].includes(e.state));if(e.state==='RSI_JUMP_LANDING')landed=true;}if(f.a.state==='RSI_WAIT')break;}
  assert.ok(landed);assert.equal(f.a.state,'RSI_WAIT');
});

for(const facing of[-1,1])for(const command of['Z','X','66Z','66X','skill'])test(`ended air Haze accepts fresh ${command} (${facing}) without new jump impulse`,()=>{
  const f=airborne(24221,facing);f.a.loadout[1]={...f.a.loadout[0],skillId:24218};
  tick(f,{pressed:['A']});assert.equal(vcAirSkillCancelAllowed(f.a,f.profile.states[H]),false);toEnd(f);
  const input=createInputBuffer({sampledLevels:true}),dir=facing>0?'RIGHT':'LEFT';
  for(let i=0;i<(command.startsWith('66')?3:1);i++){
    const time=f.sim.state.time+.001;
    if(command.startsWith('66')){input[i===1?'up':'down'](dir,time);if(i===2)input.down(command.at(-1),time);}
    else input.down(command==='skill'?'S':command,time);
    tick(f,input.consume(f.sim.state.time+dt));
  }
  const dash=command.startsWith('66'),successor=command==='skill'?F:command==='Z'?'RSI_JUMP_COMBO_Z':command==='X'?'RSI_JUMP_COMBO_X':command==='66Z'?'RSI_DASH_JUMP_COMBO_Z':'RSI_DASH_JUMP_COMBO_X';
  assert.equal(f.a.state,H,'the fresh input requests a successor after this frame physics; it does not apply in post');
  assert.equal(f.a.sourcePendingState?.state,dash?'RSI_DASH_JUMP':successor);
  if(dash)assert.deepEqual(f.a.sourcePendingState.productPressed,[command.at(-1)],'the explicit product extension carries the simultaneous attack to dash apply');
  tick(f,input.consume(f.sim.state.time+dt));
  if(dash){
    assert.equal(f.a.state,'RSI_DASH_JUMP','the first eligible outer apply enters dash');
    assert.equal(f.a.sourcePendingState?.state,successor,'the dash post requests its attack after apply');
    tick(f,input.consume(f.sim.state.time+dt));
  }
  assert.equal(f.a.state,successor);
  assert.ok(f.a.vy<f.profile.physics.DASH_JUMP_SPEED,'no new 2200 jump launch');
});

for(const facing of[-1,1])test(`ten rapid air 66ZX repeats descend rather than accumulate altitude (${facing})`,()=>{
  const f=airborne(24221,facing),input=createInputBuffer({sampledLevels:true}),heights=[];
  f.sim.enter(f.a,'RSI_DASH_JUMP','explicit-initial-air');
  let phase=-1,dir=facing>0?'RIGHT':'LEFT',previous='';
  for(let i=0;i<900&&heights.length<10;i++){
    const time=f.sim.state.time+.001,n=f.a.state;
    input.up('Z',time);input.up('X',time);
    if(n==='RSI_DASH_JUMP'&&previous!==n)input.down('Z',time);
    if(n==='RSI_DASH_JUMP_COMBO_Z'&&f.a.animationTime>.07&&!(f.a.sourceCommandFlags&2))input.down('X',time);
    if(n===ZX&&phase<0&&vcCommandAirDashCancelDirection(f.a,f.profile.states[n],{pureDoubleRight:true})){phase=0;dir=f.a.facing>0?'LEFT':'RIGHT';heights.push(f.a.y);}
    if(phase>=0){if(phase===0||phase===2)input.down(dir,time);if(phase===1||phase===3)input.up(dir,time);if(phase===2)input.down('Z',time);phase=phase===3?-1:phase+1;}
    previous=n;tick(f,input.consume(f.sim.state.time+dt));
  }
  assert.equal(heights.length,10);
  for(let i=1;i<heights.length;i++)assert.ok(heights[i]<=heights[i-1],`cycle ${i} rises: ${heights}`);
});

test('overheat bypasses equipment and is attack-based, not an invented fixed max-HP percentage',()=>{
  const first=vcFixture(),second=vcFixture();
  first.a.stats.damageReduction=0;second.a.stats.damageReduction=.9;second.a.hpMax=second.a.hp=400000;
  const name='DAMAGE_EFFECT_DEADLY_RAID_LARGE';
  const a=burnVeteranOverheat(first.sim,first.a,name,{power:1}),b=burnVeteranOverheat(second.sim,second.a,name,{power:1});
  // The public cost is now the actual Float32 HP delta after protective
  // clamping. At800000HP one ULP is.0625; two HP bases may round oppositely.
  assert.ok(Math.abs(a-b)<=.0625);assert.ok(Math.abs(a-2000*3.6835*.6*.2*.6)<=.0625);
});
