/** Fixed-V5 Data -> mesh -> EffectSet order, separate from unit frame movement.
 * SetPos writes MeshInstance.m_vPos; its XSkinAnim matrix changes only during
 * the next mesh OnFrameMove. DamageManager reads that cached matrix.
 * Target2016 main-loop/Now-Future order remains unmeasured.
 */
export function usesSourceTracePosition(effect) {
  return !!effect.damage && !Object.hasOwn(effect,'sourceTargetMeshId') && !effect.sourceArcHandle && !effect.sourceShadowMesh &&
    effect.definition.TRACE_MATRIX !== 1 &&
    (effect.definition.TRACE === 1 || effect.definition.TRACE_MORE === 1);
}

export function advanceTraceMeshPose(effect, actor, sampleAnchor) {
  if (!effect.active || effect.dead || !usesSourceTracePosition(effect)) return;
  const pending = effect.currentAnchor ?? effect.birthAnchor;
  if (!pending) return;
  effect.sourcePosedAnchor = structuredClone(pending);
  const next = sampleAnchor?.(effect, actor);
  if (next) {
    // EffectSet::OnFrameMove_UpdateEffect calls SetPos, not SetRotate. The
    // owner's new facing cannot rotate a live TRACE mesh a second time.
    effect.currentAnchor = {...structuredClone(pending),position:[...next.position]};
    [effect.x, effect.y, effect.z] = next.position;
  }
}
