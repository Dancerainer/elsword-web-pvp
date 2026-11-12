/** Raven Web lifecycle adapter. Version 1 retains its RF-only contract;
 * version 2 shares the identical frozen RF/BM/VC damage and carrier.
 * Frozen damage/geometry remain local;
 * events install the existing live collider, never a second hit executor. */
export const CONTINUOUS_AURA_VERSION=2;
export const CONTINUOUS_AURA_NAME='RAVEN_HYPER_AURA';
export const CONTINUOUS_AURA_SET='EffectSet_RAVEN_HYPER_AURA';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const ravenProfessions=new Map([[107,'RF'],[106,'BM'],[115,'VC']]);
// These are the complete source declarations, not a newly authored attack.
// Canonical source hashes are checked against all three frozen profiles by
// continuous-aura-raven-v11.test.mjs. Provenance metadata may differ by profile.
const ravenAuraSet={NAME:'EffectSet_RAVEN_HYPER_AURA',
  EFFECT0:{BONE_NAME:'Bip01',NAME:'RAVEN_HYPER_AURA',EFFECT_TYPE:1,TRACE:1},
  EFFECT1:{BONE_NAME:'Bip01',NAME:'raven_powrUp_01',EFFECT_TYPE:8,TRACE:1},
  EFFECT2:{NAME:'raven_powrUp_02',START_TIME:.5,BONE_NAME:'Bip01',EFFECT_TYPE:8,TRACE:1},
  EFFECT3:{BONE_NAME:'Bip01',NAME:'raven_powrUp_03',EFFECT_TYPE:8,TRACE:1},
  EFFECT4:{BONE_NAME:'Bip01',NAME:'raven_powrUp_04',EFFECT_TYPE:8,TRACE:1}};
const ravenAuraDamage={DAMAGE_TIME:9999,MAIN_EFFECT_NAME:'Raven_Aura',EFFECT_TYPE:1,
  ATTACKED_BY_UNIT:0,ATTACKED_BY_EFFECT:0,REFLECT:0,
  DAMAGE_DATA:{PVP_RATE:.5,STOP_TIME_ATT:0,CAMERA_CRASH_GAP:0,TECH_POINT:63,CAMERA_CRASH_TIME:0,
    CLEAR_SCREEN:0,HIT_GAP:2.5,STOP_TIME_DEF:0,DAMAGE_TYPE:2,ATTACK_TYPE:1,HIT_TYPE:23,
    REACT_TYPE:7,DAMAGE:{PHYSIC:2.5,MAGIC:2.5},RE_ATTACK:1,ONLY_BASIC:1},
  HIT_PARTICLE0:{PARTICLE_NAME:'raven_powrUp_hit_01',POSITION_TYPE:2},
  HIT_PARTICLE1:{PARTICLE_NAME:'raven_powrUp_hit_02',POSITION_TYPE:2}};
const ravenAuraTemplate={kind:'mesh',
  initialSize:[6,6,6],initialAnimation:{name:'Normal',playback:'XAP_LOOP'},initialVelocity:[0,0,0],
  missingExplicitTickRate:false,
  fields:{MeshName:'DummyAttackBox_50x50x50.X',LifeType:'LT_TIME',MeshType:'X_SKIN_MESH',BillBoardType:'BT_NONE',
    SourceBlendMode:'D3DBLEND_SRCALPHA',DestBlendMode:'D3DBLEND_INVSRCALPHA',Layer:14,LifeTime:99999,DrawCount:0},
  events:[{property:'Color',start:0,end:0,fade:false,value:[0,0,0,0]},
    {property:'AniName',start:0,end:0,fade:false,value:{animation:'Normal',playback:'XAP_LOOP'}},
    {property:'Velocity',start:0,end:0,fade:false,value:[0,0,0]},
    {property:'Size',start:0,end:0,fade:false,value:[6,6,6]}],
  repeated:{},unsupported:[],animationMissingTickRate:false,
  animationClips:[{name:'Normal',durationSeconds:0.06666667014360428,nativePlaybackField:0,ticksPerSecond:4800,warnings:[],trackWarnings:[]}],
  animationRequiresUnconfirmedRate:false,initialDirSpeed:null};
