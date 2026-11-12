/** Original factor/template data executor. Numeric HP/interval functions run
 * unchanged in C++ WASM. Actor reactions, RNG, rendering and assignment stay
 * outside this module; no automatic Exploding Hand activation is invented.
 */
import {buffCountFinalizerIncrement} from './buff-count-finalizers.mjs';
import feedbackBuffs from '../../contracts/feedback-buff-closure-v45.json' with {type:'json'};
const f=Math.fround;
const elesisClass=profile=>[120,121,125].includes(profile.target?.unitClass);
const copy=x=>structuredClone(x);
const finite=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError(`${label} missing/nonfinite`);return n;};
const hitCounterByte=actor=>{const value=actor?.sourceHitCountByte;
 if(!Number.isInteger(value)||value<0||value>255)throw new TypeError('Original hit counter byte input required');return value;};
const combo=v=>Object.keys(v??{}).sort((a,b)=>Number(a)-Number(b)).map(key=>v[key]);
const enumName=(profile,group,type)=>Object.entries(profile.enums?.[group]??{}).find(([,value])=>value===type)?.[0];
const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
/** A global target buff display closure is shared by recipients of any class.
 * It never supplies action states, skills, damage effects or offensive helpers.
 * Existing original declarations must agree before a common entry is added. */
export function installCommonBuffs(profile,catalog,feedback=true){
  if(feedback)installCommonBuffs(profile,feedbackBuffs,false);
  if(!catalog)return profile;
  if(catalog.schemaVersion!==1||typeof catalog.targetVersion!=='string'||!catalog.targetVersion.endsWith(profile.target.build)
    ||Object.keys(catalog.damageEffects??{}).length||catalog.states||catalog.skillCatalog)throw new TypeError('Invalid common target buff-only catalog');
  const allowedSets=new Set(Object.values(catalog.buffTemplates??{}).flatMap(row=>Object.values(row.raw?.DISPLAYER?.BDT_EFFECT_SET??{})));
  for(const name of Object.keys(catalog.effectSets??{}))if(!allowedSets.has(name))throw new TypeError('Common effect set is outside buff DISPLAYER closure: '+name);
  for(const group of ['buffTemplates','buffFactors','effectSets','effectTemplates']){
    const entries=catalog[group];if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new TypeError('Missing common buff catalog '+group);
    profile[group]??={};
    for(const [id,row]of Object.entries(entries)){
      const old=profile[group][id];
      const declaration=value=>value.raw??(group==='effectTemplates'?{fields:value.fields,events:value.events,repeated:value.repeated}:value);
      if(old&&canonical(declaration(old))!==canonical(declaration(row)))throw new TypeError('Conflicting original common buff declaration: '+group+'.'+id);
      if(!old)profile[group][id]=copy(row);
    }
  }
  return profile;
}
function value(table,level,label){
  if(typeof table==='number')return finite(table,label);
  if(!table || typeof table[String(level)]!=='number')throw new TypeError(`${label} at level ${level} missing`);
  return f(table[String(level)]);
}
function native(bridge){
  for(const name of ['buffFixed','buffRelation','buffPercent','buffInterval'])
    if(typeof bridge?.[name]!=='function')throw new TypeError('Original buff math/interval bridge required');
}
function resistance(actor,type){
  const resist=finite(actor?.buffResistances?.[String(type)],`explicit normalized buffResistances[${type}]`);
  if(resist<0||resist>1)throw new TypeError('Normalized resistance must be in [0,1]');
  // Fixed GUUser5798 adds Body of Fire points to ET_BLAZE, then3488 caps
  // the elemental map. GameUnit11165 normalizes with EAR_MAX_VALUE=500
  // (pinned X2EnchantItem.h81). Do not mutate the frozen base table.
  const fire=type===1&&actor?.professionId==='BH'?actor.passivePolicy?.elesis?.fireResistancePoints??0:0;
  return f(Math.min(1,resist+Math.trunc(fire)/500));
}
function attack(actor,relation){
  const stats=actor?.stats??actor;
  if(relation===1)return finite(stats?.physicalAttack,'source physicalAttack');
  if(relation===2)return finite(stats?.magicAttack,'source magicAttack');
  if(relation===3)return f(f(finite(stats?.physicalAttack,'source physicalAttack')+finite(stats?.magicAttack,'source magicAttack'))*.5);
  throw new TypeError('Unsupported HP relation type '+relation);
}

