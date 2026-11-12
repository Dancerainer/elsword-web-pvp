/** Original2016 HA description shares HP/Attack/Defence/Critical. The exact
 * NPC stat-copy consumer is unavailable; this explicit base-stat adapter does
 * not inherit owner buffs, resource systems, guards, reactions or score. */
import {computePvpBaseDamage,applyPvpFinalDamageStage,applyPvpEquipmentReduction} from './pvp-damage-formulas.mjs';
import {evaluateHitCritical} from './critical-hit.mjs';
const keys=['physicalAttack','magicAttack','weaponPhysicalAttack','weaponMagicAttack','physicalDefence','magicDefence',
 'criticalRate','criticalAttack','criticalDefence','antiCriticalRate'];
export function addSummonCombatActor(owner){
 const base=owner.buffBaseStats;
 if(!base)throw new TypeError('Apocalypse requires frozen owner base attributes');
 const stats=Object.fromEntries(keys.filter(k=>base[k]!==undefined).map(k=>[k,base[k]]));
 return {id:owner.id,team:owner.team,stats,buffBaseStats:{...stats},formulaRules:{...owner.formulaRules},equipmentAttributes:{},buffs:[],
  // Both damage and pose callers spread this over the owner. Suppress its
  // character-only guild callbacks explicitly, just as buffs/passives above:
  // an NPC numeric proxy has no character equipment speed/resource context.
  awakening:{remaining:0},sourceAdd:null,passivePolicy:null,guild:null,pvpModifiers:{},wayOfSword:null,hpMax:owner.hpMax};
}
/** Numeric-only stage shared by NPC as attacker or defender. Callers provide
 * an explicit random roll; this function owns no clocks, RNG or game state.
 * Optional final channels are explicit ordinary-character inputs. An NPC's
 * corresponding channels remain 1/0, never copied from its owner implicitly. */
export function computeAddSummonHitDamage({attacker,defender,data,powerMultiplier=1,nativeCritical=null,roll,
 attackStatMultiplier=1,attackFinalMultiplier=1,defenceFinalMultiplier=1,damageReduction=0,skillBonus=0,traitPolicy={}}){
 const a=attacker.stats,b=defender.stats;
 const base=computePvpBaseDamage({damageType:data.DAMAGE_TYPE??0,
  physicalMultiplier:data.DAMAGE?.PHYSIC??0,magicMultiplier:data.DAMAGE?.MAGIC??0,
  physicalAttack:a.physicalAttack*attackStatMultiplier,magicAttack:a.magicAttack*attackStatMultiplier,
  weaponPhysicalAttack:a.weaponPhysicalAttack==null?undefined:a.weaponPhysicalAttack*attackStatMultiplier,
  weaponMagicAttack:a.weaponMagicAttack==null?undefined:a.weaponMagicAttack*attackStatMultiplier,
  physicalDefence:b.physicalDefence,magicDefence:b.magicDefence,attackerLevel:attacker.formulaRules?.combatLevel,
  penetrate:data.PENETRATE??false,ignoreDefence:data.IGNORE_DEFENCE??false,defencePierceMultiplier:traitPolicy.defencePierceMultiplier??1});
 if(!base.supported)return base;
 let amount=Math.max(0,applyPvpFinalDamageStage(Math.fround(base.amount*(data.PVP_RATE??1)*powerMultiplier*(1+skillBonus)),
  {attackFinalMultiplier,defenceFinalMultiplier}));
 if(data.NO_DAMAGE)amount=0;
 let critical=null;
 if(nativeCritical&&amount>0){
  if(typeof roll!=='number'||!Number.isFinite(roll)||roll<0||roll>=1)throw new TypeError('Explicit deterministic summon hit roll required');
  critical=evaluateHitCritical(nativeCritical,{amount,attacker,defender,data,traitPolicy,roll});amount=critical.amount;
 }
 if(!data.IGNORE_DEFENCE_DECLINE)amount=applyPvpEquipmentReduction(amount,damageReduction);
 return {supported:true,amount,critical,base,evidence:'target2016 shared-stat description + qualified fixed PvP/critical consumers; NPC-specific modifiers unresolved'};
}
