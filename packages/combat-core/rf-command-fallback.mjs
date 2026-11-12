/** Missing RF EventProcess consumers, qualified fixed-V5 reference adapters.
 * Target2016 provides ATTACK_CANCEL_AFTER; unchanged Raven callbacks provide
 * the strict held-key skip and WAIT successor. This is not a 2016 recording.
 * Other target cancel fields retain their existing independent dispatch.
 */
export const RF_COMMAND_FALLBACK_VERSION='rf-command-held-skip-v1';
export const RF_COMMAND_FALLBACK_STATES=Object.freeze(['RSI_COMBO_XXX','RSI_DASH_COMBO_ZZ','RSI_DASH_COMBO_X']);
const skipStates=new Set(RF_COMMAND_FALLBACK_STATES);
const skipKeys=['UP','DOWN','LEFT','RIGHT','Z','X','A','S','D','C','F','Q','W','E','R'];
export function rfCommandFallbackEvent(actor,keys,definition){
  if(!skipStates.has(actor.state))return null;
  const time=Math.fround(actor.animationTime),limit=definition.raw.ATTACK_CANCEL_AFTER;
  const duration=definition.clip?.durationSeconds;
  const ended=actor.animationStopped||Number.isFinite(duration)&&
    time>Math.fround(duration-Math.max(duration/10,.03));
  if(ended)return {state:'RSI_WAIT',reason:'reference-rf-command-animation-end'};
  if(Number.isFinite(limit)&&time>Math.fround(limit)&&skipKeys.some(key=>keys.held.has(key)))
    return {state:'RSI_WAIT',reason:'reference-rf-command-held-skip'};
  return null;
}