export function createBuffFromFactor(profile,{factor,sourceFactorId=typeof factor==='number'?factor:null,skillLevel=1,sourceActor,targetActor,roll,nativeValues,countFinalizerParameters}={}){
  try{
    native(nativeValues);
    if(!Number.isInteger(skillLevel)||skillLevel<1||skillLevel>30)throw new TypeError('Skill level must be 1..30');
    const raw=typeof factor==='number'?profile.buffFactors?.[factor]?.raw:factor?.raw??factor?.BUFF_FACTOR??factor;
    if(!raw || !Number.isInteger(raw.BUFF_TEMPLET_ID))throw new TypeError('Original factor/template ID missing');
    if(sourceFactorId!==null&&(!Number.isInteger(sourceFactorId)||profile.buffFactors?.[sourceFactorId]?.raw?.BUFF_TEMPLET_ID!==raw.BUFF_TEMPLET_ID))throw new TypeError('Original factor identity/template mismatch');
    const template=profile.buffTemplates?.[raw.BUFF_TEMPLET_ID]?.raw;
    if(!template)throw new TypeError('Original BattleFieldBuffTemplet missing');
    const immediateMp=[97,98].includes(template.BUFF_TEMPLET_ID)&&template.ACCUMULATION_LIMIT===0&&template.FINALIZER?.BFT_IMMEDIATE||profile.target?.unitClass===112&&template.BUFF_TEMPLET_ID===20&&template.ACCUMULATION_LIMIT===0;
    const elesisStack=elesisClass(profile)&&({246:5,290:5,293:10,426:5,427:5,428:5,511:20,566:10}[template.BUFF_TEMPLET_ID]===template.ACCUMULATION_LIMIT);
    const moonlightStack=[122,123,126].includes(profile.target?.unitClass)&&template.BUFF_TEMPLET_ID===439&&template.ACCUMULATION_LIMIT===3;
    if(template.ACCUMULATION_LIMIT!==1&&!immediateMp&&!elesisStack&&!moonlightStack&&!([232,546].includes(template.BUFF_TEMPLET_ID)&&template.ACCUMULATION_LIMIT===5)&&!(template.BUFF_TEMPLET_ID===250&&template.ACCUMULATION_LIMIT===2)&&!(profile.target?.unitClass===112&&[19,94].includes(template.BUFF_TEMPLET_ID)&&template.ACCUMULATION_LIMIT===5)&&!(profile.target?.unitClass===123&&template.BUFF_TEMPLET_ID===343&&template.ACCUMULATION_LIMIT===3)&&!(template.BUFF_TEMPLET_ID===99&&template.ACCUMULATION_LIMIT===3))throw new TypeError('Unsupported source accumulation template');
    const resist=resistance(targetActor,template.REGIST_TYPE);
    // Fixed Raven GetReduceDebuffDurationRate enumerates these identities;
    // beneficial buffs and unrelated debuffs do not inherit this reduction.
    const shortened=targetActor?.passivePolicy?.veteran&&[31,25,38,52,53,58,61,85,87,99,161,223].includes(raw.BUFF_TEMPLET_ID);
    const addShortened=targetActor?.passivePolicy?.add?.mindControlDebuffTemplateIds?.includes(raw.BUFF_TEMPLET_ID);
    const durationMultiplier=f(finite(targetActor?.debuffDurationMultiplier,'explicit debuffDurationMultiplier')*(shortened?targetActor.passivePolicy.veteran.debuffDurationMultiplier:1)*(addShortened?targetActor.passivePolicy.add.mindControlDebuffDurationMultiplier:1));
    if(durationMultiplier<0)throw new TypeError('Debuff duration multiplier must be nonnegative');
    // IS's variable-level Sharp Sword factor is cloned at the learned level
    // before native GetRate(1); the untouched target table retains all levels.
    const rate=value(raw.RATE,(profile.target?.unitClass===112&&sourceFactorId===228||elesisClass(profile))?skillLevel:1,'buff RATE');
    finite(roll,'deterministic buff roll');if(roll<0||roll>1)throw new TypeError('Buff roll must be in [0,1]');
    const probability=f(rate*f(1-((raw.IGNORE_REGIST_FOR_RATE===1||raw.IGNORE_REGIST_FOR_RATE===true)?0:resist)));
    if(rate<f(roll)||probability<f(roll))return {supported:true,accepted:false,buff:null,reason:'source probability/resistance check'};
    const behaviors=[];
    for(const type of combo(template.BEHAVIOR?.COMBINATION)){
      if(!combo(raw.BEHAVIOR?.COMBINATION).includes(type))throw new TypeError('Factor does not supply template behavior '+type);
      const name=enumName(profile,'BUFF_BEHAVIOR_TYPE',type),base=template.BEHAVIOR[name],detail=raw.BEHAVIOR[name];
      if(name==='BBT_EMPTY'){behaviors.push({type,kind:'empty'});continue;}
      if(name==='BBT_EFFECT_SET_WITH_DAMAGE'&&template.BUFF_TEMPLET_ID===433&&profile.target?.unitClass===125){
        // Its source skill callback owns attack-effect creation and retirement;
        // this timed identity is not a generic buff-to-attack implementation.
        behaviors.push({type,kind:'sourceCallback',sourceBehavior:name});continue;
      }
      if(name==='BBT_CUSTOM_FUNCTION'&&[438,439].includes(template.BUFF_TEMPLET_ID)&&[122,123,126].includes(profile.target?.unitClass)){
        behaviors.push({type,kind:'sourceCallback',sourceBehavior:name});continue;
      }
      if(elesisClass(profile)&&template.BUFF_TEMPLET_ID===566&&name==='BBT_CHANGE_ANIM_SPEED'){
        // Target28402 description independently states +2% per stack. Raw
        // FIX_VALUE=2 is preserved; only this reviewed factor has a percent
        // display adapter, never the general raw socket-point converter.
        behaviors.push({type,kind:'stat',stat:'animationSpeedMultiplier',value:f(1+value(detail.FIX_VALUE,skillLevel,'agility FIX_VALUE')/100),changeType:3,
          evidenceClass:'target2016 28402 explicit 2-percent-description adapter'});continue;
      }
      if([297,567].includes(template.BUFF_TEMPLET_ID)&&name==='BBT_CHANGE_MAX_MP'&&detail.BUFF_CHANGE_TYPE===1){
        behaviors.push({type,kind:'stat',stat:'mpMax',changeType:1,value:value(detail.FIX_VALUE,skillLevel,'max MP')});continue;
      }
      if([297,567].includes(template.BUFF_TEMPLET_ID)&&name==='BBT_CHANGE_ATTACK_BY_TYPE'&&detail.BUFF_CHANGE_TYPE===3){
        const attackTypes=[detail.ATTACK_TYPE,...(Number.isInteger(detail.ADDITIONAL_ATTACK_TYPE)?[detail.ADDITIONAL_ATTACK_TYPE]:[])];
        behaviors.push({type,kind:'attackByType',attackTypes,multiplier:value(detail.PERCENT,skillLevel,'attack type multiplier')});continue;
      }
      if(elesisClass(profile)&&name==='BBT_DOUBLE_ATTACK_BUFF'&&template.BUFF_TEMPLET_ID===429){
        behaviors.push({type,kind:'elesisDoubleAttack',chance:value(detail.PERCENT,skillLevel,'double attack chance')});continue;
      }
      if(elesisClass(profile)&&name==='BBT_CUSTOM_FUNCTION'&&[426,427].includes(template.BUFF_TEMPLET_ID)){
        // Target counter identities are consumed explicitly by Elesis hit hooks.
        behaviors.push({type,kind:'empty'});continue;
      }
      if(profile.target?.unitClass===121&&template.BUFF_TEMPLET_ID===296&&name==='BBT_RESET_SKILL_COOL_TIME'
        &&base?.BUFF_CHANGE_TYPE===1&&detail?.BUFF_CHANGE_TYPE===1&&base.RELATIVE_ALL_SKILL===1&&value(detail.FIX_VALUE,skillLevel,'Blossom cooldown FIX_VALUE')===-2){
        // The immediate identity invokes the reviewed Elesis application
        // hook once. It is not a persistent override of future cast cooldowns.
        behaviors.push({type,kind:'empty'});continue;
      }
      if(elesisClass(profile)&&name==='BBT_CHANGE_ADDITIONAL_DEFENCE'&&template.BUFF_TEMPLET_ID===430){
        behaviors.push({type,kind:'stat',stat:'finalDefenceMultiplier',value:f(1-value(detail.FIX_VALUE,skillLevel,'shade defence')/100),changeType:3,
          evidenceClass:'target2016 Shade Illusion explicit damage-reduction description adapter'});continue;
      }
      if(elesisClass(profile)&&name==='BBT_CHANGE_ADDITIONAL_ATTACK'&&template.BUFF_TEMPLET_ID===428){
        behaviors.push({type,kind:'stat',stat:'additionalAttackPercent',value:f((value(detail.FIX_VALUE,skillLevel,'revenge additional')-1)*100),changeType:1,
          evidenceClass:'target2016 Blood Revenge explicit 3/6/9-percent description adapter'});continue;
      }
      if(elesisClass(profile)&&['BBT_CHANGE_ADDITIONAL_DEFENCE','BBT_CHANGE_ATTRIBUTE_BLAZE_DEFENCE','BBT_CUSTOM_FUNCTION'].includes(name)){
        behaviors.push({type,kind:'elesisUnsupported',sourceBehavior:name,reason:'Target numeric unit/custom callback consumer not acquired'});continue;
      }
      if(elesisClass(profile)&&name==='BBT_CHANGE_NOW_FORCE_DOWN_PER_SECOND'&&base.TIME_INTERVAL===0&&detail.BUFF_CHANGE_TYPE===1){
        behaviors.push({type,kind:'elesisImmediateKnockdown',value:value(detail.FIX_VALUE,skillLevel,'knockdown FIX_VALUE')});continue;
      }
      if(name==='BBT_DASH_IMPOSSIBLE'){behaviors.push({type,kind:'dashBlock'});continue;}
      if(profile.target?.unitClass===126&&sourceFactorId===475&&template.BUFF_TEMPLET_ID===437){
        if(name==='BBT_ATTACK_IMPOSSIBLE'){behaviors.push({type,kind:'attackBlock'});continue;}
        if(name==='BBT_NEVER_MOVE'&&base?.IS_GRAVITY===0){
          const position=[targetActor?.x,targetActor?.y,targetActor?.z].map(f);if(!position.every(Number.isFinite))throw new TypeError('Void binding requires the actual recipient position');
          behaviors.push({type,kind:'neverMove',position,gravity:false});continue;
        }
      }
      if(name==='BBT_DETONATION_IMPOSSIBLE'){behaviors.push({type,kind:'manaBreakBlock'});continue;}
      if(name==='BBT_STUN'){behaviors.push({type,kind:'stun',reactionState:null});continue;}
      if(name==='BBT_SUPER_ARMOR'){behaviors.push({type,kind:'superArmor'});continue;}
      if(profile.target?.unitClass===112&&name==='BBT_CUSTOM_FUNCTION'&&template.BUFF_TEMPLET_ID===29){behaviors.push({type,kind:'phantomSword'});continue;}
      if(profile.target?.unitClass===112&&name==='BBT_IGNORE_DEFENCE'&&detail.IGNORE_DEFENCE_RATE===1){behaviors.push({type,kind:'ignoreDefence'});continue;}
      if(profile.target?.unitClass===112&&name==='BBT_CHANGE_ADDITIONAL_ATTACK'&&detail.BUFF_CHANGE_TYPE===1){
        behaviors.push({type,kind:'stat',stat:'additionalAttackPercent',value:value(detail.FIX_VALUE,skillLevel,'FIX_VALUE'),changeType:1});continue;
      }
      if(name==='BBT_RESET_SKILL_COOL_TIME'&&base?.BUFF_CHANGE_TYPE===0&&detail?.BUFF_CHANGE_TYPE===0&&base.SKILL_TYPE===detail.SKILL_TYPE){
        behaviors.push({type,kind:'skillCooldown',skillType:detail.SKILL_TYPE,value:value(detail.SWAP_VALUE,skillLevel,'cooldown SWAP_VALUE')});continue;
      }
      if(name==='BBT_DRAIN_HP_NORMAL_ATTACK'&&base?.BUFF_CHANGE_TYPE===1&&detail?.BUFF_CHANGE_TYPE===1&&detail.BUFF_RELATION_TYPE===7){
        behaviors.push({type,kind:'normalHpDrain',value:value(detail.FIX_VALUE,skillLevel,'HP drain FIX_VALUE')});continue;
      }
      if(name==='BBT_CREATE_BUFF_FACTOR'){
        if(!Number.isInteger(detail?.BUFF_FACTOR_ID)||!profile.buffFactors?.[detail.BUFF_FACTOR_ID]||!Number.isInteger(detail.SKILL_ID))throw new TypeError('Original on-hit buff factor missing');
        // The two profession consumers keep their sourced normal-hit gates.
        behaviors.push(profile.target?.unitClass===106
          ?{type,kind:'normalHitBuff',factorId:detail.BUFF_FACTOR_ID,sourceSkillId:detail.SKILL_ID}
          :{type,kind:'onHitBuffFactor',factorId:detail.BUFF_FACTOR_ID,skillId:detail.SKILL_ID});continue;
      }
      if(name==='BBT_ABSORB_EFFECT_ATTACK'){behaviors.push({type,kind:'absorbMagicProjectile',mp:value(detail?.ABSORB_VALUE,skillLevel,'ABSORB_VALUE')});continue;}
      if(name==='BBT_FINISH_OTHER_BUFF_DEBUFF'){
        const templateIds=combo(base);if(!templateIds.every(Number.isInteger))throw new TypeError('Original exclusive buff IDs missing');
        behaviors.push({type,kind:'finishOtherBuffs',templateIds});continue;
      }
      if(['BBT_CHANGE_ATTRIBUTE_BLAZE_ATTACK_RATE','BBT_CHANGE_ATTRIBUTE_WATER_ATTACK_RATE','BBT_CHANGE_ATTRIBUTE_NATURE_ATTACK_RATE'].includes(name)){
        if(detail?.BUFF_CHANGE_TYPE!==1||base?.BUFF_CHANGE_TYPE!==1)throw new TypeError('Original elemental rate type unsupported');
        behaviors.push({type,kind:'elementAttackRate',element:name,value:value(detail.FIX_VALUE,skillLevel,'element FIX_VALUE')});continue;
      }
      if(name==='BBT_CHANGE_NOW_HP_PER_SECOND'||name==='BBT_CHANGE_NOW_MP_PER_SECOND'){
        if(!base||!detail||base.BUFF_CHANGE_TYPE!==detail.BUFF_CHANGE_TYPE)throw new TypeError('Original HP change type mismatch');
        const changeType=detail.BUFF_CHANGE_TYPE;
        let hpValue;
        if(changeType===1)hpValue=nativeValues.buffFixed(value(detail.FIX_VALUE,skillLevel,'FIX_VALUE'),resist);
        else if(changeType===2)hpValue=nativeValues.buffRelation(attack(sourceActor,detail.BUFF_RELATION_TYPE),value(detail.MULTIPLIER,skillLevel,'MULTIPLIER'),resist);
        else if(changeType===3)hpValue=nativeValues.buffPercent(value(detail.PERCENT,skillLevel,'PERCENT'),resist);
        else throw new TypeError('Unsupported HP change type '+changeType);
        const interval=finite(base.TIME_INTERVAL,'template TIME_INTERVAL');
        // Original Mp::ChangeMpByValue/Percent permits the zero-interval,
        // immediate-finalizer templates97/98 used by HA and Luna Blade.
        if(interval<0||interval===0&&!(immediateMp&&name==='BBT_CHANGE_NOW_MP_PER_SECOND'))throw new TypeError('Unsupported TIME_INTERVAL');
        behaviors.push({type,kind:name==='BBT_CHANGE_NOW_MP_PER_SECOND'?'mpInterval':'hpInterval',value:hpValue,changeType,interval:f(interval),sum:0});continue;
      }
      if(profile.target?.unitType===9&&name==='BBT_CHANGE_HYPER_CHARGE_SPEED'&&base?.BUFF_CHANGE_TYPE===3&&detail?.BUFF_CHANGE_TYPE===3){
        behaviors.push({type,kind:'addDpGain',changeType:3,value:value(detail.PERCENT,skillLevel,'PERCENT'),
          evidenceClass:'target2016 Add DP gain buff; source GetEffectiveIncreaseDPValue consumer'});continue;
      }
      const stat={BBT_CHANGE_PHYSIC_ATTACK:'physicalAttack',BBT_CHANGE_MAGIC_ATTACK:'magicAttack',
        BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_MELEE_ATTACK:'finalDamageMultiplierMelee',BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_RANGE_ATTACK:'finalDamageMultiplierRange',
        BBT_CHANGE_FORCE_DOWN_MULTIPLIER_MELEE_ATTACK:'forceDownMultiplierMelee',BBT_CHANGE_FORCE_DOWN_MULTIPLIER_RANGE_ATTACK:'forceDownMultiplierRange',
        BBT_CHANGE_CRITICAL_RATE:'criticalRate',BBT_CHANGE_CRITICAL_ATTACK:'criticalAttack',
        BBT_CHANGE_FINAL_DEFENCE_MULTIPLIER:'finalDefenceMultiplier',BBT_CHANGE_PHYSIC_DEFENCE:'physicalDefence',
        BBT_CHANGE_MAGIC_DEFENCE:'magicDefence',BBT_CHANGE_WALK_RUN_SPEED:'moveSpeedMultiplier',
        BBT_CHANGE_JUMP_POWER:'jumpSpeedMultiplier',BBT_CHANGE_ANIM_SPEED:'animationSpeedMultiplier',
        BBT_CHANGE_ACCURACY:'accuracy',BBT_CHANGE_AVOIDANCE:'avoidance',BBT_CHANGE_ENCHANT_ATTACK_RATE:'enchantAttackRate',BBT_CHANGE_EVERY_ATTRIBUTE_DEFENCE:'everyAttributeDefence',
        BBT_CHARGE_MP_HIT_MELEE_ATTACK:'hitMeleeMpMultiplier',BBT_CHARGE_MP_HIT_RANGE_ATTACK:'hitRangeMpMultiplier',BBT_CHARGE_MP_HITTED:'receivedMpMultiplier'}[name];
      if(stat && detail && base && detail.BUFF_CHANGE_TYPE===base.BUFF_CHANGE_TYPE){
        // ChangeStat::SetFactor907 checks factor relation only for
        // BCT_RELATION_VALUE. Target Sandstorm's percent factor omits it;
        // template BRT_END remains explicit and no foreign stat is queried.
        // Target Elesis Annihilation247 and Dark Force434 percent factors
        // omit relation on both declarations. Percent math reads no other
        // stat; preserve absent raw fields and admit only sourced identities.
        const elesisSwordPercent=([120,121,125].includes(profile.target?.unitClass)&&template.BUFF_TEMPLET_ID===247
          ||profile.target?.unitClass===125&&template.BUFF_TEMPLET_ID===434)
          &&name==='BBT_CHANGE_ENCHANT_ATTACK_RATE'&&detail.BUFF_CHANGE_TYPE===3
          &&detail.BUFF_RELATION_TYPE===undefined&&base.BUFF_RELATION_TYPE===undefined;
        if(!elesisSwordPercent&&(detail.BUFF_RELATION_TYPE!==undefined&&detail.BUFF_RELATION_TYPE!==7 || base.BUFF_RELATION_TYPE!==7))throw new TypeError('Context-dependent stat relation unsupported');
        const changeType=detail.BUFF_CHANGE_TYPE;
        let v;
        if(changeType===0)v=value(detail.SWAP_VALUE,skillLevel,'SWAP_VALUE');
        else if(changeType===1&&(['BBT_CHANGE_EVERY_ATTRIBUTE_DEFENCE','BBT_CHANGE_ACCURACY','BBT_CHANGE_AVOIDANCE'].includes(name)||[112,122].includes(profile.target?.unitClass)&&name==='BBT_CHANGE_CRITICAL_RATE'))v=value(detail.FIX_VALUE,skillLevel,'FIX_VALUE');
        else if(changeType===3){const p=value(detail.PERCENT,skillLevel,'PERCENT');v=p>=1||p<=0?p:f(1-nativeValues.buffFixed(f(1-p),resist));}
        else throw new TypeError('Unsupported stat change type '+changeType);
        behaviors.push({type,kind:'stat',stat,value:v,changeType,
          evidenceClass:'reference-V5 ChangeStat.GetValue candidate; actor composition external'});continue;
      }
      throw new TypeError('Unsupported original behavior '+name+' / '+type);
    }
    const finalizers=[];
    for(const type of combo(template.FINALIZER?.COMBINATION)){
      if(!combo(raw.FINALIZER?.COMBINATION).includes(type))throw new TypeError('Factor does not supply template finalizer '+type);
      const name=enumName(profile,'BUFF_FINALIZER_TYPE',type),detail=raw.FINALIZER[name],base=template.FINALIZER[name];
      if(name==='BFT_TIME'){
        if(detail?.BUFF_DURATION_TIME_TYPE!==1 || base?.BUFF_DURATION_TIME_TYPE!==1)throw new TypeError('Only normal-time finalizer supported');
        const sourceDuration=f(value(detail.NORMAL_TIME,skillLevel,'NORMAL_TIME')*f(1-resist));
        finalizers.push({kind:'time',sourceDuration,remaining:f(sourceDuration*durationMultiplier)});
      }else if(name==='BFT_PASS_HP'){
        if(detail?.BUFF_CHANGE_TYPE!==3||base?.BUFF_CHANGE_TYPE!==3||![0,1].includes(detail.PASS_UP)||detail.PASS_UP!==base.PASS_UP)throw new TypeError('Unsupported HP finalizer');
        finalizers.push({kind:'hp',remaining:1,criterion:value(detail.CRITERION,skillLevel,'HP criterion'),passUp:!!detail.PASS_UP});
      }else if(name==='BFT_IMMEDIATE'){
        // Original DidFinish returns true at the first manager frame. Keep the
        // identity until that frame; no arbitrary timed duration is supplied.
        finalizers.push({kind:'immediate',remaining:1});
      }else if(name==='BFT_STATE_CHANGE'){
        finalizers.push({kind:'state',remaining:1,stateSerial:targetActor.stateSerial});
      }else if(name==='BFT_FINISH_HYPER'&&profile.target?.unitClass===122&&sourceFactorId===619&&template.BUFF_TEMPLET_ID===530&&targetActor?.sourceAdd){
        // Original clone32aeaf50 clears forceC; v432aeb000 samples the
        // actual positive awakening value before v1032ae9e20 tests it.
        finalizers.push({kind:'hyper',remaining:1,forceEnd:false});
      }else if(name==='BFT_HIT_COUNT'||name==='BFT_HITTED_COUNT'){
        const policy=detail?.BUFF_USE_COUNT_TYPE;
        if(![0,3,4].includes(policy)||base?.BUFF_USE_COUNT_TYPE!==policy)throw new TypeError('Unsupported/mismatched count-finalizer policy');
        // Every captured target configuration uses policy0 + COUNT. Policy3/4
        // is proven for typed float parameters; its Lua multiplier field has
        // not been bound. Require explicit decoded values instead of guessing.
        let parameters=countFinalizerParameters?.[name];
        if(parameters===undefined){
          if(policy!==0)throw new TypeError('Decoded context-count parameters required; original Lua multiplier binding unavailable');
          const explicit=value(detail.COUNT,skillLevel,'COUNT');if(Math.trunc(explicit)<=0)throw new TypeError('Positive hit count required');
          parameters=[0,0,explicit];
        }
        const count=buffCountFinalizerIncrement(profile,{policy,parameters,unit:targetActor});
        const byteCounter=name==='BFT_HIT_COUNT'&&raw.BUFF_TEMPLET_ID===408;
        if(byteCounter&&count>255)throw new TypeError('Hit counter byte quota exceeds the current Web support domain');
        const current=byteCounter?hitCounterByte(targetActor):0;
        finalizers.push({kind:name==='BFT_HIT_COUNT'?'hit':'received',remaining:count,
          ...(byteCounter?{sourceByteEnd:current+count,sourceByteBaseline:current}:{})});
      }else throw new TypeError('Unsupported original finalizer '+name+' / '+type);
    }
    if(!finalizers.length)throw new TypeError('Original finalizer required');
    return {supported:true,accepted:true,buff:{schemaVersion:1,templateId:raw.BUFF_TEMPLET_ID,
      factorId:sourceFactorId,skillLevel,sourceActorId:sourceActor?.id??null,targetActorId:targetActor?.id??null,
      accumulationLimit:template.ACCUMULATION_LIMIT,...(template.ACCUMULATION_LIMIT>1?{accumulationCount:1}:{}),resistance:resist,durationMultiplier,behaviors,finalizers,
      evidenceClass:'target-2016 declarations + fixed-V5 native math/reference lifetime candidate',
      targetClientMeasured:false,displayer:copy(template.DISPLAYER??{})}};
  }catch(error){return {supported:false,accepted:false,buff:null,unsupported:[{reason:String(error.message)}]};}
}

