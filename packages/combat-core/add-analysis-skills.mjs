/** Selected target2016 native control chains from the sealed offline static analysis
 * capture. Current Web scheduling is distinct from target PvP measurements.
 * Unknown target acquisition/action phases are explicit injected adapters;
 * missing adapters do not create guessed global damage or owner-centred hits.
 */
import {arcLineBasis} from './archenemy-mesh.mjs';
import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {orientLiteralMesh} from './shadow-mesh.mjs';
import {addInstallationFactoryActor2016} from './add-installation-power-2016.mjs';
const f=Math.fround;
export const ADD_ANALYSIS_SKILLS_VERSION='add-target2016-analysis-control-v37';
export const STARFALL_CARRIER='DAMAGE_EFFECT_Star_Fall_Start_MESH';
export const CHASER_ATTACKER='DamageEffect_AMM_Shooting_Chaser_Attacker';
export const CHASER_SETS=Object.freeze(Array.from({length:4},(_,i)=>'EffectSet_SI_SA_AMM_Installation_Shooting_Chaser_A'+(i+1)));
export const STARFALL_ATTACK_SET='EffectSet_SI_SA_AMM_Installation_Star_Fall_Attack';
export const STARFALL_ATTACK_MESH='ADD_Star_Fall_Attack_Mesh_Attack';
export const ADD_ANALYSIS_BONE_TARGETS=Object.freeze({[STARFALL_ATTACK_SET]:STARFALL_ATTACK_MESH,
 EffectSet_SI_SA_AMM_Installation_Shooting_Chaser_Start:'ADD_MM_Drone_Activator_Dummy01'});
export const ADD_ANALYSIS_RESOURCE_ROOTS=Object.freeze({
 Starfall:[STARFALL_CARRIER,'DAMAGE_EFFECT_Star_Fall_Explode','EffectSet_SI_SA_AMM_Installation_Star_Fall_Attack','EffectSet_SI_SA_AMM_Installation_Star_Fall_LockOn'],
 ShootingChaser:[CHASER_ATTACKER,...CHASER_SETS],
 StardustShower:['DamageEffect_ATT_Stardust_Shower_Rupture','Mesh_ATT_Stardust_Shower_Drop','DamageEffect_ATT_Stardust_Shower_Ball','EffectSet_ATT_Stardust_Shower_Attack','EffectSet_ATT_Stardust_Shower_End'],
});
const ownerAlive=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
const enemy=(a,b)=>ownerAlive(b)&&b.id!==a.id&&b.team!==a.team;
const registry=(sim,a)=>(a.sourceAddNative??=[]);
const entry=(sim,a,kind)=>a.sourceAddNative?.find(row=>row.kind===kind);
const effect=(sim,id)=>sim.state.effects.find(e=>e.id===id&&!e.dead);
const skill=(sim,a,id)=>sim.profileFor(a).skillCatalog.find(s=>s.skillId===id);
const scalar=(s,k)=>{const n=s?.raw?.[k]?.[s.maxLevel];if(!Number.isFinite(n)||n<0)throw new TypeError('Missing original Add ANALYSIS '+k);return n;};
const vector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
function anchor(sim,a,position){
 if(!vector(position))throw new TypeError('Invalid Add ANALYSIS source anchor');
 const basis=arcLineBasis(a,sim.map.lines);return {position:[...position],facing:a.facing,rotation:[...basis.rotation]};
}
function emit(sim,a,type,data){sim.emit?.(type,a.id,{...data,evidence:ADD_ANALYSIS_SKILLS_VERSION+'; static original native control, current Web simulation'});}
function endHandle(sim,a,id,reason){
 const e=effect(sim,id);if(e){e.dead=true;e.endReason=reason;e.suppressSecondaryDamage=true;}
 // Pure display handles can already have left the collision list.
 sim.emit?.('effectEnded',a.id,{effectId:id,reason});
}
function clear(sim,a,kind,reason){
 const r=entry(sim,a,kind);if(!r)return;
 for(const id of r.handles)endHandle(sim,a,id,reason);
 a.sourceAddNative=registry(sim,a).filter(row=>row!==r);
}
function born(sim,a,name,position,options={}){
 if(!sim.profileFor(a).damageEffects[name]&&!sim.profileFor(a).effectTemplates[name]){
  sim.note?.('add-analysis-root:'+name,'Recovered original root has not yet entered the sealed asset closure',a);return null;
 }
 const birth=anchor(sim,a,position);
 // These recovered roots receive an explicit world-space release point:
 // Starfall's placed carrier/selected-target blast, or Chaser's Bip01 shot.
 // Keep that birth intent when an independent network birth arrives after
 // the caster entered another state. This carries no live collider clock.
 if([STARFALL_CARRIER,'DAMAGE_EFFECT_Star_Fall_Explode',CHASER_ATTACKER,'DamageEffect_ATT_Stardust_Shower_Rupture','Mesh_ATT_Stardust_Shower_Drop','DamageEffect_ATT_Stardust_Shower_Ball'].includes(name))birth.customPosition=true;
 return sim.createEffect(a,{NAME:name},{birthAnchor:birth,...options});
}
function setAtTarget(sim,a,name,target,power){
 if(!sim.profileFor(a).effectSets[name]){sim.note?.('add-analysis-set:'+name,'Recovered original set has not yet entered the sealed asset closure',a);return [];}
 const first=sim.state.nextEffectId;
 sim.spawnSet({...a,skillScale:power},name,1);
 const ids=[];
 for(const e of sim.state.effects)if(e.id>=first&&e.ownerId===a.id){
  e.traceActorId=target.id;e.traceUnitDieDelete=true;e.powerMultiplier=power;ids.push(e.id);
 }
 return ids;
}
/** The original caller is known: ANSI_SA_AMM_INSTALLATION_STAR_FALL +38,
 * 32777b30 ->32761d10, animation threshold1.2. */
