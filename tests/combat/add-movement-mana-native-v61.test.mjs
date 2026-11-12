import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addFixture} from '../helpers/add-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {recoverAddSecondUp} from '../../apps/web/add-second-up-input-v58.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const dt=1/60;
function owner(sim,a){const profile=sim.profileFor(a),raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:sim.state.step})));
 const report=validateOwnedState(raw);validateOwnedReferences(report,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 applyOwnedState(sim,a.id,report);encodeCriticalAction(report,{seq:sim.state.step+1});return report;}
function driver(f){const {sim,a}=f,buffer=createInputBuffer({sampledLevels:true}),events=[];return {buffer,events,
 step(){const input=recoverAddSecondUp(buffer.consume(sim.state.time+dt),a);sim.step(dt,{[a.id]:input},{snapshot:false});events.push(...sim.drainEvents());
  if(this.mirror){this.mirror.step(dt,{[a.id]:structuredClone(input)},{snapshot:false});this.mirror.drainEvents();}},
 edge(key,on){buffer[on?'down':'up'](key,sim.state.time+.001);},
 tap(key){this.edge(key,true);this.step();this.edge(key,false);this.step();},
 until(fn,max=120){for(let n=0;n<max&&!fn();n++)this.step();assert.ok(fn(),'bounded original state/input gate');}};}
