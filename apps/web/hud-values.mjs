/** X2GageUI1416..1429: the original MP_ACTIVE uses charge / THREE_CHARGE,
 * independent of an actor's expanded maximum MP. No display-owned timer. */
export function manaBreakGauge(actor) {
  // Elesis annihilation uses the dedicated red sword layer, not MP_ACTIVE.
  const swordCharge=isElesisProfession(actor.professionId)&&actor.wayOfSword?.state===-2;
  const charge=swordCharge?0:Math.max(0,actor.manaBreak?.charge??0),maximum=actor.manaBreak?.maxCharge??300;
  return {charge,fraction:maximum>0?Math.max(0,Math.min(1,charge/maximum)):0,maximum};
}

/** Fixed-V5 X2GageUI::UpdateHyperModeRemainTime: positive truncation + 1,
 * including an exact integer. This is not the skill-CD ceil rule. */
export function awakeningCountdown(remaining) {
  const seconds=Number.isFinite(remaining)&&remaining>0?Math.trunc(remaining)+1:0;
  return {seconds,text:seconds?`${seconds}s`:'',urgent:seconds>0&&seconds<8};
}

/** Native GageManager zeroes unobservable enemy MP; preserve the empty frame. */
export function opponentGauges(local, target) {
  const clamp = value => Math.max(0, Math.min(1, value));
  const hpMax = target.hpMax ?? target.maxHp;
  const mpMax = target.mpMax ?? target.maxMp;
  const showMp = local.uiAbilities?.showOpponentMp === true;
  return {
    hpFraction: hpMax > 0 ? clamp(target.hp / hpMax) : 0,
    hpText: `${Math.round(target.hp)} / ${Math.round(hpMax)}`,
    mpFraction: showMp && mpMax > 0 ? clamp(target.mp / mpMax) : 0,
    mpText: showMp ? `${Math.round(target.mp)} / ${mpMax}` : '',
    showMp,
  };
}
import {isElesisProfession} from '../../packages/professions/identity.mjs';