export function startAddStarfall(sim,a,{consumeMutation}={}){
 if(a.professionId!=='MM')return false;
 clear(sim,a,'starfall','add-starfall-replaced');
 const s=skill(sim,a,29016),duration=scalar(s,'SA_EFFECTIVE_TIME'),interval=scalar(s,'SA_COOLTIME_1'),max=scalar(s,'SA_MUTATION_CONSUME_MAX_COUNT');
 const variant=!!a.sourceAdd?.formation&&a.sourceAdd.mutation>=max;
 if(variant&&typeof consumeMutation!=='function'){
  sim.note?.('add-starfall-mutation-hook','Known three-point variant needs its atomic resource consumer',a);return false;
 }
 const basis=arcLineBasis(a,sim.map.lines),offset=variant?50:0,rows=[],handles=[],factoryActor=addInstallationFactoryActor2016(a);
 for(const [life,x]of variant?[[duration,offset],[f(duration*.5),-offset]]:[[duration,0]]){
  const position=[a.x,a.y,a.z].map((n,i)=>n+basis.direction[i]*x*a.facing);
  const e=born(sim,factoryActor,STARFALL_CARRIER,position);if(!e){for(const id of handles)endHandle(sim,a,id,'add-starfall-missing-carrier');return false;}
  handles.push(e.id);e.skillId=29016;
  rows.push({carrierId:e.id,remaining:f(life),interval:f(interval),reset:f(interval),lastTargetId:null,skipSame:false,attacking:false});
 }
 if(variant&&consumeMutation(a,max,{profile:sim.profileFor(a),emit:(...args)=>sim.emit?.(...args)})!==max){
  for(const id of handles)endHandle(sim,a,id,'add-starfall-mutation-unavailable');return false;
 }
 registry(sim,a).push({version:ADD_ANALYSIS_SKILLS_VERSION,ownerId:a.id,kind:'starfall',skillId:29016,group:a.stateSerial,power:factoryActor.skillScale,handles,rows});
 emit(sim,a,'addStarfallStarted',{carriers:rows.length,duration,interval,mutationSpent:variant?max:0});return true;
}
/** The exact external target-choice/distance helper remains an explicit
 * boundary. Tests may provide a source-recorded candidate; production must
 * declare its selected adapter rather than silently changing 1e6 to radius. */
