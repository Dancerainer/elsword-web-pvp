import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {recoverAddSecondUp} from '../../apps/web/add-second-up-input-v58.mjs';
const dt=1/60;
const actor=professionId=>({professionId,state:'RSI_JUMP_UP',grounded:false,hp:100,skillId:null,
 inputLock:0,canNotJumpTime:0,hitStop:0,worldStop:0,buffControls:{inputBlock:false},sourceAddMovement:{levitationAvailable:true}});
function secondTap({heldAtEnd=false}={}){
 const b=createInputBuffer({sampledLevels:true});b.down('UP',.001);assert.deepEqual(b.consume(dt).pressed,['UP']);
 b.up('UP',.020);b.down('UP',.024);if(!heldAtEnd)b.up('UP',.028);
 return {b,packet:b.consume(2*dt)};
}
for(const profession of ['LP','MM','DE'])for(const heldAtEnd of [false,true])test(`${profession}: real second-UP down edge coalesced with release is recovered once, final held=${heldAtEnd}`,()=>{
 const {b,packet}=secondTap({heldAtEnd});assert.deepEqual(packet.pressed,[],'independent v19 original sample retains final level/one lock');
 assert.equal(packet.edges.filter(e=>e.key==='UP'&&e.down).length,1);
 const raw=structuredClone(packet),out=recoverAddSecondUp(packet,actor(profession));
 assert.deepEqual(out.pressed,['UP']);assert.deepEqual(out.held,heldAtEnd?['UP']:[]);
 assert.deepEqual(packet,raw,'original sampled packet is immutable to this adapter');
 assert.deepEqual(recoverAddSecondUp(b.consume(3*dt),actor(profession)).pressed,[],'no delayed fabricated repeated UP');
 assert.deepEqual(recoverAddSecondUp(structuredClone(out),actor(profession)).pressed,['UP'],'idempotent replay and receiver consumption');
});
test('hover permits the same rapid fresh UP once, including after levitation eligibility was consumed',()=>{
 const {packet}=secondTap(),a=actor('MM');a.state='ANSI_LEVITATION_WAIT';a.sourceAddMovement.levitationAvailable=false;
 assert.deepEqual(recoverAddSecondUp(packet,a).pressed,['UP']);
});
test('two downs in initial ground packet cannot invent a second jump, and no later packet is replayed',()=>{
 const b=createInputBuffer({sampledLevels:true});b.down('UP',.001);b.up('UP',.004);b.down('UP',.008);
 const packet=b.consume(dt),a={...actor('LP'),state:'RSI_WAIT',grounded:true};
 assert.equal(packet.edges.filter(e=>e.down).length,2);assert.deepEqual(recoverAddSecondUp(packet,a).pressed,['UP']);
 assert.deepEqual(recoverAddSecondUp(b.consume(2*dt),actor('LP')).pressed,[]);
});
test('repeated keydown while held adds no physical edge and cannot recover UP every frame',()=>{
 const b=createInputBuffer({sampledLevels:true});b.down('UP',.001);b.consume(dt);
 for(const time of [.018,.020,.025])assert.equal(b.down('UP',time),false);
 const p=b.consume(2*dt);assert.deepEqual(p.edges,[]);assert.equal(recoverAddSecondUp(p,actor('DE')),p);
});
test('an ordinary source fresh UP is never duplicated or accompanied by a fabricated double',()=>{
 const b=createInputBuffer({sampledLevels:true});b.down('UP',.001);const p=b.consume(dt);
 assert.equal(recoverAddSecondUp(p,actor('LP')),p);assert.deepEqual(p.pureDouble,[]);assert.deepEqual(p.oneDouble,[]);
});
test('ground, skills, locks, consumed eligibility, other professions and inspector taps retain their input unchanged',()=>{
 const {packet}=secondTap();
 const changes=[{grounded:true},{state:'RSI_WAIT'},{state:'RSI_DASH_JUMP'},{state:'RSI_JUMP_COMBO_Z'},
  {state:'ANSI_AIR_DASH'},{skillId:29029},{inputLock:.1},{canNotJumpTime:.1},{hitStop:.1},{worldStop:.1},
  {buffControls:{inputBlock:true}},{hp:0},{sourceAddMovement:{levitationAvailable:false}},{professionId:'LK'},
  {professionId:'CA'},{professionId:'RF'}];
 for(const change of changes)assert.equal(recoverAddSecondUp(packet,{...actor('LP'),...change}),packet,JSON.stringify(change));
 assert.equal(recoverAddSecondUp({...packet,sampledDevice:false},actor('LP')).pressed.length,0);
 const manual={...packet,edges:packet.edges.map(e=>({...e,manual:true}))};assert.equal(recoverAddSecondUp(manual,actor('LP')),manual);
});
test('a serialized corrected packet replays its existing pressed UP without raw DOM edges',()=>{
 const {packet}=secondTap(),out=recoverAddSecondUp(packet,actor('DE'));
 const wire=JSON.parse(JSON.stringify({held:out.held,pressed:out.pressed,released:out.released,sampledDevice:out.sampledDevice,pureDouble:out.pureDouble,oneDouble:out.oneDouble}));
 assert.deepEqual(wire.pressed,['UP']);assert.equal(recoverAddSecondUp(wire,actor('DE')),wire);
});
