import {Quaternion} from '@babylonjs/core/Maths/math.vector.js';
const DEG=Math.PI/180;

/** ParticleSystem3884..3892 selects RotateLocal for BT_ALL. Matrix171..191
 * applies local rotation before the transposed view rotation. Native Z is
 * reflected by the renderer, so native pitch/yaw change sign, roll does not.
 * Unit/attachment rotation is deliberately absent from this billboard branch.
 */
export function nativeBillboardRotationToRef(billboard,angles,reverseY,out,scratch){
  Quaternion.RotationYawPitchRollToRef(-(angles[1]+(reverseY?180:0))*DEG,-angles[0]*DEG,angles[2]*DEG,scratch);
  billboard.multiplyToRef(scratch,out);
  return out;
}