export function tickAddStarfall(sim,a,dt,{selectTarget,attackCarrier}={}){
 const r=entry(sim,a,'starfall');if(!r)return;
 if(!ownerAlive(a)){clear(sim,a,'starfall','add-starfall-owner-ended');return;}
 if(!(dt>=0&&Number.isFinite(dt)))throw new TypeError('Invalid Add ANALYSIS elapsed');
 const remain=[];
 for(const row of r.rows){
  row.remaining=f(row.remaining-dt);
  if(row.remaining<0){endHandle(sim,a,row.carrierId,'add-starfall-expired');continue;}
  const carrier=effect(sim,row.carrierId);
  row.interval=f(row.interval-dt);
  if(row.interval>=0){
   if(carrier&&row.attacking&&row.interval<f(.05)){row.attacking=false;changeStarfallAnimation(sim,a,carrier,'Wait');}
  }else{
   row.interval=row.reset;
   if(typeof selectTarget!=='function')sim.note?.('add-starfall-selection','Original target distance/choice helper is not bound; no global attack fabricated',a);
   else{
    const target=selectTarget({sim,owner:a,carrier,lastTargetId:row.lastTargetId});
    if(enemy(a,target)){
     const same=target.id===row.lastTargetId;row.lastTargetId=target.id;
     if(same&&!row.skipSame)row.skipSame=true;
     else {
      if(same)row.skipSame=false;
      if(carrier&&typeof attackCarrier==='function'){
       attackCarrier({sim,owner:a,carrier,target,power:r.power,skillId:r.skillId});row.attacking=true;
       changeStarfallAnimation(sim,a,carrier,'Attack',target.id);
      }else if(carrier)sim.note?.('add-starfall-carrier-attachment','Original carrier/target attachment is not bound; no owner-position attack fabricated',a);
     }
    }
   }
  }
  remain.push(row);
 }
 r.rows=remain;r.handles=remain.map(row=>row.carrierId);
 if(!remain.length)clear(sim,a,'starfall','add-starfall-ended');
}
/** ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER +38, .4 animation threshold,
 * 32778da0->32766960. The attacker itself is NO_DAMAGE. */
export function startAddShootingChaser(sim,a){
 if(a.professionId!=='MM')return false;
 clear(sim,a,'chaser','add-chaser-replaced');
 const position=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:sim.profileFor(a)})?.position;
 if(!vector(position)){sim.note?.('add-chaser-original-bone','Original Bip01 is required for the attacker; no origin substitution',a);return false;}
 const factoryActor=addInstallationFactoryActor2016(a),e=born(sim,factoryActor,CHASER_ATTACKER,position);if(!e)return false;e.skillId=29018;
 const initialRange=sim.profileFor(a).damageEffects[CHASER_ATTACKER].raw.LOCK_ON_DATA.PVP_TARGET_RANGE_MIN_MAX;
 const initialTarget=sim.state.actors.map((b,index)=>({b,index,distance:Math.hypot(b.x-position[0],b.y-position[1],b.z-position[2])}))
  .filter(({b,distance})=>enemy(a,b)&&!b.invincible&&!(b.forceInvincible>0)&&!b.invulnerable&&distance>initialRange['1']&&distance<initialRange['2'])
  .sort((x,y)=>x.distance-y.distance||x.index-y.index)[0]?.b;
 const direction=arcLineBasis(a,sim.map.lines).direction.map(n=>f(n*a.facing*180/Math.PI));
 registry(sim,a).push({version:ADD_ANALYSIS_SKILLS_VERSION,ownerId:a.id,kind:'chaser',skillId:29018,group:a.stateSerial,power:factoryActor.skillScale,
  handles:[e.id],attackerId:e.id,remaining:f(1),records:[],targetId:initialTarget?.id??null,unlockRemaining:f(.15),manualDirDegree:direction,previousTargetIds:[],stoppedDirSpeed:null});
 emit(sim,a,'addChaserStarted',{effectId:e.id,retainSeconds:1});return true;
}
/** Invoke from the actual matching effect's contact callback BEFORE HP
 * acceptance/reaction. Counting HP hits would incorrectly omit NO_DAMAGE and
 * contacts whose reaction is suppressed. This function does not apply damage. */
