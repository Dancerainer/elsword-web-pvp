import {rotateNative} from '../effect-runtime/index.mjs';
export const ADD_AWAKENING_ATTACK_SET='EffectSet_AN_Hyper_Attack';
export const ADD_AWAKENING_ATTACK='DamageEffect_AN_Hyper';
export function addAwakeningThreshold(predicate){
 if(predicate!==0&&predicate!==1)throw new TypeError('Explicit target2016 actor6d7e predicate input required');
 return predicate===1?Math.fround(.24):Math.fround(.6);
}
export function fireAddAwakeningAttack(sim,a,before,after){
 const profile=sim.profileFor(a),input=profile.referenceSemantics.awakening.nativePredicateInput;
 if(input!==0&&input!==1){sim.note('add-awakening-predicate-input','Original6d7e instance input must be supplied independently of formation',a);return false;}
 sim.fire(a,'add:awakening-target2016-attack',addAwakeningThreshold(input),before,after,()=>{
  // Nonzero delayed queue trigger clears groupbc; member .05 is then group
  // elapsed, not another offset into the actor animation controller.
  sim.spawnSet({...a,skillId:null,skillScale:1,skillContext:null},ADD_AWAKENING_ATTACK_SET,1,[2]);
 });return true;
}
/** Original invisible Normal mesh has two static bound-node centers±25 and
 * D3DX radius43.30126953125. Apply this live instance's SRT layers. The
 * missing GLB renderer is irrelevant to its source DrawCount0 declaration. */
export function addAwakeningAttackShapes(e,profile){
 if(e.name!==ADD_AWAKENING_ATTACK)return null;
 const p=(e.currentAnchor??e.birthAnchor)?.position;if(!p)return [];
 const template=profile.effectTemplates?.Mesh_AN_Hyper_Attack,base=template?.initialSize;if(!base)return [];
 const scale=base.map((n,i)=>n*(e.definition[['SCALE_X','SCALE_Y','SCALE_Z'][i]]??1)),rotation=(e.currentAnchor??e.birthAnchor).rotation??[0,e.facing<0?180:0,0];
 return [-25,25].map(x=>({kind:'sphere',center:rotateNative([x*scale[0],0,0],rotation).map((n,i)=>n+p[i]),radius:Math.fround(43.30126953125*scale[0]),evidence:'original2016 bound-node sphere radius/SRT; current live anchor, no target-client trajectory'}));
}