export function mergeBuffs(profile,buffs,buff){
  if(!buff)return copy(buffs);
  const removed=buff.behaviors.filter(row=>row.kind==='finishOtherBuffs').flatMap(row=>row.templateIds);
  const result=copy(buffs.filter(row=>!removed.includes(row.templateId))),existing=result.find(row=>row.templateId===buff.templateId);
  // Fixed GameUnit11204 case0 creates a separate identity per application.
  if(buff.accumulationLimit===0){result.push(copy(buff));return result;}
  if(!existing){result.push(copy(buff));return result;}
  if(existing.accumulationLimit!==buff.accumulationLimit)throw new TypeError('Mismatched original accumulation limit');
  if(existing.accumulationLimit>1){
    // Fixed BuffChangeStat::SetFactor BCT_PERCENT, ADJUST_BUFF_ACCMULATION_CALCULATE.
    // Target Counter Patience also declares five additive stacks, not pow(.5,n).
    const count=Math.min(existing.accumulationLimit,(existing.accumulationCount??1)+1);
    for(const incoming of buff.behaviors){const old=existing.behaviors.find(row=>row.type===incoming.type);
      if(existing.templateId===439&&incoming.kind==='sourceCallback'&&old?.kind==='sourceCallback'
        &&[122,123,126].includes(profile.target?.unitClass))continue;
      if(elesisClass(profile)&&old&&['finishOtherBuffs','elesisUnsupported','empty'].includes(incoming.kind))continue;
      if(existing.templateId===99&&incoming.kind==='hpInterval'&&incoming.changeType===2&&old){
        const prior=f(old.value/(existing.accumulationCount??1));
        old.value=f((Math.abs(incoming.value)>Math.abs(prior)?incoming.value:prior)*count);continue;
      }
      if(existing.templateId!==99&&incoming.kind==='hpInterval'&&incoming.changeType===2&&old){old.value=f(incoming.value*count);continue;}
      if(incoming.kind!=='stat'||![1,3].includes(incoming.changeType)||!old)throw new TypeError('Unsupported accumulated behavior');
      old.value=incoming.changeType===1?f(incoming.value*count):f(Math.max(0,1+f(f(incoming.value-1)*count)));}
    existing.accumulationCount=count;
  }
  for(const incoming of buff.behaviors){
    const old=existing.behaviors.find(row=>row.type===incoming.type);if(!old||old.kind!==incoming.kind)throw new TypeError('Reapply behavior mismatch');
    // Original replace branch retains the stronger absolute value; timing is
    // held by the existing native interval object and is not reset by SetFactor.
    if(existing.accumulationLimit===1&&typeof incoming.value==='number'&&Math.abs(incoming.value)>Math.abs(old.value))old.value=incoming.value;
  }
  for(const incoming of buff.finalizers){
    const old=existing.finalizers.find(row=>row.kind===incoming.kind);if(!old)throw new TypeError('Reapply finalizer mismatch');
    // Native normal-time SetFactor compares the previous remaining time with
    // the incoming resisted time, then applies the target duration modifier.
    old.remaining=incoming.kind==='time'?f(Math.max(old.remaining,incoming.sourceDuration)*buff.durationMultiplier):Math.max(old.remaining,incoming.remaining);
    if(incoming.kind==='time')old.sourceDuration=incoming.sourceDuration;
    if(incoming.sourceByteEnd!==undefined){old.sourceByteEnd=Math.max(old.sourceByteEnd??0,incoming.sourceByteEnd);
      old.sourceByteBaseline??=incoming.sourceByteBaseline;}
  }
  return result;
}

