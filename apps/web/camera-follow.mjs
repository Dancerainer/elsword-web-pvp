/** Normal tracking from the fixed V5 source, on every axis.
 * GUUser's disabled-dynamic-camera branch requests the normal .3s/0 track;
 * Game then calls Camera::OnFrameMove -> CKTDGCamera::UpdateCamera.
 * Point is initialization only: calling it after tracking overwrites positions
 * and clears both source timers. There is no extra centering/smoothing pass.
 * The caller must pass the same displayed actor used for drawing the model.
 * Fixed V5 is a source reference, not a measured target2016 camera.
 */
export function advanceNormalCamera(bridge,points,policy,dt,previous){
  const remember=value=>points.lineCamera?{...value,lineCamera:points.lineCamera}:value;
  if(!previous)return remember(bridge.init(points));
  const absolute=!!points.lineCamera?.absolute;
  bridge.setTracking({...points,eyeSeconds:absolute?.4:policy.trackingSeconds,targetSeconds:absolute?0:policy.targetTrackingSeconds});
  return remember(bridge.advance(dt));
}
