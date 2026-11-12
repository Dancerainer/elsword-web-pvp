import originalSource from '../../contracts/equipment-2016-source-v1.json' with {type:'json'};
import elesisSource from '../../contracts/elesis-equipment-source-v1.json' with {type:'json'};
import addSource from '../../contracts/add-equipment-2016-source-v1.json' with {type:'json'};

const source={...originalSource,character:{...originalSource.character,...elesisSource.character,...addSource.character},career:{...originalSource.career,...elesisSource.career,...addSource.career},items:{...originalSource.items,...elesisSource.items,...addSource.items}};
export const SOURCE_EQUIPMENT_VERSION='na2016-perkisas-mk4-base-v1';
export const INFERRED_CHARACTER_POLICY='target-table-growth-inference-v1';
export const EQUIPMENT_REFERENCE_POLICY='fixed-v5-enhance-ranked-pvp-v1';
export const BASE_FIELDS=Object.freeze(['hpMax','physicalAttack','magicAttack','physicalDefence','magicDefence']);
const f=Math.fround;
const careers={RF:['UT_RAVEN','UC_RAVEN_RECKLESS_FIST'],LK:['UT_ELSWORD','UC_ELSWORD_LORD_KNIGHT'],VC:['UT_RAVEN','UC_RAVEN_VETERAN_COMMANDER'],RS:['UT_ELSWORD','UC_ELSWORD_RUNE_SLAYER'],BM:['UT_RAVEN','UC_RAVEN_BLADE_MASTER'],IS:['UT_ELSWORD','UC_ELSWORD_INFINITY_SWORD'],GM:['UT_ELESIS','UC_ELESIS_GRAND_MASTER'],BH:['UT_ELESIS','UC_ELESIS_BLAZING_HEART'],CA:['UT_ELESIS','UC_ELESIS_CRIMSON_AVENGER']};
Object.assign(careers,{LP:['UT_ADD','UC_ADD_LUNATIC_PSYKER'],MM:['UT_ADD','UC_ADD_MASTERMIND'],DE:['UT_ADD','UC_ADD_DIABOLIC_ESPER']});
const slots=Object.fromEntries(Object.entries(source.enums.EQIP_POSITION).map(([k,v])=>[v,k]));
const zero=()=>Object.fromEntries(BASE_FIELDS.map(k=>[k,0]));
function characterRows(profession){
  const keys=careers[profession];if(!keys)throw new TypeError('Unsupported equipment profession');
  return [source.character[keys[0]],source.career[keys[1]],source.enums];
}

/** Target CharacterStatTable.lua prototypes 0/1. Lua evaluates in double;
 * consumer table inputs are float32. This computes item base stats only. */
export function sourceItemBase(profession,itemId){
  const [B,A]=characterRows(profession),item=source.items[itemId];
  if(!item)throw new TypeError('Unsupported source equipment item');
  const unit={UT_ELSWORD:1,UT_RAVEN:4,UT_ELESIS:elesisSource.unitType,UT_ADD:9}[careers[profession][0]];
  if(item.unitType!==0&&item.unitType!==unit)throw new TypeError('Equipment unit mismatch');
  const C=source.slots[slots[item.slot]],L=item.useLevel;
  if(!C)throw new TypeError('Unsupported equipment slot');
  return Object.fromEntries(BASE_FIELDS.map(k=>{
    const a=f(A[k]),b=f(B[k]),c=f(C[k]),e=item.relativeLevels[k];
    const raw=k==='hpMax'?c*(e/10*((a+a*(L-1)*.15)-b-b*(L-1)*.15)):
      c*((a+a*(L+e-1)*.15)-b*.8-b*(L+e-1)*.0225);
    return [k,Math.floor(raw+.5)];
  }));
}

/** Explicit inference, not a recovered 2016 server StatTable. The naked
 * growth terms are the B terms removed by the target item formulas. The
 * special level-one PvP anchor comes from A; cross-check V5 separately. */
export function inferCharacterBase(profession,level,policy){
  if(policy!==INFERRED_CHARACTER_POLICY)throw new TypeError('Explicit inferred character policy required');
  if(level!==85)throw new TypeError('Only the requested level85 candidate is supported');
  const [B,A]=characterRows(profession);
  return {levelOne:Object.fromEntries(BASE_FIELDS.map(k=>[k,Math.floor(A[k]*(k==='hpMax'?1:.8)+.5)])),
    naked:Object.fromEntries(BASE_FIELDS.map(k=>[k,Math.floor(B[k]*(k==='hpMax'?1+.15*(level-1):.8+.0225*(level-1))+.5)]))};
}

