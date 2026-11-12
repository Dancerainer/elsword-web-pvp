/** Source-bound 2016 CA callbacks. See ca-commands-native-v58.json for exact
 * bytes. Existing raw .05 queue entries run independently and stay intact. */
const f=Math.fround;
export const CA_NATIVE_DASH_Z_PRODUCERS=Object.freeze({
 ESI_DASH_COMBO_SCA_ZZZ_START:Object.freeze([[.43,'EffectSet_C_SCA_Dash_ZZZ']]),
 ESI_DASH_COMBO_SCA_ZZZ_LOOP_1:Object.freeze([[.01,'EffectSet_C_SCA_Dash_ZZZ_Uppercut'],[.25,'EffectSet_C_SCA_Dash_ZZZ']]),
 ESI_DASH_COMBO_SCA_ZZZ_LOOP_2:Object.freeze([[.08,'EffectSet_C_SCA_Dash_ZZZ'],[.31,'EffectSet_C_SCA_Dash_ZZZ_Uppercut']]),
 ESI_DASH_COMBO_SCA_ZZZ_END:Object.freeze([[.37,'EffectSet_C_SCA_Dash_ZZZ_Finish']]),
});
/** undefined: another callback; null: continue into named cancels; true:
 * fresh Z consumed this callback. A successor wins before common adapters. */
export function caOriginalCommandEvent(a,name,keys,raw,result){
 if(a.professionId!=='CA')return undefined;
 if(name==='ESI_DASH_JUMP_COMBO_SDK_XX'){
  if(keys.pressed.has('X'))result.flags|=1;
  else if(keys.pressed.has('Z'))result.flags|=2;
  if(a.grounded)return result.flags&2?'ESI_COMBO_Z':result.flags&1?'ESI_DASH_JUMP_COMBO_SDK_XXX':'ESI_DASH_JUMP_COMBO_XX_LANDING';
  return null;
 }
 if(!Object.hasOwn(CA_NATIVE_DASH_Z_PRODUCERS,name))return undefined;
 if(name==='ESI_DASH_COMBO_SCA_ZZZ_END')return a.animationStopped?'RSI_WAIT':null;
 const loop=name.endsWith('_1')||name.endsWith('_2'),window=raw.EVENT_PROCESS_TIME0;
 if((result.flags&1)&&(f(a.animationTime)>f(window['3'])||a.animationStopped)){
  result.flags&=~1;
  return name.endsWith('_1')?'ESI_DASH_COMBO_SCA_ZZZ_LOOP_2':'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1';
 }
 if(keys.pressed.has('Z')&&(!loop||(a.sourceElesisCommand?.loops??0)<4)&&
    f(a.animationTime)>=f(window['1'])&&f(a.animationTime)<f(window['2'])){
  result.flags|=1;return true;
 }
 return a.animationStopped?(loop?'ESI_DASH_COMBO_SCA_ZZZ_END':'RSI_WAIT'):null;
}
export function caOriginalCommandWaveEvents(sim,a,name,before,after){
 if(a.professionId!=='CA')return;
 for(const[index,[at,set]]of (CA_NATIVE_DASH_Z_PRODUCERS[name]??[]).entries()){
  // Original XSAnim floats and IsChangeAnimationTime31d0cd70 use a strict
  // previous<t<=now comparison. Do not replace these literals with a JS
  // decimal threshold or replay a cue when previous already equals it.
  const previous=f(before),now=f(after),threshold=f(at);
  if(!(previous<threshold&&threshold<=now))continue;
  sim.fire(a,'ca-native-frame-wave:'+index,threshold,previous,now,()=>{
   if(a.mp<3){sim.note('ca-command-native-mp-failure-particle','Original MP failure particle callback has no established resource closure',a);return;}
   a.mp=f(a.mp-3);sim.spawnSet(a,set);
  });
 }
}
