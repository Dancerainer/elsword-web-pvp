/** Four-player source-geometry audit; not a GPU or original-client benchmark.
 * Preparation seeds the supported practice sword gauge. Rage itself must be
 * triggered by ordinary input, authored attack windows and actual native helpers.
 * A separate pressure section explicitly seeds effect instances to measure the
 * observer's whole-state copy cost; those seeded counts are not real match proof.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createSimulation} from '../packages/combat-core/index.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../packages/professions/profiles.mjs';
import {createNativeRuntime} from '../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../packages/combat-assets/effect-indexes.mjs';
import {createProfessionSamplers} from '../packages/combat-assets/profession-samplers.mjs';
import {composeCharacterPose} from '../packages/combat-assets/shared-character.mjs';
import {addCommonBuffVisuals} from '../packages/combat-assets/common-buffs.mjs';
import {encodeOwnedState,applyOwnedState} from '../packages/online/owned-state.mjs';

const root=resolve(import.meta.dirname,'..');
const json=file=>JSON.parse(readFileSync(file));
const empty=()=>Array(8).fill(null),median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const add=(table,key,value=1)=>table[key]=(table[key]??0)+value;

export async function loadFourActorSwordAssets({assetRoot=process.env.ELSWORD_ASSETS_ROOT??resolve(root,'artifacts')}={}){
  const read=relative=>json(resolve(assetRoot,relative));
  const map={...read('scene/sander-garpai-rock-pvp/manifest.json'),...read('scene/sander-garpai-rock-pvp/collision.json')};
  const native=await createNativeRuntime({manifest:read('native/manifest.json'),map,loadBinary:file=>readFileSync(resolve(assetRoot,'native',file))});
  const commonManifest=read('common-buffs/manifest.json'),commonBuffs=read('common-buffs/'+commonManifest.definitionCatalog);
  const commonVisual=mergeVisualEffectIndexes(...commonManifest.visualEffectIndexes.map(file=>read('common-buffs/'+file)));
  const samplers={},indexes={};
  for(const id of ['LK','RS','IS','BH','CA']){
    const folder=id.toLowerCase(),manifest=read(folder+'/manifest.json'),profile=PROFESSION_PROFILES[id];
    const visual=addCommonBuffVisuals(mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(file=>read(folder+'/'+file))),commonVisual);
    const index=mergeEffectIndexes(read(folder+'/'+manifest.effectAssetIndex),visual);
    const raw=read(folder+'/'+manifest.runtimePose),pose=composeCharacterPose(raw,raw.sharedPose?read(folder+'/'+raw.sharedPose):null);
    const effectPoses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
      .map(file=>[file,read(folder+'/'+file)]));
    samplers[id]=createNativeSamplers({profile,characterPose:pose,effectIndex:index,effectPoses,map});indexes[id]=visual;
  }
  return {map,native,commonBuffs,samplers:createProfessionSamplers(samplers,'LK'),indexes};
}

export function createFourActorSwordFixture(assets,{roster=['LK','LK','LK','LK'],ownerId=null,observeRemoteDamage=true,prepare=true}={}){
  const presetFor=id=>({...PROFESSION_PRESETS[id],loadout:empty(),passives:[],guildPassives:[],onlineMatch:ownerId!==null,
    attributes:{...PROFESSION_PRESETS[id].attributes,animationSpeedMultiplier:1}});
  const sim=createSimulation({profile:PROFESSION_PROFILES[roster[0]],profiles:PROFESSION_PROFILES,
    commonBuffs:assets.commonBuffs,
    preset:presetFor(roster[0]),presets:Object.fromEntries(roster.map(id=>[id,presetFor(id)])),
    actors:roster.map((professionId,i)=>({id:'p'+i,professionId,team:i<2?0:1,position:[[0,3080,0],[-25,3080,0],[85,3080,0],[110,3080,0]][i],
      lineId:2,facing:i<2?1:-1,loadout:empty(),passives:[],guildPassives:[]})),
    map:assets.map,seed:2016,networkOwnerId:ownerId,observeRemoteDamage,...assets.samplers,
    nativeGeometry:assets.native.geometry,nativeSkillValues:assets.native.skillValues,nativeCritical:assets.native.critical,nativeManaBreak:assets.native.manaBreak});
  sim.rng=()=>.99;
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','four-actor-audit');if(prepare)sim.prepareWayOfSword(actor.id,-2);}
  const rageEntered=new Map(),rageEntries=[],enter=sim.enter,emit=sim.emit;
  sim.enter=function(actor,state,reason,...options){const result=enter.call(this,actor,state,reason,...options);
    if(reason==='way-of-sword-destruction-rage')rageEntered.set(actor.id,{state:actor.state,stateSerial:actor.stateSerial});return result;};
  sim.emit=function(type,actorId,data){const event=emit.call(this,type,actorId,data);
    if(type==='destructionRageStarted'){const live=this.actor(actorId);rageEntries.push({eventId:event.eventId,time:this.state.time,actorId,
      observationOnly:this.observationOnly===true,entered:rageEntered.get(actorId),live:{state:live.state,stateSerial:live.stateSerial,networkFrameEpoch:live.networkFrameEpoch??null,networkFrameSeq:live.networkFrameSeq??null}});}return event;};
  sim.auditRageEntries=rageEntries;
  return sim;
}

function instrumentSimulation(sim){
  const counts={},times={};
  for(const name of ['step','tickActor','tickEffects','checkCharacterAttack','checkHits','applyHit','applyParticipantHit','createEffect','intersects','hitPoint']){
    const original=sim[name];if(typeof original!=='function')continue;
    sim[name]=function(...args){const before=performance.now();add(counts,name);try{return original.apply(this,args);}finally{add(times,name,performance.now()-before);}};
  }
  for(const name of ['collisionSampler','defenderSampler','effectSampler','effectAnchorSampler','effectBoneSampler','motionOffsetSampler']){
    const original=sim[name];if(typeof original!=='function')continue;
    sim[name]=function(...args){const before=performance.now();add(counts,name);try{return original(...args);}finally{add(times,name,performance.now()-before);}};
  }
  return {counts,times};
}

export function traceFourActorSwordFixture(assets,options={}){
  const sim=createFourActorSwordFixture(assets,options),phases=instrumentSimulation(sim),events=[],frames=[];
  // Warm existing source aura packets before the ordinary attack input.
  for(let i=0;i<30;i++){sim.step(1/60,{}, {snapshot:false});sim.drainEvents();}
  const startupEffects=sim.state.effects.length;Object.keys(phases.counts).forEach(key=>phases.counts[key]=0);Object.keys(phases.times).forEach(key=>phases.times[key]=0);
  for(let frame=0;frame<240;frame++){
    const start=performance.now(),attacker=options.attackerId??'p0';
    sim.step(1/60,frame===0?{[attacker]:{pressed:['Z'],held:['Z']}}:{},{snapshot:false});
    const batch=sim.drainEvents();events.push(...batch);frames.push({frame,ms:performance.now()-start,effects:sim.state.effects.length,
      events:batch.length,rage:batch.filter(e=>e.type==='destructionRageStarted').map(e=>e.actorId),
      windHits:batch.filter(e=>e.type==='hit'&&e.origin?.kind==='effect'&&e.data?.CAN_REVENGE===0).map(e=>({attacker:e.actorId,target:e.targetId,effectId:e.origin.id}))});
  }
  const eventCounts={};for(const event of events)add(eventCounts,event.type);
  const rageEvents=events.filter(e=>e.type==='destructionRageStarted');
  return {sim,events,report:{roster:sim.state.actors.map(a=>a.professionId),ownerId:sim.networkOwnerId,
    setup:'practice gauge -2, original Garpai line2, authored command Z input and native posed attack/defender helpers; no forced rage or injected hit',
    startupEffects,eventCounts,rageEvents:rageEvents.map(e=>({actorId:e.actorId,time:e.time,eventId:e.eventId})),rageEntries:sim.auditRageEntries.filter(entry=>!entry.observationOnly),
    frames:frames.filter(f=>f.rage.length||f.events>10||f.frame<30||f.frame===239),
    peaks:{events:Math.max(...frames.map(f=>f.events)),effects:Math.max(...frames.map(f=>f.effects)),stepMs:Math.max(...frames.map(f=>f.ms))},
    phases,finalActors:sim.state.actors.map(a=>({id:a.id,state:a.state,wos:a.wayOfSword,rage:a.destructionRageRemaining,grounded:a.grounded})),
    finalEffects:sim.state.effects.map(e=>({name:e.name,ownerId:e.ownerId,active:e.active,life:e.lifeTimeSeconds}))}};
}

/** Synchronous source-clock contact capture using exact native geometry.
 * The declared Z clock and pose are seeded once, then repeated collision checks
 * demonstrate participant-ownership isolation; this is separate from input replay.
 */