const ravenAuraTemplateEntries=Object.entries(ravenAuraTemplate);
// BM/VC refer to the RF-owned exported pose/mesh. Their generated templates
// deliberately omit RF's redundant archive/helper/literal metadata; the
// actual mesh declaration and all animation/collision semantics stay exact.
const ravenAuraBindings=new Map([[107,{poseData:'fx/meshes/DummyAttackBox_50x50x50.pose.json',glb:'fx/meshes/DummyAttackBox_50x50x50.glb',
  meshName:'DummyAttackBox_50x50x50.X',helperNames:['ATTACK_SPHERE1'],drawCountLiteral:'0',lifeTimeLiteral:'99999',unsupportedPoseTracks:[]}],
  ...[106,115].map(unitClass=>[unitClass,{poseData:'../rf/fx/meshes/DummyAttackBox_50x50x50.pose.json',glb:'../rf/fx/meshes/DummyAttackBox_50x50x50.glb',
    meshName:undefined,helperNames:undefined,drawCountLiteral:undefined,lifeTimeLiteral:undefined,unsupportedPoseTracks:undefined}])]);
const sourceContracts=new WeakMap(),effectContracts=new WeakMap();
/** Production profiles and their raw/template declarations are immutable.
 * A different raw or template reference (including a test fixture replacement)
 * invalidates this cache. Do not deep-walk identical source data each frame. */
function sourceContract(profile){
  const set=profile.effectSets?.[CONTINUOUS_AURA_SET]?.raw,damage=profile.damageEffects?.[CONTINUOUS_AURA_NAME]?.raw;
  const template=profile.effectTemplates?.Raven_Aura,unitClass=profile.target.unitClass,old=sourceContracts.get(profile);
  if(old&&old.set===set&&old.damage===damage&&old.template===template&&old.unitClass===unitClass)return old.valid;
  const valid=sameSource(set,ravenAuraSet)&&sameSource(damage,ravenAuraDamage)&&
    !!template&&ravenAuraTemplateEntries.every(([key,value])=>sameSource(template[key],value))&&
    Object.entries(ravenAuraBindings.get(unitClass)).every(([key,value])=>sameSource(template[key],value));
  sourceContracts.set(profile,{set,damage,template,unitClass,valid});return valid;
}
/** Aura definitions and raw damage are declaration clones. The execution
 * changes clocks/hit receipts, not these declarations. Each new clone or
 * replacement reference is checked before it can use the cached contract. */
