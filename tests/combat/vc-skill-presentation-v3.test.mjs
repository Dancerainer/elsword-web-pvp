/** Expectations are fixed source literals, independent of simulator output.
 * Source references: contracts/vc-skill-presentation-source-v3.json. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {veteranEvents,veteranSkillEvent,veteranStart,activateVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createLiteralMesh,stepShadowMesh} from '../../packages/combat-core/shadow-mesh.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`);
const vector=(a,b)=>a.forEach((n,i)=>close(n,b[i]));
function inState(f,state,time){f.sim.enter(f.a,state,'isolated-source-callback');f.a.animationTime=time;f.sim.drainEvents();}
function presses(f,count,time=.1){const events=[];for(let i=0;i<count;i++){
  f.sim.state.step++;f.a.animationTime=time;veteranSkillEvent(f.sim,f.a,{pressed:new Set(['A'])});events.push(...f.sim.drainEvents());
}return events;}
function cast(f){f.sim.step(1/60,{vc:{pressed:['A']}});f.sim.drainEvents();}

for(const loop of [1,5,9,18])test(`Gatling loop ${loop} uses the target2016 explosion set without old V5 bullets`,()=>{
  const f=vcFixture({skillId:24020});cast(f);f.a.sourceVeteranCommander.loop=loop-1;
  f.sim.enter(f.a,'RSI_SA_RWT_HELLFIRE_GATLING_LOOP','target2016-loop-audit');f.a.animationTime=.15;
  veteranEvents(f.sim,f.a,0,.15);
  const events=f.sim.drainEvents();
  assert.equal(events.filter(e=>e.type==='effectSet'&&e.name==='EffectSet_SA_RWT_HellFire_Loop'+(loop>17?'_OverHit':'')).length,1);
  assert.equal(events.filter(e=>e.type==='effectSet'&&e.name==='EffectSet_Raven_Hellfire_Gatling').length,0);
  assert.equal(f.sim.state.effects.filter(e=>e.name.startsWith('RAVEN_HELLFIRE_GATLING_BULLET')).length,0);
});

for(const facing of [-1,1])test(`Deadly Raid fixed hand explosion remains at release point, facing ${facing}`,()=>{
  const f=vcFixture({skillId:24024,facing});cast(f);inState(f,'RVC_SI_SA_DEADLY_RAID',1.866);
  const hand=f.sim.effectAnchorSampler({definition:{BONE_NAME:'Bip01_L_Hand'}},f.a).position;
  const expected=[hand[0]+100*facing,hand[1],hand[2]];
  veteranEvents(f.sim,f.a,1.85,1.88);
  const effects=f.sim.state.effects.filter(e=>e.setName==='EffectSet_Raven_Deadly_Raid');assert.equal(effects.length,8);
  for(const e of effects){assert.equal(e.birthAnchor.customPosition,true);vector(e.birthAnchor.position,expected);}
  f.a.x+=700;f.a.animationTime=2.1;
  for(const e of effects)vector(f.sim.effectAnchorSampler(e,f.a).position,expected);
});

test('Giga custom fire-pillar origin preserves the original FireTail Y=-200 offset',()=>{
  const f=vcFixture({skillId:24021});cast(f);inState(f,'RSI_SA_RWT_GIGA_PROMINENCE_LOOP',.02);
  veteranEvents(f.sim,f.a,0,.02);
  const effects=f.sim.state.effects.filter(e=>e.setName==='EffectSet_Raven_Giga_Prominence_Flame');
  const flame=effects.find(e=>e.name==='RAVEN_GIGA_PROMINENCE_FLAME'),tail=effects.find(e=>e.name==='RWT_GIGA_PROMINENCE_FireTail');
  assert.ok(flame&&tail);assert.equal(tail.birthAnchor.customPosition,true);
  vector(tail.birthAnchor.position,[flame.birthAnchor.position[0],flame.birthAnchor.position[1]-200,flame.birthAnchor.position[2]]);
});

for(const facing of [-1,1])test(`Giga two sides reverse DirSpeed, preserving owner mesh rotation, facing ${facing}`,()=>{
  const f=vcFixture({skillId:24021,facing});cast(f);inState(f,'RSI_SA_RWT_GIGA_PROMINENCE_FINISH',.41);
  veteranEvents(f.sim,f.a,.39,.41);
  const effects=f.sim.state.effects.filter(e=>e.name==='RAVEN_GIGA_PROMINENCE_FINISH');assert.equal(effects.length,2);
  assert.deepEqual(effects.map(e=>e.sourceDirSpeedSign??1),[-1,1]);
  for(const e of effects){assert.equal(e.birthAnchor.facing,facing);vector(e.birthAnchor.rotation,[0,facing<0?180:0,0]);}
});

test('Ground Impact original 1.5 instance scale affects three particle layers, not disabled stones or damage',()=>{
  const f=vcFixture({skillId:24216});cast(f);inState(f,'SI_A_RRF_GROUND_IMPACT',.47);
  veteranEvents(f.sim,f.a,.46,.47);
  const effects=f.sim.state.effects.filter(e=>e.setName==='EffectSet_RAVEN_GROUND_IMPACT');assert.equal(effects.length,6);
  for(const e of effects){const scaled=/^(UpLight|Ground_ShockWave)/.test(e.name);
    assert.equal(e.definition.SCALE_X??1,scaled?1.5:1);assert.equal(e.definition.SCALE_Y??1,scaled?1.5:1);assert.equal(e.definition.SCALE_Z??1,scaled?1.5:1);
  }
});

for(const [id,state]of [[24034,'RSI_SA_RWT_REVOLVER_CANNON_LOOP'],[24020,'RSI_SA_RWT_HELLFIRE_GATLING_LOOP'],[24022,'RVC_SI_SA_IGNITION_CROW'],[24023,'RVC_SI_SA_IGNITION_CROW_INCINERATION']])test(`skill ${id} shows one overheat notice at accepted input, before buff activation`,()=>{
  const f=vcFixture({skillId:id});cast(f);inState(f,state,.1);
  assert.equal(presses(f,4).filter(e=>e.type==='overheatIcon').length,0);
  const e=presses(f,1).find(e=>e.type==='overheatIcon');assert.ok(e);assert.equal(e.size,0);assert.equal(f.a.buffs.some(b=>b.templateId===250),false);
  assert.equal(presses(f,9).filter(e=>e.type==='overheatIcon').length,0);
  assert.equal(e.position.length,3);assert.equal(e.direction.length,3);
});

test('Deadly Raid accepts tier 1/2/3 overheat notices during its first animation',()=>{
  const f=vcFixture({skillId:24024});cast(f);
  const events=presses(f,8);assert.deepEqual(events.filter(e=>e.type==='overheatIcon').map(e=>e.size),[1,2,3]);
});

test('Giga notice starts with accepted overheat finish; normal finish emits none',()=>{
  for(const presses of [4,5]){const f=vcFixture({skillId:24021});cast(f);f.a.sourceVeteranCommander.presses=presses;
    f.sim.enter(f.a,'RSI_SA_RWT_GIGA_PROMINENCE_FINISH','isolated-source-callback');
    assert.equal(f.sim.drainEvents().filter(e=>e.type==='overheatIcon').length,presses===5?1:0);
    veteranStart(f.sim,f.a);assert.equal(f.sim.drainEvents().filter(e=>e.type==='overheatIcon').length,0);
    assert.equal(f.a.sourceVeteranCommander.overheatIconSize,presses===5?0:-1);
  }
});

test('overheat attachment traces the arm matrix and survives owner-packet hydration',()=>{
  const f=vcFixture(),g=vcFixture();activateVeteranOverheat(f.sim,f.a);
  const e=f.sim.state.effects.find(e=>e.name==='RVC_OverHeat_Object_Start');assert.equal(e.definition.TRACE_MATRIX,1);
  f.sim.step(1/60,{});const packet=encodeOwnedState(f.sim,'vc',{frameSeq:1});validateOwnedState(packet);validateOwnedReferences(packet,f.a,f.profile,f.map);
  applyOwnedState(g.sim,'vc',packet);assert.equal(g.sim.state.effects.find(e=>e.name==='RVC_OverHeat_Object_Start').definition.TRACE_MATRIX,1);
});

test('Burning Buster crow follows original 0.66-to-1 velocity fade and switches animation at .96',()=>{
  const {profile}=vcFixture({skillId:24605}),t=profile.effectTemplates.EffectSet_RVC_Flame_Buster_CROW_M01;
  const m=createLiteralMesh({name:t.name,position:[0,3000,0],velocity:[0,0,0],landY:0,fields:t.fields,events:t.events,rotation:[0,0,0]});
  for(let i=0;i<66;i++)stepShadowMesh(m,.01,t.events);
  vector(m.position,[0,3000,0]);
  for(let i=0;i<34;i++)stepShadowMesh(m,.01,t.events);
  // Integral of the source linear velocity ramp over .34s: 0.5*.34*V.
  vector(m.position,[510,2830,0]);assert.equal(m.animationName,'IGNITION_CROW_CROW_END');assert.equal(m.animationPlayback,'XAP_LOOP');
});

test('direct muzzle offset consumes the source direction vector (synthetic oblique basis)',()=>{
  const f=vcFixture({skillId:24034}),line={lineId:999,start:[0,0,0],end:[300,0,400]};
  cast(f);inState(f,'RSI_SA_RWT_REVOLVER_CANNON_LOOP',.011);f.a.lineId=line.lineId;
  f.sim.map={...f.sim.map,lines:[...f.sim.map.lines,line]};
  const hand=f.sim.effectAnchorSampler({definition:{BONE_NAME:'Bip01_L_Hand'}},f.a).position;
  const d=line.end.map((n,i)=>n-line.start[i]),length=Math.hypot(...d);
  veteranEvents(f.sim,f.a,0,.011);
  const shell=f.sim.state.effects.find(e=>e.name==='RAVEN_REVOLVER_CANNON_SHELL');
  vector(shell.birthAnchor.position,hand.map((n,i)=>n-50*d[i]/length));
});
