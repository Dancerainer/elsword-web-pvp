/** Real target declarations/poses and the Web owner wire. The scalar oracle
 * is original29409 level3 plus the four explicit source FMUL entry points;
 * this is not an original-client packet or a claim about every installation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/add-installation-power-source-v56.json' with {type:'json'};
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addEvents} from '../../packages/combat-core/add-skills.mjs';
import {tickAddFury} from '../../packages/combat-core/add-fury.mjs';
import {tickAddFactory} from '../../packages/combat-core/add-factory.mjs';
import {addDynamoEvents} from '../../packages/combat-core/add-dynamo-skills.mjs';
import {startAddMagnetron,MAGNETRON_ORBIT} from '../../packages/combat-core/add-magnetron.mjs';
import {STARFALL_CARRIER,CHASER_ATTACKER,tickAddStarfall,tickAddShootingChaser,addShootingChaserContact,selectAddStarfallTarget,attackAddStarfallCarrier} from '../../packages/combat-core/add-analysis-skills.mjs';
import {addDamageModifiers} from '../../packages/combat-core/add-nasod.mjs';
import {syncAddAwakening,stopAddFormation} from '../../packages/combat-core/add-systems.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

const f=Math.fround,BASE=2,OFFENSE_LEVEL3=1.15,EXPECTED=f(f(BASE)*f(OFFENSE_LEVEL3));
const roots={
 activator:{skillId:29013,state:'ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR',before:.49,after:.51,name:'DamageEffect_AAT_Dynamo_Factory_Projectile'},
 fury:{skillId:29017,state:'ANSI_SA_AMM_INSTALLATION_ULTIMATE_FURY',before:1.06,after:1.07,name:'Mesh_ADD_Ultimate_Fury_Attack_Dron'},
 starfall:{skillId:29016,state:'ANSI_SA_AMM_INSTALLATION_STAR_FALL',before:1.19,after:1.21,name:STARFALL_CARRIER},
 chaser:{skillId:29018,state:'ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER',before:.39,after:.41,name:CHASER_ATTACKER},
};
function fixture(skillId,{formed=false,learned=true,networkOwnerId='add'}={}){
 const q=originalAddFixture('MM',{skillId,passives:learned?[29409]:[],networkOwnerId});
 q.configuredSkillId=q.a.loadout[0].skillId;
 q.a.sourceAdd.dp=8000;q.a.sourceAdd.mutation=0;q.a.sourceAdd.formation=formed;syncAddAwakening(q.a);
 q.a.skillId=q.configuredSkillId;q.a.skillScale=BASE;q.a.skillContext={};q.a.inputLock=0;
 return q;
}
function produce(kind,q){
 const row=roots[kind];q.sim.enter(q.a,row.state,'factory-wire-preparation');
 q.a.skillId=q.configuredSkillId;q.a.skillScale=BASE;q.a.skillContext={};
 q.a.sourceAdd.generator={skillId:q.configuredSkillId,phase:'firing',generation:1,remaining:30};
 addEvents(q.sim,q.a,row.before,row.after);
 const born=q.sim.state.effects.filter(e=>e.ownerId===q.a.id&&e.name===row.name&&!e.dead);
 assert.ok(born.length,kind+' actual factory emitted its original root');
 return born;
}
function report(q,frame=10){
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(q.sim,q.a.id,{epoch:1,frameSeq:frame})));
 validateOwnedState(wire);validateOwnedReferences(wire,q.a,q.sim.profileFor(q.a),q.sim.map,
  {actors:q.sim.state.actors,profiles:q.sim.profiles});
 return wire;
}
function restore(wire,skillId,version,{learned=true}={}){
 const q=fixture(skillId,{learned,networkOwnerId:'target'});
 // A V1 effect control has no authority over the observer's current actor
 // getter. Deliberately keep that getter different from the saved effect.
 q.a.skillScale=9;
 const playback=version===1?createRemoteCombatPlayback({clock:()=>0}):null;
 if(playback){q.sim.networkCombatPlaybackVersion=1;playback.bind(q.sim,'target',()=>1);}
 const original=JSON.stringify(wire);
 for(let frame=10;frame<=11;frame++){
  const packet=JSON.parse(original);packet.frameSeq=frame;
  validateOwnedState(packet);validateOwnedReferences(packet,q.a,q.sim.profileFor(q.a),q.sim.map,
   {actors:q.sim.state.actors,profiles:q.sim.profiles});
  if(version===0)applyOwnedState(q.sim,'add',packet);
  else{
   const action=encodeCriticalAction(packet,{id:frame,effectIds:new Set(packet.effects.map(e=>e.id))});
   action.playback={version:1,start:false,held:[]};
   assert.equal(playback.receiveActions('add',[action],1,frame),true);
   playback.beforeStep(q.sim,'target',()=>1);
  }
  for(const sent of wire.effects){
   const received=q.sim.state.effects.find(e=>e.ownerId==='add'&&e.networkId===sent.id);
   assert.ok(received,'original effect identity reconstructed: '+sent.name);
   assert.equal(received.powerMultiplier,sent.powerMultiplier,'wire reconstruction never applies29409 a second time: '+sent.name);
  }
 }
 assert.equal(JSON.stringify(wire),original,'receiver did not mutate the source packet');
 return q;
}

test('independent scalar oracle names only four actual70c8 multipliers and preserves the direct getter',()=>{
 assert.equal(source.freeze,'c3be320c07b5f2158b513093010d22dcb15491ee');
 assert.deepEqual(source.parameter.levels,[1.05,1.1,OFFENSE_LEVEL3]);
 assert.equal(source.getter.target,'0x31f31bd0');
 assert.equal(source.factories.filter(row=>row.consumer.startsWith('explicit FMUL')).length,4);
 const {profile}=fixture(29013);
 assert.equal(profile.skillCatalog.find(row=>row.skillId===29409).raw.SA_DAMAGE_REL['3'],OFFENSE_LEVEL3);
});

for(const [kind,row]of Object.entries(roots))for(const formed of [false,true])for(const version of [0,1])
test(`${kind} original birth scalar survives JSON and repeated V${version} owner restoration, formed=${formed}`,()=>{
 const q=fixture(row.skillId,{formed}),born=produce(kind,q);
 assert.ok(born.every(e=>e.powerMultiplier===EXPECTED),'source entry performs exactly one independent original FMUL');
 for(const e of born)assert.equal(addDamageModifiers(q.a,e.damage??{},{skillId:e.skillId}).damageMultiplier,1,
  'a formed current owner must not multiply the already scaled factory again at hit time');
 assert.equal(q.a.skillScale,BASE,'the factory does not overwrite current owner getter');
 stopAddFormation(q.a,{profile:q.profile});q.a.skillScale=9;
 const wire=report(q),received=restore(wire,row.skillId,version);
 assert.equal(received.a.sourceAdd.formation,false);assert.equal(received.a.skillScale,9);
 for(const sent of wire.effects.filter(e=>e.name===row.name)){
  assert.equal(sent.powerMultiplier,EXPECTED);
  assert.equal(received.sim.state.effects.find(e=>e.networkId===sent.id).powerMultiplier,EXPECTED);
 }
});

for(const [kind,name,childPower]of [
 ['fury','DamageEffect_AMM_Ultimate_Fury_Dynamo',EXPECTED],
 ['starfall','DAMAGE_EFFECT_Star_Fall_Explode',EXPECTED],
 ['chaser','DamageEffect_AMM_Shooting_Chaser_Attack',f(EXPECTED*3)],
])for(const version of [0,1])test(`${kind} future child inherits the saved birth scalar after V${version} restoration and formation exit`,()=>{
 const row=roots[kind],q=fixture(row.skillId,{formed:true}),born=produce(kind,q);
 assert.ok(born.every(e=>e.powerMultiplier===EXPECTED));
 if(kind==='fury')tickAddFactory(q.sim,q.a);
 if(kind==='chaser')for(let i=0;i<3;i++)assert.equal(addShootingChaserContact(q.sim,q.a,q.b,born[0],[q.b.x,q.b.y+80,q.b.z]),true);
 stopAddFormation(q.a,{profile:q.profile});q.a.skillScale=9;
 // Actual future factories execute on their owner. V1 observers consume
 // subsequent effect births; a control packet cannot invent private registry
 // entries in an observer merely to make it rerun the owner's controller.
 const continued=fixture(row.skillId);continued.sim.restore(JSON.parse(JSON.stringify(q.sim.snapshot())));
 continued.a=continued.sim.actor('add');continued.b=continued.sim.actor('target');
 assert.equal(continued.a.sourceAdd.formation,false);assert.equal(continued.a.skillScale,9);
 if(kind==='fury'){tickAddFury(continued.sim,continued.a,.01);tickAddFury(continued.sim,continued.a,.01);}
 if(kind==='starfall')tickAddStarfall(continued.sim,continued.a,1,{selectTarget:selectAddStarfallTarget,attackCarrier:attackAddStarfallCarrier});
 if(kind==='chaser')tickAddShootingChaser(continued.sim,continued.a,1);
 const children=continued.sim.state.effects.filter(e=>e.ownerId==='add'&&e.name===name&&!e.dead);
 assert.ok(children.length,'real owner JSON continuation creates its later original child: '+name);
 assert.ok(children.every(e=>e.powerMultiplier===childPower),'child inherits saved scalar; current9 and another1.15 are both forbidden');
 const received=restore(report(continued),row.skillId,version);
 for(const e of children)assert.equal(received.sim.state.effects.find(r=>r.networkId===e.id).powerMultiplier,childPower);
});

const direct=[
 {name:'Rushing Drones',skillId:29208,state:'ANSI_A_AAT_RUSHING_DRONE_DYNAMO'},
 {name:'Fission',skillId:29209,state:'ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO'},
 {name:'Countdown',skillId:29211,state:'ANSI_A_AMM_COUNTDOWN_BOMB_DYNAMO'},
 {name:'Flick Disc',skillId:29210,state:'ANSI_A_AMM_FLICK_DISC_DYNAMO'},
];
for(const row of direct)for(const version of [0,1])test(`${row.name} direct-getter negative retains base power across V${version} owner wire`,()=>{
 const q=fixture(row.skillId,{formed:true});q.sim.enter(q.a,row.state,'direct-getter-wire-preparation');
 q.a.skillId=q.configuredSkillId;q.a.skillScale=BASE;q.a.skillContext={};
 const first=q.sim.state.nextEffectId;addDynamoEvents(q.sim,q.a,0,.7);
 const effects=q.sim.state.effects.filter(e=>e.ownerId==='add'&&e.id>=first&&!e.dead);
 assert.ok(effects.length,'actual configuration producer emits its original definitions');
 assert.ok(effects.every(e=>e.powerMultiplier===BASE),'29409 is not a blanket configuration multiplier');
 stopAddFormation(q.a,{profile:q.profile});q.a.skillScale=9;
 const wire=report(q),received=restore(wire,row.skillId,version);
 for(const e of effects)assert.equal(received.sim.state.effects.find(r=>r.networkId===e.id).powerMultiplier,BASE);
});
for(const version of [0,1])test(`selection follower direct getter does not acquire29409 during V${version} restoration`,()=>{
  const skillId=29017,q=fixture(skillId,{formed:true});
  q.a.sourceAdd.generator={skillId,phase:'firing',generation:1,remaining:30};tickAddFactory(q.sim,q.a);
  const name='DAMAGE_EFFECT_Ultimate_Fury_Generate';
  const born=q.sim.state.effects.filter(e=>e.ownerId==='add'&&e.name===name&&!e.dead);
  assert.ok(born.length);assert.ok(born.every(e=>e.powerMultiplier===BASE));
  stopAddFormation(q.a,{profile:q.profile});q.a.skillScale=9;
  const received=restore(report(q),skillId,version);
  for(const e of born)assert.equal(received.sim.state.effects.find(r=>r.networkId===e.id).powerMultiplier,BASE);
});
test('Magnetron getter does not acquire29409 and its unavailable MM skill is still rejected by owner admission',()=>{
 const q=fixture(29013,{formed:true});q.a.skillId=29205;startAddMagnetron(q.sim,q.a);
 const born=q.sim.state.effects.filter(e=>e.ownerId==='add'&&e.name===MAGNETRON_ORBIT&&!e.dead);
 assert.equal(born.length,3);assert.ok(born.every(e=>e.powerMultiplier===BASE));
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(q.sim,'add',{epoch:1,frameSeq:10})));
 validateOwnedState(wire);
 assert.throws(()=>validateOwnedReferences(wire,q.a,q.sim.profileFor(q.a),q.sim.map,
  {actors:q.sim.state.actors,profiles:q.sim.profiles}),/magnetron|skill/,
  'a static getter fact cannot make an unconfigured MM active skill legal on the wire');
});
for(const version of [0,1])test(`unlearned four-factory negative keeps base scalar through V${version}`,()=>{
 for(const [kind,row]of Object.entries(roots)){
  const q=fixture(row.skillId,{formed:true,learned:false}),born=produce(kind,q);
  assert.ok(born.every(e=>e.powerMultiplier===BASE));
  const received=restore(report(q),row.skillId,version,{learned:false});
  for(const e of born)assert.equal(received.sim.state.effects.find(r=>r.networkId===e.id).powerMultiplier,BASE);
 }
});