function effectContract(effect){
  const definition=effect.definition,damage=effect.damage,old=effectContracts.get(effect);
  if(old&&old.definition===definition&&old.damage===damage)return old.valid;
  const valid=(definition===undefined||sameSource(definition,ravenAuraSet.EFFECT0))&&
    (damage===undefined||sameSource(damage,ravenAuraDamage));
  effectContracts.set(effect,{definition,damage,valid});return valid;
}
function sameSource(actual,expected){
  if(actual===expected)return true;
  if(!actual||!expected||typeof actual!=='object'||typeof expected!=='object'||Array.isArray(actual)!==Array.isArray(expected))return false;
  const keys=Object.keys(expected);
  return Object.keys(actual).length===keys.length&&keys.every(key=>Object.hasOwn(actual,key)&&sameSource(actual[key],expected[key]));
}
function auraCarrier(effect){
  return effect?.name===CONTINUOUS_AURA_NAME&&effect.setName===CONTINUOUS_AURA_SET&&
    (effect.definitionMember===undefined||effect.definitionMember==='EFFECT0')&&
    effect.sourceProfessionId===undefined&&effect.parentEffectId==null&&
    !effect.sourceShadowMesh&&!effect.sourceArcHandle&&!effect.sourceSetTargetMesh&&
    effect.sourceAddSummonSerial===undefined&&effect.sourceReflected===undefined&&effect.sourceBoneEffectSetId===undefined;
}
export function isRFContinuousAura(effect,profile){
  const definition=profile?.effectSets?.[CONTINUOUS_AURA_SET]?.raw?.EFFECT0;
  const damage=profile?.damageEffects?.[CONTINUOUS_AURA_NAME]?.raw;
  return profile?.target?.unitClass===107&&profile.target.unitType===4&&
    auraCarrier(effect)&&
    definition?.NAME===CONTINUOUS_AURA_NAME&&definition.TRACE===1&&
    damage?.MAIN_EFFECT_NAME==='Raven_Aura'&&damage.DAMAGE_DATA?.REACT_TYPE===7&&damage.DAMAGE_DATA.RE_ATTACK===1&&damage.DAMAGE_DATA.HIT_GAP===2.5;
}
export function isContinuousRavenAura(effect,profile,version=2){
  if(version===1)return isRFContinuousAura(effect,profile);
  if(version!==2||profile?.target?.unitType!==4||!ravenProfessions.has(profile.target.unitClass)||!auraCarrier(effect))return false;
  return (effect.mainEffectName===undefined||effect.mainEffectName==='Raven_Aura')&&
    sourceContract(profile)&&effectContract(effect);
}
export function isManagedContinuousAura(effect,actor){
  const version=effect?.sourceContinuousAura?.version;
  return effect?.name===CONTINUOUS_AURA_NAME&&effect.setName===CONTINUOUS_AURA_SET&&
    (version===1&&(!actor||actor.professionId==='RF')||version===2&&(!actor||['RF','BM','VC'].includes(actor.professionId)));
}
export function validateContinuousAuraMarker(effect,profile){
  const value=effect?.sourceContinuousAura;if(value===undefined)return true;
  if(!plain(value)||Object.keys(value).some(k=>!['version','revision','phase'].includes(k))||![1,2].includes(value.version)||
    !integer(value.revision)||value.revision<1||!['active','ended'].includes(value.phase)||
    effect.name!==CONTINUOUS_AURA_NAME||effect.setName!==CONTINUOUS_AURA_SET||
    value.phase==='active'&&(effect.dead===true||effect.active!==true)||
    value.phase==='ended'&&(effect.dead!==true||effect.active!==false)||profile&&!isContinuousRavenAura(effect,profile,value.version))
    throw new TypeError('invalid-owner-continuous-aura');
  return true;
}
export function setContinuousAuraVersion(simulation,version){
  if(![0,1,2].includes(version))throw new TypeError('invalid-continuous-aura-version');
  if(simulation.continuousAuraVersion!==version){if(simulation.continuousAuraVersion!==undefined||version===0){delete simulation.state.continuousAuraReceipts;delete simulation.state.continuousAuraRetirementFrames;delete simulation.state.continuousAuraAbsenceFrames;}
    if(version===0){
      for(const effect of simulation.state.effects)if(isManagedContinuousAura(effect)&&effect.active&&!effect.endEmitted)
        simulation.emit?.('effectEnded',effect.ownerId,{effectId:effect.id,name:effect.name,setName:effect.setName,reason:'continuous-aura-mode-ended'});
      simulation.state.effects=simulation.state.effects.filter(effect=>!isManagedContinuousAura(effect));
    }}
  simulation.continuousAuraVersion=version;
}
function receipts(simulation){return simulation.state.continuousAuraReceipts??=[];}
function rowFor(simulation,ownerId,epoch,effectId){return receipts(simulation).find(row=>row.ownerId===ownerId&&row.epoch===epoch&&row.effectId===effectId);}
export function hasNewerContinuousAuraPhase(simulation,ownerId,epoch,frameSeq){
  return simulation.continuousAuraVersion>0&&receipts(simulation).some(row=>row.ownerId===ownerId&&row.epoch===epoch&&row.frameSeq>frameSeq);
}
export function retainNewerContinuousAura(simulation,ownerId,epoch,effect,frameSeq){
  const row=simulation.continuousAuraVersion>0?rowFor(simulation,ownerId,epoch,effect.networkId??effect.id):null;
  return row?.phase==='active'&&row.frameSeq>frameSeq;
}
export function clearContinuousAuraOwner(simulation,ownerId){
  if(simulation.state.continuousAuraReceipts)simulation.state.continuousAuraReceipts=simulation.state.continuousAuraReceipts.filter(row=>row.ownerId!==ownerId);
  if(simulation.state.continuousAuraRetirementFrames)delete simulation.state.continuousAuraRetirementFrames[ownerId];
  if(simulation.state.continuousAuraAbsenceFrames)delete simulation.state.continuousAuraAbsenceFrames[ownerId];
}
export function observeContinuousAuraAbsence(simulation,ownerId,epoch,frameSeq){
  if(!(simulation.continuousAuraVersion>0))return;
  const rows=simulation.state.continuousAuraAbsenceFrames??={},old=rows[ownerId];
  if(!old||old.epoch<epoch||old.epoch===epoch&&frameSeq>old.frameSeq)rows[ownerId]={epoch,frameSeq};
}
/** Authoritative full poses and reliable events share one terminal ledger.
 * A later active pose cannot resurrect an ended ID in the same life. */