export function addShootingChaserContact(sim,a,target,effectRecord,impactPoint){
 const r=entry(sim,a,'chaser');
 if(!r||!(r.remaining>0)||effectRecord?.id!==r.attackerId||effectRecord?.ownerId!==a.id||effectRecord?.name!==CHASER_ATTACKER||!enemy(a,target)||!vector(impactPoint))return false;
 const old=r.records.find(row=>row.targetId===target.id);
 if(old)old.count++;
 else r.records.push({targetId:target.id,count:1,position:[...impactPoint]});
 r.previousTargetIds=r.previousTargetIds.filter(id=>id!==target.id);r.previousTargetIds.push(target.id);
 if(r.targetId===target.id)r.targetId=null;
 emit(sim,a,'addChaserContactRecorded',{effectId:effectRecord.id,targetId:target.id,count:old?.count??1});return true;
}
export function tickAddShootingChaser(sim,a,dt){
 const r=entry(sim,a,'chaser');if(!r)return;
 if(!ownerAlive(a)){clear(sim,a,'chaser','add-chaser-owner-ended');return;}
 if(!(dt>=0&&Number.isFinite(dt)))throw new TypeError('Invalid Add ANALYSIS elapsed');
 r.remaining=f(r.remaining-dt);if(r.remaining>0)return;
 let units=0;const remaining=[...r.records];
 const allocate=(row,amount)=>{
  const target=sim.state.actors.find(b=>b.id===row.targetId);if(!enemy(a,target))return;
  const name=CHASER_SETS[amount-1];
  setAtTarget(sim,{...a,skillId:29018,skillContext:{traitPolicy:effect(sim,r.attackerId)?.traitPolicy}},name,target,f(r.power*amount));
  emit(sim,a,'addChaserAllocated',{targetId:target.id,units:amount,setName:name,power:f(r.power*amount)});
 };
 for(const row of [...remaining]){
  if(units>=4)break;
  if(row.count<1||row.count>4)continue;
  const amount=Math.min(row.count,4-units);allocate(row,amount);
  units+=amount;remaining.splice(remaining.indexOf(row),1);
 }
 //32775100 copies the FIRST residual record, even when its count>=5.
 // Accepted1..4 records are consumed whole; a clipped count is never requeued.
 if(units<4&&remaining.length)allocate(remaining[0],4-units);
 clear(sim,a,'chaser','add-chaser-retain-ended');
}
/** Target +28 initialization; the actual old-record +58 exit below activates
 * the shower, including interruption and accepted same-state reentry. */