export function seededOwnerRageProbe(assets,{ownerId='p0',repeats=4}={}){
  const sim=createFourActorSwordFixture(assets,{ownerId}),attacker=sim.actor('p0');
  for(const actor of sim.state.actors)actor.superArmor=false;
  sim.enter(attacker,'RSI_COMBO_Z','source-clock-probe');attacker.animationTime=.2;attacker.hitStop=0;
  const state=sim.profileFor(attacker).states[attacker.state],shapes=sim.collisionSampler(attacker,{raw:state.raw,animationTime:.2});
  const target=sim.actor('p2'),defenders=sim.defenderSampler(target),contacts=shapes.flatMap(shape=>defenders.map(defender=>sim.hitPoint(shape,defender)).filter(Boolean));
  if(!contacts.length)throw new Error('Source Z pose does not contact native target helper');
  sim.drainEvents();const rows=[];
  for(let i=0;i<repeats;i++){
    const result=sim.applyHit(attacker,target,state.raw.DAMAGE_DATA,{kind:'character',id:'state-'+attacker.stateSerial,state:attacker.state,animationTime:.2,impactPoint:contacts[0],powerMultiplier:1});
    const events=sim.drainEvents();rows.push({result,rageEvents:events.filter(e=>e.type==='destructionRageStarted').length,
      effects:sim.state.effects.filter(e=>e.name==='ELSWORD_ANGRY_WIND').length,authoritativeTargetRage:sim.actor('p2').destructionRageRemaining});
  }
  return {sim,report:{setup:'pressure probe: same original Z posed native contact supplied repeatedly; deliberately bypasses command hit receipts, not an ordinary match trace',ownerId,contacts,rows}};
}

