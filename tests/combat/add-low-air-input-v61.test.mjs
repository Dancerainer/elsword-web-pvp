import test from 'node:test';
import assert from 'node:assert/strict';
import {addMovementInput,releaseAddAirAttack,validateAddMovement} from '../../packages/combat-core/add-movement.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
const keys=(pressed=[],held=[])=>({pressed:new Set(pressed),held:new Set(held)});
const actor=id=>({id:'a',professionId:id,state:'RSI_JUMP_UP',stateSerial:10,hp:100,mp:100,grounded:false,vx:0,vy:1000,y:3110,facing:1,
 skillId:null,inputLock:0,canNotAttackTime:0,canNotJumpTime:0,hitStop:0,worldStop:0,buffControls:{inputBlock:false},
 sourceAddMovement:{airDashAvailable:true,levitationAvailable:true}});
const sim={enter(a,n){a.state=n;a.stateSerial++;},jump(a){a.grounded=false;this.enter(a,'RSI_JUMP_UP');},
 profileFor:()=>({referenceSemantics:{lineRadius:30}}),skillAvailability:()=>({available:false})};
for(const id of ['LP','MM','DE'])for(const attack of ['Z','X'])test(`${id}: sampled UP+${attack} preserves UP priority then sends exactly one canonical attack`,()=>{
 const a=actor(id),k=keys(['UP',attack],['DOWN']);assert.equal(addMovementInput(sim,a,k),true);assert.equal(a.state,'ANSI_LEVITATION_WAIT');
 assert.deepEqual(a.sourceAddMovement.projectAirAttack,{key:attack,stateSerial:a.stateSerial});
 const copied=JSON.parse(JSON.stringify(a)),out=keys();releaseAddAirAttack(copied,out);assert.equal(out.pressed.has(attack),true);assert.equal(copied.sourceAddMovement.projectAirAttack,undefined);
 const next=keys();releaseAddAirAttack(copied,next);assert.equal(next.pressed.size,0,'neither held key nor JSON replay can deliver twice');
});
for(const id of ['LP','MM','DE'])test(`${id}: held2 sampled8X on support takes off before one deferred X without dropping platform`,()=>{
 const a=actor(id);a.grounded=true;a.state='RSI_WAIT';const k=keys(['UP','X'],['DOWN','UP','X']);
 assert.equal(addMovementInput(sim,a,k),true);assert.equal(a.state,'RSI_JUMP_UP');assert.equal(a.grounded,false);
 const out=keys([],['DOWN']);releaseAddAirAttack(a,out);assert.deepEqual([...out.pressed],['X']);
});
test('Z precedes X in a coalesced attack packet; held/repeat input alone never creates an attack',()=>{
 const a=actor('LP');addMovementInput(sim,a,keys(['UP','Z','X'],['Z','X']));assert.equal(a.sourceAddMovement.projectAirAttack.key,'Z');
 const b=actor('MM');addMovementInput(sim,b,keys(['UP'],['Z','X']));assert.equal(b.sourceAddMovement.projectAirAttack,undefined);
});
test('a buffered attack is discarded across actual land, state replacement, skill, stop, death or input/attack/jump lock',()=>{
 for(const change of [{grounded:true},{stateSerial:99},{state:'ANSI_SA_AN_ENERGY_BOOM'},{skillId:29029},{hp:0},{inputLock:.01},
  {canNotAttackTime:.01},{canNotJumpTime:.01},{hitStop:.01},{worldStop:.01},{buffControls:{inputBlock:true}},{professionId:'LK'}]){
  const a=actor('DE');addMovementInput(sim,a,keys(['UP','X']));Object.assign(a,change);const out=keys();releaseAddAirAttack(a,out);
  assert.equal(out.pressed.size,0,JSON.stringify(change));assert.equal(a.sourceAddMovement.projectAirAttack,undefined);
 }
});
test('non-ADD same-key packet does not acquire project state; serialized shape stays bounded',()=>{
 const a=actor('LK');assert.equal(addMovementInput(sim,a,keys(['UP','X'])),false);assert.equal(a.sourceAddMovement.projectAirAttack,undefined);
 assert.equal(validateAddMovement(a.sourceAddMovement),true);
 for(const pending of [{key:'A',stateSerial:0},{key:'X',stateSerial:-1},{key:'X',stateSerial:0,extra:1}])assert.equal(validateAddMovement({...a.sourceAddMovement,projectAirAttack:pending}),false);
});
for(const n of ['RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X'])test(`${n}: supported original Add air attack enters ordinary jump landing`,()=>{
 const a=actor('LP');a.state=n;a.grounded=true;a.animationTime=.1;a.passiveSpeed={x:-1,y:-1};
 const p={states:{[n]:{raw:{},clip:{durationSeconds:1}},RSI_JUMP_LANDING:{}},referenceSemantics:{lineRadius:30}};
 assert.equal(addCommands.runEvent(a,keys(),p).state,'RSI_JUMP_LANDING');
});
test('original hover Down and exhaustedMP precede its support landing, while supported AirDash has no guessed landing branch',()=>{
 for(const [pressed,mp]of [[['DOWN'],100],[[],.5]]){const a=actor('LP');Object.assign(a,{state:'ANSI_LEVITATION_WAIT',grounded:true,mp});
  addMovementInput(sim,a,keys(pressed));assert.equal(a.state,'RSI_JUMP_DOWN');assert.equal(a.y,3065);}
 const a=actor('MM');Object.assign(a,{state:'ANSI_AIR_DASH',grounded:true,stateTime:.1});
 addMovementInput(sim,a,keys([],['RIGHT']));assert.equal(a.state,'ANSI_AIR_DASH');
});
test('original free JumpUp and JumpDown consume UP before support rather than applying a height gate',()=>{
 for(const state of ['RSI_JUMP_UP','RSI_JUMP_DOWN']){const a=actor('DE');Object.assign(a,{state,grounded:true});
  assert.equal(addMovementInput(sim,a,keys(['UP'])),true);assert.equal(a.state,'ANSI_LEVITATION_WAIT');}
});
test('AirDash originalDown result is DASHJUMP and exactf32 .45 does not expire one packet early',()=>{
 const a=actor('LP');Object.assign(a,{state:'ANSI_AIR_DASH',stateTime:Math.fround(.45)});
 const drop={...sim,dropPlatform(a){a.y-=45;this.enter(a,'RSI_JUMP_DOWN');return true;}};
 addMovementInput(drop,a,keys(['DOWN'],['RIGHT']));assert.equal(a.state,'RSI_DASH_JUMP');assert.equal(a.y,3065);
 const b=actor('LP');Object.assign(b,{state:'ANSI_AIR_DASH',stateTime:Math.fround(.45)});addMovementInput(sim,b,keys([],['RIGHT']));assert.equal(b.state,'ANSI_AIR_DASH');
});
