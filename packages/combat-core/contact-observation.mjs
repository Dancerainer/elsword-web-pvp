/** A bounded local observation of another player, not authority over that
 * player's life or resources. Kept as plain data in combat snapshots so a
 * replay does not need a renderer, network clock or callback to reproduce it.
 * These are Web adapter fields, not a recovered target2016 wire schema. */
export const CONTACT_FIELDS=Object.freeze(('x y z vx vy vz passiveSpeed facing state stateTime stateSerial '+
  'animationTime animationName animationLoop animationBeforeTime animationOneshotTimer animationPlaybackSpeed '+
  'animationTransitionSerial animationStopped animationSpeedRamp presentationTransition applyMotionOffset '+
  'consumeRootTranslation rootMotionEnabled grounded lineId lastTouchLineId landPosition hp mp awakening core '+
  'skillId skillContext hitStop worldStop invincible forceInvincible showInvincible superArmor superArmorNotRed skillSuperArmorNotRed '+
  'limitCrusherCharging skillScale knockdown manaBreak flyCount lastAttackerFront buffs buffControls '+
  'wayOfSword destructionRageRemaining sourceLordKnight sourceVeteranCommander stats skillDamageReducePercent '+
  'passivePolicy buffBaseStats effectiveBlackHoleIds sourceBlackHoleCanPass').split(' '));

export function captureContactObservation(actor){
  const result={};
  for(const key of CONTACT_FIELDS)if(actor[key]!==undefined)result[key]=actor[key];
  return structuredClone(result);
}

export function contactObservation(actor,observations,attackerId,ownerId){
  if(ownerId===null||attackerId!==ownerId||actor?.id===ownerId)return actor;
  const saved=observations?.[actor?.id];
  // A delayed view must never revive a dead/disconnected player or bypass
  // room protection at a new life. Only ordinary remote contact is observed.
  if(!saved||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected||actor.hidden||actor.pvpPresentation)return actor;
  const view={...actor};
  // Clear absent historical fields as well; do not inherit a later guard or
  // skill modifier merely because JSON omitted an undefined earlier value.
  for(const key of CONTACT_FIELDS)view[key]=saved[key];
  if(actor.pvpInvincibleRemaining>0)view.forceInvincible=Math.max(actor.forceInvincible??0,actor.pvpInvincibleRemaining);
  return view;
}

/** A verified late contact may use an older body pose, never older owner
 * protection, resources, skill state or reaction inputs. This view is consumed
 * only by geometry queries; applyHit still receives the real current actor. */
export const OWNED_CONTACT_GEOMETRY_FIELDS=Object.freeze(('x y z facing lineId lastTouchLineId landPosition '+
  'animationName animationTime animationLoop animationTransitionSerial presentationTransition consumeRootTranslation applyMotionOffset rootMotionEnabled').split(' '));
export function captureOwnedContactGeometry(actor){
  const pose={};for(const key of OWNED_CONTACT_GEOMETRY_FIELDS)if(Object.hasOwn(actor,key))pose[key]=actor[key];
  return structuredClone(pose);
}
export function ownedContactGeometry(actor,scope,attackerId,ownerId){
  if(!actor||ownerId==null||actor.id!==ownerId||attackerId==null||attackerId===ownerId||!scope||
    scope.playerId!==actor.id||scope.attackerId!==attackerId||!Number.isSafeInteger(scope.epoch)||scope.epoch<0||
    !scope.pose||typeof scope.pose!=='object'||Array.isArray(scope.pose)||
    !['x','y','z'].every(key=>Number.isFinite(scope.pose[key])))return actor;
  const posed={...actor},pose=captureOwnedContactGeometry(scope.pose);
  for(const key of OWNED_CONTACT_GEOMETRY_FIELDS){if(Object.hasOwn(pose,key))posed[key]=pose[key];else delete posed[key];}
  return posed;
}
