/** Add's actual+1a4(0) getter31fcb9e0→32e32ef0 reads, but does not advance,
 * an existing u16 table index. Explicit captured seed takes precedence; the
 * existing frozen-frame Web seed policy is an identified instance adapter. */
import {currentMissSeedInput2016} from './source-miss-host-v53.mjs';
import {sourceRandomFloat2016} from './source-miss-v53.mjs';
export function addPassiveSample2016(sim,actor){
 const seed=actor.sourceHitSeed!==undefined?actor.sourceHitSeed:sim.state?currentMissSeedInput2016(sim,actor):undefined;
 const result=sourceRandomFloat2016(seed,0);
 if(!result.supported)sim.note?.('add-passive-seed-required','Original passive index or the explicit Web frozen-frame seed policy is required',actor);
 return result;
}
