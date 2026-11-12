/** Full real skill input -> carrier timeout -> original M02 -> DIE M03 contact.
 * Web/native fixture evidence only; no original-client runtime claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60,BIG='DamageEffect_ATT_Stardust_Shower_Ball_Big',EXP='DamageEffect_ATT_Stardust_Shower_Ball_Explosion';
for(const facing of [-1,1])test(`Stardust ${facing}: actual cast terminal ball falls before DIE explosion hits ground opponent with source damage/reaction`,()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29021});a.mp=a.mpMax;a.facing=facing;b.x=facing*250;b.invincible=true;
 const events=[];let big=null,birthY=null,minY=Infinity,explosion=null,hit=null;
 sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<480;i++){
  sim.step(dt,{}, {snapshot:false});
  for(const e of sim.drainEvents()){
   events.push(e);
   if(e.type==='effectStarted'&&e.name===BIG){big=e.effectId;birthY=e.birthAnchor.position[1];b.invincible=false;}
   if(e.type==='effectStarted'&&e.name===EXP)explosion=e;
   if(e.type==='hit'&&e.origin?.id===explosion?.effectId&&e.targetId===b.id)hit=e;
  }
  const current=sim.state.effects.find(e=>e.id===big);if(current)minY=Math.min(minY,current.currentAnchor?.position[1]??current.birthAnchor.position[1]);
  if(hit)break;
 }
 assert.ok(big!==null,'real cast must pass through source controller timeout into End set');
 assert.ok(minY<birthY-400,'M02 .2..6 fade and subsequent -500 velocity must fall in world Y; local display Rotate90 is not movement rotation');
 assert.ok(explosion,'terminal mesh death produces original DIE child');
 assert.equal(explosion.birthAnchor.position[0],events.find(e=>e.type==='effectStarted'&&e.effectId===big).birthAnchor.position[0]);
 assert.ok(hit?.amount>0,'actual original M03 posed attack must contact the ground opponent');
 assert.equal(hit.data.DAMAGE.MAGIC,22);assert.equal(hit.data.REACT_TYPE,5);assert.equal(hit.data.BACK_SPEED_X,2000);assert.equal(hit.data.BACK_SPEED_Y,1600);
 assert.ok(b.hp<b.hpMax);assert.ok(b.vy>0||b.state.includes('DAMAGE')||b.state.includes('FLY'),'accepted explosion must also apply the original reaction');
});

test('Stardust terminal deterministic literal motion survives owned restoration without a new random sample',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29021});a.mp=a.mpMax;b.x=3000;let big;
 sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<360&&!big;i++){sim.step(dt,{}, {snapshot:false});big=sim.state.effects.find(e=>e.name===BIG&&e.active);}
 assert.ok(big?.sourceShadowMesh,'actual terminal M02 has an owned literal mesh, rather than a presentation-only velocity');
 // The wire intentionally drops diagnostic evidenceClass and JSON normalizes -0.
 const before=JSON.parse(JSON.stringify(big.sourceShadowMesh));delete before.evidenceClass;
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:100})));
 validateOwnedState(wire);validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,wire);
 assert.deepEqual(sim.state.effects.find(e=>e.id===big.id).sourceShadowMesh,before);
 sim.step(dt,{}, {snapshot:false});assert.ok(sim.state.effects.some(e=>e.id===big.id&&e.sourceShadowMesh.globalTime>before.globalTime));
});