export function initializeAddStardust(sim,a,{consumeMutation}={}){
 if(a.professionId!=='DE')return false;
 // The original overwrites controller handles without a replacement cleanup.
 // Old instances keep their own authored lifetimes; never retire them here.
 a.sourceAddNative=registry(sim,a).filter(row=>row.kind!=='stardust');
 const s=skill(sim,a,29021),base=scalar(s,'SA_EFFECTIVE_TIME'),per=scalar(s,'SA_DAMAGE_TIME');
 let spent=0;
 if(a.sourceAdd?.formation&&a.sourceAdd.mutation>0){
  if(typeof consumeMutation!=='function'){sim.note?.('add-stardust-mutation-hook','Original duration mutation needs its resource consumer',a);return false;}
  spent=consumeMutation(a,3,{profile:sim.profileFor(a),emit:(...args)=>sim.emit?.(...args)});
 }
 const position=[a.x,a.y+700,a.z],e=born(sim,a,'DamageEffect_ATT_Stardust_Shower_Rupture',position);if(!e)return false;e.skillId=29021;
 registry(sim,a).push({version:ADD_ANALYSIS_SKILLS_VERSION,ownerId:a.id,kind:'stardust',skillId:29021,group:a.stateSerial,power:a.skillScale,
  handles:[e.id],ruptureId:e.id,carrierId:null,attackIds:[],remaining:f(base+f(spent*per)),accumulator:f(1),nextNode:1,
  active:false,position:[a.x,a.y,a.z],rotation:anchor(sim,a,[a.x,a.y,a.z]).rotation});
 emit(sim,a,'addStardustInitialized',{duration:f(base+f(spent*per)),mutationSpent:spent});return true;
}
export function activateAddStardust(sim,a){
 const r=entry(sim,a,'stardust');if(!r||r.active)return false;
 const e=born(sim,a,'Mesh_ATT_Stardust_Shower_Drop',[a.x,a.y+700,a.z]);if(!e)return false;
 const first=sim.state.nextEffectId;
 sim.spawnSet({...a,skillId:29021,skillScale:r.power},'EffectSet_ATT_Stardust_Shower_Attack',1);
 r.attackIds=sim.state.effects.filter(e=>e.id>=first&&e.ownerId===a.id).map(e=>e.id);
 r.carrierId=e.id;r.handles.push(e.id,...r.attackIds);r.active=true;return true;
}
export function endAddStardust(sim,a){
 if(a.professionId==='DE'&&sim.profileFor(a).states[a.state]?.sourceState==='ANSI_SA_ATT_STARDUST_SHOWER')activateAddStardust(sim,a);
}
export function tickAddStardust(sim,a,dt){
 const r=entry(sim,a,'stardust');if(!r)return;
 if(!ownerAlive(a)){clear(sim,a,'stardust','add-stardust-owner-ended');return;}
 if(!r.active)return;
 if(!(dt>=0&&Number.isFinite(dt)))throw new TypeError('Invalid Add ANALYSIS elapsed');
 r.remaining=f(r.remaining-dt);
 if(r.remaining<=0){
  const original={...a,x:r.position[0],y:r.position[1],z:r.position[2],skillId:29021,skillScale:r.power};
  sim.spawnSet(original,'EffectSet_ATT_Stardust_Shower_End',1);
  clear(sim,a,'stardust','add-stardust-duration-ended');return;
 }
 r.accumulator=f(r.accumulator+dt);
 if(r.accumulator<f(.1))return;
 r.accumulator=0;
 const carrier=effect(sim,r.carrierId);if(!carrier)return;
 const bone='spwan_Dummy0'+r.nextNode;r.nextNode=r.nextNode<10?r.nextNode+1:1;
 const position=sim.effectBoneSampler?.(carrier,a,bone);
 if(!vector(position)){sim.note?.('add-stardust-original-node:'+bone,'Original carrier world node is required; no local translation used as world position',a);return;}
 const e=born(sim,{...a,skillId:29021,skillScale:r.power},'DamageEffect_ATT_Stardust_Shower_Ball',position);
 if(e)emit(sim,a,'addStardustBallCreated',{effectId:e.id,node:bone,position:[...position]});
}
export function isAddNativeOwnedEffect(sim,a,e){return (a.sourceAddNative??[]).some(row=>row.ownerId===a.id&&row.handles.includes(e.id));}
export function clearAddNativeSkills(sim,a,reason='add-analysis-owner-ended'){for(const kind of ['starfall','chaser','stardust'])clear(sim,a,kind,reason);}
export function tickAddNativeSkills(sim,a,dt){
 tickAddStarfall(sim,a,dt,{selectTarget:selectAddStarfallTarget,attackCarrier:attackAddStarfallCarrier});
 tickAddShootingChaser(sim,a,dt);
 tickAddStardust(sim,a,dt);
}