for(const id of ['LP','MM','DE'])for(const facing of [-1,1])test(`${id}/${facing}: real sampled88Z coalesced secondUP+Z fires once and lands via original JUMPLANDING`,()=>{
 const f=originalAddFixture(id),{sim,a,b}=f;b.team=a.team;a.facing=facing;const d=driver(f);d.step();
 d.edge('UP',true);d.step();const base=sim.state.time;d.buffer.up('UP',base+.002);d.buffer.down('UP',base+.005);d.buffer.up('UP',base+.008);d.buffer.down('Z',base+.009);d.step();
 assert.equal(a.state,'ANSI_LEVITATION_WAIT');assert.equal(a.sourceAddMovement.projectAirAttack?.key,'Z');owner(sim,a);
 if(id==='LP'&&facing===1){d.mirror=originalAddFixture(id).sim;d.mirror.restore(JSON.parse(JSON.stringify(sim.snapshot())));}
 d.edge('Z',false);d.step();assert.equal(a.state,'RSI_JUMP_COMBO_Z');assert.ok(a.y-3080<60);assert.equal(a.sourceAddMovement.projectAirAttack,undefined);
 d.until(()=>a.grounded&&a.state==='RSI_JUMP_LANDING');d.until(()=>a.state==='RSI_WAIT');
 const changes=d.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id);assert.equal(changes.filter(e=>e.state==='RSI_JUMP_COMBO_Z').length,1);
 assert.equal(changes.filter(e=>e.state==='RSI_DASH_JUMP_LANDING').length,0);
 if(d.mirror)assert.deepEqual(d.mirror.snapshot(),sim.snapshot(),'same canonical sampled inputs reproduce pending attack and all subsequent pose/landing state');
});
for(const id of ['LP','MM','DE'])for(const facing of [-1,1])test(`${id}/${facing}: held2 real low8X repeats after original support without extra hover or auto repeat`,()=>{
 const f=originalAddFixture(id),{sim,a,b}=f;b.team=a.team;a.facing=facing;
 // Original Garpai lower outside platform: no guessed floor or trampoline.
 Object.assign(a,{x:-1800,y:2600,z:0,lineId:1,lastTouchLineId:1,landPosition:[-1800,2600,0],grounded:true});
 const d=driver(f);d.step();d.edge('DOWN',true);d.step();assert.equal(a.grounded,true);
 for(let n=0;n<3;n++){
  const base=sim.state.time;d.buffer.down('UP',base+.001);d.buffer.down('X',base+.006);d.step();
  assert.equal(a.state,'RSI_JUMP_UP');assert.equal(a.sourceAddMovement.projectAirAttack?.key,'X');owner(sim,a);
  d.edge('UP',false);d.edge('X',false);d.step();assert.equal(a.state,'RSI_JUMP_COMBO_X');assert.ok(a.y-2600<60);
  d.until(()=>a.grounded&&a.state==='RSI_JUMP_LANDING');
 }
 const changes=d.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id);
 assert.equal(changes.filter(e=>e.state==='RSI_JUMP_COMBO_X').length,3);assert.equal(changes.filter(e=>e.state==='ANSI_LEVITATION_WAIT').length,0);
 for(let n=0;n<40;n++)d.step();assert.equal(d.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id&&e.state==='RSI_JUMP_COMBO_X').length,3);
});
for(const id of ['LP','MM','DE'])for(const facing of [-1,1])test(`${id}/${facing}: thirdZ real input leaves original Garpai edge with source550 momentum`,()=>{
 const f=originalAddFixture(id),{a,b}=f;b.team=a.team;a.facing=facing;a.x=1150*facing;const d=driver(f);d.step();
 d.tap('Z');d.tap('Z');d.until(()=>f.sim.profileFor(a).states[a.state].sourceState==='ANSI_COMBO_ZZ');
 d.until(()=>a.animationTime>.11);d.tap('Z');d.until(()=>f.sim.profileFor(a).states[a.state].sourceState==='ANSI_COMBO_ZZZ');
 d.until(()=>a.state==='RSI_JUMP_DOWN');assert.equal(a.vx,550*facing);assert.equal(a.grounded,false);owner(f.sim,a);
});
for(const id of ['LP','MM','DE'])test(`${id}: originalXXZZ actual sampled chain produces minimum2 loops, exact1MP events, real helper contact`,()=>{
 const f=originalAddFixture(id),{sim,a,b}=f;a.x=-600;b.x=600;a.mp=300;const d=driver(f);d.step();
 const contacts=[],apply=sim.applyHit.bind(sim);sim.applyHit=(attacker,target,data,origin)=>{
  const e=origin.kind==='effect'?sim.state.effects.find(row=>row.id===origin.id):null,result=apply(attacker,target,data,origin);
  if(result.accepted&&e?.name==='DamageEffect_AN_Combo_XXZZ_Loop')contacts.push({amount:result.amount,state:target.state});return result;};
 d.tap('X');d.tap('X');d.until(()=>sim.profileFor(a).states[a.state].sourceState==='ANSI_COMBO_XX');
 d.until(()=>a.animationTime>.32);d.tap('Z');d.until(()=>a.state==='ANSI_COMBO_XXZ');
 d.until(()=>a.animationTime>.42);d.tap('Z');d.until(()=>a.state==='ANSI_COMBO_XXZZ_START');
 d.until(()=>a.state==='ANSI_COMBO_XXZZ_LOOP');owner(sim,a);
 // Controlled defender placement at the original member's130 offset; the
 // input chain, original helper pose and actual contact consumer stay live.
 Object.assign(b,{x:a.x+130*a.facing,y:a.y,z:a.z,grounded:true,lineId:a.lineId,lastTouchLineId:a.lastTouchLineId,landPosition:[a.x+130*a.facing,a.y,a.z]});
 d.until(()=>a.state==='ANSI_COMBO_XXZZ_FINISH');
 const shots=d.events.filter(e=>e.type==='addXxzzLoop'&&e.actorId===a.id);assert.equal(shots.length,2);assert.ok(shots.every(e=>e.resource==='MP'&&e.declaredAmount===1));
 assert.ok(d.events.some(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AN_Combo_XXZZ_Loop'));
 assert.ok(contacts.some(c=>c.amount>0),'original helper causes actual HP damage and reaction');
 // Original produced helper may already be retired when Finish is entered.
 assert.equal(a.sourceAddCombat.xxzzLoops,0);owner(sim,a);
});
const strike={DAMAGE:{PHYSIC:.1},DAMAGE_TYPE:0,REACT_TYPE:2,BACK_SPEED_X:0,BACK_SPEED_Y:0,FORCE_DOWN:7,MP_GAIN:0,MP_GIVE:0,STOP_TIME_ATT:0,STOP_TIME_ATK:0,STOP_TIME_DEF:0};
for(const id of ['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'])test(`${id}: actual received hit freezes reaction then consumes fullMana once without KD reset, including owned roundtrip`,()=>{
 const {sim,a,b}=addFixture('LP',{targetProfession:id});b.mp=250;b.manaBreak.charge=130;b.knockdown.now=83;
 const events=[];const hit=sim.applyHit(a,b,strike,{kind:'fixture',powerMultiplier:1});events.push(...sim.drainEvents());assert.equal(hit.accepted,true);
 const reaction=b.state,mp=b.mp,clock=b.animationTime;assert.ok(b.manaBreak.pendingDown);assert.equal(b.manaBreak.active,true);
 assert.ok(!['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE'].includes(reaction));owner(sim,b);
 assert.equal(sim.applyHit(a,b,strike,{kind:'fixture',powerMultiplier:1}).accepted,false,'reserved future down rejects duplicate hit/cost');
 for(let n=0;n<30;n++){sim.step(dt,{}, {snapshot:false});events.push(...sim.drainEvents());assert.equal(b.state,reaction);assert.equal(b.animationTime,clock);assert.equal(b.mp,mp);}
 for(let n=0;n<20&&!events.some(e=>e.type==='manaBreakConsumed'&&e.actorId===b.id);n++){sim.step(dt,{}, {snapshot:false});events.push(...sim.drainEvents());}
 const consumed=events.filter(e=>e.type==='manaBreakConsumed'&&e.actorId===b.id);assert.equal(consumed.length,1);assert.ok(Math.abs(consumed[0].mp-(mp-130))<.1);
 assert.equal(b.manaBreak.pendingDown,undefined);assert.equal(b.manaBreak.active,false);assert.equal(b.knockdown.activated,false);assert.equal(b.knockdown.now,90);owner(sim,b);
});
test('Mana on an RT_DOWN hit preserves KD, while an ordinary below100 RT_DOWN retains reset',()=>{
 for(const charge of [130,99]){const {sim,a,b}=addFixture('LP');b.manaBreak.charge=charge;b.knockdown.now=83;
  sim.applyHit(a,b,{...strike,REACT_TYPE:3},{kind:'fixture',powerMultiplier:1});assert.equal(b.knockdown.now,charge>=100?83:0);}
});
for(const [id,state,key]of [...['LP','MM','DE'].flatMap(id=>[[id,'ANSI_COMBO_XXZZ_LOOP','Z'],[id,'ANSI_DASH_JUMP_COMBO_XX_CHARGE','X']]),['MM','ANSI_AMM_COMBO_XXDownX_LOOP','X']])test(`${id}/${state}: original charge state refuses voluntaryMana until an actual received hit opens it`,()=>{
 const {sim,a,b}=addFixture(id);sim.enter(a,state,'controlled-original-charge-entry');
 if(state.includes('DASH_JUMP')){a.grounded=false;a.lineId=null;a.y=3400;}
 for(let n=0;n<6;n++)sim.step(dt,{[a.id]:{held:[key]}},{snapshot:false});
 assert.equal(a.manaBreak.noDetonation,true);assert.equal(a.manaBreak.charge,0);
 // Receive a normal actual sourced reaction, independently of animation time.
 a.superArmor=false;assert.equal(sim.applyHit(b,a,strike,{kind:'fixture',powerMultiplier:1}).accepted,true);
 assert.equal(a.manaBreak.noDetonation,false);
 // V62 project hold-intent now requires .5s continuous input before the
 // original Gauge starts; this is separate from the source noDetonation gate.
 for(let n=0;n<40;n++)sim.step(dt,{[a.id]:{held:[key]}},{snapshot:false});
 assert.ok(a.manaBreak.charge>0);owner(sim,a);
});
