/** Display only. The authoritative simulation still executes each complete
 * fixed tick. RAF samples between the last two completed poses; it never
 * advances combat, predicts a collision, or blends bone matrices.
 *
 * This is a browser timing adapter, not a measured original-client policy.
 * Rendering trails and the normal camera must consume these same actors.
 */
import { PASSIVE_REACTION_STATES } from '../../packages/online/owned-motion.mjs';

const coordinates = ['x', 'y', 'z'];
const reactions = new Set(PASSIVE_REACTION_STATES);
const copyTransition = value => value == null ? value : structuredClone(value);
const lerp = (a, b, alpha) => a + (b - a) * alpha;

function reactionBoundary(previous, current) {
  return (reactions.has(previous.state) || reactions.has(current.state)) &&
    (previous.state !== current.state || previous.stateSerial !== current.stateSerial ||
      previous.animationName !== current.animationName ||
      previous.animationTransitionSerial !== current.animationTransitionSerial);
}

export function captureActorPresentation(actor) {
  const result = Object.fromEntries(['id', ...coordinates, 'facing', 'state', 'stateSerial',
    'animationName', 'animationTime', 'animationLoop', 'animationTransitionSerial',
    'deathAlpha', 'hidden', 'deathComplete'].map(key => [key, actor[key]]));
  result.presentationTransition = copyTransition(actor.presentationTransition);
  result.core = actor.core ? { ...actor.core } : null;
  return result;
}

/** Continuous values interpolate only inside their original controller track.
 * A new state, facing, hitstop, invincibility and armor are immediately current.
 * Clocks may not interpolate backwards across a loop/seek or a new core phase.
 */
export function interpolateActorPresentation(previous, current, alpha) {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('Render alpha must be in [0, 1]');
  if (!previous || previous.id !== current.id || alpha === 1) return current;
  const shown = { ...current };
  // A confirmed simulation reaction already selects the current animation.
  // Interpolating its position from the previous controller would draw the
  // new launch/fall/landing pose at an old phase's position for one fixed tick.
  // Keep that boundary atomic. Continuous movement, including subsequent
  // ticks of the same reaction, retains ordinary interpolation. This is a Web
  // presentation adapter; it does not execute or predict a combat transition.
  const boundary = reactionBoundary(previous, current);
  for (const key of coordinates) if (!boundary && Number.isFinite(previous[key]) && Number.isFinite(current[key]))
    shown[key] = lerp(previous[key], current[key], alpha);
  const sameTrack = previous.stateSerial === current.stateSerial &&
    previous.animationName === current.animationName &&
    previous.animationTransitionSerial === current.animationTransitionSerial &&
    Number.isFinite(previous.animationTime) && Number.isFinite(current.animationTime) &&
    current.animationTime >= previous.animationTime;
  if (sameTrack) {
    shown.animationTime = lerp(previous.animationTime, current.animationTime, alpha);
    const a = previous.presentationTransition, b = current.presentationTransition;
    if (a && b && a.serial === b.serial && a.enabled === b.enabled && b.elapsedSeconds >= a.elapsedSeconds)
      shown.presentationTransition = { ...b, elapsedSeconds: lerp(a.elapsedSeconds, b.elapsedSeconds, alpha) };
  }
  if (Number.isFinite(previous.deathAlpha) && Number.isFinite(current.deathAlpha))
    shown.deathAlpha = lerp(previous.deathAlpha, current.deathAlpha, alpha);
  const a = previous.core, b = current.core;
  if (a && b && a.phase === b.phase && a.animationName === b.animationName) {
    shown.core = { ...b };
    for (const key of coordinates) if (!boundary && Number.isFinite(a[key]) && Number.isFinite(b[key]))
      shown.core[key] = lerp(a[key], b[key], alpha);
    if (Number.isFinite(a.animationTime) && Number.isFinite(b.animationTime) && b.animationTime >= a.animationTime)
      shown.core.animationTime = lerp(a.animationTime, b.animationTime, alpha);
  }
  return shown;
}

/** Copy only the presentation fields: view() exposes mutable core objects.
 * reset() is required after a restore, manual step, inspector or pause toggle;
 * those operations must display the exact requested authoritative pose.
 */
export function createActorRenderClock() {
  let previous = new Map(), current = new Map();
  function capture(actors) { return new Map(actors.map(actor => [actor.id, captureActorPresentation(actor)])); }
  return {
    reset(actors) { current = capture(actors); previous = current; },
    push(actors) { previous = current; current = capture(actors); },
    sample(actors, alpha, { exact = false } = {}) {
      return actors.map(actor => exact ? actor : interpolateActorPresentation(previous.get(actor.id), actor, alpha));
    },
  };
}
