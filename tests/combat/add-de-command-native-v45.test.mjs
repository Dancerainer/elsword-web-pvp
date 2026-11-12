import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {fireAddDeAerialZx,ADD_DE_ZX_SET} from '../../packages/combat-core/add-de-command-v45.mjs';
import {addCommands,addCommandSkillCancelAllowed} from '../../packages/combat-core/add-commands.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n)=>{for(let i=0;i<n;i++)sim.step(1/60,{});};
const keys=(pressed=[],held=pressed)=>({pressed:new Set(pressed),held:new Set(held),pureDoubleRight:false,pureDoubleLeft:false});
test('DE ZX source landing remains in command, exact grounded X cancellation returns WAIT and skill window stays usable',()=>{
 const {sim,a}=originalAddFixture('DE'),profile=sim.profileFor(a);sim.enter(a,'ANSI_ATT_DASH_JUMP_COMBO_ZX','source-cancel');
 Object.assign(a,{grounded:true,animationTime:.2});assert.equal(addCommands.runEvent(a,keys(),profile).state,null);
 assert.equal(addCommandSkillCancelAllowed(a,profile.states[a.state]),false);
 a.animationTime=.25;assert.equal(addCommands.runEvent(a,keys(['X']),profile).state,null);
 a.animationTime=.251;assert.equal(addCommands.runEvent(a,keys(['X']),profile).state,'RSI_WAIT');
 assert.equal(addCommands.runEvent(a,keys([],['X']),profile).state,'RSI_WAIT','original pureX is a held level');
 assert.equal(addCommands.runEvent(a,keys(['X'],[]),profile).state,null,'an absent held level cannot satisfy native pureX');
 assert.equal(addCommandSkillCancelAllowed(a,profile.states[a.state]),true);
 a.grounded=false;assert.equal(addCommands.runEvent(a,keys(['X']),profile).state,null);
 a.animationStopped=true;assert.equal(addCommands.runEvent(a,keys(),profile).state,'RSI_JUMP_DOWN');
 assert.equal(addCommands.runEvent(a,keys(),profile).y,a.y-profile.referenceSemantics.lineRadius);
 a.grounded=true;assert.equal(addCommands.runEvent(a,keys(),profile).state,'RSI_WAIT');
});
for(const formed of [false,true])for(const overlimit of [false,true])test(`DE original aerial ZX gate formed=${formed} Overlimit=${overlimit}`,()=>{
 const {sim,a}=originalAddFixture('DE',{passives:overlimit?[29410]:[]});
 a.equipmentAttributes.addDpConsumptionReduction=0;
 a.sourceAdd.formation=formed;a.sourceAdd.dp=1000;a.mp=100;sim.step(1/60,{});
 // Simulate the registered .01 frame callback independently of geometry.
 const mp=a.mp,dp=a.sourceAdd.dp;assert.equal(fireAddDeAerialZx(sim,a),true);
 const dpMode=formed&&overlimit;
 assert.equal(a.mp,mp-(dpMode?0:3));assert.equal(a.sourceAdd.dp,dp-(dpMode?3:0));
 const event=sim.state.events.find(e=>e.type==='addDeAerialZx');assert.equal(event.resource,dpMode?'DP':'MP');
 const all=sim.state.effects.filter(e=>e.setName===ADD_DE_ZX_SET);assert.equal(all.length,2);
 assert.equal(all.find(e=>e.name.endsWith('_Projectile')).start,.25);
 assert.ok(all.every(e=>e.setStartAnimation===0),'original ordinary PlayEffectSet uses absolute owner animation time');
});

test('DE original aerial ZX resource gate rejects insufficient MP and formed Overlimit DP before creating effects',()=>{
 for(const formed of [false,true]){
  const {sim,a}=originalAddFixture('DE',{passives:[29410]});a.sourceAdd.formation=formed;a.sourceAdd.dp=2;a.mp=2;
  const before=sim.state.effects.length;assert.equal(fireAddDeAerialZx(sim,a),false);assert.equal(sim.state.effects.length,before);
  assert.equal(a.mp,2);assert.equal(a.sourceAdd.dp,2);
 }
});

for(const predecessor of ['ANSI_DASH_JUMP_COMBO_Z','ANSI_DASH_JUMP_COMBO_ZZ'])test(`DE ${predecessor} X reaches registered .01 attack, original projectile explosion and owned transport`,()=>{
 const {sim,a,b}=originalAddFixture('DE');a.mp=100;a.y+=50;a.grounded=false;a.lineId=null;
 // The original eight-step entry now retreats before producing the projectile.
 // Keep the target inside this source projectile's finite post-retreat range.
 b.x=450;
 sim.enter(a,predecessor,'source-aerial-command-input');sim.step(1/60,{add:{pressed:['X'],held:['X']}});
 for(let i=0;i<40&&!sim.state.events.some(e=>e.type==='addDeAerialZx');i++)sim.step(1/60,{});
 assert.ok(sim.state.events.some(e=>e.type==='addDeAerialZx'));
 const profile=sim.profileFor(a);assert.equal(profile.effectSets[ADD_DE_ZX_SET].raw.EFFECT1.START_TIME,.25);
 tick(sim,4);
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:60})));
 validateOwnedState(wire);validateOwnedReferences(wire,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 applyOwnedState(sim,a.id,wire);tick(sim,100);
 const explosion=sim.state.events.find(e=>e.type==='effectStarted'&&e.name==='DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Explosion');
 assert.ok(explosion,'original projectile must produce original hit/death child');
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.origin?.id===explosion.effectId&&e.amount>0);
 assert.ok(hit,'source explosion helper must actually contact a target');assert.equal(hit.data.DAMAGE.MAGIC,1.17);assert.equal(hit.data.PVP_RATE,.6);
 assert.equal(sim.state.effects.some(e=>e.name==='DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Projectile'),false);
});
