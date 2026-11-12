import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,NullEngine,Scene} from '@babylonjs/core';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {copySampledAnimation,sampleAnimation,createActorView} from '../../apps/web/actor-presentation.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {createCastDisplay} from '../../apps/web/cast-display.mjs';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
import {updateControlledEffectLookup} from '../../apps/web/render-preparation.mjs';
import {maximumStrikePreparedPoint} from '../../packages/combat-assets/maximum-strike-display-v45.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import firePeaks from '../../contracts/bh-fire-audio-peaks-v45.json' with {type:'json'};
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {installCommonBuffs} from '../../packages/combat-core/buffs.mjs';
import {installElesisFeedbackSource} from '../../packages/combat-core/elesis-feedback-source-v45.mjs';
import {installAddMoonlightSource} from '../../packages/combat-core/add-moonlight-source-v45.mjs';

test('repeat draw copies exact sampled SRT to independent owners and rejects another original model',()=>{
 const library={},make=(name,x)=>{const target={name,position:new Vector3(x,2,3),scaling:new Vector3(4,5,6),rotationQuaternion:new Quaternion(0,.3,0,.4),rotation:new Vector3(.1,.2,.3)};
  return {sourceLibrary:library,bindPose:[{target}],nativeBindings:new Map([['normal',[]]]),clips:new Map([['normal',{stop(){}}]]),sample:{poseClipName:'normal',rootTranslation:[1,2,3],sourceTime:.5},group:null};};
 const a=make('source',11),b=make('copy',0);assert.equal(copySampledAnimation(a,b),true);
 for(const key of ['position','scaling','rotationQuaternion','rotation']){
  assert.deepEqual(a.bindPose[0].target[key].asArray(),b.bindPose[0].target[key].asArray());assert.notEqual(a.bindPose[0].target[key],b.bindPose[0].target[key]);
 }
 assert.deepEqual(b.sample,a.sample);assert.notEqual(b.sample.rootTranslation,a.sample.rootTranslation);
 a.bindPose[0].target.position.x=900;assert.equal(b.bindPose[0].target.position.x,11);
 b.sourceLibrary={};assert.equal(copySampledAnimation(a,b),false);
});

test('actual original animated Storm mesh repeated draw matches independent native interpolation at 90 clocks',async t=>{
 const base=resolve('artifacts/lp'),index=JSON.parse(readFileSync(resolve(base,'fx/index.json'))),template=index.templates.ADD_PSYCHIC_STORM_L01;
 const pose=JSON.parse(readFileSync(resolve(base,template.poseData))),engine=new NullEngine(),scene=new Scene(engine);
 const container=await loadPoseContainer(scene,resolve(base,template.glb));
 const views=['first','copied','reference'].map(id=>createActorView(container,scene,id,.01,pose));
 t.after(()=>{for(const view of views)view.dispose();container.dispose();scene.dispose();engine.dispose();});
 const clip=views[0].clips.keys().next().value;assert.ok(clip);let matrices=0;
 for(let frame=0;frame<90;frame++){
  const clock=frame/137;sampleAnimation(views[0],clip,clock,true);sampleAnimation(views[2],clip,clock,true);
  assert.equal(copySampledAnimation(views[0],views[1]),true);
  for(let i=0;i<views[1].bindPose.length;i++)for(const key of ['position','scaling','rotationQuaternion']){
   assert.deepEqual(views[1].bindPose[i].target[key]?.asArray(),views[2].bindPose[i].target[key]?.asArray());matrices++;
  }
 }
 t.diagnostic(JSON.stringify({source:template.glb,clocks:90,exactSrtChannels:matrices}));
});

test('overlapping fire cues retain every play and never exceed full-scale mix gain; ending a voice restores headroom',()=>{
 const media=[],player=createBattleAudio({createAudio:()=>{const a={volume:0,plays:0,play(){this.plays++;return Promise.resolve();},pause(){}};media.push(a);return a;}});
 player.configure({manifest:{files:{fire:{file:'fire.ogg'}}}});player.setVolume(100);
 for(let i=0;i<64;i++){assert.equal(player.play('fire'),true);assert.ok(player.proof().activeGain<=1+1e-12);}
 assert.equal(media.length,64);assert.ok(media.every(a=>a.plays===1&&a.volume===1/64));
 for(let i=0;i<63;i++)media[i].onended();assert.equal(media[63].volume,1);
 player.setVolume(50);assert.equal(media[63].volume,.25);assert.equal(media[63].plays,1);player.dispose();
});

