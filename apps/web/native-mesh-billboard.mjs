import {Quaternion} from '@babylonjs/core/Maths/math.vector.js';

const DEG=Math.PI/180;

/** PT_MESH differs from a PT_3D_PLANE billboard. The mesh draw consumer
 * (fixed V5 ParticleSystem.cpp:4746..4770) adds the sequence axis rotation to
 * the particle's local rotation before GetMatrix(BT_ALL). It does not apply
 * the plane-only ReverseY branch. Supply the visual global rotation, not an
 * independently configured movement axis. DamageEffect's default BONE/POS
 * consumers assign both AddRotate and AxisAngle; impact/NULL children do not.
 * Call only for an uncontrolled PT_MESH with BT_ALL; source-controlled mesh
 * anchors and the quad's existing billboard path retain their own consumers.
 */
export function nativeMeshBillboardRotationToRef(billboard,local,globalRotation,out,scratch){
  const pitch=local[0]+globalRotation[0],yaw=local[1]+globalRotation[1],roll=local[2]+globalRotation[2];
  Quaternion.RotationYawPitchRollToRef(-yaw*DEG,-pitch*DEG,roll*DEG,scratch);
  billboard.multiplyToRef(scratch,out);
  return out;
}
