/** Web allocation bounds for original compiled Add producers. These are
 * conservative pool capacities, never original hit counts or GPU timings.
 * Based on the recorded Stardust and Conqueror consumers. Apocalypse uses the
 * frozen NPC state declarations and the existing add-summons callback names;
 * its finite state groups include complete tails, not all lifetime casts. */
import {professionIdForProfile} from '../../packages/professions/identity.mjs';
import {resolveEffectTemplateKey} from '../../packages/combat-assets/effect-template-key.mjs';
import {getAddApocalypsePrewarmGroups} from '../../packages/combat-core/add-skills.mjs';
const STARDUST_BALL='DamageEffect_ATT_Stardust_Shower_Ball';
const CONQUEROR_PROJECTILE='DamageEffect_SA_APT_Conqueror_Projectile';
export function addCompiledPrewarmBursts(profile,index,loadout,{tickSeconds,targetCount,upperBound}){
  const selected=new Set((loadout??[]).map(slot=>Number(slot?.skillId)));
  const profession=professionIdForProfile(profile)??profile.professionId?.toUpperCase();
  const groups=[],unconfirmedRoots=[];
  if(profession==='MM')for(const skill of profile.skillCatalog)if(selected.has(Number(skill.skillId)))
    groups.push(...getAddApocalypsePrewarmGroups(skill,profile));
  if(profession==='MM'&&selected.has(29209)){
    const parent='DamageEffect_ADD_Dividing_Missile_Dynamo';
    const small=parent+'_Small',explosion='DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_';
    // Four mutually exclusive source variants, never four simultaneous casts.
    // The generic walk already includes each DIE child and its DIE explosion.
    // It does not traverse DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME (RT11).
    // Current Web checkHits admits each opposing actor in the final packet
    // before DAMAGE_TIME=1 retires the carrier. LIFE_TIME_ONLY=1 excludes only
    // template-land-crash in allowDieDamageChild: hit-limit still runs DIE.
    // Thus contact + DIE coexist; do not misread these as alternative paths.
    // One finite cast only: this does not bound repeated casts whose tails
    // overlap after cooldown resets, nor prove rendering/CPU improvements.
    for(const [suffix,count,child,big]of [['',4,small,explosion+'Big'],
      ['_Mutation',8,small,explosion+'Big_MUC'],['_DA',4,small+'_DA',explosion+'Big'],
      ['_Mutation_DA',8,small+'_DA',explosion+'Big_MUC']]){
      const name=parent+suffix,raw=profile.damageEffects?.[name]?.raw,childRaw=profile.damageEffects?.[child]?.raw;
      const smallExplosion=explosion+'Small';
      const split=Object.entries(raw??{}).filter(([key,value])=>/^DIE_DAMAGE_EFFECT\d+$/.test(key)&&value?.DAMAGE_EFFECT_NAME===child)
        .sort(([a],[b])=>Number(a.slice(17))-Number(b.slice(17)));
      const contact=(value,created)=>upperBound(value?.DAMAGE_TIME)===1&&value?.DAMAGE_DATA?.REACT_TYPE===11&&
        value.DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME===created;
      const confirmed=Number.isInteger(targetCount)&&targetCount>0&&contact(raw,big)&&contact(childRaw,smallExplosion)&&
        split.length===count&&split.every(([key,value],i)=>key==='DIE_DAMAGE_EFFECT'+i&&value.LIFE_TIME_ONLY===1)&&
        childRaw?.DIE_DAMAGE_EFFECT0?.DAMAGE_EFFECT_NAME===smallExplosion&&childRaw.DIE_DAMAGE_EFFECT0.LIFE_TIME_ONLY===1&&
        profile.damageEffects?.[big]&&profile.damageEffects?.[smallExplosion];
      if(!confirmed){unconfirmedRoots.push(name,big,smallExplosion);continue;}
      groups.push([[name,1],[big,targetCount],[smallExplosion,count*targetCount]]);
    }
  }
  if(profession==='LP'&&selected.has(29008)){
    // Original 3274ad90 / 3274aff0: normal12+c, hyper c plus one main,
    // c <=3. Alternatives must not be summed as one simultaneous cast.
    const raw=profile.damageEffects?.[CONQUEROR_PROJECTILE]?.raw;
    const hits=Object.entries(raw??{}).filter(([key,value])=>/^HIT_DAMAGE_EFFECT\d+$/.test(key)&&typeof value?.DAMAGE_EFFECT_NAME==='string').map(([,value])=>value.DAMAGE_EFFECT_NAME);
    // The ordinary traversal already includes one DIE child per projectile.
    // Its source DAMAGE_TIME=1 contact first creates HIT children, then the
    // spent carrier dies and creates a SECOND Shock. NO_DAMAGE1 suppresses
    // HP damage, not that accepted geometric-contact producer. Web may see
    // every opposing actor in its final contact packet before retirement;
    // reserve the finite frozen targetCount, never an observed cold count.
    const contactLimit=upperBound(raw?.DAMAGE_TIME),confirmed=contactLimit===1;
    if(!confirmed)unconfirmedRoots.push(...hits);
    const hitEntries=shots=>confirmed?hits.map(name=>[name,shots*targetCount]):[];
    groups.push([[CONQUEROR_PROJECTILE,15],...hitEntries(15)],
      [[CONQUEROR_PROJECTILE,3],...hitEntries(3),['DamageEffect_SA_APT_Conqueror_Hyper',1]]);
  }
  if(profession==='DE'&&selected.has(29021)){
    const skill=profile.skillCatalog.find(row=>Number(row.skillId)===29021);
    // Planner keys use skill IDs. Bound every declared level, rather than
    // borrowing maxLevel's value as an unproved monotonicity assumption.
    const levelBound=key=>{
      const table=skill?.raw?.[key];if(!table||typeof table!=='object')return null;
      const values=Object.values(table).map(upperBound);
      return values.length&&values.every(v=>v!==null&&v>=0)?Math.max(...values):null;
    };
    const base=levelBound('SA_EFFECTIVE_TIME'),per=levelBound('SA_DAMAGE_TIME');
    if(base===null||per===null||base<0||per<0){unconfirmedRoots.push(STARDUST_BALL);return {groups,unconfirmedRoots};}
    // Original controller starts its accumulator at1, then resets to0 after
    // one request per >=.1s callback. Use max three duration mutations and
    // one boundary request. The ten bones are successive positions, not ten
    // additional requests per callback. No catch-up loop is invented here.
    const interval=Math.fround(.1),seconds=Math.fround(base+Math.fround(3*per));
    const total=Math.ceil(seconds/interval)+1;
    if(!Number.isSafeInteger(total)||total<1){unconfirmedRoots.push(STARDUST_BALL);return {groups,unconfirmedRoots};}
    const raw=profile.damageEffects?.[STARDUST_BALL]?.raw;
    const main=index.templates[resolveEffectTemplateKey(index.templates,raw?.MAIN_EFFECT_NAME,4)];
    const ballLife=main?.fields.LifeType==='LT_TIME'?upperBound(main.fields.LifeTime):null;
    const templateInstanceCaps=new Map();
    if(ballLife!==null&&ballLife>=0)for(const [key,entry]of Object.entries(raw??{})){
      if(!/^(?:PASSIVE|START|TIME)_PARTICLE\d+$/.test(key))continue;
      const name=entry?.PARTICLE_NAME,template=index.templates[name];
      if(!template||template.kind!=='particle')continue;
      // Only direct sequences without child tails may use this tighter
      // overlap window. Detached DIE effects (Small_Explosion lasts9s) and
      // Trace/Final chains retain the finite whole-cast total above.
      if(['TraceParticleList','FinalParticleList'].some(k=>template.repeated?.[k]?.length||template.fields[k]))continue;
      const life=upperBound(template.fields.Lifetime);
      if(life===null||life<0)continue;
      const count=Math.min(total,Math.ceil((ballLife+life+2*tickSeconds)/interval)+1);
      templateInstanceCaps.set(name,Math.max(templateInstanceCaps.get(name)??0,count));
    }
    groups.push([
      ['DamageEffect_ATT_Stardust_Shower_Rupture',1],['Mesh_ATT_Stardust_Shower_Drop',1],
      ['EffectSet_ATT_Stardust_Shower_Attack',1],[STARDUST_BALL,total,{templateInstanceCaps}],
      ['EffectSet_ATT_Stardust_Shower_End',1],
    ]);
  }
  return {groups,unconfirmedRoots};
}
