import {isElswordProfession,isElesisProfession} from '../../packages/professions/identity.mjs';
/** Authoritative headless verification: browsers may submit actions, never HP,
 * transforms, kills or results. No renderer/GPU, and no browser-controlled dt. */
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSampledKeyboardBuffer} from '../web/sampled-keyboard.mjs';
import {PvpMatch,chooseTeamSpawns,PVP_RULE_VERSION} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from './local-owner-driver.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';
import {mapLoadingBudget} from '../../packages/online/map-loading-budget.mjs';
import {normalize as normalizeSkillPreferences} from './skill-preferences.mjs';
import {normalizeProfessionId,PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
import {createLordKnightResourcePools} from '../../packages/combat-core/lord-knight.mjs';
import {createElesisResourcePools} from '../../packages/combat-core/elesis-way-of-sword.mjs';
import {createAddResourcePools,isAddActor} from '../../packages/combat-core/add-systems.mjs';
const loadedAssets=new Map();

export function createBattleResourcePools(players){
  return [...(players.some(player=>isElswordProfession(player.professionId))?createLordKnightResourcePools():[]),
    ...(players.some(player=>isElesisProfession(player.professionId))?createElesisResourcePools():[]),
    ...(players.some(isAddActor)?createAddResourcePools():[])];
}

export function createVerifiedBattleDriver({match,simulation,pvp,emit,finish,clock=()=>performance.now(),manual=false}){
  const loadingTimeoutSeconds=match.loadingTimeoutSeconds??30;
  if(!Number.isFinite(loadingTimeoutSeconds)||loadingTimeoutSeconds<=0||loadingTimeoutSeconds>180)throw Error('invalid-loading-timeout');
  const queues=new Map(match.players.map(p=>[p.id,[]]));
  const devices=new Map(match.players.map(p=>[p.id,createSampledKeyboardBuffer()]));
  const held=new Map(match.players.map(p=>[p.id,new Set()]));
  const ready=new Set(),inputState={},lastInputFrame={},stats={steps:0,totalStepMs:0,maxStepMs:0,broadcastBytes:0,broadcasts:0};
  let stopped=false,finished=false,started=false,sequence=0,accumulator=0,last=clock(),loadingAge=0,serverTime=0,timer=null;
  const outEvents=[];
  function broadcast(){const value={matchId:match.id,sequence:sequence++,snapshot:simulation.snapshot(),pvp:pvp.snapshot(),events:outEvents.splice(0),inputs:structuredClone(inputState)};
    const serialized=JSON.stringify(value);stats.broadcastBytes+=Buffer.byteLength(serialized);stats.broadcasts++;emit('state',value);}
  function tick(dt=1/60){
    if(stopped)return;serverTime+=dt;
    if(!started){loadingAge+=dt;if(loadingAge>=loadingTimeoutSeconds){
      for(const player of match.players)if(!ready.has(player.id)){
        emit('player-timeout',{playerId:player.id,reason:'loading-timeout'});
        // The service releases the account and calls disconnect synchronously.
        // A standalone driver still removes the actor when no service is attached.
        if(!simulation.state.actors.find(a=>a.id===player.id)?.pvpDisconnected)disconnect(player.id);
      }
      if(!finished){if(pvp.snapshot().phase==='created')pvp.start(simulation);started=true;}
    }return;}
    const startedAt=clock(),phase=pvp.snapshot().phase;
    const inputs={};
    for(const player of match.players){
      const queue=queues.get(player.id),next=queue.shift(),prior=held.get(player.id),device=devices.get(player.id);
      if(next){lastInputFrame[player.id]=next.frameSeq;const level=new Set(next.held);for(const k of prior)if(!level.has(k))device.up(k,serverTime);
        for(const k of level)if(!prior.has(k))device.down(k,serverTime);held.set(player.id,level);}
      inputs[player.id]=device.consume(serverTime,dt);inputState[player.id]={held:inputs[player.id].held,frameSeq:lastInputFrame[player.id]??0};
      if(phase!=='fight')inputs[player.id]={held:[],pressed:[],released:[]};
    }
    if(phase==='fight'||phase==='slow')simulation.step(dt*pvp.timeScale,inputs,{snapshot:false});
    const combatEvents=simulation.drainEvents();
    for(const event of combatEvents)if(event.type==='hit')pvp.recordHit({attackerId:event.actorId,targetId:event.targetId,damage:event.amount,amount:event.amount});
    outEvents.push(...combatEvents);
    pvp.advance(dt,simulation);
    outEvents.push(...pvp.drainEvents());
    const state=pvp.snapshot();
    if(state.phase==='result'&&!finished){finished=true;Promise.resolve(finish(state.result??{
      winnerTeam:state.winnerTeam,score:state.score,reason:state.reason,players:state.players})).catch(error=>{emit('server-error',{error:'result-save-failed'});});}
    stats.steps++;const elapsed=clock()-startedAt;stats.totalStepMs+=elapsed;stats.maxStepMs=Math.max(stats.maxStepMs,elapsed);
    if(stats.steps%6===0||finished)broadcast();
    if(finished)stop();
  }
  function stop(){stopped=true;clearInterval(timer);clearTimeout(initialBroadcast);}
  function disconnect(id,options){const player=match.players.find(p=>p.id===id);if(!player)return;
    queues.get(id).length=0;devices.get(id).clear();held.set(id,new Set());
    pvp.disconnect(id,simulation,options);outEvents.push(...pvp.drainEvents());
    const actor=simulation.state.actors.find(a=>a.id===id);if(actor){actor.hidden=true;actor.hp=0;actor.deathComplete=true;actor.core.phase='absent';}
    simulation.state.effects=simulation.state.effects.filter(e=>e.ownerId!==id);
    if(pvp.snapshot().phase!=='created')started=true;
    broadcast();const state=pvp.snapshot();if(state.phase==='result'&&!finished){finished=true;Promise.resolve(finish(state.result)).catch(()=>emit('server-error',{error:'result-save-failed'}));stop();}}
  if(!manual){timer=setInterval(()=>{const now=clock();accumulator+=Math.min(.25,Math.max(0,(now-last)/1000));last=now;
    for(let n=0;accumulator>=1/60&&n<15;n++){tick(1/60);accumulator-=1/60;}},1000/60);timer.unref?.();}
  const initialBroadcast=setTimeout(broadcast,0);initialBroadcast.unref?.();
  return {submitInput(id,batch){if(stopped)return {accepted:false};const queue=queues.get(id);if(!queue)throw Error('player-not-in-match');
      if(queue.length+batch.frames.length>32)throw Error('input-queue-overflow');queue.push(...batch.frames.map(p=>structuredClone(p)));return {accepted:true};},
    ready(id){if(!queues.has(id))throw Error('player-not-in-match');ready.add(id);if(!started&&ready.size===match.players.length){started=true;if(pvp.snapshot().phase==='created')pvp.start(simulation);simulation.drainEvents();outEvents.push(...pvp.drainEvents());broadcast();}return {ok:true};},
    tick,disconnect,reconnect(id){if(stopped||!pvp.reconnect(id,simulation))return {resumed:false};
      queues.get(id).length=0;devices.get(id).clear();held.set(id,new Set());delete inputState[id];delete lastInputFrame[id];
      simulation.drainEvents();outEvents.push(...pvp.drainEvents());broadcast();return {resumed:true};},
    snapshot(){return {matchId:match.id,sequence:sequence++,snapshot:simulation.snapshot(),pvp:pvp.snapshot(),stats:{...stats,meanStepMs:stats.steps?stats.totalStepMs/stats.steps:0}};},stop};
}
export async function createBattleDriverFactory({root,assetRoot,ownership=OWNERSHIP_PROTOCOL}){
  if(![OWNERSHIP_PROTOCOL,'server-authoritative'].includes(ownership))throw new TypeError('unknown-network-ownership');
  const key=JSON.stringify([root,assetRoot]);
  if(!loadedAssets.has(key))loadedAssets.set(key,loadServerCombatAssets({root,assetRoot}));
  let assets;try{assets=await loadedAssets.get(key);}catch(error){loadedAssets.delete(key);if(error.code==='ENOENT')return null;throw error;}
  const factory=async({match,emit,finish})=>{
    const selected=assets.forScene(match.sceneId??assets.versions.sceneId);
    if(match.versions?.sceneId!==undefined&&match.versions.sceneId!==selected.versions.sceneId)throw Error('match-scene-version-mismatch');
    for(const key of ['mapCollisionSha256','mapGeometrySha256','mapManifestSha256'])if(match.versions?.[key]!==undefined&&match.versions[key]!==selected.versions[key])throw Error('match-map-version-mismatch');
    const profiles=assets.profiles??{RF:assets.profile},presets=assets.presets??{RF:assets.preset};
    for(const player of match.players){
      const professionId=normalizeProfessionId(player.professionId??'RF'),profile=profiles[professionId],preset=presets[professionId];
      if(!profile||!preset||assets.professions?.[professionId]===false)throw Error('match-profession-unavailable');
      if(player.unitClass!==undefined&&player.unitClass!==profile.target.unitClass)throw Error('match-profession-class-mismatch');
      if(player.loadout!==undefined)normalizeSkillPreferences({loadout:player.loadout,branchChoices:player.branchChoices??{}},profile,preset);
      const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
      for(const sealed of [player.professionVersions,match.versions?.professions?.[professionId]])
        if(sealed&&(sealed.profile!==undefined&&sealed.profile!==digest(profile)
          ||sealed.preset!==undefined&&sealed.preset!==digest(preset)
          ||sealed.reference!==undefined&&sealed.reference!==digest(profile.target)))throw Error('match-profession-version-mismatch');
    }
    const {native,samplers}=await selected.createRuntime();
    const spawns=chooseTeamSpawns(selected.map,match.players);
    const actors=match.players.map((p,i)=>({...p,...spawns[i],position:spawns[i].position,loadout:p.loadout}));
    const simulation=createSimulation({profile:assets.profile,profiles,map:selected.map,preset:{...assets.preset,onlineMatch:true},
      presets:Object.fromEntries(Object.entries(presets).map(([id,preset])=>[id,{...preset,onlineMatch:true}])),
      commonBuffs:assets.commonBuffs,actors,seed:match.seed,...samplers,
      nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
      nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,
      versions:{...native.versions,...selected.versions,...match.versions,matchRules:PVP_RULE_VERSION,networkOwnership:ownership}});
    const initialActors=structuredClone(simulation.state.actors);
    const pvp=new PvpMatch({players:match.players,map:selected.map,mode:match.mode??'2v2',seed:match.seed,versions:simulation.versions,
      specialResourcePools:createBattleResourcePools(match.players),
      onRespawn(id,spawn){const index=simulation.state.actors.findIndex(a=>a.id===id),template=initialActors.find(a=>a.id===id);
        const position=spawn.position,actor=structuredClone(template);[actor.x,actor.y,actor.z]=position;actor.landPosition=[...position];
        simulation.state.actors[index]=actor;simulation.state.effects=simulation.state.effects.filter(e=>e.ownerId!==id);simulation.enter(actor,'RSI_WAIT','pvp-respawn');return actor;}
    });
    return (ownership===OWNERSHIP_PROTOCOL?createLocalOwnerBattleDriver:createVerifiedBattleDriver)({match,simulation,pvp,emit,finish});
  };
  factory.ownership=ownership;factory.versions={...assets.versions,baseline:assets.profile.target.build,networkOwnership:ownership};
  factory.professions=assets.professions??Object.fromEntries(PROFESSION_IDS.map(id=>[id,id==='RF'||Boolean(assets.profiles?.[id])]));
  factory.assetDiagnostics=structuredClone(assets.assetDiagnostics??[]);
  factory.maps=assets.maps;factory.mapVersions=sceneId=>assets.forScene(sceneId).versions;
  factory.mapLoadTimeoutSeconds=(sceneId,count)=>{const row=assets.maps.find(row=>row.id===sceneId);if(!row)throw Error('unknown-pvp-scene');return mapLoadingBudget(row.geometryBytes??0,count);};
  return factory;
}