test('actual decoded fire-clip overshoot participates in mix headroom instead of assuming every source peaks at one',()=>{
 const media=[],player=createBattleAudio({createAudio:()=>{const a={volume:0,play(){return Promise.resolve();},pause(){}};media.push(a);return a;}});
 const name='Elesis_AncientFire2.ogg',peak=firePeaks.files[name].peak;assert.ok(peak>1.28);
 player.configure({manifest:{files:{[name]:{file:'original.ogg'}}}});player.setVolume(100);
 for(let i=0;i<32;i++){player.play(name);assert.ok(player.proof().activePeakGain<=1+1e-12);}
 assert.ok(Math.abs(media.reduce((sum,a)=>sum+a.volume*peak,0)-1)<1e-12);player.dispose();
});

for(const id of ['LP','MM','DE'])test(id+' shock follows source ANSI/RSI alias once and never replays restored/rewound clocks',()=>{
 const profile=getProfessionProfile(id),emitted=[],display=createCastDisplay({profile,index:{templates:{'cast:GroundShockWave':{fields:{BillBoardType:'BT_NONE'}}}},runtime:{add:(name,options)=>{emitted.push({name,options});return {}; }},samplers:{}});
 const actor={id:'a',professionId:id,hp:100,x:0,y:0,z:0,state:'ANSI_HYPER_MODE',stateSerial:1,animationTime:0};
 display.step({actors:[actor]});actor.animationTime=.461;display.step({actors:[actor]});assert.equal(emitted.length,1);
 actor.state='RSI_HYPER_MODE';display.step({actors:[actor]});actor.animationTime=.1;display.step({actors:[actor]});actor.animationTime=.6;display.step({actors:[actor]});assert.equal(emitted.length,1);
 actor.stateSerial++;actor.animationTime=.8;display.step({actors:[actor]});assert.equal(emitted.length,1,'late snapshot is not a new historical shock');
 actor.stateSerial++;actor.animationTime=0;display.step({actors:[actor]});actor.animationTime=.47;display.step({actors:[actor]});assert.equal(emitted.length,2);
});

test('profession preparation awaits asynchronous retirement before creating any replacement burst pool',async()=>{
 const calls=[],views=Object.fromEntries(['RF','LK','DE'].map(id=>[id,{clear(){calls.push(id+':clear');},async releaseBurstPoolsAsync(){calls.push(id+':retire-start');await new Promise(done=>setTimeout(done,0));calls.push(id+':retired');},async prewarmActors(){calls.push(id+':prewarm');}}]));
 const effects=createProfessionEffects(views);await effects.prepareProfession('LK',[]);
 assert.deepEqual(calls,['RF:clear','LK:clear','DE:clear','RF:retire-start','RF:retired','LK:retire-start','LK:retired','DE:retire-start','DE:retired','LK:prewarm']);
});

test('Magnetron moving source is controlled without assigning every ordinary effect a renderer transform',()=>{
 const orbit={id:1,name:'DamageEffect_SA_APT_Magnetron_Dynamo_Start'},other={id:2,name:'ordinary'};
 const lookup=updateControlledEffectLookup(new Map(),[orbit,other]);assert.equal(lookup.get(1),orbit);assert.equal(lookup.has(2),false);
});