export function acceptContinuousAuraState(simulation,ownerId,epoch,frameSeq,effect){
  if(!(simulation.continuousAuraVersion>0)||!effect.sourceContinuousAura)return true;
  if(effect.sourceContinuousAura.version!==simulation.continuousAuraVersion)return false;
  const marker=effect.sourceContinuousAura,id=effect.networkId??effect.id;
  let row=rowFor(simulation,ownerId,epoch,id);
  const retired=simulation.state.continuousAuraRetirementFrames?.[ownerId];
  if(!row&&retired?.epoch===epoch&&frameSeq<=retired.frameSeq)return false;
  const absent=simulation.state.continuousAuraAbsenceFrames?.[ownerId];
  if(marker.phase==='active'&&absent?.epoch===epoch&&frameSeq<=absent.frameSeq)return false;
  if(row&&(row.phase==='ended'&&marker.phase!=='ended'&&(!row.locallyExpired||marker.revision<=row.revision)||
    marker.revision<row.revision||marker.revision===row.revision&&frameSeq<row.frameSeq))return false;
  if(!row){row={ownerId,epoch,effectId:id,revision:marker.revision,phase:marker.phase,frameSeq};receipts(simulation).push(row);}
  else if(marker.phase==='ended'||marker.revision>row.revision||frameSeq>=row.frameSeq)
    Object.assign(row,{revision:marker.revision,phase:marker.phase,frameSeq:Math.max(frameSeq,row.frameSeq)});
  delete row.locallyExpired;
  // One Raven can have only one active aura. Evicted terminal IDs advance an
  // owner/life watermark so a very old reliable birth cannot resurrect them.
  const rows=receipts(simulation);
  for(let i=rows.length-1;i>=0;i--)if(rows[i].ownerId===ownerId&&rows[i].epoch<epoch)rows.splice(i,1);
  while(rows.length>128){const at=rows.findIndex(item=>item.phase==='ended');if(at<0)break;
    const [closed]=rows.splice(at,1),floors=simulation.state.continuousAuraRetirementFrames??={};
    const prior=floors[closed.ownerId];if(!prior||prior.epoch<closed.epoch||prior.epoch===closed.epoch&&prior.frameSeq<closed.frameSeq)
      floors[closed.ownerId]={epoch:closed.epoch,frameSeq:closed.frameSeq};}
  return true;
}
export function endContinuousAura(simulation,ownerId,epoch,effectId,frameSeq,revision,reason='continuous-aura-ended',{provisional=false}={}){
  if(!(simulation.continuousAuraVersion>0))return false;
  const old=rowFor(simulation,ownerId,epoch,effectId);
  if(old&&revision<old.revision)return false;
  if(old?.phase==='ended'&&(!old.locallyExpired||provisional&&revision<=old.revision))return false;
  if(!acceptContinuousAuraState(simulation,ownerId,epoch,frameSeq,{id:effectId,sourceContinuousAura:{version:simulation.continuousAuraVersion,revision,phase:'ended'}}))return false;
  if(provisional)rowFor(simulation,ownerId,epoch,effectId).locallyExpired=true;
  const ending=simulation.state.effects.filter(effect=>effect.ownerId===ownerId&&isManagedContinuousAura(effect)&&
    (effect.networkEpoch===undefined||effect.networkEpoch===epoch)&&(effect.networkId??effect.id)===effectId);
  for(const effect of ending){if(effect.active&&!effect.endEmitted)simulation.emit?.('effectEnded',ownerId,{effectId:effect.id,name:effect.name,setName:effect.setName,reason});
    effect.dead=true;effect.endEmitted=true;effect.endReason=reason;}
  const actor=simulation.state.actors.find(actor=>actor.id===ownerId),ids=new Set(ending.map(effect=>effect.id));
  if(actor?.sourceAwakeningAuraEffectGroup)actor.sourceAwakeningAuraEffectGroup=actor.sourceAwakeningAuraEffectGroup.filter(entry=>!ids.has(entry.id));
  simulation.state.effects=simulation.state.effects.filter(effect=>!ending.includes(effect));return true;
}
/** Only the changed victim life loses its old 2.5s receipt. Hit dictionaries
 * are shared with receiverHitMemory, so deleting their entries updates both. */
