import test from 'node:test';
import assert from 'node:assert/strict';
import {addStateStart} from '../../packages/combat-core/add-nasod.mjs';
import {addPanzerStateStart,PANZER_PREFIX,PANZER_RED,PANZER_BG} from '../../packages/combat-core/add-panzer-v57.mjs';

for(const professionId of ['LP','MM','DE']){
 test(`${professionId} non-Panzer entry needs neither a Panzer profile nor an effects host`,()=>{
  for(const sourceAddCombat of [undefined,{nasodTargetId:'enemy'}]){
   const a={id:'owner',professionId,skillId:29016,state:'RSI_WAIT',hp:100,sourceAddCombat};
   const sim={profileFor(){assert.fail('Non-Panzer callback must return before querying state');},get state(){assert.fail('Non-Panzer callback must not touch effects');}};
   addPanzerStateStart(sim,a);assert.equal(a.sourceAddCombat,sourceAddCombat);
  }
 });
 test(`${professionId} ordinary Nasod WAIT reset keeps the lightweight StateStart API without an effects host`,()=>{
  const a={id:'owner',professionId,skillId:null,state:'RSI_WAIT',hp:100,sourceAddCombat:{nasodTargetId:'enemy',nasodFlag:true}};
  const sim={profileFor:()=>({states:{RSI_WAIT:{sourceState:'ANSI_WAIT'}}}),get state(){assert.fail('Ordinary Nasod reset must not acquire Panzer effects dependency');}};
  addStateStart(sim,a);assert.equal(a.sourceAddCombat.nasodTargetId,null);assert.equal(a.sourceAddCombat.nasodFlag,false);
 });
}

for(const [reason,values] of [
 ['WAIT exit',{state:'RSI_WAIT'}],
 ['skill replacement',{skillId:29016}],
 ['death',{hp:0}],
 ['class replacement',{professionId:'LP'}],
])test(`an existing MM Panzer controller still retires only its own aiming handles on ${reason}`,()=>{
 const a={id:'owner',professionId:'MM',skillId:29032,state:PANZER_PREFIX+'AIMING',hp:100,
  sourceAddCombat:{nasodTargetId:'enemy',panzer:{skillId:29032,charge:1,angle:20,pending:false}},...values};
 const line={id:1,ownerId:a.id,name:PANZER_RED,dead:false},background={id:2,ownerId:a.id,setName:PANZER_BG,dead:false},
  otherOwner={id:3,ownerId:'other',name:PANZER_RED,dead:false},unrelated={id:4,ownerId:a.id,name:'ordinary-effect',dead:false},
  previouslyDead={id:5,ownerId:a.id,name:PANZER_RED,dead:true};
 const events=[],sim={profileFor:()=>({states:{[a.state]:{sourceState:a.state}}}),state:{effects:[line,background,otherOwner,unrelated,previouslyDead]},
  emit:(type,actorId,data)=>events.push({type,actorId,...data})};
 addPanzerStateStart(sim,a);
 assert.equal(a.sourceAddCombat.panzer,undefined);assert.equal(a.sourceAddCombat.nasodTargetId,'enemy');
 for(const effect of [line,background]){assert.equal(effect.dead,true);assert.equal(effect.endEmitted,true);assert.equal(effect.suppressSecondaryDamage,true);}
 assert.equal(otherOwner.dead,false);assert.equal(unrelated.dead,false);assert.equal(previouslyDead.endEmitted,undefined);
 assert.deepEqual(events.map(e=>({type:e.type,actorId:e.actorId,effectId:e.effectId,reason:e.reason})),[1,2].map(effectId=>({type:'effectEnded',actorId:a.id,effectId,reason:'add-panzer-aim-ended'})));
});

test('MM Panzer START without a prior controller still requires and initializes its real effects host',()=>{
 const a={id:'owner',professionId:'MM',skillId:29032,state:PANZER_PREFIX+'START',hp:100,sourceAddCombat:{}};
 const sim={profileFor:()=>({states:{[a.state]:{sourceState:a.state}}}),state:{effects:[]}};
 addPanzerStateStart(sim,a);assert.deepEqual(a.sourceAddCombat.panzer,{skillId:29032,charge:0,angle:0,pending:false});
});
test('an existing Panzer cleanup is not silently skipped when its required effects host is absent',()=>{
 const a={id:'owner',professionId:'MM',skillId:29016,state:'RSI_WAIT',hp:100,sourceAddCombat:{panzer:{skillId:29032,charge:1,angle:0,pending:false}}};
 assert.throws(()=>addPanzerStateStart({profileFor:()=>({states:{RSI_WAIT:{sourceState:'ANSI_WAIT'}}})},a),TypeError);
});
