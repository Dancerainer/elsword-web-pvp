/** Static registry + real producer/owner protocol audit. No client goldens. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {resolveEffectTemplateKey} from '../../packages/combat-assets/effect-template-key.mjs';
import {encodeOwnedState,validateOwnedReferences,MAX_OWNER_EFFECT_STAGE} from '../../packages/online/owned-state.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assetRoot=resolve(process.env.OWNER_AUDIT_ASSETS??resolve(root,'artifacts'));
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex');
const assetJson=p=>JSON.parse(readFileSync(resolve(assetRoot,p),'utf8'));
function visualRegistry(id){
  const folder=id.toLowerCase(),manifest=assetJson(folder+'/manifest.json');
  const paths=[manifest.effectAssetIndex??'effect-assets.json',...(id==='RF'?
    ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx'].map(p=>p+'/index.json'):
    manifest.visualEffectIndexes??['fx/index.json'])];
  const templates={};for(const p of paths)if(existsSync(resolve(assetRoot,folder,p)))Object.assign(templates,assetJson(folder+'/'+p).templates??{});
  return templates;
}
const profiles=Object.fromEntries(PROFESSION_IDS.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(PROFESSION_IDS.map(id=>[id,read(`config/${id.toLowerCase()}-preset.json`)]));
const map={...JSON.parse(readFileSync(resolve(assetRoot,'scene/sander-garpai-rock-pvp/manifest.json'))),
  ...JSON.parse(readFileSync(resolve(assetRoot,'scene/sander-garpai-rock-pvp/collision.json')))};
const result={schemaVersion:1,evidenceClass:'source-declarations-and-current-web-simulation',targetClientMeasured:false,
  maximumOwnerEffectStage:MAX_OWNER_EFFECT_STAGE,professions:[],dynamic:[],failures:[],limits:['No original-client dynamic traces, GPU rendering, or WAN play are measured by this tool.']};
function simulation(id,skillId=null,runtime={}){
  const preset={...presets[id],passives:[],guildPassives:[],loadout:[skillId?{skillId}:null,...Array(7).fill(null)]};
  const n=runtime.native;
  const s=createSimulation({profile:profiles[id],preset,commonBuffs:runtime.commonBuffs,map,seed:2016,
    actors:[{id:'owner',professionId:id,team:0,position:[-600,3080,0],lineId:2,facing:1,passives:[],guildPassives:[]},
      {id:'target',professionId:id,team:1,position:[-400,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
    ...(runtime.samplers??{}),...(n?{nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeNasod:n.nasod,
      nativeSkillValues:n.skillValues,nativeCritical:n.critical,nativeManaBreak:n.manaBreak}:{}),versions:runtime.versions??{}});
  s.actor('owner').mp=s.actor('owner').mpMax;return s;
}
function refs(s,p){validateOwnedReferences(p,s.actor('owner'),s.profileFor(s.actor('owner')),map,{profiles:s.profiles,actors:s.state.actors});}
for(const id of PROFESSION_IDS){
  const profile=profiles[id],sim=simulation(id),a=sim.actor('owner'),visualTemplates=visualRegistry(id);
  const row={professionId:id,profileSha256:hash(`packages/combat-core/${id.toLowerCase()}-profile.json`),
    effectSets:Object.keys(profile.effectSets).length,effectMembers:0,hyperMembers:0,damageEffects:Object.keys(profile.damageEffects).length,
    templates:Object.keys(profile.effectTemplates).length,visualAssetTemplates:Object.keys(visualTemplates).length,registeredMembers:0,visualOnlyReferences:[],missingReferences:[],unsupportedMainEffects:[],stages:[],ownerSnapshots:0,errors:[]};
  for(const [setName,set]of Object.entries(profile.effectSets))for(const [member,definition]of Object.entries(set.raw))if(/^EFFECT\d+$/.test(member)){
    row.effectMembers++;
    for(const [field,name]of [['NAME',definition.NAME],['HYPER_NAME',definition.HYPER_NAME]]){
      if(name===undefined)continue;if(field==='HYPER_NAME')row.hyperMembers++;
      const key=resolveEffectTemplateKey(profile.effectTemplates,name,definition.EFFECT_TYPE);
      if(key!==null&&(profile.damageEffects[name]||profile.effectTemplates[key]))row.registeredMembers++;
      else {
        const entry={setName,member,field,name,effectType:definition.EFFECT_TYPE,reason:key===null?'wrong-template-registry':'not-in-profile-registry'};
        const visualKey=resolveEffectTemplateKey(visualTemplates,name,definition.EFFECT_TYPE);
        if(visualKey!==null&&visualTemplates[visualKey])row.visualOnlyReferences.push(entry);
        else row.missingReferences.push(entry);
      }
    }
  }
  for(const [name,definition]of Object.entries(profile.damageEffects)){
    const raw=definition.raw,keys=Object.keys(raw).filter(k=>/^DAMAGE_DATA_NEXT\d*$/.test(k));
    const stages=[0,...keys.map(key=>Number(key.slice('DAMAGE_DATA_NEXT'.length)||1))].sort((a,b)=>a-b);
    if(keys.length)row.stages.push({name,stages,timers:{global:raw.DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME??null,animation:raw.DAMAGE_DATA_CHANGE_TIME??null}});
    if(raw.MAIN_EFFECT_NAME&&!profile.effectTemplates[raw.MAIN_EFFECT_NAME])row.unsupportedMainEffects.push({name,main:raw.MAIN_EFFECT_NAME,declaredUnsupported:definition.unsupportedMainEffect??null});
    try{
      sim.state.effects=[];const e=sim.createEffect(a,{NAME:name});if(!e)throw Error('producer-rejected-template');
      for(const stage of stages){e.stage=stage;const packet=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:row.ownerSnapshots+1});
        refs(sim,decodeNetworkBinary(encodeNetworkBinary(packet)));row.ownerSnapshots++;}
    }catch(error){row.errors.push({name,error:error.message});}
  }
  result.professions.push(row);console.log(JSON.stringify({id,staticSnapshots:row.ownerSnapshots,errors:row.errors.length,missing:row.missingReferences.length}));
}
if(process.argv.includes('--skills')){
  const assets=await loadServerCombatAssets({root,assetRoot});const runtime=await assets.createRuntime();runtime.commonBuffs=assets.commonBuffs;runtime.versions=assets.versions;
  for(const id of PROFESSION_IDS){
    const skills=profiles[id].skillCatalog.filter(s=>s.topTier&&!s.passive&&s.supported&&s.skillId!==900);
    for(const skill of skills)for(const awake of [false,true]){
      const sim=simulation(id,skill.skillId,runtime),a=sim.actor('owner');a.cooldowns={};
      if(awake){a.awakening.pendingOrbs=3;a.awakening.pendingAvailableOrbs=3;sim.activateAwakening(a);}
      const send=createOwnerPoseDelta(),receive=createOwnerPoseDelta();let ack=-1,observed=false,frames=0,effectNames=new Set(),failure=null;
      try{for(let frame=1;frame<=300;frame++){
        sim.step(1/60,{owner:frame<=180?{held:['A'],pressed:frame===1?['A']:[]}:{}},{snapshot:false});frames=frame;
        observed||=a.skillId===skill.skillId;
        const packet=encodeOwnedState(sim,'owner',{epoch:1,frameSeq:frame});for(const effect of packet.effects)effectNames.add(effect.name);
        const decoded=receive.decode(decodeNetworkBinary(encodeNetworkBinary(send.encode(packet,{acknowledgedEpoch:1,acknowledgedFrameSeq:ack,version:2}))));
        refs(sim,decoded.report);decoded.commit();ack=frame;sim.drainEvents();
      }}catch(error){failure={frame:frames,error:error.message};result.failures.push({id,skillId:skill.skillId,awake,...failure});}
      result.dynamic.push({id,skillId:skill.skillId,awake,frames,castObserved:observed,effectNames:[...effectNames].sort(),failure});
    }
    console.log(JSON.stringify({id,dynamicCases:result.dynamic.filter(r=>r.id===id).length,failures:result.failures.filter(r=>r.id===id)}));
  }
}
const output=resolve(root,process.argv.includes('--registration')?'reports/owner-effect-registration-v49.json':'reports/owner-effect-audit-v49.json');mkdirSync(resolve(root,'reports'),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,staticFailures:result.professions.reduce((n,r)=>n+r.errors.length,0),dynamicCases:result.dynamic.length,dynamicFailures:result.failures.length}));