export function prepareContinuousAuraLives(simulation,epochFor){
  if(!(simulation.continuousAuraVersion>0))return;
  for(const effect of simulation.state.effects)if(isManagedContinuousAura(effect)){
    const actor=simulation.state.actors.find(a=>a.id===effect.ownerId);
    if(!actor||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected){
      const epoch=effect.networkEpoch??epochFor(effect.ownerId),id=effect.networkId??effect.id,row=rowFor(simulation,effect.ownerId,epoch,id);
      endContinuousAura(simulation,effect.ownerId,epoch,id,Math.max(effect.networkFrameSeq??0,actor?.networkFrameSeq??0,row?.frameSeq??0),
        Math.max(effect.sourceContinuousAura.revision,row?.revision??0)+1,'continuous-aura-owner-ended');continue;
    }
    if(!actor.awakening?.full||!(actor.awakening.remaining>0)){
      const epoch=effect.networkEpoch??epochFor(effect.ownerId),id=effect.networkId??effect.id,row=rowFor(simulation,effect.ownerId,epoch,id);
      endContinuousAura(simulation,effect.ownerId,epoch,id,Math.max(effect.networkFrameSeq??0,actor.networkFrameSeq??0,row?.frameSeq??0),
        effect.sourceContinuousAura.revision,'continuous-aura-local-phase-expired',{provisional:true});
      continue;
    }
    const lives=effect.networkAuraTargetLives??={};
    for(const target of simulation.state.actors){const epoch=epochFor(target.id);
      if(Object.hasOwn(lives,target.id)&&lives[target.id]!==epoch){delete effect.hits?.[target.id];delete effect.hitGaps?.[target.id];}
      lives[target.id]=epoch;
    }
  }
}
/** Stable birth definitions exclude mutable marker revisions. Both legacy
 * relay codecs carry the complete marker in their independently decoded patch. */
export function continuousAuraBaseline(effect){const value={...effect};delete value.sourceContinuousAura;return value;}
