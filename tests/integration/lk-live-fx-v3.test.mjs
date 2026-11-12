import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Real target2016 assets + public input, source-based expectations. These
 * checks describe the current adapter, not a measured target-client GPU run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {ARMAGEDDON_SET as SET,ARMAGEDDON_SWORD as SWORD} from '../../packages/combat-core/lk-effect-set-targets.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=process.env.LK_TEST_ASSETS_ROOT??resolve(root,'artifacts');
const read=p=>JSON.parse(readFileSync(resolve(assets,'lk',p)));
const index=read('fx/index.json'),poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(p)]));
const CAST=['Light_Knight_ArmageddonBlade01','Light_Knight_ArmageddonBlade02','Flare_MagicKnight_WindBlade01'];
const preset=authoredEquipmentPreset(JSON.parse(readFileSync(resolve(root,'config/lk-preset.json'))));
async function fixture(t,{full=false,facing=1}={}){
 const f=await lkCommandFixture({gap:5000,facing,preset:{...preset,guildPassives:[],loadout:Array(8).fill(null)}}),engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('lk-live-fx',new Vector3(0,30,10),scene);
 const names=full?Object.keys(index.templates):[...CAST,...Object.values(f.profile.effectSets[SET].raw).filter(e=>e?.NAME).map(e=>e.NAME),
  'Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','RollingSmash_SwordWY01'];
 const bounded={...f.profile,states:full?f.profile.states:{ESSI_ESK_DASH_JUMP_ZZZ:f.profile.states.ESSI_ESK_DASH_JUMP_ZZZ},skillCatalog:full?f.profile.skillCatalog:[],
  buffTemplates:full?f.profile.buffTemplates:{},resourceOnlyTemplates:names,resourceOnlyEffectSets:[],effectSets:full?f.profile.effectSets:{[SET]:f.profile.effectSets[SET],EffectSet_ESK_DASH_JUMP_ZZZ:f.profile.effectSets.EffectSet_ESK_DASH_JUMP_ZZZ}};
 const view=await createEffectsView({scene,engine,index:{...index,templates:Object.fromEntries(names.map(n=>[n,index.templates[n]]))},profile:bounded,effectPoses:poses,
  samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler},effectQuality:DEFAULT_EFFECT_QUALITY,
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assets,'lk',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});f.sim.drainEvents();
 const events=[];const step=(input={},dt=1/60)=>{f.sim.step(dt,{lk:input},{snapshot:false});const batch=f.sim.drainEvents();events.push(...batch);
  for(const e of batch)view.event(e,f.sim.state);view.step(dt,f.sim.state);view.render();return view.proof({includeDraws:true});};
 return {...f,view,step,events};
}
for(const facing of [-1,1])for(const awake of [false,true])test(`real Armageddon ${facing}/${awake}: cast cues, exact sword bones, movement, swing and expiry`,async t=>{
 const f=await fixture(t,{facing}),{sim,actor,events,step,view}=f;
 sim.configureLoadout([{skillId:21008,branchId:'none'},...Array(7).fill(null)],'lk');if(awake)actor.awakening.remaining=30;
 const seen=new Set();let snapshot;
 for(let frame=0;frame<190;frame++){const proof=step(frame===0?{pressed:['A']}:{});
  for(const [name,count] of Object.entries(proof.nativeParticleDraws.counts))if(count>0)seen.add(name);
  if(frame===150)snapshot=encodeOwnedState(sim,'lk');}
 for(const name of CAST)assert.ok(seen.has(name),'missing original cast cue '+name);
 for(const name of [SWORD,'ELK_ArmagedonBladeB01','ELK_ArmagedonBladeP01','ELK_ArmagedonBladeP02'])assert.ok(seen.has(name),'missing sustained layer '+name);
 const flare=events.find(e=>e.type==='effectStarted'&&e.name===CAST[2]);assert.ok(flare?.birthAnchor);
 for(const e of events.filter(e=>e.type==='effectStarted'&&([...CAST,...Object.values(f.profile.effectSets[SET].raw).filter(e=>e?.NAME).map(e=>e.NAME)].includes(e.name))))
  assert.ok(e.birthAnchor?.position.every(Number.isFinite),e.name+' original birth anchor');
 assert.doesNotThrow(()=>validateOwnedReferences(snapshot,actor,f.profile,f.map));
 const sword=sim.state.effects.find(e=>e.name===SWORD),layers=sim.state.effects.filter(e=>e.sourceBoneTargetMeshId===sword.id);
 assert.equal(layers.length,2);assert.deepEqual(layers.map(e=>e.definition.BONE_NAME).sort(),['Dummy02','Dummy03']);
 const initial=layers.map(e=>[...e.currentAnchor.position]);
 for(let i=0;i<45;i++){step({pressed:i===0?['Z']:[],held:i>25?[facing>0?'RIGHT':'LEFT']:[]});
  for(const e of layers)assert.deepEqual(e.currentAnchor.position,sim.effectBoneSampler(sword,actor,e.definition.BONE_NAME));}
 assert.ok(layers.some((e,i)=>Math.hypot(...e.currentAnchor.position.map((n,j)=>n-initial[i][j]))>20),'sword bones must follow the actual changed pose');
 assert.ok(!view.proof().unsupported.some(n=>/Armagedon.*:birth|ArmageddonBlade.*:(texture|pool-budget)/.test(n)));
 const receiver=await fixture(t,{facing});receiver.sim.configureLoadout(actor.loadout,'lk');receiver.sim.state.nextEffectId=500;
 applyOwnedState(receiver.sim,'lk',snapshot);const remoteSword=receiver.sim.state.effects.find(e=>e.name===SWORD);
 assert.ok(remoteSword.id>=500);for(const e of receiver.sim.state.effects.filter(e=>e.sourceBoneTargetMeshId!=null))assert.equal(e.sourceBoneTargetMeshId,remoteSword.id);
 applyOwnedState(receiver.sim,'lk',snapshot);assert.equal(receiver.sim.state.effects.filter(e=>e.name===SWORD).length,1);
 // P01/P02 are 10/s ambient particles at medium density: the first birth
 // takes .8s. Observe the complete interval, rather than expecting a birth
 // at the arbitrary .333s receiver sampling point.
 const remoteSeen=new Set();for(let i=0;i<90;i++){
  const proof=receiver.step();for(const [name,count]of Object.entries(proof.nativeParticleDraws.counts))if(count>0)remoteSeen.add(name);
  for(const e of receiver.sim.state.effects.filter(e=>e.sourceBoneTargetMeshId!=null))
   assert.deepEqual(e.currentAnchor.position,receiver.sim.effectBoneSampler(remoteSword,receiver.actor,e.definition.BONE_NAME));
 }
 for(const name of [SWORD,'ELK_ArmagedonBladeB01','ELK_ArmagedonBladeP01','ELK_ArmagedonBladeP02'])assert.ok(remoteSeen.has(name),name+' must draw after actual ownership reconstruction');
 actor.buffs=actor.buffs.filter(b=>b.templateId!==322);step();assert.equal(sim.state.effects.filter(e=>e.setName===SET).length,0);
 assert.ok(!Object.keys(view.proof({includeDraws:true}).nativeParticleDraws.counts).some(n=>n.startsWith('ELK_Armagedon')));
});
test('Armageddon wire rejects missing anchors, foreign target, wrong bone binding and another cast instance',async()=>{
 const f=await lkCommandFixture({gap:5000,preset});f.sim.configureLoadout([{skillId:21008},...Array(7).fill(null)],'lk');
 for(let i=0;i<190;i++){f.sim.step(1/60,{lk:i===0?{pressed:['A']}:{}});f.sim.drainEvents();}
 const good=encodeOwnedState(f.sim,'lk'),layer=good.effects.find(e=>e.name==='ELK_ArmagedonBladeP01');assert.ok(layer);
 for(const change of [e=>{e.currentAnchor=null;},e=>{e.birthAnchor=null;},e=>{e.sourceBoneTargetMeshId=999;},e=>{e.sourceBoneEffectSetId='another';}]){
  const p=structuredClone(good);change(p.effects.find(e=>e.id===layer.id));assert.throws(()=>validateOwnedState(p),/invalid-owner-effect/);}
 const other=structuredClone(good);other.effects.find(e=>e.id===layer.id).setStartState+=1;
 assert.throws(()=>validateOwnedReferences(other,f.actor,f.profile,f.map),/invalid-owner-effect-bone-target/);
});
for(const facing of [-1,1])test(`real device 668ZZZ ${facing}: all three original spin layers survive multiple animation loops and clear on landing`,async t=>{
 const f=await fixture(t,{facing}),input=createInputBuffer(),key=facing===1?'RIGHT':'LEFT',rows=[];
 const step=()=>{const proof=f.step(input.consume(f.sim.state.time+1/60));rows.push({state:f.actor.state,time:f.actor.animationTime,draws:proof.nativeParticleDraws.counts});};
 const tap=k=>{input.tap(k,f.sim.state.time+.001);step();};
 const wait=(fn,max=240)=>{for(let i=0;i<max&&!fn();i++)step();assert.ok(fn(),f.actor.state);};
 tap(key);input.down(key,f.sim.state.time+.001);step();assert.equal(f.actor.state,'RSI_DASH');tap('UP');for(let i=0;i<4;i++)step();
 tap('Z');wait(()=>f.actor.animationTime>=.04);tap('Z');wait(()=>f.profile.states[f.actor.state].sourceState==='ESSI_DASH_JUMP_COMBO_Z2');
 wait(()=>f.actor.animationTime>=.04);tap('Z');wait(()=>f.actor.state==='ESSI_ESK_DASH_JUMP_ZZZ');
 for(let i=0;i<6;i++)step();
 const packet=encodeOwnedState(f.sim,'lk');
 assert.equal(packet.effects.filter(e=>e.setName==='EffectSet_ESK_DASH_JUMP_ZZZ').length,3,'source state-owned spin handles must survive ownership sampling');
 const receiver=await fixture(t,{facing});applyOwnedState(receiver.sim,'lk',packet);
 assert.equal(receiver.sim.state.effects.filter(e=>e.setName==='EffectSet_ESK_DASH_JUMP_ZZZ').length,3);
 for(let i=0;i<10;i++)receiver.step();
 for(const name of ['Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','RollingSmash_SwordWY01'])
  assert.ok(receiver.view.proof({includeDraws:true}).nativeParticleDraws.counts[name]>0,name+' must draw on remote third-Z reconstruction');
 wait(()=>f.actor.state==='ESSI_ESK_DASH_JUMP_ZZZ_LANDING');
 const spin=rows.filter(r=>r.state==='ESSI_ESK_DASH_JUMP_ZZZ');assert.ok(spin.length>=20);
 for(const name of ['Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','RollingSmash_SwordWY01']){
  assert.ok(spin.slice(8).every(r=>(r.draws[name]??0)>0),name+' spin must continue drawing on every later packet: '+JSON.stringify(spin.map(r=>r.draws[name]??0)));
 }
 assert.ok(!f.view.proof().unsupported.some(n=>/RollingSmash.*:(birth|pool-budget|geometry)/.test(n)));
 for(let i=0;i<40;i++)step();assert.ok(!Object.keys(f.view.proof({includeDraws:true}).nativeParticleDraws.counts).some(n=>n.includes('RollingSmash')));
});
for(const facing of [-1,1])test(`Rolling Smash ${facing}: original four spin layers remain continuous under medium quality until source landing`,async t=>{
 const f=await fixture(t,{full:true,facing}),names=['Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','Elsword_RollingSmash_M02','RollingSmash_SwordWY01'],rows=[];
 f.sim.configureLoadout([{skillId:21205},...Array(7).fill(null)],'lk');
 for(let i=0;i<180;i++){const proof=f.step(i===0?{pressed:['A']}:{});
  if(f.actor.state==='ESSI_A_ELK_ROLLING_SMASH')rows.push(proof.nativeParticleDraws.counts);}
 assert.ok(rows.length>=20);for(const name of names)assert.ok(rows.slice(12).every(r=>r[name]>0),name+' source trail must not blink under medium density');
 assert.equal(f.sim.state.effects.filter(e=>e.setName==='EffectSet_A_Elsword_RollingSmash').length,0);
 assert.ok(!names.some(name=>f.view.proof({includeDraws:true}).nativeParticleDraws.counts[name]>0));
});
test('all 20 LK skills normal/awakened: actual input births and native model/particle draw audit',async t=>{
 const f=await fixture(t,{full:true}),initial=f.sim.snapshot(),rows=[];
 const ids=[21026,21217,21027,21028,21029,21219,21031,21030,21218,21034,21203,21204,21007,21008,21205,21009,21010,21206,21011,21603];
 for(const awake of [false,true])for(const id of ids){
  f.view.clear();f.sim.restore(initial);f.events.length=0;f.sim.configureLoadout([{skillId:id},...Array(7).fill(null)],'lk');
  if(awake)f.sim.actor('lk').awakening.remaining=30;const rendered=new Set();let peak=0;
  for(let i=0;i<480;i++){
   if(i===5&&[21219,21206].includes(id)){
    const a=f.sim.actor('lk'),b=f.sim.actor('target');b.x=a.x+a.facing*100;b.y=a.y;
    f.sim.injectHit({attackerId:'target',targetId:'lk',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:2},REACT_TYPE:1,CAN_REVENGE:1}});
   }
   const proof=f.step(i===0?{pressed:['A']}:{});peak=Math.max(peak,proof.activeParticles);
   for(const [n,c]of Object.entries(proof.nativeParticleDraws.counts))if(c>0)rendered.add(n);}
  const births=f.events.filter(e=>e.type==='effectStarted');
  for(const e of births)if(index.templates[f.profile.damageEffects[e.name]?.raw.MAIN_EFFECT_NAME??e.name])assert.ok(e.birthAnchor?.position.every(Number.isFinite),id+'/'+awake+'/'+e.name);
  const failures=f.view.proof().unsupported.filter(n=>/:(birth|texture|geometry|animation-rate)/.test(n));assert.deepEqual(failures,[],id+'/'+awake);
  assert.ok(f.events.some(e=>e.type==='skillStarted'&&e.skillId===id));rows.push({skillId:id,awakened:awake,births:births.map(e=>e.name),rendered:[...rendered].sort(),peakParticles:peak,unsupported:f.view.proof().unsupported});
 }
 if(process.env.LK_LIVE_FX_REPORT)writeFileSync(process.env.LK_LIVE_FX_REPORT,JSON.stringify({schemaVersion:1,evidenceClass:'current-adapter actual-input and native-asset render audit',clientMeasured:false,rows},null,2)+'\n');
});
