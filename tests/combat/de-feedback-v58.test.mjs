/** Source2016 declarations/selected frame + actual original poses/native
 * Garpai collision. This is current Web behavior, not original-client play. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
import {fireAddDeDashXxx,ADD_DE_DASH_XXX_SET} from '../../packages/combat-core/add-de-command-v45.mjs';
import dashSource from '../../contracts/de-dash-xxx-v58.json' with {type:'json'};
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
const stateName=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
function until(f,predicate,input={},limit=200){for(let i=0;i<limit&&!predicate();i++)f.sim.step(dt,input,{snapshot:false});assert.ok(predicate(),'bounded real input/state reached');}
function owned(f,frameSeq=100){
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq})));
 validateOwnedState(wire);validateOwnedReferences(wire,f.a,f.sim.profileFor(f.a),f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
 applyOwnedState(f.sim,f.a.id,wire);return wire;
}

for(const facing of [-1,1])test(`DE ${facing}: real 66XXX third X produces the original .25 bomb, hits with original explosion and survives owned restore`,()=>{
 const f=originalAddFixture('DE'),{sim,a,b}=f;a.facing=facing;b.facing=-facing;b.x=facing*100;a.mp=a.mpMax;
 const direction=facing===1?'RIGHT':'LEFT';
 sim.step(dt,{add:{pressed:['DASH'],held:[direction]}},{snapshot:false});assert.equal(a.state,'RSI_DASH');
 sim.step(dt,{add:{pressed:['X'],held:[direction,'X']}},{snapshot:false});
 assert.equal(stateName(sim,a),'ANSI_DASH_COMBO_X');
 const first=sim.profileFor(a).states[a.state].raw.EVENT_PROCESS_TIME1;
 until(f,()=>a.animationTime>=first['1']+.02,{add:{held:[direction]}});
 sim.step(dt,{add:{pressed:['X'],held:[direction,'X']}},{snapshot:false});
 until(f,()=>stateName(sim,a)==='ANSI_ADE_DASH_COMBO_XX',{add:{held:[direction]}});
 assert.equal(a.facing,-facing,'original first66X EndFuture turns once after passing the target');
 const second=sim.profileFor(a).states[a.state].raw.EVENT_PROCESS_TIME0;
 until(f,()=>a.animationTime>=second['1']+.02,{add:{held:[direction]}});
 sim.step(dt,{add:{pressed:['X'],held:[direction,'X']}},{snapshot:false});
 until(f,()=>stateName(sim,a)==='ANSI_ADE_DASH_COMBO_XXX');
 assert.equal(a.facing,-facing,'neither DE second nor third turn independently');
 const mp=a.mp;until(f,()=>sim.state.effects.some(e=>e.setName==='EffectSet_ADE_DashCombo_XXX_Bomb'));
 assert.equal(a.mp,mp-3);
 const projectile=sim.state.effects.find(e=>e.setName==='EffectSet_ADE_DashCombo_XXX_Bomb');
 assert.equal(projectile.name,'DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Projectile');
 assert.equal(projectile.start,.25);assert.equal(projectile.setStartAnimation,0);
 owned(f);const hp=b.hp;
 until(f,()=>sim.state.events.some(e=>e.type==='hit'&&e.amount>0&&e.data?.DAMAGE?.MAGIC===1.17),{},100);
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.amount>0&&e.data?.DAMAGE?.MAGIC===1.17);
 assert.equal(hit.data.PVP_RATE,.6);assert.equal(hit.targetId,b.id);assert.ok(b.hp<hp);
 assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.effectId===hit.origin.id&&e.name==='DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Explosion'));
});

test('DE66XXX source retains exact registered frame, first66X exit and original effect declaration',()=>{
 assert.equal(dashSource.frame.sha256,'362164b854f3595ed3336b277fc5058fabfb8e129d5d1e0947df55b55650c8f6');
 assert.equal(dashSource.firstDashExit.endFuture.address,'0x3272bf30');
 assert.equal(dashSource.firstDashExit.endFuture.bytes,49);assert.equal(dashSource.firstDashExit.halfTurn.value,180);
 const {sim,a}=originalAddFixture('DE'),raw=sim.profileFor(a).effectSets[ADD_DE_DASH_XXX_SET].raw;
 assert.deepEqual(raw,dashSource.effectSets[ADD_DE_DASH_XXX_SET].raw);
 assert.deepEqual(raw.EFFECT0,{NAME:'DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Projectile',POSITION_OFFSET_X:0,START_TIME:.25,BONE_NAME:'Bip01',EFFECT_TYPE:1});
 assert.equal(sim.profileFor(a).states.ANSI_ADE_DASH_COMBO_XXX.raw.EFFECT_SET_LIST,undefined,'original state has no declarative producer; only the recovered native callback adds it');
});

for(const id of ['LP','MM','DE'])for(const facing of [-1,1])for(const interruption of [false,true])
test(`${id} first66X facing${facing} ${interruption?'controlled reaction-state entry':'natural end'} turns only on exit, including owned restore`,()=>{
 const f=originalAddFixture(id),{sim,a,b}=f;a.facing=facing;b.x=facing*3000;
 const direction=facing===1?'RIGHT':'LEFT';
 sim.step(dt,{add:{pressed:['DASH'],held:[direction]}},{snapshot:false});
 sim.step(dt,{add:{pressed:['X'],held:[direction,'X']}},{snapshot:false});
 assert.equal(stateName(sim,a),'ANSI_DASH_COMBO_X');assert.equal(a.facing,facing);
 if(interruption){
  // A controlled state entry checks the exit independently of DamageReact.
  sim.enter(a,'RSI_DAMAGE_BIG_FRONT','received-source-reaction');
 }else until(f,()=>stateName(sim,a)!=='ANSI_DASH_COMBO_X');
 assert.equal(a.facing,-facing);owned(f);assert.equal(a.facing,-facing);
 sim.enter(a,'RSI_WAIT','next-state-no-repeated-turn');assert.equal(a.facing,-facing);
});

for(const id of ['LP','MM','DE'])for(const facing of [-1,1])
test(`${id} first66X facing${facing} accepted original hit invokes directChange exit and preserves native local back-speed`,()=>{
 const f=originalAddFixture(id),{sim,a,b}=f;a.facing=facing;b.facing=-facing;b.x=facing*100;
 const direction=facing===1?'RIGHT':'LEFT';
 sim.step(dt,{add:{pressed:['DASH'],held:[direction]}},{snapshot:false});
 sim.step(dt,{add:{pressed:['X'],held:[direction,'X']}},{snapshot:false});
 assert.equal(stateName(sim,a),'ANSI_DASH_COMBO_X');
 // The original first66X declares EffectSet_AN_Dash_Combo_X_Attack, not a
 // unit DAMAGE_DATA. Follow its original EFFECT0 into the named damage row.
 const profile=sim.profileFor(b),member=profile.effectSets.EffectSet_AN_Dash_Combo_X_Attack.raw.EFFECT0;
 assert.equal(member.NAME,'DamageEffect_AN_Dash_Combo_X');
 const data=profile.damageEffects[member.NAME].raw.DAMAGE_DATA,hp=a.hp;
 assert.equal(data.ARRANGED_FLY,1);assert.equal(data.REACT_TYPE,2);assert.equal(data.BACK_SPEED_X,900);
 // Accept the original attack data through production DamageReact; collision
 // geometry is independent of this directChange/exit ordering assertion.
 sim.applyHit(b,a,data,{kind:'character',attackPosition:[b.x,b.y,b.z]});
 assert.ok(a.hp<hp);assert.equal(a.lastAttackerFront,true);assert.equal(a.state,'RSI_DAMAGE_BIG_FRONT');
 assert.equal(a.facing,-facing);
 // DamageReact first writes native local -900. Original force1 StateChange
 // calls old EndFuture (turn), so the unchanged local speed becomes+900 in
 // the original facing's world axis. No physics packet has decayed it yet.
 assert.equal(a.vx,data.BACK_SPEED_X*facing);assert.equal(a.vx*a.facing,-data.BACK_SPEED_X);
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.targetId===a.id);assert.ok(hit&&hit.amount>0);
 owned(f);assert.equal(a.facing,-facing);assert.equal(a.vx*a.facing,-data.BACK_SPEED_X);
 sim.enter(a,'RSI_WAIT','received-hit-no-repeat');assert.equal(a.facing,-facing);
});

for(const id of ['LP','MM','DE'])test(`${id} first66X exact exit preserves native local horizontal speed and unrelated exits retain facing`,()=>{
 const {sim,a}=originalAddFixture(id);sim.enter(a,'RSI_DASH_COMBO_X','exit-boundary');a.facing=-1;a.vx=-123;
 const result=addCommands.runEnd(a);assert.equal(result.handled,true);assert.equal(result.facing,1);assert.equal(result.vx,123);
 assert.equal(a.facing,-1,'callback result remains pure until consumed');
 sim.enter(a,'RSI_WAIT','exit-boundary-apply');assert.equal(a.facing,1);
 assert.equal(addCommands.runEnd(a).handled,false);
});

for(const formed of [false,true])for(const overlimit of [false,true])test(`DE66XXX original gate formed=${formed} Overlimit=${overlimit}`,()=>{
 const {sim,a}=originalAddFixture('DE',{passives:overlimit?[29410]:[]});
 a.equipmentAttributes.addDpConsumptionReduction=0;a.sourceAdd.formation=formed;a.sourceAdd.dp=1000;a.mp=100;sim.step(dt,{});
 const mp=a.mp,dp=a.sourceAdd.dp;assert.equal(fireAddDeDashXxx(sim,a),true);
 const dpMode=formed&&overlimit;assert.equal(a.mp,mp-(dpMode?0:3));assert.equal(a.sourceAdd.dp,dp-(dpMode?3:0));
 assert.equal(sim.state.events.find(e=>e.type==='addDeDashXxx').resource,dpMode?'DP':'MP');
 const projectile=sim.state.effects.filter(e=>e.setName===ADD_DE_DASH_XXX_SET);assert.equal(projectile.length,1);
 assert.equal(projectile[0].start,.25);assert.equal(projectile[0].setStartAnimation,0);
});

test('DE66XXX original MP/rawDP gate rejects before producing any effect',()=>{
 for(const formed of [false,true]){
  const {sim,a}=originalAddFixture('DE',{passives:[29410]});a.sourceAdd.formation=formed;a.sourceAdd.dp=2;a.mp=2;
  const count=sim.state.effects.length;assert.equal(fireAddDeDashXxx(sim,a),false);assert.equal(sim.state.effects.length,count);
  assert.equal(a.mp,2);assert.equal(a.sourceAdd.dp,2);
 }
});

