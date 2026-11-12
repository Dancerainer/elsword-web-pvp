import {pvpBuffText} from './buff-text.mjs';
import {isElswordProfile,isElesisProfile} from '../professions/identity.mjs';
/** Pure, seeded 1v1/2v2/3v3 lifecycle. Reference rules are documented in the source contract.
 * Actors are the existing independent combat simulation's state.actors.
 * Networking, resource loading, rendering, and account persistence are host duties.
 */
import source from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};
import {MODE_CONFIG,isOnlineMode} from '../online/modes.mjs';
import {createMapMechanics} from '../combat-core/map-mechanics.mjs';
import {isAddActor,syncAddAwakening} from '../combat-core/add-systems.mjs';

export const PVP_RULE_VERSION='rf-multimode-reference-v7-network-reconnect';
export const RECONNECT_GRACE_SECONDS=30;
// User-selected online opening lock. Both supported Infernal Arms variants
// share the requested delay; this is not a measured target-client default.
export const OPENING_HA_SKILL_IDS=Object.freeze([24600,24603,21603,21604,21605,24604,24605,28603,28604,28605,29600,29601,29602,29603,29604,29605]);
export const DEFAULT_PVP_RULES=Object.freeze({
  scoreLimit:4,duration:420,introDuration:4.5,slowDuration:1.5,slowScale:0.2,
  // User-selected initial resources, not measured target defaults.
  // Combat core gauge100 fills ONE orb; gauge50 is half the visible charge bar.
  initialMp:0,initialAwakeningOrbs:0,initialAwakeningGauge:50,
  initialHaCooldown:180,
  respawnInvincible:5,respawnLock:1.3666666666666667,flashInterval:0.05,
  // Teammate-position spawning is explicitly requested by the user. The
  // acquired V5 client chooses a random authored AddStartPos instead.
  respawnPosition:'random-live-teammate',
  respawnEnabled:true,
  // The acquired V5 result consumer credits a dead deathmatch player 100% HP.
  // Complete ties keep the first (red) team after lower average level.
  tiedHpPolicy:'v5-deathmatch-next-life',completeTie:'v5-first-team',
});
const copy=value=>structuredClone(value);
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const finite=(n,name)=>{if(!Number.isFinite(n))throw new TypeError(`${name} must be finite`);return n;};
const actorsOf=simulation=>simulation?.state?.actors??simulation?.actors??[];
const symbol=value=>value?.symbol??value?.$symbol??value;
const isTrue=value=>[true,1,'TRUE','true'].includes(symbol(value));
const identity=id=>String(id);

export function respawnSeconds(ownScore,enemyScore){
  finite(ownScore,'ownScore');finite(enemyScore,'enemyScore');
  return clamp(15+3*(ownScore-enemyScore),0,30);
}

/** User-selected extension of the fixed V5 seasonal MP retention rule.
 * Evaluate at revival, not death; awakening charge/orbs and Raven core are
 * separate lifecycles, never automatically registered as special resources.
 */
export function respawnResourceRetention(ownScore,enemyScore){
  finite(ownScore,'ownScore');finite(enemyScore,'enemyScore');
  const lead=ownScore-enemyScore;
  return lead>=2?0:lead===1?.5:1;
}

function registerResourcePools(pools){
  if(!Array.isArray(pools))throw new TypeError('specialResourcePools must be an array');
  const ids=new Set();
  return Object.freeze(pools.map(pool=>{
    if(!pool||typeof pool.id!=='string'||!(/^[a-z][a-z0-9_-]{0,63}$/).test(pool.id)||['mp','awakening','core'].includes(pool.id))throw new TypeError('Invalid special resource pool id');
    if(ids.has(pool.id))throw new TypeError('Duplicate special resource pool id');
    if(typeof pool.read!=='function'||typeof pool.write!=='function')throw new TypeError('Special resource pool requires read/write callbacks');
    ids.add(pool.id);
    if(pool.retain!==undefined&&typeof pool.retain!=='function')throw new TypeError('Special resource retention must be a callback');
    return Object.freeze({id:pool.id,read:pool.read,write:pool.write,...(pool.retain?{retain:pool.retain}:{})});
  }));
}

/** Authored team starts only. Never substitute a training-floor coordinate. */
export function chooseTeamSpawns(map,players){
  if(!map||!Array.isArray(map.lines))throw new TypeError('Original line map required');
  const starts=map.spawns??map.starts??[];
  const counters=[0,0];
  return players.map(player=>{
    const team=Number(player.team);
    if(team!==0&&team!==1)throw new TypeError('PvP team must be 0 (red) or 1 (blue)');
    const candidates=starts.filter(start=>start.kind==='SetTeamStartPos'&&isTrue(start.teamFlag)===(team===0));
    const start=candidates[counters[team]++];
    if(!start||!Array.isArray(start.position)||start.position.length!==3||start.position.some(v=>!Number.isFinite(v)))throw new TypeError(`Missing authored team spawn for ${player.id}`);
    if(!map.lines.some(line=>line.lineId===start.lineId))throw new TypeError(`Spawn references unknown line ${start.lineId}`);
    return {id:player.id,team,position:copy(start.position),facing:isTrue(start.facingRight)?1:-1,lineId:start.lineId,sourceSpawnIndex:start.index};
  });
}