function changeStarfallAnimation(sim,a,carrier,name,targetId){
 const template=sim.profileFor(a).effectTemplates[carrier.mainEffectName??'ADD_Star_Fall_Attack_Mesh_Start'];
 if(!template?.animationClips?.some(c=>c.name===name)){
  sim.note?.('add-starfall-original-animation:'+name,'Original carrier animation is required; no substitute clip',a);return;
 }
 if(carrier.sourceShadowMesh){carrier.sourceShadowMesh.animationName=name;carrier.sourceShadowMesh.animationPlayback='XAP_LOOP';carrier.sourceShadowMesh.animationTime=0;}
 carrier.initialAnimationName=name;carrier.initialAnimationPlayback='XAP_LOOP';carrier.animationTime=0;
 emit(sim,a,'addStarfallCarrierAnimation',{effectId:carrier.id,animation:name,...(targetId?{targetId}:{})});
}
/** The source helper31c6e880 is proven squared vec3 distance. Its caller
 * compares <=1e6, excludes the preceding target from the random candidate
 * vector and retains that preceding target as fallback when the vector is
 * empty. CRT rand()%N is proved; the source TLS seed/call chronology is not.
 * sim.rng owns the explicit Web deterministic seed adapter. The original
 * state0/100/virtual164 filter uses this project's declared live-enemy policy.
 */
export function selectAddStarfallTarget({sim,owner,lastTargetId}){
 const candidates=sim.state.actors.filter(b=>{
  if(!enemy(owner,b)||b.hidden||b.pvpPresentation||b.invincible||b.forceInvincible>0||b.invulnerable||b.pvpInvincibleRemaining>0)return false;
  const d=[b.x-owner.x,b.y-owner.y,b.z-owner.z].map(f);
  return f(d.reduce((sum,n)=>sum+n*n,0))<=1000000;
 });
 const fresh=candidates.filter(b=>b.id!==lastTargetId);
 if(!fresh.length)return candidates.find(b=>b.id===lastTargetId)??null;
 if(typeof sim.rng!=='function'){sim.note?.('add-starfall-rng','Explicit snapshot-owned Web RNG seed adapter is required',owner);return null;}
 const random=sim.rng();if(!Number.isFinite(random)||random<0||random>=1)throw new TypeError('Invalid Starfall deterministic seed adapter result');
 return fresh[Math.floor(random*32768)%fresh.length];
}
/** Attack display binds to the specific live carrier; lock/ground payloads
 * bind to the selected target's original posed bone and authored line solver.
 * Bip01 is the explicit Web body-anchor adapter: native dynamic bodypart-string
 * assembly/ground projection is not mislabelled as fully recovered here.
 */
export function attackAddStarfallCarrier({sim,owner:a,carrier,target,power,skillId=29016}){
 if(!enemy(a,target))return false;
 const p=sim.profileFor(a),position=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},target,{profile:sim.profileFor(target)})?.position;
 if(!vector(position)){sim.note?.('add-starfall-target-bone','Original posed target bone unavailable; no owner-position blast fabricated',a);return false;}
 setAtTarget(sim,{...a,skillId},'EffectSet_SI_SA_AMM_Installation_Star_Fall_LockOn',target,power);
 const first=sim.state.nextEffectId;
 sim.spawnSet({...a,skillId,skillScale:power},STARFALL_ATTACK_SET,1);
 const mesh=sim.state.effects.find(e=>e.id>=first&&e.ownerId===a.id&&e.name===STARFALL_ATTACK_MESH);
 const source=carrier.currentAnchor??carrier.birthAnchor;
 if(mesh&&source?.position){mesh.birthAnchor=structuredClone(source);mesh.currentAnchor=structuredClone(source);[mesh.x,mesh.y,mesh.z]=source.position;}
 const ground=sim.nativeGeometry?.land?.({position:[...position],radius:p.referenceSemantics.lineRadius,lastLineId:target.lastTouchLineId??target.lineId});
 const blastPosition=ground?.found?[position[0],ground.point[1],position[2]]:position;
 const e=born(sim,{...a,skillId,skillScale:power},'DAMAGE_EFFECT_Star_Fall_Explode',blastPosition);
 if(e){e.skillId=skillId;emit(sim,a,'addStarfallAttackCreated',{effectId:e.id,carrierId:carrier.id,targetId:target.id,position:[...blastPosition],anchorPolicy:'Web original posed Bip01 + native authored-line land adapter'});}
 return !!e;
}