/** Bleeding/Moonlight's three display entries describe successive accumulation
 * levels. They are alternative effect sets, not three simultaneous effects.
 * Other buff displays retain their existing list semantics. */
export function buffDisplaySets(buff){
  const sets=combo(buff.displayer?.BDT_EFFECT_SET);
  if([290,293].includes(buff.templateId))return sets.slice(Math.min(sets.length,Math.max(1,buff.accumulationCount??1))-1,Math.min(sets.length,Math.max(1,buff.accumulationCount??1)));
  const count=Math.min(3,Math.max(1,buff.accumulationCount??1));
  return [99,439].includes(buff.templateId)&&buff.accumulationLimit===3
    ?sets.slice(count-1,count)
    :sets;
}

/** Shared active identity predicate for observers/visuals. Counter finalizers
 * finish on the next manager tick; a pending finish must not paint a live icon.
 * A cleared stun registration may retain its original timed Buff object. */
export function isBuffActive(buff){
  return !(buff.finalizers??[]).some(row=>row.remaining<=0)
    && (!(buff.behaviors?.length)||buff.behaviors.some(row=>row.kind!=='stun'||!row.identityCleared));
}
export function buffControls(buffs){
  const rows=buffs.flatMap(buff=>buff.behaviors);
  return {inputBlock:rows.some(row=>row.kind==='stun'&&!row.identityCleared),stun:rows.some(row=>row.kind==='stun'&&!row.identityCleared),
    dashBlock:rows.some(row=>row.kind==='dashBlock'),manaBreakBlock:rows.some(row=>row.kind==='manaBreakBlock'),statModifiers:rows.filter(row=>row.kind==='stat').map(copy)};
}
/** User-requested received-hit cure. GUUser8428–8432 has a conditional
 * BTI_DEBUFF_STUN erase; the target build's macro choice is unverified.
 * Remove active stun Buff identities immediately, retaining other statuses.
 * This runs before the hit's new factors, which may apply a fresh stun. */
