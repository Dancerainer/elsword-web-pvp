/** Actual shipped native modules/helpers; simulation flow, not target gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {resolveHitSound,damageEffectSoundEntries} from '../../packages/combat-core/hit-audio.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
const path=f=>new URL('../../'+f,import.meta.url),read=f=>JSON.parse(readFileSync(path(f)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const source=read('contracts/rf-hit-audio-source-v17.json'),coverage=read('reports/rf-hit-audio-coverage-v17.json');
const audio=read('artifacts/audio/manifest.json'),shieldAudio=read('artifacts/rf/core-shield-audio/manifest.json');
const available=new Set([...Object.keys(audio.files),...Object.keys(shieldAudio.files),'Critical_Hit.wav']);
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx'].map(f=>read('artifacts/rf/'+f+'/index.json')));
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const poses=Object.fromEntries(collectEffectPoseFiles(index,visual).map(f=>[f,read('artifacts/rf/'+f)]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:f=>readFileSync(path('artifacts/native/'+f))});
function make({gap=80,skillId=24203,allowBanned=false,factory=createSimulation}={}){
  return factory({profile,map,preset:{...preset,loadout:[{skillId},null,null,null,null,null,null,null],...(allowBanned?{bannedSkillIds:[]}: {})},seed:2016,
    actors:[{id:'rf',team:0,position:[2023,2840,0],lineId:6,facing:-1,passives:[]},
      {id:'target',team:1,position:[2023-gap,2840,0],lineId:6,facing:1,passives:[]}],
    ...createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions});
}
const step=(s,input={})=>s.step(1/60,input,{snapshot:false}),frames=(s,n,input={})=>{for(let i=0;i<n;i++)step(s,input);};
const hitSounds=s=>s.state.events.filter(e=>e.type==='sound'&&e.field==='original-damage-hit');
const observations=[];
function observe(name,s,setup){
  const origin=e=>e?{kind:e.kind,id:e.id,skillId:e.skillId}:null;
  observations.push({name,setup,
    hits:s.state.events.filter(e=>e.type==='hit').map(e=>({time:e.time,actorId:e.actorId,targetId:e.targetId,
      hitType:e.data.HIT_TYPE,reactType:e.data.REACT_TYPE,amount:e.amount,guarded:e.guarded,origin:origin(e.origin)})),
    sounds:s.state.events.filter(e=>e.type==='sound').map(e=>({time:e.time,actorId:e.actorId,name:e.name,field:e.field,
      attackerId:e.attackerId,hitType:e.hitType,effectId:e.effectId,effectName:e.effectName,clock:e.clock,eventTime:e.eventTime,origin:origin(e.origin)})),
    states:s.state.events.filter(e=>e.type==='stateChanged').map(e=>({time:e.time,actorId:e.actorId,state:e.state}))});
}
test.after(()=>{
  if(process.env.RF_HIT_AUDIO_REPORT==='1')writeFileSync(path('reports/rf-hit-audio-observations-v17.json'),JSON.stringify({
    schemaVersion:1,classification:'current host simulation with shipped native modules and original poses; not target client gold',
    targetClientMeasured:false,seed:2016,dt:1/60,cases:observations},null,2)+'\n');
});
function verifyTrace(s){
  const hits=s.state.events.filter(e=>e.type==='hit'),sounds=hitSounds(s);
  // Independent frozen target table, with fixed-V5 literal lookup order.
  const expected=hits.flatMap(h=>{if(h.data.REACT_TYPE===0||h.data.REACT_TYPE===10||h.data.HIT_TYPE===-1)return [];
    const table=source.bindings.damageSoundTables[h.data.HIT_TYPE??0];const name=table?.['1']||table?.['0']||source.bindings.damageSoundTables['0']?.['0'];
    return name?[{name,time:h.time,actorId:h.targetId,attackerId:h.actorId}]:[];});
  assert.deepEqual(sounds.map(e=>({name:e.name,time:e.time,actorId:e.actorId,attackerId:e.attackerId})),expected);
  for(const event of s.state.events.filter(e=>e.type==='sound'))assert.ok(available.has(event.name),'missing actual resource '+event.name);
  return hits;
}

test('target hit table uses exact sword/punch/fire names and no-sound/sensor guards, independently of damage amount',()=>{
  const resolve=(data,options={})=>resolveHitSound(data,{hittedType:1,...options});
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:1}),'HitSlash.wav');
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:2}),'HitSlash2.wav');
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:9}),'Hit.wav');
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:19}),'HitFire.wav');
  assert.equal(resolve({REACT_TYPE:7,HIT_TYPE:1,NO_DAMAGE:1}),'HitSlash.wav','dummy is not sensor/no-damage result');
  for(const data of [{REACT_TYPE:0,HIT_TYPE:1},{REACT_TYPE:10,HIT_TYPE:1},{REACT_TYPE:1,HIT_TYPE:-1},
    {REACT_TYPE:1,HIT_TYPE:{$symbol:'unknown'}},{HIT_TYPE:1}])assert.equal(resolve(data),null);
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:1},{hittedType:-1}),null);
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:1},{atStateHittedType:8}),'HitGuard_Metal1.wav');
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:4}),'swordcrash.ogg','empty material cell uses this hit type default');
  assert.equal(resolve({REACT_TYPE:1,HIT_TYPE:26}),null,'target default/default is absent, not invented');
});

test('SOUND uses source mesh animation/global endpoints, numeric record order and one-shot processed keys',()=>{
  const raw={SOUND1:{EVENT_TIME:.01,FILE_NAME:'global.ogg',USE_GLOBAL_TIME:1},SOUND0:{EVENT_TIME:.01,FILE_NAME:'skin.ogg'}};
  const t=Math.fround(.01),clock={afterGlobal:t,beforeAnimation:0,afterAnimation:t};
  assert.deepEqual(damageEffectSoundEntries(raw,[],clock).map(e=>e.name),['skin.ogg']);
  assert.deepEqual(damageEffectSoundEntries(raw,[],{...clock,afterGlobal:t+.001}).map(e=>e.name),['skin.ogg','global.ogg']);
  assert.deepEqual(damageEffectSoundEntries(raw,['SOUND0','SOUND1'],{afterGlobal:10,beforeAnimation:0,afterAnimation:10}),[]);
  assert.deepEqual(damageEffectSoundEntries(raw,[],{afterGlobal:t,beforeAnimation:t,afterAnimation:t+.001}),[]);
});

test('actual repeated Z input has one exact ordinary sound per accepted slash; far-target miss has none',()=>{
  const s=make({gap:5}),miss=make({gap:8000});
  // Frozen Z callback buffers once inside its <=.3 animation window. Hit-stop
  // changes wall-clock input frames, so press at .1 in each actual Z state.
  for(const simulation of [s,miss]){
    const a=simulation.actor('rf'),buffered=new Set(),inputs=[];
    for(let i=0;i<240;i++){
      const press=i===0||/^RSI_COMBO_Z{1,3}$/.test(a.state)&&a.animationTime>=.1&&!buffered.has(a.state);
      if(press){buffered.add(a.state);inputs.push({step:i+1,pressed:['Z'],state:a.state,animationTime:a.animationTime});}
      step(simulation,press?{pressed:['Z']}:{});
    }
    assert.deepEqual(simulation.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='rf'&&/^RSI_COMBO_Z+$/.test(e.state)).map(e=>e.state),
      ['RSI_COMBO_Z','RSI_COMBO_ZZ','RSI_COMBO_ZZZ','RSI_COMBO_ZZZZ']);
    observe(simulation===s?'real-Z-hit':'real-Z-miss',simulation,{gap:simulation===s?5:8000,inputs,frames:240});
  }
  const hits=verifyTrace(s);assert.equal(hits.length,4,'each actual Z-chain slash intersects an original defender helper');
  assert.deepEqual(hitSounds(s).map(e=>e.name),Array(4).fill('HitSlash.wav'));
  assert.equal(verifyTrace(miss).length,0);assert.equal(hitSounds(miss).length,0);
});

test('actual guard, dummy, sensor, rejected invincibility/team paths do not synthesize or duplicate normal audio',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');s.drainEvents();
  const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.5},HIT_TYPE:1,REACT_TYPE:7,NO_DAMAGE:1};
  const hp=b.hp;s.applyHit(a,b,data);assert.equal(b.hp,hp);assert.equal(hitSounds(s).length,1);
  observe('dummy-hit',s,{data});
  s.drainEvents();s.applyHit(a,b,{...data,REACT_TYPE:10});assert.equal(hitSounds(s).length,0);
  observe('sensor',s,{data:{...data,REACT_TYPE:10}});
  s.drainEvents();b.invincible=true;assert.equal(s.applyHit(a,b,{...data,REACT_TYPE:1}).accepted,false);assert.equal(hitSounds(s).length,0);
  observe('invincible-reject',s,{data:{...data,REACT_TYPE:1},invincible:true});
  b.invincible=false;b.team=a.team;s.applyHit(a,b,{...data,REACT_TYPE:1});assert.equal(hitSounds(s).length,0);
  observe('same-team-reject',s,{data:{...data,REACT_TYPE:1},sameTeam:true});
  b.team=1;s.canGuard=()=>true;s.drainEvents();s.applyHit(a,b,{...data,NO_DAMAGE:0,REACT_TYPE:1});
  assert.equal(hitSounds(s).length,1);assert.equal(hitSounds(s)[0].name,'HitSlash.wav');
  assert.equal(s.state.events.filter(e=>e.type==='sound'&&e.name==='Raven_NasodCore_Guard.ogg').length,1);
  observe('core-guard',s,{data:{...data,NO_DAMAGE:0,REACT_TYPE:1},guardForced:true});
});

for(const name of ['DamageEffect_RSI_OVER_TAKER_BIG_SPINE','DamageEffect_RSI_OVER_TAKER_UP_SPINE'])
test(name+' actual effect sound occurs once on mesh clock even when no target is hit',()=>{
  const s=make({gap:8000}),a=s.actor('rf');s.drainEvents();
  const e=s.createEffect(a,{NAME:name},{birthAnchor:{position:[a.x,a.y,a.z],facing:a.facing}});
  frames(s,120);const events=s.state.events;
  assert.equal(events.filter(v=>v.type==='hit'&&v.origin?.id===e.id).length,0);
  const sounds=events.filter(v=>v.type==='sound'&&v.effectId===e.id);
  assert.equal(sounds.length,1);assert.equal(sounds[0].name,'Raven_OT_ComboX3Front.ogg');
  assert.equal(sounds[0].field,'SOUND0');assert.equal(sounds[0].clock,'mesh-animation');assert.equal(sounds[0].eventTime,.01);
  assert.ok(sounds[0].time>0&&sounds[0].time<=1/60+1e-8);
  observe('spine-miss:'+name,s,{gap:8000,effect:name,frames:120});
});

test('real 668ZXX and XX2X four-child routes each emit one piercing source sound per child, separately from hit sounds',()=>{
  for(const command of ['668ZXX','XX2X']){
    const s=make({gap:80}),a=s.actor('rf');s.drainEvents();
    if(command==='668ZXX'){
      step(s,{pressed:['LEFT'],held:['LEFT']});step(s,{released:['LEFT']});step(s,{pressed:['LEFT'],held:['LEFT']});
      step(s,{pressed:['UP'],held:['LEFT','UP']});step(s,{pressed:['Z'],held:['LEFT','Z']});
      for(let i=0;i<300&&a.state==='RSI_DASH_JUMP_COMBO_Z';i++)step(s,{pressed:i===3?['X']:[],held:['LEFT']});
      for(let i=0;i<300&&a.state!=='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING';i++)step(s,{held:['LEFT']});
      assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING');step(s,{pressed:['X']});
    }else{
      step(s,{pressed:['X']});frames(s,10);step(s,{pressed:['X']});
      for(let i=0;i<180&&a.state!=='RSI_COMBO_XX';i++)step(s);
      frames(s,10);step(s,{pressed:['X'],held:['DOWN']});
      for(let i=0;i<180&&a.state!=='RSI_OVER_TAKER_COMBO_XXdownX';i++)step(s,{held:['DOWN']});
      assert.equal(a.state,'RSI_OVER_TAKER_COMBO_XXdownX');
    }
    frames(s,300);const children=s.state.events.filter(e=>e.type==='damageChildCreated'&&e.name.includes('SPINE'));
    assert.equal(children.length,4);const ids=new Set(children.map(e=>e.effectId));
    const piercing=s.state.events.filter(e=>e.type==='sound'&&e.name==='Raven_OT_ComboX3Front.ogg'&&ids.has(e.effectId));
    assert.equal(piercing.length,4);assert.equal(new Set(piercing.map(e=>e.effectId)).size,4);verifyTrace(s);
    observe('real-command:'+command,s,{gap:80,inputRoute:command,framesAfterFinalX:300});
  }
});

for(const [name,records] of Object.entries(source.bindings.effectSounds))
test('target SOUND owner '+name+' fires every declared record exactly once using its actual mesh',()=>{
  const s=make({gap:8000}),a=s.actor('rf');s.drainEvents();
  const e=s.createEffect(a,{NAME:name},{birthAnchor:{position:[a.x,a.y+250,a.z],facing:a.facing}});
  frames(s,120);
  const sounds=s.state.events.filter(v=>v.type==='sound'&&v.effectId===e.id&&/^SOUND\d+$/.test(v.field));
  assert.deepEqual(sounds.map(v=>({field:v.field,name:v.name,eventTime:v.eventTime})),
    Object.entries(records).sort(([a],[b])=>Number(a.slice(5))-Number(b.slice(5)))
      .map(([field,v])=>({field,name:v.FILE_NAME,eventTime:v.EVENT_TIME??0})));
  assert.equal(s.state.events.filter(v=>v.type==='hit'&&v.origin?.id===e.id).length,0);
  verifyTrace(s);
  observe('sound-owner:'+name,s,{gap:8000,effect:name,birthHeightOffset:250,frames:120});
});

for(const row of coverage.rows)test('audited '+row.kind+' '+row.id+' executes actual resources with complete sound paths',()=>{
  const s=make({skillId:row.kind==='active'?row.id:24203,allowBanned:row.id===900}),a=s.actor('rf');s.drainEvents();
  if(row.kind==='combo'){
    if(/JUMP/.test(row.id)&&!/LAND/i.test(row.id)){a.grounded=false;a.lineId=null;a.y+=250;}
    s.enter(a,row.id,'audio-source-coverage');
  }else step(s,{pressed:['A'],held:['A']});
  frames(s,360);verifyTrace(s);
  if(row.kind==='active')assert.equal(s.state.events.filter(e=>e.type==='skillStarted'&&e.skillId===row.id).length,1);
  observe(row.kind+':'+row.id,s,{gap:80,frames:360,...(row.kind==='combo'?{enterState:row.id}:{pressed:['A'],skillId:row.id,diagnosticBanOverride:row.id===900})});
});

// Historical finite evidence: freeze both core entry points AND their relative
// source dependencies. Current production changes are exercised above, not
// silently filtered out of a comparison with an older combat implementation.
async function historicalFactory(ref,label){
  const cache=path('.cache/audio-v17/history/'+label+'/'),pending=['packages/combat-core/index.mjs'],seen=new Set();
  while(pending.length){
    const relative=pending.pop();if(seen.has(relative))continue;seen.add(relative);
    const source=execFileSync('git',['show',ref+':'+relative],{cwd:path(''),encoding:'utf8'});
    const destination=new URL(relative,cache);mkdirSync(new URL('.',destination),{recursive:true});writeFileSync(destination,source);
    if(relative.endsWith('.mjs'))for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
      const dependency=new URL(match[1],new URL(relative,'file:///')).pathname.slice(1);
      pending.push(dependency);
    }
  }
  return (await import(new URL('packages/combat-core/index.mjs',cache))).createSimulation;
}

test('historical audio-only integration preserves combat snapshots and RNG between the two frozen commits',{skip:(!process.env.RF_HIT_AUDIO_BASELINE||!process.env.RF_HIT_AUDIO_IMPLEMENTATION)&&'Supply both archive refs for an audio comparison'},async()=>{
  const baselineRef=process.env.RF_HIT_AUDIO_BASELINE;
  const implementationRef=process.env.RF_HIT_AUDIO_IMPLEMENTATION;
  const oldFactory=await historicalFactory(baselineRef,'baseline');
  const audioFactory=await historicalFactory(implementationRef,'implementation');
  const withoutPresentation=snapshot=>{
    const s=structuredClone(snapshot),added=s.events.filter(e=>e.type==='sound'&&(e.field==='original-damage-hit'||/^SOUND\d+$/.test(e.field)));
    // Added audio requests own ordinary event IDs; all other event content and
    // sequence remains equivalent after removing only these requests/IDs.
    s.nextEventId-=added.length;
    const originalId=id=>id-added.filter(a=>a.eventId<id).length;
    s.events=s.events.filter(e=>!added.some(a=>a.eventId===e.eventId)).map(e=>({...e,eventId:originalId(e.eventId)}));
    s.unsupported=s.unsupported.map(e=>({...e,eventId:originalId(e.eventId)}));
    for(const e of s.effects)e.soundFired=e.soundFired.filter(key=>!/^SOUND\d+$/.test(key));
    return s;
  };
  for(const skill of [null,24025]){
    const a=make({skillId:skill??24203,factory:audioFactory}),b=make({skillId:skill??24203,factory:oldFactory});
    for(let i=0;i<180;i++){const input=skill?(i===0?{pressed:['A']}:{}):([0,14,28,42].includes(i)?{pressed:['Z']}:{});
      step(a,input);step(b,input);assert.deepEqual(withoutPresentation(a.snapshot()),withoutPresentation(b.snapshot()));}
  }
});