/** LOT6's original PvP0..550 range, .15 unlock and curve30 are declared.
 * This Web candidate selects nearest eligible current bodies deterministically;
 * the native vector steering kernel is retained. It is not a claim that the
 * native external selector used this tie-break or all invulnerability states.
 * Invoke after the original mesh movement to orient the NEXT movement packet.
 */
export function advanceAddChaserProjectile(sim,e,a,dt){
 const r=entry(sim,a,'chaser');
 if(!r||e.id!==r.attackerId||e.name!==CHASER_ATTACKER||!e.sourceShadowMesh||!(dt>0))return false;
 const raw=sim.profileFor(a).damageEffects[CHASER_ATTACKER]?.raw.LOCK_ON_DATA;
 if(raw?.LOCK_ON_TYPE!==6||raw.TIME_UNLOCK_FROM_START!==.15||raw.CURVE_SPEED!==30)throw new TypeError('Missing target Chaser lock-on declaration');
 if(r.unlockRemaining>0){r.unlockRemaining=Math.max(0,f(r.unlockRemaining-dt));return true;}
 const mesh=e.sourceShadowMesh,range=raw.PVP_TARGET_RANGE_MIN_MAX;
 const candidates=sim.state.actors.map((b,index)=>({b,index,distance:Math.hypot(b.x-mesh.position[0],b.y-mesh.position[1],b.z-mesh.position[2])}))
  .filter(({b,distance})=>enemy(a,b)&&!b.invincible&&!(b.forceInvincible>0)&&!b.invulnerable&&!r.previousTargetIds.includes(b.id)&&distance>range['1']&&distance<range['2'])
  .sort((x,y)=>x.distance-y.distance||x.index-y.index);
 const target=candidates.find(row=>row.b.id===r.targetId)?.b??candidates[0]?.b;
 r.targetId=target?.id??null;
 if(!target){
  if(raw.NOT_TARGET_PRE_LOCK_ON_TARGET===1)r.previousTargetIds=[]; // Empty pool clears; no same-call retry.
  if(raw.NOT_FIND_TARGET_MOVE_STOP===1){r.stoppedDirSpeed??=mesh.dirSpeed;mesh.dirSpeed=0;mesh.velocity=[0,0,0];}
  return true;
 }
 if(r.stoppedDirSpeed!==null){mesh.dirSpeed=r.stoppedDirSpeed;r.stoppedDirSpeed=null;}
 const kernel=sim.skillsFor?.(a)??sim.nativeSkills;
 if(!kernel?.vectorLockOn){sim.note?.('add-chaser-vector-kernel','Original vector steering kernel unavailable; no guessed homing curve',a);return true;}
 const point=nearestLockOnPoint(sim.defenderSampler?.(target,{profile:sim.profileFor(target),role:'defender'}),[a.x,a.y,a.z],[target.x,target.y,target.z]);
 r.manualDirDegree=kernel.vectorLockOn({position:mesh.position,manualDirDegree:r.manualDirDegree,targetPosition:point,curveSpeed:raw.CURVE_SPEED,dt}).manualDirDegree;
 orientLiteralMesh(mesh,r.manualDirDegree.map(n=>f(n*f(Math.PI/180))));return true;
}

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const bounded=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const text=n=>typeof n==='string'&&n.length>0&&n.length<=128;
const exact=(o,names)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===names.length&&names.every(n=>Object.hasOwn(o,n));
const boundedVector=(v,limit)=>vector(v)&&v.every(n=>Math.abs(n)<=limit);
/** Strict owner-wire shape. Source handles refer only to the owner's known
 * effects; the outer protocol performs that roster/reference check. */
