import {isElswordProfile,isElesisProfile,isAddProfile,professionIdForProfile} from '../../packages/professions/identity.mjs';
// Exact V5 Raven resource literals and GameUnit bone routing. Target 2016
// declarations are separately frozen in contracts/rf-awakening-fx-index.json.
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
export const awakeningAttachments=Object.freeze([
  {slot:'rightFoot',template:'HyperBoostRightBlack',right:'Bip01_R_Foot',left:'Bip01_L_Foot'},
  {slot:'leftFoot',template:'HyperBoostLeftBlack',right:'Bip01_L_Foot',left:'Bip01_R_Foot'},
  {slot:'rightArm',template:'HyperBoostRightBlack',right:'Bip01_R_UpperArm',left:'Bip01_L_UpperArm'},
  {slot:'leftArm',template:'HyperBoostLeftBlack',right:'Bip01_L_UpperArm',left:'Bip01_R_UpperArm'},
]);

export const lkAwakeningAttachments=Object.freeze(awakeningAttachments.map(row=>Object.freeze({...row,template:row.template.replace('Black','')})));
export function awakeningAttachmentsFor(profile){return isAddProfile(profile)?[]:isElswordProfile(profile)||isElesisProfile(profile)?lkAwakeningAttachments:awakeningAttachments;}

/** Each profession view owns only its actors. Raven's shared aura callback is
 * inherited by both RF and VC; filtering just the original RF class hid VC. */
export function awakeningActorEligible(profile,actor){
  const profession=professionIdForProfile(profile);
  return profession!==undefined&&(actor.professionId??'RF').toUpperCase()===profession;
}

export function awakeningEmitRate(remaining,maxHyperModeTime){
  // X2GameUnit::HyperModeBuffEffectOnFrameMove uses the per-bead MAX time,
  // not the total duration obtained by spending one/two/three beads.
  return remaining<maxHyperModeTime/3?[15,20]:remaining<maxHyperModeTime/2?[20,30]:[30,40];
}

/** Four actor-owned emitters live across attacks, hit reactions and skills.
 * Reconcile state also restores auras after loading an awakened snapshot.
 * The original DestroyInstanceHandle deletes the sequence and its particles. */
export function createAwakeningEffects({runtime,samplers,maxHyperModeTime,eligibleActor=()=>true,attachments=awakeningAttachments,onUnsupported=()=>{}}){
  const actors=new Map(),notes=new Set();
  const note=(id,detail)=>{if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}};
  const anchor=(state,id,attachment)=>{
    const actor=state.actors.find(a=>a.id===id);if(!actor)return null;
    const bone=actor.facing>0?attachment.right:attachment.left;
    return samplers.effectAnchorSampler({definition:{BONE_NAME:bone}},actor)?.position??null;
  };
  function clearActor(id){const handles=actors.get(id);if(handles)for(const e of handles.values())runtime.stop(e.id,true);actors.delete(id);}
  return {
    step(state){
      const live=new Set();
      for(const actor of state.actors){
        if(!eligibleActor(actor)||!(actor.hp>0&&actor.awakening?.remaining>0)){clearActor(actor.id);continue;}
        live.add(actor.id);
        let handles=actors.get(actor.id);if(!handles){handles=new Map();actors.set(actor.id,handles);}
        for(const attachment of attachments){
          let emitter=handles.get(attachment.slot);
          if(!emitter){
            const position=anchor(state,actor.id,attachment);
            if(!position){note('awakening-bone:'+attachment.slot,'Original awakening bone cannot be sampled');continue;}
            emitter=runtime.add(attachment.template,{effectQuality:FULL_EFFECT_QUALITY,position,anchor:s=>anchor(s,actor.id,attachment),
              // CreateSequenceHandle uses zero rotation. Facing exchanges the
              // attached bones, rather than rotating this sequence by 180deg.
              facing:1,trace:true,billboardType:'BT_ALL',emitRate:{random:awakeningEmitRate(actor.awakening.remaining,maxHyperModeTime)}});
            if(emitter)handles.set(attachment.slot,emitter);
          }
          if(emitter){emitter.options.bone=actor.facing>0?attachment.right:attachment.left;
            emitter.options.emitRate={random:awakeningEmitRate(actor.awakening.remaining,maxHyperModeTime)};
            // Raven SetInvisibility hides the sequence without destroying it.
            emitter.options.hidden=actor.hidden===true||actor.invisible===true;}
        }
      }
      for(const id of actors.keys())if(!live.has(id))clearActor(id);
    },
    clear(){for(const id of [...actors.keys()])clearActor(id);notes.clear();},
    proof(){return {actors:actors.size,emitters:[...actors.values()].reduce((n,v)=>n+v.size,0),
      activeParticles:[...actors.values()].reduce((n,v)=>n+[...v.values()].reduce((sum,e)=>sum+e.particles.size,0),0),
      attachments:[...actors].flatMap(([actorId,handles])=>[...handles].map(([slot,e])=>({actorId,slot,template:e.name,
        bone:e.options.bone,position:[...e.position],emitRate:e.options.emitRate.random,trace:e.options.trace,billboard:e.options.billboardType,
        activeParticles:e.particles.size,hidden:e.options.hidden}))),
      templates:[...new Set(attachments.map(v=>v.template))],
      reference:'V5 profession HyperModeBuffEffectStart / GameUnit HyperModeBuffEffectOnFrameMove / HyperModeBuffEffectEnd',
      targetClientMeasured:false,unsupported:[...notes]};},
  };
}
