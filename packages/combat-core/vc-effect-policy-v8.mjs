/** Explicit project rules. These are web adaptations;
 * original damage declarations remain unchanged and are not historical gold.
 * Use accepted hitCount, never collision receipts, to distinguish a hit from
 * an invincible/dead/same-team contact. There is no added actor/effect state. */
const silentResiduals=new Set(['RAVEN_BARRAGE_ATTACK_EXTRA_MEMO','DAMAGE_EFFECT_A_RWT_FLAME_SWORD_MEMO']);
const delayedBombs=new Map([
  ...[1,2,3].map(i=>['DAMAGE_EFFECT_SHADOW_BACK_SLIDE_BULLET_'+i,'DAMAGE_EFFECT_SHADOW_BURSTER']),
  ...[1,2,3].map(i=>['DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_'+i,'DamageEffect_RVC_Napalm_Grenade_Flame']),
]);
export function veteranResidualHitAudioMuted(profile,effect){
  return profile?.target?.unitClass===115&&silentResiduals.has(effect?.name);
}
export function allowVeteranResidualChild(profile,effect,definition){
  if(profile?.target?.unitClass!==115||delayedBombs.get(effect?.name)!==definition?.DAMAGE_EFFECT_NAME)return true;
  // These projectiles bounce on land and normally expire by their authored
  // LifeTime. Only that miss creates the ground-check successor. A hit first
  // creates the authored impact explosion and consumes the projectile.
  return !(effect.hitCount>0)&&effect.endReason==='template-life-time';
}
