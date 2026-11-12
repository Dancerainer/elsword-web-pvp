import test from 'node:test';
import assert from 'node:assert/strict';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createBattleLifeEffects} from '../../apps/web/battle-life-effects.mjs';
import {addBattleLifeVisuals} from '../../packages/combat-assets/battle-life.mjs';
import {professionPoseAssetPath} from '../../packages/combat-assets/common-buffs.mjs';
import {createEffectRenderOffsets,createEffectRenderState,offsetEffectPosition} from '../../apps/web/effect-render-anchors.mjs';
import source from '../../contracts/battle-life-fx-index-v1.json' with {type:'json'};
const point=a=>[a.x,a.y,a.z],bones={'Dummy1_Rhand':[25,80,0],'Dummy2_Lhand':[-25,80,0]};
const samplers={actorRotationSampler:a=>[0,a.facing<0?180:0,0],effectAnchorSampler:({definition:d},a)=>({
  position:point(a).map((n,i)=>n+(bones[d.BONE_NAME]?.[i]??0)*(!i?a.facing:1)),rotation:[0,d.APPLY_UNIT_ROTATION===0?0:a.facing<0?180:0,0]})};
function fixture(){
  const index=addBattleLifeVisuals({schemaVersion:1,referenceVersion:source.referenceVersion,templates:{}},source),runtime=createEffectRuntime({index,seed:2016});
  const view=createBattleLifeEffects({runtime,samplers,index}),actor={id:'p',professionId:'RF',hp:100,x:100,y:200,z:300,facing:1,buffs:[],guild:{heroSacrificeFired:false}};
  return {index,runtime,view,actor,state:{actors:[actor],effects:[]}};
}
const tick=(s,dt)=>{s.view.step(s.state,dt);s.runtime.step(dt,s.state);};
test('original minor respawn meshes appear immediately; four ring callbacks use source animation times/positions exactly once',()=>{
  const s=fixture();s.view.event({type:'respawn',playerId:'p',eventId:1},s.state);
  assert.deepEqual(Object.keys(s.view.proof().triggers).sort(),source.callbacks.respawn.initialTemplates.toSorted());
  const original=structuredClone(s.state);s.actor.pvpPresentation={state:'RSI_START_INTRUDE',time:0};
  for(const [time,count]of [[.099,0],[.101,1],[.261,2],[.391,3],[.521,4],[.9,4]]){
    s.actor.pvpPresentation.time=time;tick(s,1/60);assert.equal(s.view.proof().triggers.RespawnLanding_P04??0,count);
  }
  const rings=[...s.runtime.emitters.values()].filter(e=>e.name==='RespawnLanding_P04');
  assert.deepEqual(rings.map(e=>e.position),[50,100,150,200].map(h=>[110,200+h,300]));
  s.view.event({type:'respawn',playerId:'p',eventId:1},s.state);assert.equal(s.view.proof().triggers.RespawnLanding01,1);
  assert.equal(original.actors[0].hp,s.actor.hp);assert.equal(s.index.templates.RespawnLanding01.sourceFamily,'game-minor');
});
test('late snapshot does not replay the old initial revival flash; next observed death/revival starts a new one',()=>{
  const s=fixture();s.actor.pvpPresentation={state:'ESSI_START_INTRUDE',time:.8};tick(s,1/60);
  assert.deepEqual(s.view.proof().triggers,{});s.actor.pvpPresentation=null;s.actor.hp=0;tick(s,1/60);
  s.actor.hp=100;s.actor.pvpPresentation={state:'ESSI_START_INTRUDE',time:0};tick(s,1/60);
  assert.equal(s.view.proof().triggers.RespawnLanding01,1);
});
test('hero sacrifice schedules the four source lights and deduplicates event plus snapshot',()=>{
  const s=fixture();tick(s,0);s.actor.hp=0;s.actor.guild.heroSacrificeFired=true;
  const event={type:'guildHeroSacrifice',actorId:'p',eventId:4};s.view.event(event,s.state);s.view.event(event,s.state);
  assert.deepEqual(s.view.proof().triggers,{UpLight_GS_Sacrifice_of_Hero01:1});
  tick(s,.101);assert.equal(s.view.proof().triggers.Light_GS_Sacrifice_of_Hero01,1);
  tick(s,.55);assert.equal(s.view.proof().triggers.Ring_GS_Sacrifice_of_Hero01,1);assert.equal(s.view.proof().triggers.LightParticle_GS_Sacrifice_of_Hero01,1);
  tick(s,.2);assert.equal(s.view.proof().triggers.UpLight_GS_Sacrifice_of_Hero01,1);
});
test('snapshot transition can restore hero dispatch, while an already fired historical snapshot is not replayed',()=>{
  const s=fixture();s.actor.guild.heroSacrificeFired=true;tick(s,0);assert.deepEqual(s.view.proof().triggers,{});
  s.actor.guild.heroSacrificeFired=false;tick(s,0);s.actor.hp=0;s.actor.guild.heroSacrificeFired=true;tick(s,0);
  assert.equal(s.view.proof().triggers.UpLight_GS_Sacrifice_of_Hero01,1);
});
test('actual active Template57 emits both original hand lightning sequences, follows movement/facing, and never grants a buff',()=>{
  const s=fixture();tick(s,0);s.actor.buffs=[{templateId:57,elapsed:0,finalizers:[{kind:'time',remaining:30},{kind:'hit',remaining:15}]}];
  const before=structuredClone(s.state);tick(s,.2);assert.deepEqual(s.state,before);
  assert.deepEqual(s.view.proof().hands.map(h=>h.bone),['Dummy1_Rhand','Dummy2_Lhand']);
  assert.equal(s.view.proof().triggers.Lightning_GS_Chance_to_Reverse01,2);assert.equal(s.view.proof().triggers.Smoke_UnoHound_AttackB01,1);
  s.actor.x=200;s.actor.facing=-1;tick(s,.1);
  assert.deepEqual(s.view.proof().hands.map(h=>h.position),[[175,280,300],[225,280,300]]);
  assert.ok(s.view.proof().hands.every(h=>h.traceMore&&h.activeParticles>0));
  const handles=s.view.proof().hands.map(h=>[...s.runtime.emitters.values()].find(e=>e.name===h.template&&e.options.bone===h.bone).id);
  s.actor.buffs=[];tick(s,1/60);assert.deepEqual(s.view.proof().hands,[]);assert.ok(handles.every(id=>!s.runtime.emitters.has(id)));
});
test('restoring old Template57 starts only persistent hands; hidden/dead owners hide then delete handles',()=>{
  const s=fixture();s.actor.buffs=[{templateId:57,elapsed:10}];tick(s,.2);
  assert.equal(s.view.proof().triggers.Smoke_UnoHound_AttackB01,undefined);assert.equal(s.view.proof().hands.length,2);
  s.actor.hidden=true;tick(s,0);assert.ok([...s.runtime.emitters.values()].every(e=>e.options.hidden===true));
  s.actor.hp=0;tick(s,0);assert.equal(s.view.proof().hands.length,0);
});
test('hand particles use the displayed bone during render without modifying simulation positions',()=>{
  const s=fixture();s.actor.buffs=[{templateId:57,elapsed:0}];tick(s,.2);
  const p=[...s.runtime.particles.values()].find(p=>p.name==='Lightning_GS_Chance_to_Reverse01'),before=[...p.position];
  const shown={...s.actor,x:s.actor.x+30},state=createEffectRenderState(s.state,[shown],samplers),offset=createEffectRenderOffsets(s.runtime,state)(p);
  assert.deepEqual(offset,[30,0,0]);assert.deepEqual(offsetEffectPosition(p.position,offset),before.map((n,i)=>n+(i?0:30)));assert.deepEqual(p.position,before);
});
test('resource merge rebases assets and preserves inputs; mismatched/conflicting/path escaping resources fail closed',()=>{
  const base={schemaVersion:1,referenceVersion:source.referenceVersion,templates:{}},before=structuredClone(source),merged=addBattleLifeVisuals(base,source);
  assert.equal(Object.keys(base.templates).length,0);assert.deepEqual(source,before);
  assert.match(merged.templates.RespawnLanding01.glb,/^\.\.\/battle-life\//);assert.equal(professionPoseAssetPath('VC',merged.templates.RespawnLanding01.poseData),'battle-life/fx/meshes/RespawnLanding01.pose.json');
  assert.throws(()=>addBattleLifeVisuals(base,{...source,referenceVersion:'unknown'}),/frozen target/);
  assert.throws(()=>addBattleLifeVisuals({...base,templates:{RespawnLanding01:{kind:'particle'}}},source),/Conflicting/);
  const damaged=structuredClone(source);damaged.templates.RespawnLanding01.glb='../escape.glb';assert.throws(()=>addBattleLifeVisuals(base,damaged),/asset path/);
});
