/** Authored native line orientation shared by rendering, camera and pose helpers.
 * Fixed V5 MakeLine/User consumers; target2016 runtime remains unmeasured.
 * See contracts/rf-camera-line-source-v2.json. No skill/projectile offset policy
 * lives here: this is only the character's saved world yaw and lane direction.
 */
export function authoredLineBasis(actor,map){
  if(!actor||!Array.isArray(map?.lines))throw new TypeError('Camera requires an actor and authored map lines');
  const lineId=actor.lineId??actor.lastTouchLineId;
  const line=map.lines.find(candidate=>candidate.lineId===lineId);
  if(!line)throw new TypeError('Camera requires the saved original line basis');
  const start=line.start,end=line.end;
  if(![start,end].every(point=>Array.isArray(point)&&point.length===3&&point.every(Number.isFinite)))
    throw new TypeError('Camera line endpoints must be finite native vec3 values');
  if(actor.facing!==1&&actor.facing!==-1)throw new TypeError('Camera facing must be 1 or -1');
  const delta=end.map((coordinate,i)=>coordinate-start[i]),length=Math.hypot(...delta);
  if(!Number.isFinite(length)||!length||!Math.hypot(delta[0],delta[2]))
    throw new TypeError('Camera zero/vertical line basis is unsupported');
  const dirVector=delta.map(coordinate=>coordinate/length);
  // MakeLine 725-748: inverse LookAtLH, exchanged X/Z columns, then
  // atan2(-_31,_33). For a Y-up line this reduces to atan2(-Z,X).
  const yaw=Math.atan2(-dirVector[2],dirVector[0])+(actor.facing<0?Math.PI:0);
  return {lineId,dirVector,yRotationDegrees:yaw*180/Math.PI,rendererYawRadians:-yaw};
}

/** Native XYZ yaw quaternion. Omitted map retains the historical standalone
 * straight-lane fixture interface; production callers supply their actual map.
 * Straight +X lanes use the old literal quaternions, preserving exact numbers
 * instead of introducing sin(pi)/cos(pi/2) residue into existing trajectories.
 */
export function actorWorldQuaternion(actor,map){
  if(map===undefined)return actor.facing<0?[0,1,0,0]:[0,0,0,1];
  const basis=authoredLineBasis(actor,typeof map==='function'?map():map);
  if(basis.dirVector[2]===0&&basis.dirVector[0]>0)return actor.facing<0?[0,1,0,0]:[0,0,0,1];
  const halfYaw=-basis.rendererYawRadians/2;
  return [0,Math.sin(halfYaw),0,Math.cos(halfYaw)];
}