export function pvpModifiers(score,team,connectedCounts){
  const deficit=clamp(score[1-team]-score[team],0,3);
  const revenge=source.revenge.levels[deficit-1];
  const missing=Math.max(0,connectedCounts[1-team]-connectedCounts[team]);
  return {
    revengeLevel:deficit,damageMultiplier:revenge?.attackMultiplier??1,
    receivedMultiplier:revenge?.receivedDamageMultiplier??1,
    receivedMpMultiplier:revenge?.receivedMpMultiplier??1,
    outnumbered:missing,hitMpBonus:3*missing,receivedMpBonus:2*missing,
  };
}

export class PvpMatch{
  constructor({players,map,mode='2v2',seed=1,versions={},rules={},onRespawn,specialResourcePools=[]}={}){
    if(!isOnlineMode(mode))throw new TypeError('Unsupported PvP mode');
    const spec=MODE_CONFIG[mode];
    if(!Array.isArray(players)||players.length!==spec.playerCount||new Set(players.map(p=>identity(p.id))).size!==spec.playerCount)throw new TypeError(`${spec.playerCount} distinct players required for ${mode}`);
    if([0,1].some(team=>players.filter(p=>Number(p.team)===team).length!==spec.teamSize))throw new TypeError(`${spec.teamSize} players per team required for ${mode}`);
    for(const name of ['referenceVersion','presetVersion','programVersion'])if(typeof versions[name]!=='string'||!versions[name])throw new TypeError(`${name} required`);
    if(!Number.isInteger(seed))throw new TypeError('Integer seed required');
    this.map=map;this.mode=mode;this.onRespawn=onRespawn;this.reconnectSnapshots=new Map();
    // Explicit host-authored providers only. RF currently registers none;
    // this does not create actor fields or authorize new network payloads.
    this.specialResourcePools=registerResourcePools(specialResourcePools);
    this.specialResourcePoolIds=Object.freeze(this.specialResourcePools.map(pool=>pool.id));
    // V5 ordinary 1v1 is a single life with a 300-second limit. Team modes
    // retain the existing deathmatch lifecycle and the user-selected 4/6 caps.
    const modeRules=mode==='1v1'?{scoreLimit:1,duration:300,respawnEnabled:false,tiedHpPolicy:'remaining'}:{scoreLimit:spec.scoreLimit};
    this.rules={...DEFAULT_PVP_RULES,...modeRules,...copy(rules)};
    for(const name of ['scoreLimit','duration','introDuration','slowDuration','slowScale','respawnInvincible','respawnLock','flashInterval'])if(finite(this.rules[name],name)<=0)throw new RangeError(`${name} must be positive`);
    if(this.rules.slowScale>1)throw new RangeError('slowScale must be at most 1');
    if(finite(this.rules.initialMp,'initialMp')<0)throw new RangeError('initialMp must be nonnegative');
    if(finite(this.rules.initialHaCooldown,'initialHaCooldown')<0)throw new RangeError('initialHaCooldown must be nonnegative');
    if(!Number.isInteger(this.rules.initialAwakeningOrbs)||this.rules.initialAwakeningOrbs<0||this.rules.initialAwakeningOrbs>3)throw new RangeError('initialAwakeningOrbs must be integer0..3');
    if(finite(this.rules.initialAwakeningGauge,'initialAwakeningGauge')<0||this.rules.initialAwakeningGauge>=100)throw new RangeError('initialAwakeningGauge must be 0..<100');
    if(!Number.isInteger(this.rules.scoreLimit))throw new TypeError('scoreLimit must be integer');
    if(typeof this.rules.respawnEnabled!=='boolean')throw new TypeError('respawnEnabled must be boolean');
    if(!['random-live-teammate','authored-random'].includes(this.rules.respawnPosition))throw new TypeError('Unsupported respawnPosition');
    if(!['v5-deathmatch-next-life','remaining'].includes(this.rules.tiedHpPolicy))throw new TypeError('Unsupported tiedHpPolicy');
    if(!['v5-first-team','draw'].includes(this.rules.completeTie))throw new TypeError('Unsupported completeTie');
    this.versions=Object.freeze(copy(versions));
    this.initialSpawns=chooseTeamSpawns(map,players);
    this.state={version:PVP_RULE_VERSION,mode,scoreLimit:this.rules.scoreLimit,phase:'created',clock:0,fightTime:0,remaining:this.rules.duration,
      score:[0,0],randomState:seed>>>0||1,phaseTime:0,winner:null,finishReason:null,result:null,nextEventId:1,
      players:players.map(p=>({id:p.id,team:Number(p.team),...(p.professionId?{professionId:p.professionId}:{}),name:p.nickname??p.name??identity(p.id),nickname:p.nickname??p.name??identity(p.id),level:finite(p.level??99,'level'),
        connected:true,alive:true,kills:0,deaths:0,assists:0,respawnAt:null,invincibleUntil:null,lockUntil:null,
        pose:null,damageBy:{},lastAttackerId:null,lastHitSequence:0})),events:[]};
  }
  player(id){return this.state.players.find(p=>identity(p.id)===identity(id));}
  actor(sim,id){return actorsOf(sim).find(a=>identity(a.id)===identity(id));}
  random(){let x=this.state.randomState;x^=x<<13;x^=x>>>17;x^=x<<5;this.state.randomState=x>>>0;return this.state.randomState/4294967296;}
  emit(type,data={}){const event={id:this.state.nextEventId++,type,clock:this.state.clock,...copy(data)};this.state.events.push(event);return event;}
  drainEvents(){return this.state.events.splice(0);}
  weightedPose(list){
    const n=Math.floor(this.random()*100);let total=0;
    for(const item of list){total+=item.weight;if(n<total)return copy(item);}
    throw new TypeError('Pose weights must cover 100');
  }
  posesFor(sim,actor,kind){
    const profile=sim?.profileFor?.(actor)??sim?.profile;
    if([100,101,106,112,115,120,121,125,122,123,126].includes(profile?.target?.unitClass)){
      const poses=profile.presentation?.pvpPoses?.[kind];
      if(!poses?.length)throw new TypeError('Profession target PvP pose list unavailable');
      return poses;
    }
    return source.poses[kind];
  }
  start(sim){
    if(this.state.phase!=='created')throw new Error('Match already started');
    this.state.phase='intro';this.state.phaseTime=0;
    for(const p of this.state.players){
      const a=this.actor(sim,p.id);if(!a)throw new TypeError(`Missing combat actor ${p.id}`);
      a.nickname=p.nickname;
      if(!p.connected){a.hidden=true;a.inputLock=1e9;continue;}
      a.mp=clamp(this.rules.initialMp,0,a.mpMax??Infinity);
      a.awakening={...a.awakening,orbs:this.rules.initialAwakeningOrbs,gauge:this.rules.initialAwakeningGauge,
        remaining:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0};
      // Add's equipment +50% means DP acquisition, never initial soul charge.
      // DP itself remains the frozen preset's explicitly initialized balance.
      if(isAddActor(a))syncAddAwakening(a);
      this.applyOpeningHaCooldown(a,true);
      const spawn=this.initialSpawns.find(s=>identity(s.id)===identity(p.id));
      this.applyPosition(a,spawn);a.hidden=false;
      p.pose=this.weightedPose(this.posesFor(sim,a,'start'));
      a.presentationTransition=null;
      a.pvpPresentation={state:p.pose.state,animationName:p.pose.animationName,time:0,duration:p.pose.duration,loop:false};
      this.emit('pose',{playerId:p.id,...p.pose});
    }
    this.introDuration=Math.max(this.rules.introDuration,...this.state.players.filter(p=>p.connected).map(p=>p.pose.duration));
    this.refreshModifiers(sim);this.applyLocks(sim);
    this.emit('intro',{duration:this.introDuration,scoreLimit:this.rules.scoreLimit,durationLimit:this.rules.duration});
    return this.snapshot();
  }
  applyOpeningHaCooldown(actor,reset=false){
    const remaining=Math.max(0,this.rules.initialHaCooldown-this.state.fightTime);
    if(remaining===0)return;
    actor.cooldowns??={};
    const ids=({LK:[21603],IS:[21605],RS:[21604],BM:[24604],VC:[24605],GM:[28603],BH:[28604],CA:[28605],
      LP:[29600,29603],MM:[29601,29604],DE:[29602,29605]})[actor.professionId]??[24600,24603];
    for(const id of ids)actor.cooldowns[id]=reset?remaining:Math.max(actor.cooldowns[id]??0,remaining);
  }
  applyPosition(actor,spawn){
    [actor.x,actor.y,actor.z]=spawn.position;actor.facing=spawn.facing;
    actor.lineId=spawn.lineId;actor.lastTouchLineId=spawn.lastTouchLineId??spawn.lineId;
    actor.landPosition=copy(spawn.landPosition??spawn.position);
    if(typeof spawn.grounded==='boolean')actor.grounded=spawn.grounded;
    else actor.grounded=spawn.sourceSpawnIndex!==undefined;
    actor.vx=0;actor.vy=0;actor.vz=0;
  }
  refreshModifiers(sim){
    const counts=[0,1].map(team=>this.state.players.filter(p=>p.team===team&&p.connected).length);
    for(const p of this.state.players){
      const actor=this.actor(sim,p.id);if(!actor)continue;
      const previous=JSON.stringify(actor.pvpModifiers??null);
      actor.pvpModifiers=pvpModifiers(this.state.score,p.team,counts);
      const m=actor.pvpModifiers,buffs=[];
      if(m.revengeLevel){const info=source.revenge.levels[m.revengeLevel-1];buffs.push({
        id:String(info.templateId),templateId:info.templateId,...pvpBuffText(info.templateId,m),
        remaining:null,stackCount:m.revengeLevel,isDebuff:false,iconKey:source.revenge.iconKey,iconName:source.revenge.iconName,evidence:'target2016-declaration + V5-score-consumer',
      });}
      if(m.outnumbered)buffs.push({id:'pvp-outnumbered',...pvpBuffText('pvp-outnumbered',m),
        remaining:null,stackCount:m.outnumbered,isDebuff:false,evidence:'V5-team-size-consumer; web HUD indicator'});
      actor.onlineBuffs=p.connected?buffs:[];
      if(previous!==JSON.stringify(m))this.emit('buff',{playerId:p.id,modifiers:m,buffs:actor.onlineBuffs});
    }
  }
  recordHit({attackerId,targetId,damage,amount}={}){
    damage??=amount;
    if(!['fight','slow'].includes(this.state.phase)||!(finite(damage,'damage')>0))return false;
    const attacker=this.player(attackerId),target=this.player(targetId);
    if(!attacker?.connected||!target?.connected||!target.alive||attacker.team===target.team)return false;
    const key=identity(attackerId),prior=Object.hasOwn(target.damageBy,key)?target.damageBy[key]:0;
    Object.defineProperty(target.damageBy,key,{value:prior+damage,enumerable:true,writable:true,configurable:true});
    target.lastAttackerId=attackerId;target.lastHitSequence++;
    return true;
  }
  /** One batch contains all deaths from the same combat step before checking wins. */
  recordDeaths(deaths,sim){
    if(!['fight','slow'].includes(this.state.phase))return [];
    const accepted=[];
    for(const d of deaths){
      const p=this.player(d.victimId);if(!p?.connected||!p.alive||accepted.some(x=>identity(x.p.id)===identity(p.id)))continue;
      const actor=this.actor(sim,p.id);
      // A host cannot award a kill merely by submitting an event.
      if(!actor||!(actor.hp<=0))continue;
      let killer=this.player(d.killerId??p.lastAttackerId);
      if(!killer||killer.team===p.team)killer=null;
      let maxDamager=null,maxDamage=-1;
      for(const [id,damage] of Object.entries(p.damageBy)){
        const candidate=this.player(id);if(candidate&&candidate.team!==p.team&&damage>maxDamage){maxDamager=candidate;maxDamage=damage;}
      }
      // KDA counts the greatest-damage contributor only when different from
      // the final attacker. This avoids counting a kill twice as kill+assist.
      const assistant=maxDamager&&maxDamager!==killer?maxDamager:null;
      accepted.push({p,killer,assistant,actor});
    }
    for(const {p,killer,assistant,actor} of accepted){
      p.alive=false;p.deaths++;
      if(killer)killer.kills++;
      if(assistant)assistant.assists++;
      this.state.score[1-p.team]++;
      if(actor){actor.pvpDead=true;actor.inputLock=Math.max(actor.inputLock??0,1);}
    }
    for(const {p,killer,assistant} of accepted){
      const delay=this.rules.respawnEnabled?respawnSeconds(this.state.score[p.team],this.state.score[1-p.team]):null;
      p.respawnAt=delay===null?null:this.state.fightTime+delay;p.damageBy={};p.lastAttackerId=null;
      this.emit('death',{playerId:p.id,killerId:killer?.id??null,assistIds:assistant?[assistant.id]:[],respawnSeconds:delay,score:this.state.score});
      if(this.state.pendingEnd&&!this.state.pendingEnd.deathIds.includes(p.id))this.state.pendingEnd.deathIds.push(p.id);
    }
    if(accepted.length){this.refreshModifiers(sim);if(this.state.phase==='fight')this.checkFinish(sim,'score');}
    return accepted.map(({p})=>p.id);
  }
  chooseRespawn(p,sim){
    if(this.rules.respawnPosition==='random-live-teammate'){
      const teammates=this.state.players.filter(q=>q.team===p.team&&q.id!==p.id&&q.connected&&q.alive)
        .map(q=>this.actor(sim,q.id)).filter(a=>a&&a.hp>0&&[a.x,a.y,a.z].every(Number.isFinite));
      if(teammates.length){const chosen=teammates[Math.floor(this.random()*teammates.length)];
        // An airborne teammate has no current support. Preserve its actual
        // remembered authored lane and last land point; neither is a new floor.
        return {position:[chosen.x,chosen.y,chosen.z],facing:chosen.facing,lineId:chosen.lineId,
          lastTouchLineId:chosen.lastTouchLineId??chosen.lineId,landPosition:copy(chosen.landPosition??[chosen.x,chosen.y,chosen.z]),
          grounded:!!chosen.grounded,teammateId:chosen.id};}
      // The teammate is dead: retain an authored team start, never invent a floor.
      const fallback=this.initialSpawns.find(s=>identity(s.id)===identity(p.id));return copy(fallback);
    }
    const starts=(this.map.starts??this.map.spawns??[]).filter(s=>s.kind==='AddStartPos');
    if(!starts.length)throw new TypeError('Authored random respawn points missing');
    const s=starts[Math.floor(this.random()*starts.length)];return {position:copy(s.position),lineId:s.lineId,facing:isTrue(s.facingRight)?1:-1};
  }
  respawn(p,sim){
    if(!this.rules.respawnEnabled||this.state.phase!=='fight'||!p?.connected||p.alive||p.respawnAt===null||p.respawnAt>this.state.fightTime)return false;
    const old=this.actor(sim,p.id);
    if(!old?.deathComplete)return false;
    const oldMp=old.mp??0,awakening=old.awakening&&{orbs:old.awakening.orbs,gauge:old.awakening.gauge};
    const retention=respawnResourceRetention(this.state.score[p.team],this.state.score[1-p.team]);
    const resourceContext=Object.freeze({ownScore:this.state.score[p.team],enemyScore:this.state.score[1-p.team],
      scoreDifference:this.state.score[p.team]-this.state.score[1-p.team],retention});
    // Capture before the host replaces the corpse with its clean initialized
    // actor template. null explicitly means this actor does not use the pool.
    const balances=this.specialResourcePools.flatMap(pool=>{
      const balance=pool.read(old);
      if(balance===null)return [];
      if(!Number.isFinite(balance)||balance<0)throw new TypeError(`Invalid special resource balance: ${pool.id}`);
      const retained=pool.retain?pool.retain(balance,resourceContext):balance*retention;
      if(!Number.isFinite(retained)||retained<0)throw new TypeError(`Invalid retained special resource: ${pool.id}`);
      return [{pool,balance:retained}];
    });
    const position=this.chooseRespawn(p,sim);
    const replacement=this.onRespawn?.(p.id,copy(position),sim);
    const actor=replacement??this.actor(sim,p.id);
    if(!actor)throw new TypeError(`Missing respawn actor ${p.id}`);
    this.applyPosition(actor,position);
    if(actor.mapMechanics)actor.mapMechanics={...createMapMechanics(),portalSerial:old.mapMechanics?.portalSerial??0};
    actor.nickname=p.nickname;
    actor.hp=actor.hpMax;actor.hidden=false;actor.death=null;actor.deathComplete=false;actor.pvpDead=false;
    actor.mp=clamp(oldMp*retention,0,actor.mpMax??Infinity);
    // Clean respawn templates must not bypass the still-running opening HA
    // delay. Keep only its remaining room time, never restart the 180 seconds.
    this.applyOpeningHaCooldown(actor);
    // Fixed V5 preserves stored HyperModeCount and seasonal NowSoul. Active
    // awakening expires independently; Raven core stays reset by the template.
    if(awakening)actor.awakening={...actor.awakening,...awakening,remaining:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0};
    const beforeWayOfSword=actor.wayOfSword&&copy(actor.wayOfSword);
    for(const {pool,balance} of balances)pool.write(actor,balance);
    if(isAddActor(actor))syncAddAwakening(actor);
    actor.forceInvincible=this.rules.respawnInvincible;actor.inputLock=this.rules.respawnLock;
    if(beforeWayOfSword)sim?.reconcileWayOfSwordResources?.(actor,beforeWayOfSword,'respawn-resource-restore');
    const profile=sim?.profileFor?.(actor)??sim?.profile;
    const respawnState=isAddActor(actor)?'ANSI_START_INTRUDE':isElesisProfile(profile)?'ESI_START_INTRUDE':isElswordProfile(profile)?'ESSI_START_INTRUDE':'RSI_START_INTRUDE';
    const nativeRespawn=profile?.states?.[respawnState];
    actor.pvpPresentation={state:respawnState,animationName:nativeRespawn?.animationName??'RespawnLanding',time:0,duration:nativeRespawn?.clip?.durationSeconds??this.rules.respawnLock,loop:false};
    p.alive=true;p.respawnAt=null;p.invincibleUntil=this.state.fightTime+this.rules.respawnInvincible;
    p.lockUntil=this.state.fightTime+this.rules.respawnLock;
    this.refreshModifiers(sim);
    this.emit('respawn',{playerId:p.id,...position,resourceRetention:retention,invincibleSeconds:this.rules.respawnInvincible,lockSeconds:this.rules.respawnLock});
    this.emit('sound',{actorId:p.id,name:'Revival.ogg',onlyIfLocal:false});
    return true;
  }
  disconnect(id,sim,{recoverable=false}={}){
    const p=this.player(id);if(!p)return false;
    if(!p.connected){if(!recoverable){this.reconnectSnapshots.delete(identity(id));if(['intro','fight'].includes(this.state.phase))this.checkFinish(sim,'disconnect');}return false;}
    // V54 product policy: freeze the last accepted owner state before removing
    // its battlefield presence. This is not a native-2016 reconnect claim.
    const savedActor=this.actor(sim,id);
    if(recoverable&&['intro','fight'].includes(this.state.phase)&&savedActor)this.reconnectSnapshots.set(identity(id),{actor:copy(savedActor),player:copy(p),expiresAt:this.state.clock+RECONNECT_GRACE_SECONDS});
    else this.reconnectSnapshots.delete(identity(id));
    p.connected=false;p.alive=false;p.respawnAt=null;p.invincibleUntil=null;p.lockUntil=null;
    const actor=this.actor(sim,id);if(actor){actor.hidden=true;actor.hp=0;actor.deathComplete=true;actor.pvpDisconnected=true;actor.inputLock=1e9;actor.onlineBuffs=[];}
    if(Array.isArray(sim?.state?.effects))sim.state.effects=sim.state.effects.filter(effect=>identity(effect.ownerId??effect.owner?.id)!==identity(id));
    this.emit('disconnect',{playerId:p.id});this.refreshModifiers(sim);
    if(!['slow','result'].includes(this.state.phase))this.checkFinish(sim,'disconnect');
    return true;
  }
  reconnect(id,sim){
    const key=identity(id),saved=this.reconnectSnapshots.get(key),p=this.player(id);
    if(!saved||!p||p.connected||!['intro','fight'].includes(this.state.phase)||saved.expiresAt<=this.state.clock)return false;
    const index=actorsOf(sim).findIndex(actor=>identity(actor.id)===key);if(index<0)return false;
    // Reuse the room's initialized respawn template, so skill-owned timers,
    // summon handles, old STOP queues and attack memories cannot cross lives.
    // The saved resources/Buffs/geometry below are deliberately restored after
    // initialization; reconnect is neither a heal nor a resource refund.
    const old=saved.actor,position={position:[old.x,old.y,old.z],lineId:old.lineId,facing:old.facing};
    const actor=this.onRespawn?.(id,copy(position),sim)??copy(old);actorsOf(sim)[index]=actor;
    Object.assign(p,copy(saved.player),{connected:true});this.reconnectSnapshots.delete(key);
    actor.pvpDisconnected=false;actor.pvpDead=!p.alive;actor.hidden=!p.alive;
    const restoreStoredResources=()=>{
      for(const field of ['x','y','z','facing','grounded','lineId','lastTouchLineId','landPosition',
        'hp','mp','cooldowns','awakening','buffs','buffBaseStats','stats','buffControls','sourceHitCountByte','wayOfSword'])
        if(Object.hasOwn(old,field))actor[field]=copy(old[field]);
      if(old.sourceAdd){actor.sourceAdd={...copy(old.sourceAdd),generator:null,formationPending:false};syncAddAwakening(actor);}
      for(const pool of this.specialResourcePools){const balance=pool.read(old);if(balance!==null)pool.write(actor,balance);}
    };
    // A rejoin starts a new transport life. Never replay the interrupted attack
    // or its projectiles; resources and position come from the saved snapshot.
    if(p.alive){
      sim.enter?.(actor,'RSI_WAIT','network-reconnect');
      restoreStoredResources();
      if(old.core){actor.core={...actor.core,gauge:old.core.gauge,level:old.core.level,
        phase:old.awakening?.remaining>0&&old.core.level>0?'idle':'absent',targetId:null,hit:false,attackLevel:0,phaseTime:0,
        attackElapsed:0,delayElapsed:0,guardRemaining:0,parrying:false,animationName:'Wait',animationTime:0};}
      actor.vx=0;actor.vy=0;actor.vz=0;actor.hitStop=0;actor.worldStop=0;actor.death=null;actor.deathComplete=false;
      actor.buffered=null;actor.comboStopInput=null;actor.skillId=null;actor.skillContext=null;
      actor.forceInvincible=this.rules.respawnInvincible;actor.inputLock=this.rules.respawnLock;
      p.invincibleUntil=this.state.fightTime+this.rules.respawnInvincible;p.lockUntil=this.state.fightTime+this.rules.respawnLock;
      const profile=sim?.profileFor?.(actor)??sim?.profile;
      const state=isAddActor(actor)?'ANSI_START_INTRUDE':isElesisProfile(profile)?'ESI_START_INTRUDE':isElswordProfile(profile)?'ESSI_START_INTRUDE':'RSI_START_INTRUDE';
      const definition=profile?.states?.[state];
      actor.pvpPresentation={state,animationName:definition?.animationName??'RespawnLanding',time:0,duration:definition?.clip?.durationSeconds??this.rules.respawnLock,loop:false};
      // Rejoin does not restart or replace the shared opening sequence.
      if(this.state.phase==='intro')actor.pvpPresentation={...copy(p.pose),time:Math.min(p.pose.duration,this.state.phaseTime),loop:false};
    }else{restoreStoredResources();actor.hp=0;actor.deathComplete=true;actor.inputLock=1;}
    if(Array.isArray(sim?.state?.effects))sim.state.effects=sim.state.effects.filter(effect=>identity(effect.ownerId??effect.owner?.id)!==key);
    this.refreshModifiers(sim);this.applyLocks(sim);
    this.emit('reconnect',{playerId:p.id,position:[actor.x,actor.y,actor.z],alive:p.alive,
      invincibleSeconds:p.alive?this.rules.respawnInvincible:0,lockSeconds:p.alive?this.rules.respawnLock:0});
    if(p.alive)this.emit('sound',{actorId:p.id,name:'Revival.ogg',onlyIfLocal:false});
    return true;
  }
  hpTieMetric(sim,team){
    return this.state.players.filter(p=>p.team===team&&p.connected).reduce((sum,p)=>{
      if(!p.alive&&this.rules.tiedHpPolicy==='v5-deathmatch-next-life')return sum+100;
      const a=this.actor(sim,p.id);return sum+(a?.hpMax>0?clamp(a.hp/a.hpMax,0,1)*100:0);
    },0);
  }
  checkFinish(sim,trigger){
    // A missing model cannot be attacked, but its team keeps a bounded chance
    // to reconnect. Ordinary timeout/score settlement still wins this race.
    const counts=[0,1].map(team=>this.state.players.filter(p=>p.team===team&&(p.connected||
      this.reconnectSnapshots.get(identity(p.id))?.expiresAt>this.state.clock)).length);
    if(counts[0]===0||counts[1]===0){this.finish(counts[0]===0&&counts[1]===0?null:counts[0]===0?1:0,'disconnect',sim);return true;}
    const reached=this.state.score.some(n=>n>=this.rules.scoreLimit),timedOut=this.state.remaining<=0;
    if(!reached&&!timedOut)return false;
    // Freeze control, not the result. Other owners can still report deaths from
    // already active attacks while the final original death/fade is playing.
    if(this.state.phase==='fight'){this.finish(undefined,timedOut?'timeout':trigger,sim);return true;}
    let winner=null,tieBreak='score';
    if(this.state.score[0]!==this.state.score[1])winner=this.state.score[0]>this.state.score[1]?0:1;
    else{
      const hp=[0,1].map(team=>this.hpTieMetric(sim,team));tieBreak='hp-percent';
      if(hp[0]!==hp[1])winner=hp[0]>hp[1]?0:1;
      else{
        const levels=[0,1].map(team=>{const ps=this.state.players.filter(p=>p.connected&&p.team===team);return Math.trunc(ps.reduce((n,p)=>n+p.level,0)/ps.length);});
        tieBreak='average-level';
        if(levels[0]!==levels[1])winner=levels[0]<levels[1]?0:1;
        else {tieBreak=this.rules.completeTie;winner=this.rules.completeTie==='v5-first-team'?0:null;}
      }
    }
    this.finish(winner,timedOut?'timeout':trigger,sim,tieBreak);return true;
  }
  finish(winner,reason,sim,tieBreak=null){
    if(this.state.phase==='result')return;
    if(this.state.phase!=='slow'){
      const deathIds=this.state.players.filter(p=>p.connected&&!p.alive&&this.actor(sim,p.id)?.hp<=0).map(p=>p.id);
      this.state.pendingEnd={reason,deathIds,focusVictimId:deathIds.at(-1)??null,
        ...(winner!==undefined&&reason!=='disconnect'?{requestedWinner:winner,tieBreak}: {})};
      this.state.phase='slow';this.state.phaseTime=0;this.state.winner=null;this.state.result=null;
      this.emit('finish',{winner:null,pending:true,reason,focusVictimId:this.state.pendingEnd.focusVictimId,
        slowScale:this.rules.slowScale,slowDuration:this.rules.slowDuration});this.applyLocks(sim);return;
    }
    this.state.winner=winner;this.state.finishReason=reason;
    this.state.result={mode:this.mode,scoreLimit:this.rules.scoreLimit,winner,winnerTeam:winner,reason,tieBreak,score:copy(this.state.score),fightTime:this.state.fightTime,versions:copy(this.versions),ruleVersion:PVP_RULE_VERSION,
      players:this.state.players.map(p=>({id:p.id,team:p.team,name:p.name,nickname:p.nickname,connected:p.connected,kills:p.kills,deaths:p.deaths,assists:p.assists,
        outcome:winner===null?'draw':p.team===winner?'win':'loss',kda:p.deaths===0?null:(p.kills+p.assists)/p.deaths}))};
    // Protection starts after the user-requested simultaneous-death window.
    for(const p of this.state.players){const actor=this.actor(sim,p.id);if(actor&&p.connected)actor.forceInvincible=Math.max(actor.forceInvincible??0,9999);}
    this.state.phase='result';this.state.phaseTime=0;
    for(const p of this.state.players){const a=this.actor(sim,p.id);if(!a||!p.connected)continue;
      // Draw has a confirmed GameDraw announcement, but no separate authored
      // draw pose. Keep the finished state instead of assigning both sides lose.
      if(winner===null){a.pvpPresentation=null;continue;}
      const pose=this.weightedPose(this.posesFor(sim,a,p.team===winner?'win':'lose'));
      a.pvpPresentation={state:pose.state,animationName:pose.animationName,time:0,duration:pose.duration,loop:false};}
    this.emit('result',{result:this.state.result});
    this.applyLocks(sim);
  }
  get timeScale(){return this.state.phase==='slow'?(this.state.phaseTime<this.rules.slowDuration?this.rules.slowScale:1):this.state.phase==='fight'?1:0;}
  canControl(id){const p=this.player(id);return this.state.phase==='fight'&&p?.connected&&p.alive&&!(p.lockUntil>this.state.fightTime);}
  applyLocks(sim){
    for(const p of this.state.players){const a=this.actor(sim,p.id);if(!a)continue;
      if(!this.canControl(p.id))a.inputLock=Math.max(a.inputLock??0,this.state.phase==='fight'&&p.lockUntil?Math.max(0,p.lockUntil-this.state.fightTime):1);
      if(p.invincibleUntil!==null){const remaining=clamp(p.invincibleUntil-this.state.fightTime,0,this.rules.respawnInvincible);a.forceInvincible=Math.max(a.forceInvincible??0,remaining);
        a.pvpInvincibleRemaining=remaining;a.pvpWhiteFlash=remaining>0&&Math.floor(this.state.fightTime/this.rules.flashInterval)%2===0;
        if(remaining===0)p.invincibleUntil=null;}
      if(p.lockUntil!==null&&p.lockUntil<=this.state.fightTime){p.lockUntil=null;if(this.state.phase!=='intro')a.pvpPresentation=null;}
    }
  }
  /** dt is unscaled server elapsed seconds. The combat host applies timeScale. */
  advance(dt,sim){
    if(finite(dt,'dt')<0)throw new RangeError('dt must be nonnegative');
    if(this.state.phase==='created')throw new Error('Call start before advance');
    this.state.clock+=dt;this.state.phaseTime+=dt;
    if(this.state.phase==='result'){
      for(const p of this.state.players){const a=this.actor(sim,p.id);if(a?.pvpPresentation)a.pvpPresentation.time=Math.min(a.pvpPresentation.duration,this.state.phaseTime);}
      return this.snapshot();
    }
    if(this.state.phase==='intro'){
      // fightTime intentionally stands still during the opening. Rejoin's
      // protection and input lock still start at actual restoration, so carry
      // only their remaining duration into the first playable frame.
      for(const p of this.state.players)if(p.connected){const a=this.actor(sim,p.id);
        if(p.invincibleUntil!==null){p.invincibleUntil=Math.max(0,p.invincibleUntil-dt);if(a)a.forceInvincible=Math.min(a.forceInvincible??0,p.invincibleUntil);}
        if(p.lockUntil!==null){p.lockUntil=Math.max(0,p.lockUntil-dt);if(a)a.inputLock=Math.min(a.inputLock??0,p.lockUntil);}
      }
      if(this.reconnectSnapshots.size&&this.checkFinish(sim,'disconnect')){this.applyLocks(sim);return this.snapshot();}
      for(const p of this.state.players){const a=this.actor(sim,p.id);if(p.connected&&a?.pvpPresentation)a.pvpPresentation.time=Math.min(p.pose.duration,this.state.phaseTime);}
      if(this.state.phaseTime>=this.introDuration){this.state.phase='fight';this.state.phaseTime=0;
        for(const p of this.state.players){const a=this.actor(sim,p.id);if(p.connected&&a){a.pvpPresentation=null;a.inputLock=0;}}
        this.emit('fight-start',{remaining:this.state.remaining});}
      if(this.state.phase==='fight')this.emit('sound',{name:'Fight.ogg',onlyIfLocal:false});
    }else if(this.state.phase==='fight'){
      this.state.fightTime=Math.min(this.rules.duration,this.state.fightTime+dt);this.state.remaining=Math.max(0,this.rules.duration-this.state.fightTime);
      const deaths=this.state.players.filter(p=>p.connected&&p.alive&&this.actor(sim,p.id)?.hp<=0).map(p=>({victimId:p.id}));
      this.recordDeaths(deaths,sim);
      if(this.state.phase==='fight')this.checkFinish(sim,'score');
      if(this.state.phase==='fight')for(const p of this.state.players)if(p.connected&&!p.alive&&p.respawnAt!==null&&p.respawnAt<=this.state.fightTime&&this.actor(sim,p.id)?.deathComplete)this.respawn(p,sim);
      for(const p of this.state.players){const a=this.actor(sim,p.id);if(a?.pvpPresentation&&p.lockUntil!==null)a.pvpPresentation.time=Math.min(this.rules.respawnLock,this.rules.respawnLock-Math.max(0,p.lockUntil-this.state.fightTime));}
    }else if(this.state.phase==='slow'){
      const deaths=this.state.players.filter(p=>p.connected&&p.alive&&this.actor(sim,p.id)?.hp<=0).map(p=>({victimId:p.id}));
      this.recordDeaths(deaths,sim);
      const ended=(this.state.pendingEnd?.deathIds??[]).every(id=>{const p=this.player(id),a=this.actor(sim,id);
        return !p?.connected||a?.hidden===true||a?.deathComplete===true;});
      if(ended&&this.state.phaseTime>=this.rules.slowDuration){
        const end=this.state.pendingEnd;
        if(end&&Object.hasOwn(end,'requestedWinner'))this.finish(end.requestedWinner,end.reason,sim,end.tieBreak);
        else this.checkFinish(sim,end?.reason??'score');
      }
    }
    this.applyLocks(sim);return this.snapshot();
  }
  snapshot(){return copy({...this.state,timeScale:this.timeScale,rules:this.rules,versions:this.versions,introDuration:this.introDuration??null,initialSpawns:this.initialSpawns,specialResourcePoolIds:this.specialResourcePoolIds});}
  restore(snapshot){
    if(snapshot?.version!==PVP_RULE_VERSION||snapshot.mode!==this.mode||snapshot.scoreLimit!==this.rules.scoreLimit||JSON.stringify(snapshot.versions)!==JSON.stringify(this.versions)||JSON.stringify(snapshot.rules)!==JSON.stringify(this.rules))throw new TypeError('Incompatible PvP snapshot');
    if(JSON.stringify(snapshot.specialResourcePoolIds)!==JSON.stringify(this.specialResourcePoolIds))throw new TypeError('Different PvP special resource pools');
    if(JSON.stringify(snapshot.players?.map(p=>[p.id,p.team]))!==JSON.stringify(this.state.players.map(p=>[p.id,p.team])))throw new TypeError('Different PvP players');
    for(const n of ['clock','fightTime','remaining','phaseTime'])if(!Number.isFinite(snapshot[n])||snapshot[n]<0)throw new TypeError('Invalid PvP snapshot clock');
    if(!Array.isArray(snapshot.score)||snapshot.score.length!==2||snapshot.score.some(n=>!Number.isInteger(n)||n<0))throw new TypeError('Invalid PvP snapshot score');
    if(!Number.isInteger(snapshot.randomState)||snapshot.randomState<1||snapshot.randomState>0xffffffff)throw new TypeError('Invalid PvP random state');
    if(!Number.isInteger(snapshot.nextEventId)||snapshot.nextEventId<1||!Array.isArray(snapshot.events))throw new TypeError('Invalid PvP snapshot events');
    if(snapshot.remaining>this.rules.duration||snapshot.fightTime>this.rules.duration+1)throw new TypeError('Invalid PvP snapshot elapsed');
    if(JSON.stringify(snapshot.initialSpawns)!==JSON.stringify(this.initialSpawns))throw new TypeError('Different PvP map spawns');
    for(const p of snapshot.players){
      if(typeof p.connected!=='boolean'||typeof p.alive!=='boolean'||['kills','deaths','assists'].some(n=>!Number.isInteger(p[n])||p[n]<0))throw new TypeError('Invalid PvP player record');
      for(const n of ['respawnAt','invincibleUntil','lockUntil'])if(p[n]!==null&&(!Number.isFinite(p[n])||p[n]<0))throw new TypeError('Invalid PvP player timer');
      if(!p.damageBy||Array.isArray(p.damageBy)||Object.values(p.damageBy).some(n=>!Number.isFinite(n)||n<0))throw new TypeError('Invalid PvP damage ledger');
    }
    if(!['created','intro','fight','slow','result'].includes(snapshot.phase))throw new TypeError('Invalid PvP phase');
    const end=snapshot.pendingEnd,ids=new Set(snapshot.players.map(p=>p.id));
    if(snapshot.phase==='slow'&&!end)throw new TypeError('Missing pending PvP end');
    if(end&&(!Array.isArray(end.deathIds)||end.deathIds.some(id=>!ids.has(id))||new Set(end.deathIds).size!==end.deathIds.length
      ||typeof end.reason!=='string'||(end.focusVictimId!==null&&!end.deathIds.includes(end.focusVictimId))
      ||Object.hasOwn(end,'requestedWinner')&&![null,0,1].includes(end.requestedWinner)))throw new TypeError('Invalid pending PvP end');
    const {rules,versions,introDuration,initialSpawns,timeScale,specialResourcePoolIds,...state}=copy(snapshot);
    this.state=state;this.introDuration=introDuration;this.initialSpawns=initialSpawns;return this;
  }
}
