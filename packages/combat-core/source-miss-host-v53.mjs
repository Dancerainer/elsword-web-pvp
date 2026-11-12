/** Explicit current-simulation instance inputs for the recovered2016 Miss
 * functions. Original property reset/base values come from the source contract;
 * an original u16 seed is accepted only as an explicit actor input. */
import {sourceAccuracyBuffGroups2016,sourceAccuracyProperty2016,evaluateSourceMiss2016} from './source-miss-v53.mjs';
export const SOURCE_MISS_SEED_POLICY='web-frozen-match-seed-target-id-frame-v53';
/** This is an explicit Web instance-input policy, not a recovered original
 * seed producer. Repeated queries in one target frame have the same u16 and
 * do not consume the combat RNG. An explicit captured seed takes precedence. */
export function currentMissSeedInput2016(sim,target){
 if(target.sourceHitSeed!==undefined)return target.sourceHitSeed;
 if(sim.state.sourceHitSeedPolicy!==SOURCE_MISS_SEED_POLICY)return undefined;
 let value=sim.state.sourceHitSeedBase>>>0;
 for(const c of target.id)value=Math.imul(value^c.charCodeAt(0),16777619)>>>0;
 value=(value^Math.imul(sim.state.step+1,2654435761))>>>0;
 value^=value<<13;value^=value>>>17;value^=value<<5;
 return value&65535;
}
export function actorSourceAccuracy2016(actor,type){
 const grouped=sourceAccuracyBuffGroups2016(actor.buffs?.flatMap(b=>b.behaviors)??[],type);
 if(!grouped.supported)return grouped;
 // 321de520 base1;321de7a0 resets temporary additive0/multiplier1. The
 // current Web instance has no additional unmodelled relation objects.
 return sourceAccuracyProperty2016({base:1,temporaryPercent:0,temporaryMultiplier:1,temporaryAdd:0,groups:grouped.groups});
}
export function currentSourceMiss2016(sim,owner,target,damage,origin){
 if(origin.sourceAddSummonSerial!==undefined)return {supported:false,reason:'npc-accuracy-instance-unavailable'};
 const accuracy=actorSourceAccuracy2016(owner,14),avoidance=actorSourceAccuracy2016(target,15);
 if(!accuracy.supported||!avoidance.supported)return !accuracy.supported?accuracy:avoidance;
 const profile=sim.profileFor(owner),skills={};
 for(const id of [24406,104]){
  const level=owner.passivePolicy?.skillLevels?.[id],row=profile.skillCatalog.find(s=>s.skillId===id);
  if(level&&row?.raw.SA_ACCURACY_PERCENT_ABS?.[level]!==undefined)skills[id]={level,accuracyPercent:row.raw.SA_ACCURACY_PERCENT_ABS[level]};
 }
 const raw=sim.profileFor(target).states[target.state]?.raw??{},windows=[];
 for(const kind of ['REVENGE','REFLEX_MAGIC'])if(raw[kind])windows.push({kind,begin:raw[kind]['1'],end:raw[kind]['2']});
 // Direction uses the current actual attack/defender positions. No historical
 // target position or seed is fabricated by this host adapter.
 const directionByte=(owner.x-target.x)*target.facing>=0?1:0;
 return evaluateSourceMiss2016({selector:origin.kind==='effect'?1:0,
  owner:{kind:'player',classId:profile.target.unitClass,accuracy:accuracy.value,accuracyMultiplier:1,skills,accuracyBonus:0},
  target:{kind:'player',modelPresent:true,windows,modelClock:target.animationTime,directionByte,evasionRecords:0,
   avoidance:avoidance.value,invincible:target.invincible||target.forceInvincible>0,seed:currentMissSeedInput2016(sim,target)},
  damage:{NO_MISS:damage.NO_MISS??false,HP_PERCENT_UP:damage.HP_PERCENT_UP??0,MP_PERCENT_UP:damage.MP_PERCENT_UP??0,INCREASE_MP:damage.INCREASE_MP??0}});
}
