/** Explicit target2016 command adapters where the sealed older callback
 * does not read the target window. GUUser macros supply strict comparisons.
 * This list is reviewed action by action, not inferred from arbitrary fields.
 * Matching V6 EventProcess ordering is unavailable; simultaneous non-direction
 * edges retain the existing class callback's priority.
 */
import {afterCancel} from './skill-command-cancels.mjs';
export const RAVEN_COMMAND_CANCEL_VERSION='raven-reviewed-target-command-windows-v1';
const states=new Set(['RSI_COMBO_ZZ','RSI_COMBO_ZZZZ','RSI_COMBO_ZZXX','RSI_DASH_JUMP_COMBO_ZZ_Landing',
  'RRF_COMBO_ZZXFRONTXX','RSI_OVER_TAKER_COMBO_XXdownX','RSI_OVER_TAKER_COMBO_XXfrontXX4','RSI_OVER_TAKER_COMBO_XXfrontXXdownX']);
export function ravenCommandCancel(a,def,input){
  if(!states.has(a.state)||!a.grounded||a.cancelInput)return null;
  const raw=def.raw;
  if([...input.pressed].some(k=>!['LEFT','RIGHT','UP','DOWN','DASH','AWAKEN'].includes(k)))return null;
  if(input.pressed.has('AWAKEN')&&afterCancel(a.animationTime,raw.SKILL_CANCEL_AFTER))return {state:'AWAKEN_REQUEST'};
  if((input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH'))&&afterCancel(a.animationTime,raw.DASH_CANCEL_AFTER))
    return {state:'DASH_REQUEST'};
  // A blocked/early double must not be demoted to a backward single press.
  if(input.pureDoubleLeft||input.pureDoubleRight||input.pressed.has('DASH'))return null;
  const back=input.held.has(a.facing===1?'LEFT':'RIGHT');
  if(back&&afterCancel(a.animationTime,raw.BWALK_CANCEL_AFTER)||
    (input.held.has('LEFT')||input.held.has('RIGHT'))&&afterCancel(a.animationTime,raw.WALK_CANCEL_AFTER))return {state:'RSI_WAIT'};
  return null;
}