export function validateAddNativeState(value,{owner,profile,actors}={}){
 if(!Array.isArray(value)||value.length>3||new Set(value.map(r=>r?.kind)).size!==value.length)throw new TypeError('Invalid Add ANALYSIS controller list');
 for(const r of value){
  const base=['version','ownerId','kind','skillId','group','power','handles'];
  const fields=r?.kind==='starfall'?['rows']:r?.kind==='chaser'?['attackerId','remaining','records','targetId','unlockRemaining','manualDirDegree','previousTargetIds','stoppedDirSpeed']:
   r?.kind==='stardust'?['ruptureId','carrierId','attackIds','remaining','accumulator','nextNode','active','position','rotation']:null;
  if(!fields||!exact(r,[...base,...fields])||r.version!==ADD_ANALYSIS_SKILLS_VERSION||!text(r.ownerId)||!integer(r.group)||!bounded(r.power,0,100)||
   !Array.isArray(r.handles)||r.handles.length>64||new Set(r.handles).size!==r.handles.length||!r.handles.every(integer)||
   owner&&(owner.id!==r.ownerId||owner.professionId!==(r.kind==='stardust'?'DE':'MM'))||
   r.skillId!==({starfall:29016,chaser:29018,stardust:29021})[r.kind]||profile&&!profile.skillCatalog?.some(s=>s.skillId===r.skillId))throw new TypeError('Invalid Add ANALYSIS controller');
  const target=id=>id===null||text(id)&&(!actors||actors.some(b=>b.id===id&&b.id!==r.ownerId&&(!owner||b.team!==owner.team)));
  if(r.kind==='starfall'){
   if(!Array.isArray(r.rows)||r.rows.length>2||new Set(r.rows.map(q=>q?.carrierId)).size!==r.rows.length||r.handles.length!==r.rows.length||!r.rows.every(q=>exact(q,['carrierId','remaining','interval','reset','lastTargetId','skipSame','attacking'])&&integer(q.carrierId)&&r.handles.includes(q.carrierId)&&bounded(q.remaining,0,7.400001)&&bounded(q.interval,0,.500001)&&q.reset===f(.5)&&target(q.lastTargetId)&&typeof q.skipSame==='boolean'&&typeof q.attacking==='boolean'))throw new TypeError('Invalid Starfall controller');
  }else if(r.kind==='chaser'){
   if(!integer(r.attackerId)||r.handles.length!==1||!r.handles.includes(r.attackerId)||!bounded(r.remaining,0,1)||!bounded(r.unlockRemaining,0,.150001)||!boundedVector(r.manualDirDegree,360)||!target(r.targetId)||r.stoppedDirSpeed!==null&&!bounded(r.stoppedDirSpeed,0,1e6)||
    !Array.isArray(r.records)||r.records.length>16||new Set(r.records.map(x=>x?.targetId)).size!==r.records.length||!r.records.every(q=>exact(q,['targetId','count','position'])&&target(q.targetId)&&q.targetId!==null&&integer(q.count)&&q.count>=1&&q.count<=65535&&boundedVector(q.position,1e7))||
    !Array.isArray(r.previousTargetIds)||r.previousTargetIds.length>16||new Set(r.previousTargetIds).size!==r.previousTargetIds.length||!r.previousTargetIds.every(id=>target(id)&&id!==null))throw new TypeError('Invalid Chaser controller');
  }else if(!integer(r.ruptureId)||!r.handles.includes(r.ruptureId)||r.carrierId!==null&&!integer(r.carrierId)||!Array.isArray(r.attackIds)||!r.attackIds.every(id=>integer(id)&&r.handles.includes(id))||!bounded(r.remaining,0,3.500001)||!bounded(r.accumulator,0,1)||!integer(r.nextNode)||r.nextNode<1||r.nextNode>10||typeof r.active!=='boolean'||!boundedVector(r.position,1e7)||!boundedVector(r.rotation,36000))throw new TypeError('Invalid Stardust controller');
 }
 return true;
}