export function snapshotReplayProbe(source,receiver,playerId='p2'){
  source.tickEffects(0);source.drainEvents();
  const report=encodeOwnedState(source,playerId,{epoch:1,frameSeq:1}),counts=[];
  receiver.drainEvents();
  for(let i=0;i<3;i++){
    applyOwnedState(receiver,playerId,{...report,frameSeq:i+1});const events=receiver.drainEvents();
    counts.push({rageStarted:events.filter(e=>e.type==='destructionRageStarted').length,effectStarted:events.filter(e=>e.type==='effectStarted').length,
      windStarted:events.filter(e=>e.type==='effectStarted'&&e.name==='ELSWORD_ANGRY_WIND').length,
      effects:receiver.state.effects.filter(e=>e.ownerId===playerId).length,group:receiver.actor(playerId).sourceWayOfSwordEffectGroup?.length??0});
  }
  return counts;
}

export function measureObserverCopyPressure(assets,{counts=[0,16,64,128],warmup=100,repetitions=5,contacts=100,priorEvents=0,observer}={}){
  const rows=[],nativeClone=globalThis.structuredClone;
  for(const seededEffects of counts){
    const sim=createFourActorSwordFixture(assets,{ownerId:'p0',prepare:false}),a=sim.actor('p1'),b=sim.actor('p2');
    for(let i=0;i<seededEffects;i++)sim.createEffect(a,{NAME:'ELSWORD_ANGRY_WIND'},{birthAnchor:{position:[a.x,a.y+80,a.z],facing:a.facing}});
    const data=PROFESSION_PROFILES.LK.states.RSI_COMBO_Z.raw.DAMAGE_DATA,origin={kind:'character',id:'observer-pressure',state:'RSI_COMBO_Z',powerMultiplier:1,impactPoint:[b.x,b.y+80,b.z]};
    if(observer)sim.applyHit=function(attacker,defender,damage,origin){return observer(this,attacker,defender,damage,origin);};
    sim.drainEvents();const serializedStateBytes=Buffer.byteLength(JSON.stringify(sim.state));
    const seedEvents=()=>{for(let i=0;i<priorEvents;i++)sim.emit('hit','p1',{targetId:'p2',data,origin,amount:1});};
    seedEvents();const stateWithPriorEventsBytes=Buffer.byteLength(JSON.stringify(sim.state)),discardedEventBytes=Buffer.byteLength(JSON.stringify(sim.state.events));sim.drainEvents();
    for(let i=0;i<warmup;i++){seedEvents();sim.applyHit(a,b,data,origin);sim.drainEvents();}
    const totalSamples=[],copySamples=[];let stateClones=0,allClones=0;
    try{
      for(let trial=0;trial<repetitions;trial++){
        let copyMs=0;
        globalThis.structuredClone=function(value,...rest){const start=performance.now();try{return nativeClone(value,...rest);}finally{allClones++;if(value?.effects===sim.state.effects&&Array.isArray(value?.actors)){stateClones++;copyMs+=performance.now()-start;}}};
        const start=performance.now();for(let i=0;i<contacts;i++){seedEvents();sim.applyHit(a,b,data,origin);sim.drainEvents();}
        totalSamples.push((performance.now()-start)/contacts);copySamples.push(copyMs/contacts);
      }
    }finally{globalThis.structuredClone=nativeClone;}
    rows.push({seededEffects,priorEvents,actualEffectObjects:sim.state.effects.length,serializedStateBytes,stateWithPriorEventsBytes,discardedEventBytes,warmup,repetitions,contacts,
      medianContactMs:median(totalSamples),medianWholeStateCopyMs:median(copySamples),stateClones,allClones,totalSamples,copySamples});
  }
  return {scope:'explicit seeded-state CPU pressure, exact source effect definitions but multiplicity is synthetic; no GPU/FPS claim',rows};
}

