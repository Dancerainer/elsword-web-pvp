import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createAwakeningBeadView} from './awakening-bead.mjs';
import {swordHudState} from './way-of-sword-hud.mjs';
export const SWORD_HUD_TEMPLATES=Object.freeze(['vitality','demolition'].flatMap(kind=>[1,2,3].map(i=>`elswrod_${kind}_UI_0${i}`)));

/** Original X2GageUI creates all three once on entry, stops all on state change.
 * Templates 01/02 are finite; template03 loops. Replenishing gauge must not
 * restart the one-shot flare. The anchor is original picture4 rectangle center.
 */
export function createSwordHudParticleController({index,nativeRandom,onUnsupported=()=>{}}){
  const templates=SWORD_HUD_TEMPLATES.map(name=>{
    const t=index.templates?.[name];
    if(!t||t.fields.particleType!=='PT_2D_PLANE'||t.fields.NumParticles!==1)throw new Error('Original sword HUD particle missing '+name);
    return t;
  });
  const runtime=createEffectRuntime({index:{...index,templates:Object.fromEntries(templates.map(t=>[t.name,t]))},nativeRandom,onUnsupported,quality:'high'});
  let state=0,identity=null,family=null;
  return {runtime,templates,
    step(dt,actor){
      const display=swordHudState(actor),next=display.visible&&display.active?display.state:0;
      if(next!==state||actor?.id!==identity||family!==display.family){
        runtime.clear();state=next;identity=actor?.id;family=display.family;
        if(state){
          const side=state===2?'blue':'red',anchor=index.swordHudFamilyAnchors?.[family]?.[side]??index.swordHudAnchors?.[side];
          if(!Array.isArray(anchor)||anchor.length!==3||!anchor.every(Number.isFinite))throw new Error('Original sword HUD anchor missing');
          for(const name of SWORD_HUD_TEMPLATES.slice(state===2?0:3,state===2?3:6))runtime.add(name,{position:anchor});
        }
      }
      if(dt>0)runtime.step(dt);
    },
    clear(){runtime.clear();state=0;identity=null;},
    proof(){return {active:state!==0,state,emitters:runtime.emitters.size,particles:runtime.count,nativeClientMeasured:false};}
  };
}

export async function createWayOfSwordParticleView({document,host,effectIndex,uiIndex,elesisUiIndex,nativeRandom,onUnsupported,assetBase='/assets/lk/'}){
  const familyAnchors={};
  for(const [family,source] of Object.entries({elsword:uiIndex,...(elesisUiIndex?{elesis:elesisUiIndex}:{})})){
   const anchors=familyAnchors[family]={};
   for(const [side,key] of [['blue','g_pStatic_EL_BLUE'],['red','g_pStatic_EL_RED']]){
    const row=source.groups[key][family==='elesis'&&side==='red'?5:4],size=row.size??[row.width,row.height];
    anchors[side]=[row.position[0]+size[0]/2,row.position[1]+size[1]/2,0];
   }
  }
  return createAwakeningBeadView({document,host,index:{...effectIndex,swordHudAnchors:familyAnchors.elsword,swordHudFamilyAnchors:familyAnchors},nativeRandom,onUnsupported,
    controllerFactory:createSwordHudParticleController,className:'sword-hud-particles',textureRoot:assetBase,canvasWidth:360});
}