export function clearReceivedHitStun(buffs){
  const removed=buffs.filter(buff=>buff.behaviors.some(row=>row.kind==='stun'));
  const remaining=buffs.filter(buff=>!removed.includes(buff));
  return {buffs:remaining,removed,...buffControls(remaining)};
}
export function tickBuffs(profile,buffs,dt,{targetActor,nativeValues,advanceIntervals=true,advanceHyperFinalizer=true}={}){
  native(nativeValues);finite(dt,'dt');if(dt<0)throw new TypeError('dt must be nonnegative');
  const active=copy(buffs),effects=[],remaining=[];
  for(const buff of active){
    if(buff.schemaVersion!==1)throw new TypeError('Buff schema mismatch');
    // Pause freezes interval clocks and finalizers, while existing flags remain.
    if(dt>0){
      for(const row of buff.behaviors){
        if(!advanceIntervals)continue;
        if(row.kind==='elesisImmediateKnockdown'){
          effects.push({kind:'knockdownDelta',delta:row.value,templateId:buff.templateId,sourceActorId:buff.sourceActorId});continue;
        }
        if(!['hpInterval','mpInterval'].includes(row.kind))continue;
        const drawText=profile?.buffTemplates?.[String(buff.templateId)]?.raw?.BEHAVIOR?.[row.kind==='mpInterval'?'BBT_CHANGE_NOW_MP_PER_SECOND':'BBT_CHANGE_NOW_HP_PER_SECOND']?.DRAW_TEXT===1;
        const interval=nativeValues.buffInterval(row.sum,row.interval,dt);row.sum=interval.sum;
        if(interval.triggered && finite(targetActor?.hp,'target hp')>0){
          const resource=row.kind==='mpInterval'?'mp':'hp';
          const delta=row.changeType===3?f(finite(targetActor[resource+'Max'],'target '+resource+'Max')*row.value):row.value;
          effects.push({kind:resource+'Delta',delta,templateId:buff.templateId,sourceActorId:buff.sourceActorId,
            drawText,
            damageReaction:null,applyIfHpPositive:true,evidenceClass:'original HP/interval C++ with external sequential UpNowHp sink'});
        }
      }
      // Original BuffTemplet runs behavior, then all finalizers. Any finish
      // condition sets DidFinish (OR, not AND); final interval still executes.
      for(const row of buff.finalizers)if(row.kind==='time')row.remaining=f(row.remaining-f(dt));
      for(const row of buff.finalizers)if(row.sourceByteEnd!==undefined){
        const current=hitCounterByte(targetActor);
        if(row.sourceByteEnd>=256&&current<row.sourceByteBaseline)row.sourceByteEnd-=256;
        row.remaining=row.sourceByteEnd-current;
      }
      for(const row of buff.finalizers)if(row.kind==='immediate')row.remaining=0;
      for(const row of buff.finalizers)if(row.kind==='state'&&row.stateSerial!==targetActor.stateSerial)row.remaining=0;
      for(const row of buff.finalizers)if(row.kind==='hyper'&&advanceHyperFinalizer)row.remaining=row.forceEnd||!(targetActor.awakening?.remaining>0)?0:1;
      for(const row of buff.finalizers)if(row.kind==='hp'&&(row.passUp?targetActor.hp>f(row.criterion*targetActor.hpMax):targetActor.hp<f(row.criterion*targetActor.hpMax)))row.remaining=0;
    }
    if(dt===0||!buff.finalizers.some(row=>row.remaining<=0))remaining.push(buff);
    else effects.push({kind:'buffFinished',templateId:buff.templateId});
  }
  return {buffs:remaining,effects,...buffControls(remaining)};
}
export function consumeBuffHit(profile,buffs,{kind='hit',count=1,targetActor}={}){
  if(!['hit','received'].includes(kind)||!Number.isInteger(count)||count<0)throw new TypeError('Hit kind/count required');
  const result=copy(buffs),effects=[];
  for(const buff of result){
    for(const row of buff.finalizers)if(row.kind===kind){
      if(row.sourceByteEnd!==undefined){
        const current=hitCounterByte(targetActor);
        const end=row.sourceByteEnd>=256&&current<row.sourceByteBaseline?row.sourceByteEnd-256:row.sourceByteEnd;
        row.remaining=end-current;
      }else row.remaining-=count;
    }
    // Native counter changes only become DidFinish during the next buff
    // OnFrameMove. Retain identities until behavior/finalizers run there.
    if(buff.finalizers.some(row=>row.remaining<=0))effects.push({kind:'buffFinishPending',templateId:buff.templateId});
  }
  return {buffs:result,effects,...buffControls(result)};
}


/** Original BBT_CHANGE_ATTACK_BY_TYPE values remain attached to the attacker. */
export function buffAttackTypeMultiplier(actor,data){return (actor.buffs??[]).flatMap(b=>b.behaviors).filter(b=>b.kind==='attackByType'&&b.attackTypes.includes(data.ATTACK_TYPE)).reduce((v,b)=>f(v*b.multiplier),1);}