test('source six-orb callback reserves every simultaneous original model before combat',()=>{
 const profile=getProfessionProfile('DE'),base=resolve('artifacts/de');
 const read=p=>JSON.parse(readFileSync(resolve(base,p))),manifest=read('manifest.json');
 const index=mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(read));
 const budget=collectEffectMeshBudget(profile,index,[{skillId:29022}],{effectQuality:{level:'medium',particleDivisor:8}});
 assert.equal(budget.demands.get('ATT_Maxi_St_Ball_P01').effectSetInstances,6);
 assert.equal(budget.demands.get('ATT_Maxi_St_Ball_P05').effectSetInstances,6);
 assert.equal(budget.demands.get('ATT_Maxi_St_Ball_P01').views,12);
 assert.equal(budget.demands.get('ATT_Maxi_St_Ball_P05').views,72);
 const unequipped=collectEffectMeshBudget(profile,index,[],{effectQuality:{level:'medium',particleDivisor:8}});
 assert.equal(unequipped.demands.get('ATT_Maxi_St_Ball_P01').effectSetInstances,1);
 const mark=collectEffectMeshBudget(profile,index,[{skillId:29025}],{effectQuality:{level:'medium',particleDivisor:8}});
 for(const name of ['ADE_PE03_L','ADE_PE04_L','ADE_PE05_L','ADE_PE08_L']){
  assert.equal(mark.demands.get(name).burstUpperBound,undefined);
  assert.ok(mark.demands.get(name).effectSetInstances>=2,'source six-second mark ownership bounds the otherwise indefinite parent emitter');
 }
});

test('Stigma Trace preparation requires its own finite source ownership declaration and cannot bound another owner',()=>{
 const profile=getProfessionProfile('DE'),base=resolve('artifacts/de'),read=p=>JSON.parse(readFileSync(resolve(base,p))),manifest=read('manifest.json');
 const index=mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(read));
 const withoutDuration={...profile,skillCatalog:profile.skillCatalog.map(row=>row.skillId===29025?{...row,raw:{...row.raw,SA_EFFECTIVE_TIME:{}}}:row)};
 const wrongOwner={...profile,target:{...profile.target,unitClass:123}};
 for(const candidate of [withoutDuration,wrongOwner]){
  const budget=collectEffectMeshBudget(candidate,index,[{skillId:29025}],{effectQuality:{level:'medium',particleDivisor:8}});
  for(const name of ['ADE_PE03_L','ADE_PE04_L','ADE_PE05_L','ADE_PE08_L']){
   assert.equal(budget.demands.get(name).burstUpperBound,false,name);
   assert.equal(budget.demands.get(name).effectSetInstances,1,name);
   assert.ok(budget.unsupported.some(row=>row.name===name&&/parent-particle birth/.test(row.detail)),name);
  }
 }
});

test('all twelve recipient professions resolve the original Moonlight display/explosion visual closure without editing baseline indexes',()=>{
 for(const id of ['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']){
  const base=resolve('artifacts',id.toLowerCase()),read=p=>JSON.parse(readFileSync(resolve(base,p))),manifest=read('manifest.json');
  const before=mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(read)),names=Object.keys(before.templates);
  const after=addPlayerFeedbackVisuals(before,id);assert.deepEqual(Object.keys(before.templates),names);
  for(const name of ['ADE_Moonlight_Buff01',...[1,2,3].map(i=>'ADD_Moonlight_Rhapsody_Debuff_Explosion_DummyAttackBox_Accumulation_'+i)])assert.ok(after.templates[name],id+':'+name);
  for(const template of Object.values(after.templates))for(const file of [template.glb,template.poseData,...Object.values(template.textures??{}).map(t=>t.file)].filter(Boolean))
   assert.equal(existsSync(resolve(base,file)),true,id+':'+file);
 }
});

test('original11-second shield ownership bounds periodic hit preparation while both authored cast helpers retain distinct views',()=>{
 const profile=installElesisFeedbackSource(installCommonBuffs(structuredClone(getProfessionProfile('CA'))));
 const index=addPlayerFeedbackVisuals(JSON.parse(readFileSync(resolve('artifacts/ca/fx/index.json'))),'CA');
 assert.equal(index.templates.SI_A_SDK_INJECTION_STIGMA_AttackBox_Buff.fields.LifeTime,999);
 const budget=collectEffectMeshBudget(profile,index,[{skillId:28213}],{effectQuality:{level:'medium',particleDivisor:8}});
 assert.ok(budget.demands.get('SDK_HIT_P03').effectSetInstances<=24,'source11-second ownership and the short authored cast, including conservative boundary contacts');
 assert.ok(budget.demands.get('SDK_HIT_P03').views<=192);
 assert.equal(budget.demands.get('SI_A_SDK_INJECTION_STIGMA_AttackBox').views,2);
 assert.ok([...budget.demands.values()].reduce((sum,row)=>sum+row.views,0)<1000,'one skill must not reserve999 seconds of periodic hit models');
});

