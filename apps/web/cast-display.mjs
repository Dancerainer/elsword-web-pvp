import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {professionIdForProfile,isAddProfile} from '../../packages/professions/identity.mjs';
/** The presentation policy removes the added casting/awakening hand
 * lights. Keep the independently timed ground shock; source declarations and
 * the existing awakening aura are unaffected. */
export function createCastDisplay({runtime,samplers,index,profile,onUnsupported=()=>{}}){
  const source=index.castDisplay,config=source?.professions[professionIdForProfile(profile)]??
    (isAddProfile(profile)?{states:{ANSI_HYPER_MODE:{awakening:true},RSI_HYPER_MODE:{awakening:true}}}:null);
  const shockTime=isAddProfile(profile)?profile.referenceSemantics.awakening.applyAnimationTime:source?.awakening.shockTime;
  const seen=new Map(),counts={},notes=new Set();
  function emit(actor,name,bone,options={}){
    const position=bone?samplers.effectAnchorSampler({definition:{BONE_NAME:bone}},actor)?.position:
      [actor.landPosition?.[0]??actor.x,(actor.landPosition?.[1]??actor.y)+5,actor.landPosition?.[2]??actor.z];
    if(!position){if(!notes.has(bone)){notes.add(bone);onUnsupported({type:'unsupported-visual',id:'cast-bone:'+bone,detail:'Original casting bone unavailable'});}return;}
    // CParticleEventSequence constructor initializes BT_ALL (fixed source2698).
    // GroundShockWave explicitly declares BT_NONE and must retain that plane.
    const billboardType=index.templates['cast:'+name]?.fields.BillBoardType??'BT_ALL';
    if(runtime.add('cast:'+name,{position,facing:1,billboardType,effectQuality:FULL_EFFECT_QUALITY,...options}))counts[name]=(counts[name]??0)+1;
  }
  return {step(state){
    if(!config)return;
    const live=new Set();
    for(const actor of state.actors??[]){
      live.add(actor.id);if(actor.hidden||actor.invisible||actor.hp<=0)continue;
      const sourceState=profile.states?.[actor.state]?.sourceState??actor.state;
      const spec=config.states[actor.state]??config.states[sourceState],clock=actor.animationTime??0,key=sourceState+':'+actor.stateSerial;
      let r=seen.get(actor.id);if(!r||r.key!==key){
        // A restored mid-cast snapshot cannot replay the one-shot shock.
        // Observe its present clock; a newly entered local pose is still at
        // zero/before the source boundary and crosses it on its own tick.
        r={key,time:clock>shockTime?clock:-Number.EPSILON};seen.set(actor.id,r);
      }
      if(spec){
        const crossed=time=>r.time<time&&clock>=time&&clock-time<=.5;
        if(spec.awakening){
          if(crossed(shockTime)){
            emit(actor,'GroundShockWave',null,{emitRate:{random:[5,10]},triggerCount:3});
          }
        }
      }
      r.time=Math.max(r.time,clock);
    }
    for(const id of seen.keys())if(!live.has(id))seen.delete(id);
  },clear(){seen.clear();for(const key of Object.keys(counts))delete counts[key];notes.clear();},
  proof:()=>({enabled:!!config,handLights:false,actors:seen.size,triggers:{...counts},unsupported:[...notes],evidence:'target2016 ground resource / qualified V5 timing / project display policy'})};
}
