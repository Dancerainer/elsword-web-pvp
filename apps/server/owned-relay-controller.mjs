// Called only after the room has validated an owner report. Source controller
// boundaries are already reported immediately by the browser; applying the
// ordinary movement pacer again would quantize them a second time. Positions,
// resources and continuous clocks deliberately do not make a pose urgent.
export function ownedRelayControllerSignature(report){
  const actor=report.actor;
  return JSON.stringify([report.epoch,actor.state,actor.stateSerial,actor.facing,
    actor.grounded,actor.lineId,actor.animationTransitionSerial]);
}

export function observeOwnedRelayController(signatures,playerId,signature){
  const previous=signatures.get(playerId);signatures.set(playerId,signature);
  return previous!==undefined&&previous!==signature;
}