/** Fixed V5 Inventory.cpp truncates each enhanced item before summing.
 * GSUserFunction.cpp:12164-12235 truncates separate stat channels and keeps
 * equipment HP out of the attack/defence 10% resize. Normal ranked PvP only. */
export function calculateSourceEquipmentCandidate({profession,level=85,weaponLevel,
  characterPolicy,referencePolicy,weaponEnhancement=11}={}){
  if(referencePolicy!==EQUIPMENT_REFERENCE_POLICY)throw new TypeError('Explicit V5 equipment reference policy required');
  if(![80,85].includes(weaponLevel))throw new TypeError('Explicit weapon level80 or85 required');
  if(![9,11].includes(weaponEnhancement))throw new TypeError('Only weapon enhancement9 or11 is supported');
  const character=inferCharacterBase(profession,level,characterPolicy);
  const weaponId=careers[profession][0]==='UT_ELESIS'?elesisSource.weaponByLevel[weaponLevel]:
    careers[profession][0]==='UT_ADD'?(weaponLevel===85?30531:30412):careers[profession][0]==='UT_ELSWORD'?(weaponLevel===85?30507:30388):(weaponLevel===85?30516:30397);
  const equipment=zero();
  const items=[weaponId,153795,153796,153797,153798].map((itemId,index)=>{
    const enhancement=index===0?weaponEnhancement:9,enhancementRate=f(enhancement===11?2.55:1.75);
    const base=sourceItemBase(profession,itemId);
    const enhanced=Object.fromEntries(BASE_FIELDS.map(k=>[k,Math.trunc(f(base[k]*enhancementRate))]));
    for(const key of BASE_FIELDS)equipment[key]+=enhanced[key];
    return {itemId,enhancement,base,enhanced};
  });
  const pvp=Object.fromEntries(BASE_FIELDS.map(k=>[k,character.levelOne[k]+
    Math.trunc(f(f(character.naked[k]-character.levelOne[k])*f(.1)))+Math.trunc(f(equipment[k]*f(.1)))]));
  pvp.hpMax=Math.trunc(f(character.levelOne.hpMax*f(2.7)))+
    Math.trunc(f(f(character.naked.hpMax+equipment.hpMax-character.levelOne.hpMax)*f(.6)));
  return {version:SOURCE_EQUIPMENT_VERSION,profession,level,weaponLevel,weaponEnhancement,characterPolicy,referencePolicy,
    items,character,equipment,pvp,excludes:'All passive/guild/socket/set/title/special effects',
    targetRuntimeVerified:false};
}

/** Existing profession/guild grants remain separate from equipment. The
 * acquired ranked-PvP consumer scales each flat grant channel by .1. A
 * character HP passive changes naked HP before the HP normalization. */
export function applySourcePvpStatPassives(stats,baseline,policy,guildFlat={}){
  const next={...stats},resize=v=>Math.trunc(f(f(v)*f(.1)));
  for(const key of BASE_FIELDS){
    const passive=key==='physicalAttack'?policy?.stats?.physicalAttackAdd??0:
      key==='magicAttack'?policy?.stats?.magicAttackAdd??0:0;
    if(key!=='hpMax')next[key]+=resize(passive)+resize(guildFlat[key]??0);
  }
  const hpRate=policy?.stats?.hpMultiplier??1;
  if(hpRate!==1){
    const naked=baseline.character.naked.hpMax,anchor=baseline.character.levelOne.hpMax;
    // Server CalulateIncreaseingRate is rate-1, without the client's soul EPS.
    const modified=naked+Math.trunc(f(naked*f(f(hpRate)-1)));
    // Preserve any explicit actor test override as an additive baseline delta.
    const before=Math.trunc(f(f(naked+baseline.equipment.hpMax-anchor)*f(.6)));
    const after=Math.trunc(f(f(modified+baseline.equipment.hpMax-anchor)*f(.6)));
    next.hpMax+=after-before;
  }
  return next;
}