test('Moonlight private source closure preserves existing declarations, installs exact source scales and rejects conflicting originals for every recipient',()=>{
 for(const id of ['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']){
  const raw=getProfessionProfile(id),count=Object.keys(raw.damageEffects).length,profile=installAddMoonlightSource(structuredClone(raw));
  assert.equal(Object.keys(raw.damageEffects).length,count);
  for(let i=1;i<=3;i++){
   const name='EffectSet_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_'+i,member=profile.effectSets[name].raw.EFFECT0;
   assert.equal(member.SCALE_X??1,[1,1.5,2][i-1]);
   assert.equal(profile.damageEffects[member.NAME].raw.DAMAGE_DATA.DAMAGE.MAGIC,[4.65,9.3,13.95][i-1]);
  }
  const first=profile.effectTemplates.ADE_Moonlight_Buff01;assert.equal(installAddMoonlightSource(profile),profile);assert.equal(profile.effectTemplates.ADE_Moonlight_Buff01,first);
  if(id==='RF'){
   const base=resolve('artifacts/rf'),read=p=>JSON.parse(readFileSync(resolve(base,p))),manifest=read('manifest.json');
   const index=addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(read)),id);
   const root='ADD_Moonlight_Rhapsody_Debuff_Explosion_DummyAttackBox_Accumulation_3';
   assert.equal(collectEffectMeshBudget(profile,index,[]).templates.has(root),false);
   assert.equal(collectEffectMeshBudget(profile,index,[],{moonlightReactions:true}).templates.has(root),true);
  }
  profile.effectSets.EffectSet_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_1.raw.EFFECT0.SCALE_X=99;
  assert.throws(()=>installAddMoonlightSource(profile),/Conflicting original Moonlight/);
 }
});

test('six prepared orbs use original radial distance in one body-centred 45-degree plane',()=>{
 const center=[10,120,30],anchor=[10,150,30],source=[10,-50,30],points=[];
 for(let index=0;index<6;index++){
  const p=maximumStrikePreparedPoint({name:'DamageEffect_ATT_Maximum_Strike_Bullet_Projectile',sourceAddMaximumStrike:{index}},source,anchor,center,[45,0,90]);points.push(p);
  assert.ok(Math.abs(Math.hypot(...p.map((n,i)=>n-center[i]))-200)<1e-9);assert.ok(Math.abs((p[1]-center[1])+(p[2]-center[2]))<1e-9);
 }
 assert.equal(new Set(points.map(p=>p.map(n=>n.toFixed(3)).join(','))).size,6);
 const centroid=points.reduce((sum,p)=>sum.map((n,i)=>n+p[i]/6),[0,0,0]);for(let i=0;i<3;i++)assert.ok(Math.abs(centroid[i]-center[i])<1e-9);
});

test('actual DE prepared source helper now surrounds original Bip01 and fired shot starts at the visible orb',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29022});a.mp=a.mpMax;b.x=1200;
 for(let i=0;i<105;i++)sim.step(1/60,i===0?{add:{pressed:['A'],held:['A']}}:{});
 const orbs=sim.state.effects.filter(e=>e.sourceAddMaximumStrike),points=orbs.map(e=>sim.effectBoneSampler(e,a,'Dummy02'));
 assert.equal(points.length,6);assert.ok(points.every(p=>p.every(Number.isFinite)));
 const centroid=points.reduce((sum,p)=>sum.map((n,i)=>n+p[i]/6),[0,0,0]);
 const center=sim.effectAnchorSampler({definition:{BONE_NAME:'Bip01'}},a).position;
 for(let i=0;i<3;i++)assert.ok(Math.abs(centroid[i]-center[i])<1e-6);
 const expected=points[0];sim.step(1/60,{add:{pressed:['A'],held:['A']}});
 const shot=sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Maximum_Strike_Bullet_Attack');assert.ok(shot);
 // The source phase advances one fixed tick between observation and firing.
 assert.ok(Math.hypot(...shot.birthAnchor.position.map((n,i)=>n-expected[i]))<30);
});
