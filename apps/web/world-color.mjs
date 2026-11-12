import castDisplay from '../../contracts/cast-display-index-v1.json' with {type:'json'};
import {professionIdForProfile} from '../../packages/professions/identity.mjs';
// Fixed-V5 Raven FrameMove consumers and target CHANGE_WORLD_COLOR flags.
// PvP uses a global world color; BattleField's 800-unit CutIn gate is separate
// from the 1300/2000-unit gameplay StopOtherUnit radii.
export const worldColorSkillStates=Object.freeze([
  'RSI_SI1_MAXIMUM_CANNON','RSI_SI2_POWER_ASSAULT','RSI_SI3_SEVEN_BURST',
  'RSI_SI2_CANNON_BLADE','RSI_SI1_OVER_TAKER_CHARGED_BOLT','RSI_SI2_OVER_TAKER_ARC_ENEMY',
  'RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE','RSI_SA_ROT_VALKYRIESJAVELIN','RSI_A_ROT_NUCLEAR',
  'SI_SA_RRF_X_CRASH','RSI_SA_RRF_WILD_CHARGE_READY',
]);
const callbackStates=new Set(worldColorSkillStates),gray=34/255;
export function actorWorldColor(actor,profile){
  if(actor.hidden===true||actor.deathComplete===true)return null;
  if(['RSI_HYPER_MODE','ESSI_HYPER_MODE','ESI_HYPER_MODE'].includes(actor.state))return [gray,gray,gray];
  const flag=profile.states[actor.state]?.raw.CHANGE_WORLD_COLOR;
  const confirmed=castDisplay.professions[professionIdForProfile(profile)]?.states[actor.state]?.dark;
  if(flag!==true&&flag!==1&&!confirmed&&!callbackStates.has(actor.state))return null;
  return actor.awakening?.remaining>0?[1,0,0]:[gray,gray,gray];
}

export function createWorldColorController({profile,profileFor=()=>profile}){
  let color=[1,1,1],fadeFrom=null,fadeTime=0,active=false;
  return {
    event(event){
      // DamageEffect RT_REVENGE flashes the world black then restores its
      // original color over one second, independently of REFLECT/count.
      if(event.type!=='projectileReflectionFeedback')return;
      fadeTime=Math.max(0,.5-(event.remaining??.5));fadeFrom=[0,0,0];
      color=[fadeTime,fadeTime,fadeTime];active=false;
    },
    step(state,dt){
      let next=null;
      for(const actor of state.actors??[])next=actorWorldColor(actor,profileFor(actor))??next;
      if(next){color=next;fadeFrom=null;fadeTime=0;active=true;}
      else {
        if(active){fadeFrom=[...color];fadeTime=0;active=false;}
        if(fadeFrom){fadeTime=Math.min(1,fadeTime+Math.max(0,Number.isFinite(dt)?dt:0));
          color=fadeFrom.map(v=>v+(1-v)*fadeTime);if(fadeTime===1)fadeFrom=null;}
      }
      return [...color];
    },
    clear(){color=[1,1,1];fadeFrom=null;fadeTime=0;active=false;},
    proof(){return {color:[...color],active,fadeRemaining:fadeFrom?1-fadeTime:0,
      reference:'fixed-V5 ChangeWorldColorByHyperMode / CommonStateEnd / World.OnFrameMove',targetClientMeasured:false};},
  };
}

function usesWorldColor(mesh){
  for(let node=mesh;node;node=node.parent){
    const extras=node.metadata?.gltf?.extras??node.metadata?.extras;
    if(extras?.nativeUseWorldColor===false)return false;
  }
  return true;
}

/** Multiply only source world materials. This avoids a screen overlay darkening
 * particles, playable characters or HUD. GLTF's baked original per-object color
 * is retained as the baseline, and all channels are restored on map changes. */
export function createWorldColorView({profile,profileFor}){
  const controller=createWorldColorController({profile,profileFor});
  let materials=[];
  function restore(){for(const row of materials)for(const [key,base] of row.channels)row.material[key].copyFrom(base);}
  return {
    event(event){controller.event(event);},
    setEnvironment(environment){
      restore();controller.clear();materials=[];const seen=new Set();
      for(const mesh of environment?.meshes??[]){
        if(!usesWorldColor(mesh))continue;
        const list=mesh.material?.subMaterials??[mesh.material];
        for(const material of list){if(!material||seen.has(material))continue;seen.add(material);
          const channels=['albedoColor','diffuseColor','emissiveColor'].filter(key=>material[key]?.clone)
            .map(key=>[key,material[key].clone()]);
          if(channels.length)materials.push({material,channels});
        }
      }
    },
    step(state,dt){const color=controller.step(state,dt);
      for(const row of materials)for(const [key,base] of row.channels)row.material[key].set(base.r*color[0],base.g*color[1],base.b*color[2]);
    },
    clear(){restore();controller.clear();},
    dispose(){restore();materials=[];controller.clear();},
    proof(){return {...controller.proof(),worldMaterials:materials.length};},
  };
}
