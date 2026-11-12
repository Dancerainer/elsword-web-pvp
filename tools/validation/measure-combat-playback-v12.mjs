/** Candidate Web v11/v12 comparison with one shared source WASM runtime.
 * Each owner runs original pose helpers and normal positive Native dt.
 * Wire counters cover actual complete production codec/gzip/ACK messages.
 * This controlled in-process transport is neither WAN nor capacity evidence.
 * Root runs this only in the serialized resource guard. No browser/GPU. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {createProfessionSamplers} from '../../packages/combat-assets/profession-samplers.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
import {addCommonBuffVisuals,professionPoseAssetPath} from '../../packages/combat-assets/common-buffs.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {compressOnlineText,decodeOnlineGzip} from '../../apps/web/online-socket.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {validateInputBatch,consumeLocalOwnerWorkerInput} from '../../packages/online/service.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';

export const project=fileURLToPath(new URL('../../',import.meta.url)),nativeDt=1/60;
const json=JSON.stringify,copy=structuredClone,bytes=value=>Buffer.byteLength(typeof value==='string'?value:json(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
let cachedAssets;
export async function loadPlaybackNativeAssets({assetRoot=resolve(process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project,'artifacts')}={}){
  const directory=resolve(assetRoot);
  if(cachedAssets){assert.equal(cachedAssets.directory,directory,'one fixture cannot silently load another runtime');return cachedAssets.promise;}
  const promise=(async()=>{
    const seals={},read=file=>{const pathname=resolve(directory,file),inside=relative(directory,pathname);
      assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));const value=readFileSync(pathname);seals[inside.replaceAll('\\','/')]={bytes:value.length,sha256:sha(value)};return JSON.parse(value);};
    const map={...read('scene/sander-garpai-rock-pvp/manifest.json'),...read('scene/sander-garpai-rock-pvp/collision.json')};
    const manifest=read('native/manifest.json'),native=await createNativeRuntime({manifest,map,loadBinary:file=>readFileSync(resolve(directory,'native',file))});
    for(const module of Object.values(manifest.modules)){const binary=readFileSync(resolve(directory,'native',module.file));assert.equal(sha(binary),module.sha256);seals['native/'+module.file]={bytes:binary.length,sha256:sha(binary)};}
    const common=read('common-buffs/manifest.json'),commonBuffs=read('common-buffs/'+common.definitionCatalog),
      commonVisual=mergeVisualEffectIndexes(...common.visualEffectIndexes.map(file=>read('common-buffs/'+file))),profiles={},presets={},samplers={};
    for(const id of ['RF','LP','DE']){
      profiles[id]=JSON.parse(readFileSync(resolve(project,'packages/combat-core/'+id.toLowerCase()+'-profile.json')));
      presets[id]=JSON.parse(readFileSync(resolve(project,'config/'+id.toLowerCase()+'-preset.json')));
      const folder=id.toLowerCase()+'/',info=read(folder+'manifest.json');
      const paths=info.visualEffectIndexes??(id==='RF'?['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx'].map(name=>name+'/index.json'):[]);
      const visual=addCommonBuffVisuals(mergeVisualEffectIndexes(...paths.map(file=>read(folder+file))),commonVisual),
        effectIndex=mergeEffectIndexes(read(folder+info.effectAssetIndex),visual),raw=read(folder+info.runtimePose),
        characterPose=composeCharacterPose(raw,raw.sharedPose?read(folder+raw.sharedPose):null),effectPoses={};
      for(const file of collectEffectPoseFiles(effectIndex,visual))effectPoses[file]=read(professionPoseAssetPath(id,file));
      samplers[id]=createNativeSamplers({profile:profiles[id],characterPose,effectIndex,effectPoses,map});
    }
    return {directory,map,native,profiles,presets,samplers,commonBuffs,seals,nativeRuntimeCount:1};
  })();cachedAssets={directory,promise};return promise;
}
export function playbackNativeSimulation(assets,owner,{sourceProfession='RF',targetProfession='RF',mixed=false,sourceSkill=null}={}){
  const roster=[['source',sourceProfession,0,0],['buddy',mixed?'LP':sourceProfession,0,-600],['target',targetProfession,1,80],['other',mixed?'DE':targetProfession,1,200]];
  const presets=Object.fromEntries(Object.entries(assets.presets).map(([id,value])=>[id,{...value,onlineMatch:true,passives:[],guildPassives:[]}]));
  const n=assets.native;
  return createSimulation({profile:assets.profiles[sourceProfession],profiles:assets.profiles,preset:presets[sourceProfession],presets,map:assets.map,
    commonBuffs:assets.commonBuffs,seed:2016,networkOwnerId:owner,observeRemoteDamage:true,
    actors:roster.map(([id,professionId,team,x])=>({id,username:id,professionId,team,position:[x,3080,0],lineId:2,facing:team? -1:1,
      loadout:[id==='source'&&sourceSkill?{skillId:sourceSkill}:mixed&&['LP','DE'].includes(professionId)?{skillId:29000}:null,...Array(7).fill(null)],passives:[],guildPassives:[]})),
    ...createProfessionSamplers(assets.samplers,sourceProfession),nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,
    nativeSkillValues:n.skillValues,nativeCritical:n.critical,nativeNasod:n.nasod,nativeManaBreak:n.manaBreak});
}
export function canonicalPlaybackReport(raw){
  // This fixture uses source-frame base 0. Match online-client admission:
  // internal producer age metadata never crosses the wire schema.
  return validateOwnedState({...raw,actions:(raw.actions??[]).map(({ageFrames=0,...action})=>({...action,frameSeq:Math.max(0,raw.frameSeq-ageFrames)}))});
}
export function playbackRoom(sim,version=1){return {snapshot:sim.snapshot(),owners:{},ownership:{mode:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,
  ...(version===1?{combatPlaybackVersion:1}:{}),actors:Object.fromEntries(sim.state.actors.map(actor=>[actor.id,{epoch:1,frameSeq:0}]))}};}
export function playbackNativeOwner(assets,id,{version=1,clock=()=>0,baseline,...options}={}){
  const sim=playbackNativeSimulation(assets,id,options),presentation=createOwnedPresentation({clock}),remotePresentation=createRemoteActorClock({captureContacts:true,clock}),
    sync=createLocalOwnershipSync({ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:version,clock,presentation,remotePresentation});
  sync.reconcile(sim,copy(baseline??playbackRoom(sim,version)),id);sim.drainEvents();
  return {id,sim,sync,step(input={held:[],pressed:[],released:[],sampledDevice:true},{prepared=false}={}){
    if(!prepared)sync.beforeStep(sim,id);const remote=version===1?sync.remoteInputs(sim,id):{};
    sim.step(nativeDt,{...remote,[id]:input},{snapshot:false});const events=sim.drainEvents(),raw=sync.afterStep(sim,id,events,input);
    return {events,report:raw?canonicalPlaybackReport(raw):null};},clear(){sync.clear();}};
}

const counter=()=>({messages:0,jsonBytes:0,wireBytes:0,gzipMessages:0,plainMessages:0,hash:createHash('sha256')});
async function message(value,count,{gzip=true}={}){
  const text=typeof value==='string'?value:json(value),wire=gzip?await compressOnlineText(text):text;
  count.messages++;count.jsonBytes+=bytes(text);count.wireBytes+=gzip?wire.byteLength:bytes(wire);count[gzip?'gzipMessages':'plainMessages']++;
  count.hash.update(String(gzip?wire.byteLength:bytes(wire))+':');count.hash.update(wire);
  const decoded=gzip?await decodeOnlineGzip(wire,{maximumWireBytes:128*1024,maximumDecodedBytes:128*1024}):JSON.parse(wire);
  assert.deepEqual(decoded,JSON.parse(text),'the actual complete gzip/plain message roundtrips');return decoded;
}
const sourceFiles=['tools/validation/measure-combat-playback-v12.mjs','apps/web/input-prediction.mjs','apps/web/remote-combat-playback.mjs',
  'packages/online/combat-playback.mjs','packages/online/owned-state.mjs','packages/online/owner-upload-delta.mjs','packages/online/owner-pose-delta.mjs',
  'packages/online/peer-control-delta.mjs','packages/online/owned-action-delta.mjs','apps/server/local-owner-driver.mjs','packages/combat-core/index.mjs',
  ...['rf','lp','de'].flatMap(id=>['packages/combat-core/'+id+'-profile.json','config/'+id+'-preset.json'])];
const sourceSeal=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(readFileSync(resolve(project,file)))]));
function desiredKeys(id,frame){
  if(id==='source'&&[4,100,170].includes(frame))return ['Z'];
  if(id==='source'&&frame===60)return ['AWAKEN'];
  if(id==='buddy'&&frame===24||id==='other'&&frame===110)return ['A'];
  if(id==='target'&&frame>=130&&frame<155)return ['LEFT'];return [];
}
async function measureVariant(assets,version,frames){
  let now=0;const start=performance.now(),cpu=process.cpuUsage(),ids=['source','buddy','target','other'],contexts=[],controls=[],controlQueue=[],statusQueue=[];
  const counters={peerPose:counter(),peerControl:counter(),upload:counter(),uploadAck:counter(),status:counter(),serverStatus:counter()},
    inputHash=createHash('sha256'),actionHash=createHash('sha256'),hitLedger=[],sourceGains=[],frameBytes=[];
  const server=playbackNativeSimulation(assets,null,{mixed:true,targetProfession:'DE'}),players=server.state.actors.map(actor=>({id:actor.id,username:actor.id,professionId:actor.professionId,team:actor.team,loadout:actor.loadout}));
  const pvp=new PvpMatch({players,map:assets.map,mode:'2v2',seed:2016,versions:{referenceVersion:server.versions.baseline,presetVersion:server.versions.preset,programVersion:CORE_VERSION},rules:{scoreLimit:100}});
  const driver=createLocalOwnerBattleDriver({match:{id:'measure-playback-v12',players,ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:version},simulation:server,pvp,manual:true,clock:()=>now,
    emit(type,value){if(type==='owner-status')statusQueue.push(copy(value));},finish(){throw Error('finite measurement must not end its room');}});
  for(const id of ids)driver.ready(id);driver.tick(10);
  const fixture=playbackNativeSimulation(assets,null,{mixed:true,targetProfession:'DE'});
  for(const actor of server.state.actors){const saved=fixture.actor(actor.id);Object.assign(actor,{x:saved.x,y:saved.y,z:saved.z,lineId:2,lastTouchLineId:2,landPosition:[saved.x,saved.y,saved.z],grounded:true,
    inputLock:0,forceInvincible:0,pvpPresentation:null,mp:actor.mpMax});actor.awakening.orbs=3;actor.awakening.gauge=0;if(actor.sourceAdd)actor.sourceAdd.dp=8000;server.enter(actor,'RSI_WAIT','explicit-original-map-fixture');}
  const baseline=driver.snapshot();
  for(const id of ids){const ctx=playbackNativeOwner(assets,id,{mixed:true,targetProfession:'DE',version,clock:()=>now,baseline});
    Object.assign(ctx,{keyboard:createSampledKeyboardBuffer(),held:new Set(),uploadSend:createOwnerUploadDelta(),uploadReceive:createOwnerUploadDelta(),sequence:0,reports:0,actions:0,effectSamples:0,zeroDtEffects:0,positiveDtEffects:0,steps:0});
    const original=ctx.sim.tickEffects;ctx.sim.tickEffects=function(dt,selected){if(dt===0)ctx.zeroDtEffects++;else ctx.positiveDtEffects++;return original.call(this,dt,selected);};contexts.push(ctx);}
  for(let a=0;a<contexts.length;a++)for(let b=a+1;b<contexts.length;b++){
    const forward={from:contexts[a],to:contexts[b],poseSend:createOwnerPoseDelta(),poseReceive:createOwnerPoseDelta(),ack:null,statusRevision:null},
      reverse={from:contexts[b],to:contexts[a],poseSend:createOwnerPoseDelta(),poseReceive:createOwnerPoseDelta(),ack:null,statusRevision:null};
    const endpoint=(out,incoming)=>createPeerControl({matchId:'measure-playback-v12',clock:()=>now,gzip:true,reliableTransport:true,controlDelta:true,
      send:(text,metadata)=>{controlQueue.push({route:out,text,metadata});return true;},apply:owner=>{
        const checked=validateOwnedState(owner);validateOwnedReferences(checked,incoming.to.sim.actor(incoming.from.id),assets.profiles[incoming.from.sim.actor(incoming.from.id).professionId],assets.map,{profiles:assets.profiles,actors:incoming.to.sim.state.actors});
        return incoming.to.sync.receiveActions(incoming.from.id,checked.actions??[],checked.epoch,checked.frameSeq);},
      onPose:proposal=>applyPose(incoming,proposal),onFault:error=>{throw Error(json(error));}});
    forward.control=endpoint(forward,reverse);reverse.control=endpoint(reverse,forward);forward.receiver=reverse.control;reverse.receiver=forward.control;controls.push(forward,reverse);forward.control.pump();reverse.control.pump();
  }
  function applyPose(route,{pose,candidate}){
    const delivery=route.to.sync.receivePeerResult(route.to.sim,route.from.id,pose,route.to.id);assert.equal(delivery.validated,true);
    candidate.commit();route.ack={epoch:pose.epoch,frameSeq:pose.frameSeq};route.receiver.acknowledgePose(pose.epoch,pose.frameSeq);
  }
  async function deliverControls(){for(let turn=0;controlQueue.length;turn++){assert.ok(turn<10000,'control ACK loop is bounded');const next=controlQueue.shift(),decoded=await message(next.text,counters.peerControl,{gzip:bytes(next.text)>=512});next.route.receiver.receiveParsed(decoded,{decodedBytes:bytes(decoded)});}}
  await deliverControls();
  try{
    for(let frame=1;frame<=frames;frame++){
      now=frame*1000/60;const beforeWire=Object.values(counters).reduce((sum,row)=>sum+row.wireBytes,0),produced=[];
      for(const ctx of contexts){
        const desired=new Set(desiredKeys(ctx.id,frame));for(const key of ctx.held)if(!desired.has(key))ctx.keyboard.up(key,now);for(const key of desired)if(!ctx.held.has(key))ctx.keyboard.down(key,now);ctx.held=desired;
        const input=ctx.keyboard.consume(now,nativeDt),{edges,...wireInput}=input;inputHash.update(json({id:ctx.id,frame,input}));
        const local=ctx.sim.actor(ctx.id),before={hp:local.hp,mp:local.mp,gauge:local.awakening.gauge,orbs:local.awakening.orbs};
        const {events,report}=ctx.step(input);ctx.steps++;
        for(const event of events)if(event.type==='hit'&&event.amount>0){
          if(event.targetId===ctx.id)hitLedger.push({owner:ctx.id,frame,eventId:event.eventId,attacker:event.actorId,amount:event.amount,hp:local.hp,kind:event.origin?.kind});
          if(event.actorId===ctx.id&&event.targetId!==ctx.id)sourceGains.push({owner:ctx.id,frame,target:event.targetId,amount:event.amount,mpBefore:before.mp,mpAfter:local.mp,gaugeBefore:before.gauge,gaugeAfter:local.awakening.gauge,orbsBefore:before.orbs,orbsAfter:local.awakening.orbs});
        }
        if(!report)continue;ctx.reports++;ctx.actions+=report.actions.length;ctx.effectSamples+=report.actions.reduce((n,action)=>n+action.effects.length,0);actionHash.update(json({id:ctx.id,report:report.actions}));
        validateOwnedReferences(report,local,assets.profiles[local.professionId],assets.map,{profiles:assets.profiles,actors:ctx.sim.state.actors});ctx.sync.recordSentFrame(ctx.sim,ctx.id,report.frameSeq);produced.push({ctx,report,wireInput});
      }
      for(const {ctx,report,wireInput}of produced){
        const carrier={matchId:'measure-playback-v12',sequence:ctx.sequence++,frames:[{...wireInput,frameSeq:report.frameSeq}],ownerUpload:ctx.uploadSend.encode(report)};
        const decoded=await message(carrier,counters.upload),candidate=ctx.uploadReceive.decode(decoded.ownerUpload),{ownerUpload,...header}=decoded,body={...header,owner:candidate.report};
        assert.deepEqual(validateInputBatch(body).owner,report,'full upload actor/effects/actions/hits preserve every source field');
        const accepted=consumeLocalOwnerWorkerInput(driver,ctx.id,body);assert.equal(accepted.accepted,true);let ownerReceipt;
        if(accepted.ignored===undefined&&accepted.frameSeq===report.frameSeq){assert.equal(candidate.commit(),true);ownerReceipt=candidate.ownerReceipt;}
        const ack=await message({type:'ack',data:{accepted:true,sequence:carrier.sequence,matchId:carrier.matchId,consumedActionIds:accepted.consumedActionIds??[],consumedHitIds:accepted.consumedHitIds??[],...(ownerReceipt?{ownerReceipt}:{}),...(accepted.ignored?{ignored:accepted.ignored}:{})}},counters.uploadAck,{gzip:false});
        assert.deepEqual(ack.data.consumedActionIds,report.actions.map(action=>action.id));if(ownerReceipt)assert.equal(ctx.uploadSend.acknowledge(ack.data.ownerReceipt),true);
        for(const route of controls.filter(route=>route.from===ctx)){
          assert.equal(route.control.stage({...report,hits:[]}),true);
          const marker=report.actor.sourceStatusClock;if(route.statusRevision!==marker.revision){route.statusRevision=marker.revision;const status=await message(encodeOwnedStatus(report),counters.status,{gzip:false});route.to.sync.receiveStatus(route.to.sim,ctx.id,status,route.to.id);}
          const pose={...report,hits:[],actions:[]};delete pose.actionFrontierComplete;
          const wire={matchId:carrier.matchId,sequence:report.frameSeq,poseDelta:1,ownerDelta:route.poseSend.encode(pose,{acknowledgedEpoch:route.ack?.epoch,acknowledgedFrameSeq:route.ack?.frameSeq??-1}),controlSequence:route.control.watermark(report.epoch)};
          const packet=await message(wire,counters.peerPose),result=route.poseReceive.decode(packet.ownerDelta);assert.deepEqual(result.report,pose,'full pose fields survive production delta and gzip');
          const proposal={pose:result.report,candidate:result};
          if(!route.receiver.fence(proposal,report.epoch,packet.controlSequence))applyPose(route,proposal);
        }
      }
      await deliverControls();
      while(statusQueue.length){const value=statusQueue.shift();for(const ctx of contexts)if(ctx.id!==value.playerId){const decoded=await message(value,counters.serverStatus,{gzip:false});ctx.sync.receiveStatus(ctx.sim,value.playerId,decoded.status,ctx.id);}}
      if(frame%6===0)driver.tick(.1);
      frameBytes.push({frame,wireBytes:Object.values(counters).reduce((sum,row)=>sum+row.wireBytes,0)-beforeWire});
      for(const route of controls){const limits=route.control.performance();assert.ok(limits.inflightPackets<=8&&limits.pendingPackets<=32);}
    }
    await deliverControls();
    const wire=Object.fromEntries(Object.entries(counters).map(([name,{hash,...rest}])=>[name,{...rest,sha256:hash.digest('hex')}]));
    const owners=contexts.map(ctx=>({id:ctx.id,profession:ctx.sim.actor(ctx.id).professionId,steps:ctx.steps,reports:ctx.reports,actions:ctx.actions,effectSamples:ctx.effectSamples,
      hp:ctx.sim.actor(ctx.id).hp,mp:ctx.sim.actor(ctx.id).mp,gauge:ctx.sim.actor(ctx.id).awakening.gauge,zeroDtEffects:ctx.zeroDtEffects,positiveDtEffects:ctx.positiveDtEffects,consumer:ctx.sync.actionDiagnostics}));
    assert.ok(owners.every(owner=>owner.steps===frames));if(version===1)assert.ok(owners.every(owner=>owner.zeroDtEffects===0),'v12 has no historical tickEffects(0) damage');
    return {version,frames,inputSha256:inputHash.digest('hex'),actionSha256:actionHash.digest('hex'),owners,wire,frameBytes,hitLedger,sourceGains,
      elapsedMs:performance.now()-start,cpuMicroseconds:process.cpuUsage(cpu),memory:process.memoryUsage()};
  }finally{for(const ctx of contexts)ctx.clear();driver.stop();}
}
export async function measureCombatPlayback({assetRoot,frames=180}={}){
  assert.ok(Number.isSafeInteger(frames)&&frames>=120&&frames<=600);const seal=sourceSeal(),assets=await loadPlaybackNativeAssets({assetRoot}),rows=[];
  for(const version of [0,1])rows.push(await measureVariant(assets,version,frames));assert.equal(rows[0].inputSha256,rows[1].inputSha256,'all four physical source traces are byte-identical');assert.deepEqual(sourceSeal(),seal,'measurement does not modify its sources');
  return {schemaVersion:1,status:'passed',completedAt:new Date().toISOString(),coreVersion:CORE_VERSION,nativeRuntimeCount:1,professions:['RF','LP','DE'],sourceHashes:seal,assetHashes:assets.seals,
    comparison:'Same candidate source code, frozen v11 aura2/status1/playback0 versus v12 playback1; four independent Native owners. HP, miss counts and receipts are intentionally not normalized.',
    fixturePolicy:'Authored Garpai map/Native geometry and original pose helpers. Explicit post-intro line2 anchors, empty passives/guild, full initial MP/three orbs and Add DP8000. Native source input clocks and positive dt are identical. Transport has immediate bounded application ACK, no artificial WAN RTT.',
    limitations:['No browser/GPU, live P2P/STUN/TURN/SCTP/TLS/HTTP/SSE framing, WAN, loss or cross-operator timing evidence.',
      'Actual complete application gzip messages are measured; stream/TCP overhead and 2–3-table server capacity are not established.',
      'v11 uses the candidate legacy branch, not a separate old checkout. Compression awaits do not advance the controlled source clock.',
      'The production pose/control admission fence and ACK are retained. Admission occurs on the controlled same-frame queue, not a measured WAN path. Slow/fault path correctness has independent tests.'],rows};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv[2]??'runtime/combat-playback-v12/summary.json');mkdirSync(dirname(output),{recursive:true});
  try{const report=await measureCombatPlayback({assetRoot:process.argv[3],frames:Number(process.argv[4]??180)});writeFileSync(output,json(report,null,2)+'\n');
    console.log(json({output,status:report.status,rows:report.rows.map(row=>({version:row.version,actions:row.owners.reduce((n,owner)=>n+owner.actions,0),wireBytes:Object.values(row.wire).reduce((n,wire)=>n+wire.wireBytes,0),hits:row.hitLedger.length,inputSha256:row.inputSha256}))}));}
  catch(error){writeFileSync(output,json({schemaVersion:1,status:'failed',failedAt:new Date().toISOString(),error:error.stack},null,2)+'\n');throw error;}
}