export async function runObserverCopyBeforeAfter(assets){
  const {observeRemoteDamage:baseline}=await import('../tests/fixtures/observed-damage-baseline-v30.mjs'),rows=[];
  for(const [seededEffects,priorEvents]of [[0,0],[64,0],[128,0],[64,100],[64,400]]){
    const options={counts:[seededEffects],priorEvents,warmup:100,repetitions:5,contacts:100};
    const before=measureObserverCopyPressure(assets,{...options,observer:baseline}).rows[0],after=measureObserverCopyPressure(assets,options).rows[0];
    rows.push({seededEffects,priorEvents,before,after,contactReductionPercent:(before.medianContactMs-after.medianContactMs)/before.medianContactMs*100});
    console.log(JSON.stringify({seededEffects,priorEvents,beforeMs:before.medianContactMs,afterMs:after.medianContactMs,
      reductionPercent:rows.at(-1).contactReductionPercent,stateBytes:before.stateWithPriorEventsBytes,eventBytes:before.discardedEventBytes,
      beforeClones:before.allClones,afterClones:after.allClones}));
  }
  const report={scope:'CPU-only explicit seeded-state pressure, native definitions; multiplicity synthetic; five trials after 100 contacts warmup; real actor state unchanged',rows};
  const file=resolve(root,'runtime/sword-rage-v30/observer-copy-before-after.json');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(report,null,2)+'\n');return report;
}

export async function runFourActorSwordAudit(){
  const assets=await loadFourActorSwordAssets(),traces=[];
  for(const roster of [['LK','LK','LK','LK'],['LK','LK','RS','IS'],['LK','LK','BH','CA']]){
    traces.push(traceFourActorSwordFixture(assets,{roster,attackerId:roster[2]==='BH'?'p2':'p0'}).report);
    for(const ownerId of ['p0','p2'])traces.push(traceFourActorSwordFixture(assets,{roster,ownerId,attackerId:roster[2]==='BH'?'p2':'p0'}).report);
  }
  const attackerProbe=seededOwnerRageProbe(assets,{ownerId:'p0'}),victimProbe=seededOwnerRageProbe(assets,{ownerId:'p2'});
  const report={schemaVersion:1,targetClientMeasured:false,gpuMeasured:false,
    traces,seededOwnershipProbes:[attackerProbe.report,victimProbe.report],
    snapshotReplay:snapshotReplayProbe(victimProbe.sim,createFourActorSwordFixture(assets,{ownerId:'p0'})),
    observerCopyPressure:measureObserverCopyPressure(assets),
    sourceRage:{attackBox:PROFESSION_PROFILES.LK.effectTemplates.MonsterAngryWind_AttackBox,
      particles:['MonsterAngryWind','Counter_Particle01'].map(name=>({name,fields:assets.indexes.LK.templates[name].fields}))}};
  const file=resolve(root,'runtime/sword-rage-v30/combat-audit.json');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({file,traces:traces.map(row=>({roster:row.roster,ownerId:row.ownerId,rage:row.rageEvents,peaks:row.peaks,eventCounts:row.eventCounts})),
    seededOwnershipProbes:report.seededOwnershipProbes,snapshotReplay:report.snapshotReplay,observerCopyPressure:report.observerCopyPressure},null,2));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length>3||process.argv[2]!==undefined&&process.argv[2]!=='--observer-copy')throw new Error('Usage: node tools/audit-four-actor-sword-rage-v30.mjs [--observer-copy]');
  if(process.argv[2]==='--observer-copy')await runObserverCopyBeforeAfter(await loadFourActorSwordAssets());
  else await runFourActorSwordAudit();
}
