/** Native floor/pose/input expectations; no implementation-generated golden.
 * The real roof failures are archived in before-b. Controlled contact tests
 * explicitly isolate the discrete-tier late-acceptance branch; they are not
 * evidence that original-client collision produced that contact. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lpZxInputV62} from '../helpers/lp-zx-input-v62.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const BULLET='DamageEffect_AN_Dash_Jump_Combo_Z_Bullet',ZX='ANSI_APT_DASH_JUMP_COMBO_ZX';
for(const side of [1,-1])for(const z of [10,14])test(`roof real66/8/Z/X side${side} z${z} retains actual hit through slope and delayed dive`,async()=>{
 const f=await lpZxInputV62({side,z});f.until(160);
 assert.ok(f.accepted.some(e=>e.name===BULLET),'original mesh must actually accept Z damage');
 assert.ok(f.trace.some(e=>e.state===ZX),'real X must enter the LP command');
 assert.equal(f.settled.length,1,'actual supported victim survives until the descending caster can use its surface');
 const e=f.settled[0];assert.ok(e.from[1]<e.targetSupport.point[1],'ordinary above-target dive is preserved');
 assert.equal(e.targetSupport.found,true);assert.deepEqual(f.sim.nativeGeometry.lineGroup(e.lineId),f.sim.nativeGeometry.lineGroup(e.targetLine));
 const supported=f.sim.nativeGeometry.support({position:e.position,radius:f.profile.referenceSemantics.lineRadius,lastLineId:e.lineId});
 assert.equal(supported.found,true);assert.equal(supported.lineId,e.lineId);
 assert.ok(e.position[1]>=e.targetSupport.point[1]-32,'original roof slope rises160 over500; fixed100 offset stays within32 vertical units');
 for(const name of ['DamageEffect_ANSI_APT_DASH_JUMP_COMBO_ZX_LANDING','DamageEffect_ANSI_APT_DASH_JUMP_COMBO_ZX_LANDING_Splash'])
  assert.ok(f.accepted.some(hit=>hit.name===name&&hit.amount>0),'actual original X landing carrier must hit: '+name);
 assert.equal(f.a.sourceAddCombat.lpZxTarget,undefined);
 if(side===-1&&z===10)assert.ok(f.accepted.some(e=>e.name===BULLET&&e.state===ZX&&e.hitCountBefore===0),'first real mirrored-roof late contact has no previous accepted hit');
});
for(const side of [1,-1])test(`Garpai side${side}: controlled original Z-carrier acceptance after real ZX can still reach the upper discrete tier`,async()=>{
 const f=await lpZxInputV62({side,roof:false,unhit:true});f.until(26);
 assert.equal(f.profile.states[f.a.state].sourceState,ZX);assert.equal(f.accepted.length,0);
 const carrier=f.sim.state.effects.find(e=>e.name===BULLET&&!e.dead);assert.ok(carrier);
 assert.equal(carrier.ownerStateSerial+1,f.a.stateSerial);
 // This intentionally isolates acceptance/capture from geometry. It uses the
 // real original carrier and original DD, and does not move either actor.
 assert.equal(typeof carrier.damageDirectionRight,'boolean','original active effect provides ARRANGED_FLY direction');
 const result=f.sim.applyHit(f.a,f.b,carrier.damage.DAMAGE_DATA,{kind:'effect',id:carrier.id,powerMultiplier:carrier.powerMultiplier,
  damageDirectionRight:carrier.damageDirectionRight,attackPosition:carrier.currentAnchor?.position??carrier.birthAnchor?.position,damageStateRaw:carrier.passiveDamageState});
 assert.equal(result.accepted,true);assert.ok(result.amount>0);
 // This controlled acceptance bypasses only the geometric predicate. Mirror
 // updateEffects' real outer e.hitCount += checkHits accepted-count write.
 carrier.hitCount+=1;
 f.until(160);assert.equal(f.settled.length,1);assert.equal(f.a.y,3320);
 assert.ok(f.trace.some(e=>e.state==='ANSI_APT_DASH_JUMP_COMBO_ZX_LANDING'&&e.position[1]===3320));
});
test('pending actual roof ZX victim survives snapshot and physical continuation deterministically',async()=>{
 const f=await lpZxInputV62({side:-1,z:14,epochs:true});f.until(30);
 assert.equal(f.profile.states[f.a.state].sourceState,ZX);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 const snapshot=JSON.parse(JSON.stringify(f.sim.snapshot())),g=await lpZxInputV62({side:-1,z:14,epochs:true});
 g.primeDevice(f.frame);g.sim.restore(snapshot);f.until(160);g.until(160);
 assert.deepEqual(g.sim.snapshot(),f.sim.snapshot());assert.equal(f.settled.length,1);assert.equal(g.settled.length,1);
});
test('pending actual ZX record keeps the existing four-field owner/critical shape and rejects unrelated state or serial',async()=>{
 const f=await lpZxInputV62({side:-1,z:14,epochs:true,networkOwnerId:'add'});f.until(30);
 const packet=JSON.parse(JSON.stringify(encodeOwnedState(f.sim,'add',{epoch:1,frameSeq:f.frame}))),value=packet.actor.sourceAddCombat.lpZxTarget;
 assert.ok(value);assert.equal(Object.keys(value).length,4);assert.equal(value.stateSerial+1,packet.actor.stateSerial);
 const refs=p=>validateOwnedReferences(p,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
 validateOwnedState(packet);refs(packet);
 const critical=encodeCriticalAction(packet,{id:1,effectIds:new Set()});assert.deepEqual(critical.actor.sourceAddCombat.lpZxTarget,value);
 const remote=await lpZxInputV62({side:-1,z:14,epochs:true,networkOwnerId:'target'});applyOwnedState(remote.sim,'add',packet);
 remote.until(40);assert.equal(remote.settled.length,0,'receiver playback does not settle another owner');
 for(const change of [{state:'RSI_WAIT'},{stateSerial:packet.actor.stateSerial+1}]){const p=structuredClone(packet);Object.assign(p.actor,change);assert.throws(()=>refs(p),/lp-zx/);}
 const extra=structuredClone(packet);extra.actor.sourceAddCombat.lpZxTarget.extra=1;assert.throws(()=>validateOwnedState(extra),/invalid-owner-actor-shape:sourceAddCombat/);
});
for(const id of ['add','target'])test(`pending actual roof ZX target cannot cross ${id} life epoch`,async()=>{
 const f=await lpZxInputV62({side:-1,z:14,epochs:true});f.until(30);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 f.lives[id]++;f.until(160);assert.equal(f.settled.length,0);assert.equal(f.a.sourceAddCombat.lpZxTarget,undefined);
 if(id==='target')assert.ok(f.accepted.some(e=>e.name===BULLET&&e.targetEpoch===f.lives.target),'new-life HP contact stays legal without granting the same old Bullet a second capture');
});
