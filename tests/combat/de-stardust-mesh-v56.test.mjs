/** Original2016 declarations define the boundaries; these tests exercise the
 * current Web consumer and explicit seeded instance policy, not client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {initializeAddStardustMesh,resolvedAddStardustTemplate,validateAddStardustMesh,STARDUST_CARRIER,STARDUST_BALL,STARDUST_BALL_MESH} from '../../packages/combat-core/add-stardust-mesh-v56.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createLiteralMesh,stepShadowMesh} from '../../packages/combat-core/shadow-mesh.mjs';
const f32=Math.fround,dt=1/60;
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/de-profile.json',import.meta.url)));
const source=JSON.parse(readFileSync(new URL('../../contracts/de-stardust-mesh-v56.json',import.meta.url)));
const step=(f,input={})=>f.sim.step(dt,input,{snapshot:false});
function until(f,predicate,n,label){for(let i=0;i<n&&!predicate();i++)step(f);assert.ok(predicate(),label);}
function start(facing){const f=originalAddFixture('DE',{skillId:29021});f.a.mp=f.a.mpMax;f.a.facing=facing;f.b.x=5000;
 until(f,()=>f.sim.skillAvailability(f.a.id,0).available,120,'normal skill permission');
 step(f,{add:{pressed:['A'],held:['A']}});
 assert.ok(f.a.sourceAddNative?.some(r=>r.kind==='stardust'&&!r.active),'original main enter waits for received exit');
 until(f,()=>f.sim.state.effects.some(e=>e.name===STARDUST_BALL),180,'actual exit and real spwan node produce Ball');return f;
}
test('Stardust source seal keeps raw random ranges, velocity event and actual carrier pose bytes',()=>{
 for(const row of source.rows){const template=profile.effectTemplates[row.name];assert.deepEqual(template.fields,row.fields);assert.deepEqual(template.events,row.events);
  const bytes=readFileSync(new URL('../../artifacts/de/'+row.poseData,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.poseSha256);
 }
 const t=profile.effectTemplates[STARDUST_BALL_MESH];assert.deepEqual(t.fields.LifeTime,{random:[.6,.62]});
 assert.deepEqual(t.events.find(e=>e.property==='Velocity'&&e.start===.5).value,[{random:[-1500,1500]},-5000,0]);
 assert.deepEqual(profile.effectTemplates[STARDUST_CARRIER].events.find(e=>e.property==='Rotate').value,[0,{random:[0,360]},0]);
});
test('Stardust freezes explicit independent mesh inputs once without rewriting the original declarations',()=>{
 const before=structuredClone(profile.effectTemplates[STARDUST_BALL_MESH]);let calls=0;const draws=[.25,.75];
 const e={name:STARDUST_BALL,mainEffectName:STARDUST_BALL_MESH,skillId:29021};
 initializeAddStardustMesh(e,profile,()=>draws[calls++]);assert.equal(calls,2);
 const life=f32(f32(.6)+f32(f32(f32(.62)-f32(.6))*f32(8192/32767))),vx=f32(-1500+f32(3000*f32(24576/32767)));
 assert.deepEqual(e.sourceAddStardustMesh,{version:1,lifeTime:life,velocityX:vx});
 const t=resolvedAddStardustTemplate(profile.effectTemplates[STARDUST_BALL_MESH],e);
 assert.equal(t.fields.LifeTime,life);assert.deepEqual(t.events.find(e=>e.property==='Velocity'&&e.start===.5).value,[vx,-5000,0]);
 initializeAddStardustMesh(e,profile,()=>{throw Error('must not resample');});assert.deepEqual(profile.effectTemplates[STARDUST_BALL_MESH],before);
});
test('target2016 Stardust lifetime tests old age strictly greater; exact equality survives this packet',()=>{
 const e={name:STARDUST_BALL,mainEffectName:STARDUST_BALL_MESH,skillId:29021};initializeAddStardustMesh(e,profile,()=>0);
 const t=resolvedAddStardustTemplate(profile.effectTemplates[STARDUST_BALL_MESH],e),events=t.events.filter(e=>e.property!=='SlashTrace');
 const mesh=createLiteralMesh({name:STARDUST_BALL_MESH,position:[0,700,0],velocity:[0,0,0],landY:0,fields:t.fields,events,rotation:[0,0,0],motionRotation:[0,0,0]});
 mesh.nowLifeTime=f32(.6);stepShadowMesh(mesh,.01,events);assert.equal(mesh.deathReason,null);
 assert.ok(mesh.nowLifeTime>f32(.6));stepShadowMesh(mesh,.01,events);assert.equal(mesh.deathReason,'template-life-time');
});
for(const facing of [1,-1])test(`Stardust actual DE input facing${facing} creates moving rain, original death child and finite lifetime`,()=>{
 const f=start(facing),{sim,a}=f,ball=sim.state.effects.find(e=>e.name===STARDUST_BALL),id=ball.id;
 const carrier=sim.state.effects.find(e=>e.name===STARDUST_CARRIER);
 assert.ok(carrier.sourceAddStardustMesh.yaw>=0&&carrier.sourceAddStardustMesh.yaw<=360);
 assert.ok(carrier.sourceShadowMesh&&ball.sourceShadowMesh);assert.equal(ball.birthAnchor.customPosition,true);
 const born=[...ball.birthAnchor.position];assert.equal(born[1],a.y+700);
 assert.ok(ball.lifeTimeSeconds>=f32(.6)&&ball.lifeTimeSeconds<=f32(.62));
 assert.deepEqual(ball.sourceShadowMesh.velocity,[0,0,0]);
 until(f,()=>ball.sourceShadowMesh.globalTime>=.5,60,'source global .5 boundary');
 const crossingY=f32(f32(born[1])+f32(-5000*f32(ball.sourceShadowMesh.globalTime-f32(.5))));
 assert.equal(ball.currentAnchor.position[1],crossingY,'crossing packet integrates only the segment after original .5');
 const oldGlobal=ball.sourceShadowMesh.globalTime,oldY=ball.currentAnchor.position[1];step(f);
 const expectedY=f32(oldY+f32(-5000*f32(ball.sourceShadowMesh.globalTime-oldGlobal)));
 assert.equal(ball.currentAnchor.position[1],expectedY);assert.ok(ball.currentAnchor.position[1]<born[1]);
 const point=sim.effectBoneSampler(ball,a,'Dummy01');assert.ok(point[1]<born[1],'actual passive attachment follows the descending mesh');
 until(f,()=>!sim.state.effects.some(e=>e.id===id),30,'random bounded lifetime retires the original ball');
 const children=sim.state.effects.filter(e=>e.parentEffectId===id);
 assert.ok(children.some(e=>e.name==='DamageEffect_ATT_Stardust_Shower_Ball_Small_Explosion'));
 assert.ok(!children.some(e=>e.damage?.DAMAGE_DATA?.DAMAGE?.MAGIC===22),'visual ball death cannot manufacture terminal22 damage');
 until(f,()=>!a.sourceAddNative?.some(r=>r.kind==='stardust'),240,'original duration reclaims the rain controller');
 for(let i=0;i<90;i++)step(f);
 assert.equal(sim.state.effects.filter(e=>e.name===STARDUST_BALL).length,0);
 assert.equal(sim.state.unsupported.some(n=>n.id.startsWith('add-stardust-original-node')),false);
});
test('Stardust owner samples preserve the same instance through independent IDs and reject forged parameters',()=>{
 const f=start(1),{sim,a,profile}=f;const packet=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:2,frameSeq:sim.state.step})));
 const validate=p=>{const r=validateOwnedState(p);validateOwnedReferences(r,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});return r;};
 validate(packet);const ball=packet.effects.find(e=>e.name===STARDUST_BALL);assert.ok(ball.sourceAddStardustMesh);
 for(const modify of [e=>e.sourceAddStardustMesh.lifeTime=f32(.63),e=>e.sourceAddStardustMesh.velocityX=1501,
  e=>e.sourceAddStardustMesh.unknown=1,e=>e.skillId=29022,e=>delete e.sourceAddStardustMesh]){
  const bad=structuredClone(packet);modify(bad.effects.find(e=>e.id===ball.id));assert.throws(()=>validate(bad));
 }
 const seed=sim.state.seed,old=structuredClone(packet);sim.state.effects=[];sim.state.nextEffectId+=10000;
 applyOwnedState(sim,a.id,validate(packet));assert.equal(sim.state.seed,seed,'receiving an existing source instance consumes no RNG');
 const restored=sim.state.effects.find(e=>e.networkId===ball.id);assert.deepEqual(restored.sourceAddStardustMesh,ball.sourceAddStardustMesh);
 assert.equal(restored.templateFields.LifeTime,ball.sourceAddStardustMesh.lifeTime);assert.deepEqual(restored.birthAnchor,ball.birthAnchor);
 assert.deepEqual(packet,old);validateAddStardustMesh(restored,profile);
});
