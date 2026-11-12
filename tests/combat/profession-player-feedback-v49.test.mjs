/** Static source equations/windows are independent expectations. These are
 * current Web simulation/ownership runs, not original-client trajectories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {requestElesisFirewall,tickElesisFirewalls} from '../../packages/combat-core/elesis-firewall-v45.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {emitForceFingerResourceNumbers} from '../../apps/web/damage-number-layout.mjs';
import {addResourceFeedback} from '../../apps/web/add-hud.mjs';
import {receiveElesisAvatarScan,flushElesisFireAbsorbNotices} from '../../packages/combat-core/elesis-fire-absorb-v45.mjs';
import {elesisCommandEvents} from '../../packages/combat-core/elesis-commands.mjs';
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));
const step=(f,input={})=>f.sim.step(1/60,{elesis:input},{snapshot:false});
function validate(f,seq){
 const packet=encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:seq});
 packet.actions=[encodeCriticalAction(packet,{id:seq,effectIds:new Set()})];
 validateOwnedState(packet);validateOwnedReferences(packet,f.a,f.profile,f.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
}
for(const facing of [-1,1])test(`BH ${facing}: FollowLine preserves world-down gravity and removes false horizontal acceleration`,()=>{
 const f=elesisFixture('BH',{gap:5000,facing});f.a.skillId=null;f.a.y+=350;f.a.grounded=false;f.a.lineId=null;
 f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SPK_ZX_LOOP','source-window');
 for(let i=1;i<=10;i++){step(f);validate(f,i);}
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_Elesis_SBH_DashJump_Combo_ZX');assert.ok(e?.sourceShadowMesh);
 const m=e.sourceShadowMesh;
 assert.ok(Math.abs(m.gravity[0])<.001,'template gravity remains world vertical after original FollowLine axis reset');
 assert.ok(Math.abs(m.gravity[1]+2500)<.001);assert.equal(m.velocity[0],700,'original700 X velocity cannot acquire old-roll gravity');
});
test('CA actual60Hz freshZ repeats all four bounded loop phases, each emitting its original particles',()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZZZ_START','source-window');
 for(let i=1;i<=105;i++){step(f,{pressed:i%6===1?['Z']:[],held:['Z']});validate(f,i);}
 const states=f.sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===f.a.id).map(e=>e.state);
 assert.deepEqual(states.filter(n=>/^ESI_DASH_COMBO_SCA_ZZZ_LOOP_/.test(n)),[
  'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']);
 const births=f.sim.state.events.filter(e=>e.type==='effectStarted'&&/^DamageEffect_SCA_Combo_ZZZ_Projectile/.test(e.name));
 assert.equal(births.length,14,'five original queue entries plus nine native Frame producers, before END .37');assert.equal(f.a.sourceElesisCommand.loops,4);
 for(const birth of births){const particles=f.sim.state.events.filter(e=>e.type==='effectTimedParticles'&&e.effectId===birth.effectId);
  assert.equal(particles.length,1,'source .01 entries dispatch once, including invisible attack-box main meshes');assert.equal(particles[0].entries.length,3);}
});
for(const state of ['ESI_DASH_JUMP_COMBO_SDK_XXX','ESI_DASH_COMBO_SCA_XZ_FIRE'])test(`CA ${state}: source projectile emits visible child particles once and passes full/critical ownership`,()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;f.sim.enter(f.a,state,'source-window');
 for(let i=1;i<=25;i++){step(f);validate(f,i);}
 const births=f.sim.state.events.filter(e=>e.type==='effectStarted'&&/SCA_Combo_ZZZ_Projectile|SCA_Dash_Combo_XZ/.test(e.name));assert.equal(births.length,1);
 const entries=f.sim.state.events.filter(e=>e.type==='effectTimedParticles'&&e.effectId===births[0].effectId);
 assert.equal(entries.length,1);assert.ok(entries[0].entries.some(row=>row.entry.PARTICLE_NAME==='SCA_S_E_Projectile01'));
});
test('Force Finger displays actual model MP loss in red and restoration in blue without a second HUD MP popup',()=>{
 const runtime=createEffectRuntime({index:manifest});
 assert.equal(emitForceFingerResourceNumbers(runtime,manifest,{type:'addForceFingerRecipient',drain:4,requestedDrain:15,position:[100,450,0]}),4);
 assert.equal(emitForceFingerResourceNumbers(runtime,manifest,{type:'addForceFingerTransfer',restored:12,recover:45,resource:'MP',position:[0,350,0]}),5);
 const rows=[...runtime.particles.values()];assert.deepEqual(rows.slice(0,4).map(p=>[p.name,p.options.digit]),[['PicCharRed','M'],['PicCharRed','P'],['PicCharRed','-'],['PicCharRed','4']]);
 assert.ok(rows.slice(4).every(p=>p.name==='PicCharBlue'&&p.position[1]===350));
 assert.equal(addResourceFeedback({type:'addForceFingerTransfer',restored:12,resource:'MP'}),null);
 for(const bad of [{type:'addForceFingerRecipient',drain:0,position:[0,0,0]},{type:'addForceFingerTransfer',restored:0,resource:'MP',position:[0,0,0]},
  {type:'addForceFingerRecipient',drain:15,position:[NaN,0,0]}])assert.equal(emitForceFingerResourceNumbers(runtime,manifest,bad),0);
});
for(const targetKind of ['self','ally','invincible-enemy'])test(`Avatar .01 scan removes ${targetKind} fire and counts original293 stacks`,()=>{
 const f=elesisFixture('BH',{skillId:28208,gap:800});f.a.mp=100;
 const target=targetKind==='self'?f.a:f.b;
 if(targetKind==='ally')target.team=f.a.team;
 if(targetKind==='invincible-enemy')target.forceInvincible=5;
 f.sim.grantBuff(f.a,target,301,1);for(let i=0;i<3;i++)f.sim.grantBuff(f.a,target,294,1);
 assert.equal(target.buffs.find(b=>b.templateId===293).accumulationCount,3);
 step(f,{pressed:['A'],held:['A']});step(f);validate(f,2);
 const refund=f.sim.state.events.find(e=>e.type==='elesisFireAbsorbed');assert.ok(refund);
 assert.equal(refund.count,4);assert.equal(refund.mp,40);assert.equal(refund.targetId,target.id);
 assert.ok(!target.buffs.some(b=>[37,293].includes(b.templateId)));
 for(let i=0;i<50;i++)step(f);assert.equal(f.sim.state.events.filter(e=>e.type==='elesisFireAbsorbed').length,1);
});
test('Avatar original1000 radius rejects1001 and never absorbs its own later newly applied Burn',()=>{
 const f=elesisFixture('BH',{skillId:28208,gap:1001});f.a.mp=100;f.sim.grantBuff(f.a,f.b,294,1);
 step(f,{pressed:['A'],held:['A']});for(let i=0;i<50;i++)step(f);
 assert.equal(f.sim.state.events.filter(e=>e.type==='elesisFireAbsorbed').length,0);assert.ok(f.b.buffs.some(b=>b.templateId===293));
});
test('late current-owner Avatar scan is deferred transactionally, refunded by source stack count and deduplicated',()=>{
 const owner=elesisFixture('BH',{skillId:28208,gap:800}),victim=elesisFixture('BH',{skillId:28208,gap:800});
 for(const [f,id]of [[owner,'elesis'],[victim,'target']]){f.sim.networkOwnerId=id;f.sim.networkEpochFor=key=>key==='elesis'?2:3;f.a.mp=100;}
 step(owner,{pressed:['A'],held:['A']});step(owner);
 const packet=encodeOwnedState(owner.sim,owner.a.id,{epoch:2,frameSeq:1});
 for(let i=0;i<3;i++)victim.sim.grantBuff(victim.a,victim.b,294,1);
 victim.sim.deferAddTimeRingNotices=true;applyOwnedState(victim.sim,victim.a.id,packet);
 receiveElesisAvatarScan(victim.sim,victim.a);
 assert.ok(victim.b.buffs.some(b=>b.templateId===293));victim.sim.deferAddTimeRingNotices=false;
 flushElesisFireAbsorbNotices(victim.sim,{discard:true});assert.ok(victim.b.buffs.some(b=>b.templateId===293));
 victim.sim.deferAddTimeRingNotices=true;receiveElesisAvatarScan(victim.sim,victim.a);victim.sim.deferAddTimeRingNotices=false;
 flushElesisFireAbsorbNotices(victim.sim);assert.ok(!victim.b.buffs.some(b=>b.templateId===293));
 const reply=encodeOwnedState(victim.sim,victim.b.id,{epoch:3,frameSeq:2});validateOwnedState(reply);
 assert.deepEqual(reply.actor.sourceElesisFireAbsorbNotice.receipts[0].stackCounts,[3]);
 const before=owner.a.mp;applyOwnedState(owner.sim,victim.b.id,reply);assert.ok(Math.abs(owner.a.mp-before-30)<.001);
 applyOwnedState(owner.sim,victim.b.id,reply);assert.ok(Math.abs(owner.a.mp-before-30)<.001);
 receiveElesisAvatarScan(victim.sim,victim.a);assert.equal(victim.b.sourceElesisFireAbsorbNotice.serial,1);
 const bad=structuredClone(reply);bad.actor.sourceElesisFireAbsorbNotice.receipts[0].stackCounts=[11];assert.throws(()=>validateOwnedState(bad));
});
for(const facing of [-1,1])test(`BH ${facing}: a pending668XZ owner effect retains its callback direction before either peer activates it`,()=>{
 const source=elesisFixture('BH',{gap:5000,facing}),receiver=elesisFixture('BH',{gap:5000,facing});
 for(const f of [source,receiver]){f.a.skillId=null;f.a.y+=350;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SPK_XZ','source-angle');}
 source.a.animationTime=.21;elesisCommandEvents(source.sim,source.a,0,.21);
 const original=source.sim.state.effects.find(e=>e.damage);assert.ok(original);assert.equal(original.active,false);
 assert.equal(original.definition.ROTATE_Z,-45,'original member10 plus qualified source set local-55');
 const packet=encodeOwnedState(source.sim,source.a.id,{epoch:1,frameSeq:1});packet.actions=[encodeCriticalAction(packet,{id:1,effectIds:new Set()})];
 validateOwnedState(packet);validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
 applyOwnedState(receiver.sim,receiver.a.id,packet);
 const copied=receiver.sim.state.effects.find(e=>e.damage);assert.equal(copied.definition.ROTATE_Z,original.definition.ROTATE_Z);
 source.sim.tickEffects(1/60);receiver.sim.tickEffects(1/60);
 assert.deepEqual(copied.birthAnchor.rotation,original.birthAnchor.rotation);assert.deepEqual(copied.sourceShadowMesh.rotation,original.sourceShadowMesh.rotation);
 assert.deepEqual(copied.currentAnchor.position,original.currentAnchor.position);
});
test('Firewall wall and NPC helper yaw follow an actual authored Besma bend; main contact retains hard stagger',async()=>{
 const read=file=>JSON.parse(readFileSync(new URL('../../artifacts/'+file,import.meta.url)));
 const map={...read('scene/besma-besma-lake-pvpmap/manifest.json'),...read('scene/besma-besma-lake-pvpmap/collision.json')};
 const native=await createNativeRuntime({manifest:read('native/manifest.json'),map,loadBinary:file=>readFileSync(new URL('../../artifacts/native/'+file,import.meta.url))});
 const {profile,preset,samplers}=elesisAssets('BH'),line=map.lines.find(l=>l.lineId===8),t=.01;
 const position=line.start.map((v,i)=>v+(line.end[i]-v)*t);
 const sim=createSimulation({profile,map,preset:{...preset,loadout:[{skillId:28018},...Array(7).fill(null)],passives:[],guildPassives:[]},seed:2016,
  actors:[{id:'elesis',professionId:'BH',team:0,position,lineId:8,facing:1},{id:'target',professionId:'BH',team:1,position:[position[0]+5000,position[1],position[2]],lineId:8,facing:-1}],
  ...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak});
 const a=sim.actor('elesis'),b=sim.actor('target'),f={sim,a,b,map,profile:sim.profileFor(a)};a.mp=a.mpMax;
 requestElesisFirewall(sim,a);const q=a.sourceElesisFirewallRequests[0];
 for(let i=1;i<=22;i++){sim.state.time+=1/60;tickElesisFirewalls(sim,a,1/60);sim.tickEffects(1/60);validate(f,i);}
 const effect=sim.state.effects.find(e=>e.name==='DamageEffect_Wall_of_Prominence_Attack_Main');assert.ok(effect);
 const finalLine=map.lines.find(l=>l.lineId===q.lineId)??line; const yaw=Math.atan2(-(finalLine.end[2]-finalLine.start[2]),finalLine.end[0]-finalLine.start[0])*180/Math.PI;
 assert.ok(Math.abs(yaw)>1,'fixture wall stays on an authored bend');
 assert.ok(Math.abs(effect.birthAnchor.rotation[1]-yaw)<.0001,'wall follows real authored X/Z line angle instead of global cardinal facing');
 // Isolate the original main contact at its actual sampled helper center;
 // this is a Web reaction check, not a claim about lower-platform placement.
 const shapes=sim.effectSampler(effect,a);assert.ok(shapes.length);const s=shapes[0];
 b.x=s.center[0];b.y=effect.birthAnchor.position[1];b.z=s.center[2];b.grounded=true;b.lineId=8;
 b.hp=b.hpMax=1e9;sim.tickEffects(1/60);
 const hit=sim.state.events.find(e=>e.type==='hit'&&e.origin?.id===effect.id);assert.ok(hit);assert.equal(hit.data.REACT_TYPE,2);
 assert.match(b.state,/RSI_DAMAGE_BIG_(FRONT|BACK)/);assert.equal(hit.data.STOP_TIME_DEF,.15);
 assert.deepEqual(b.sourceStopQueues.hit.at(-1),{remaining:Math.fround(.15),sourceId:a.id});
 assert.equal(b.hitStop,0,'isolated effect contact queues the stop before the next actor update');
 const before=b.animationTime;sim.step(1/60,{}, {snapshot:false});
 assert.equal(b.animationTime,before,'the next eligible actor update is stopped');
 assert.equal(b.hitStop,Math.fround(Math.fround(.15)-Math.fround(1/60)));
});
