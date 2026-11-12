import {isElswordProfession,isElesisProfession} from '../../packages/professions/identity.mjs';
import {assetUrl} from './asset-urls.mjs';

/** CPictureData::SetFlicker / FrameMove, pinned V5; original float and strict
 * turn boundaries retained. The browser clamps the resulting display alpha. */
export function createSwordHudFlicker(){
  const f=Math.fround;let time=0,gain=true;
  return {reset(){time=0;gain=true;},step(dt){
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid HUD elapsed time');
    time=f(time+(gain?f(dt):-f(dt)));
    if(gain&&time>f(.4))gain=false;else if(!gain&&time<0)gain=true;
    return f(f(f(f(f(1)-f(.1))*time)/f(.4))+f(.1));
  }};
}

/** Presentation only: never reconstruct or advance the authoritative resource. */
export function swordHudState(actor){
  const resource=actor?.wayOfSword,limits=actor?.wayOfSwordLimits;
  const elesis=isElesisProfession(actor?.professionId);
  if((!isElswordProfession(actor?.professionId)&&!elesis)||!resource||!limits)return {visible:false};
  const {point,state}=resource;
  if(![-2,-1,0,1,2].includes(state)||!Number.isFinite(point)||!(limits.vigor>0)||!(limits.destruction<0))return {visible:false};
  const side=state<0?'red':'blue',active=Math.abs(state)===2;
  const ratio=state===0?0:Math.max(0,Math.min(1,point/(state<0?limits.destruction:limits.vigor)));
  const label=state===0?'Way of the Sword: Neutral':`${state>0?(elesis?'Gale':'Vitality'):(elesis?'Annihilation':'Destruction')}${active?' active':' charging'}`;
  // Elesis inserts EL_RED_2 before the red flicker and beads. Its width is
  // detonation charge / 2000 (X2GageUI), independent of the sword resource.
  const specialRed=elesis&&side==='red';
  return {visible:true,family:elesis?'elesis':'elsword',state,side,active,ratio,point,label,
    chargeRatio:specialRed?Math.max(0,Math.min(1,(actor.sourceElesisBreakCharge??0)/2000)):0,
    flickerPicture:specialRed?3:2,
    pictures:state===0?[0,5]:specialRed?(active?[0,1,2,3,5]:[0,1,4]):[0,1,active?2:3,...(active?[4]:[])]};
}

export function createWayOfSwordHud({document,host,index,elesisIndex}){
  const root=document.createElement('div');root.className='way-of-sword-hud';root.hidden=true;
  root.style.cssText='position:absolute;inset:0;pointer-events:none;';
  root.setAttribute('role','progressbar');root.setAttribute('aria-valuemin','0');root.setAttribute('aria-valuemax','100');
  host.append(root);
  const groups={};
  for(const [family,source] of Object.entries({elsword:index,...(elesisIndex?{elesis:elesisIndex}:{})})){
   groups[family]={};
   for(const [side,key] of [['blue','g_pStatic_EL_BLUE'],['red','g_pStatic_EL_RED']]){
    if(!Array.isArray(source.groups?.[key]))throw new Error('Original sword HUD group missing');
    groups[family][side]=source.groups[key].map((row,i)=>{
      const element=document.createElement('img');element.alt='';element.draggable=false;
      element.src=assetUrl((source.baseUrl??'/assets/ui/way-of-sword/')+row.file);
      const size=row.size??[row.width,row.height];
      element.style.cssText=`position:absolute;left:${row.position[0]}px;top:${row.position[1]}px;width:${size[0]}px;height:${size[1]}px;`;
      element.dataset.family=family;
      element.dataset.piece=row.piece;element.dataset.picture=String(i);element.hidden=true;root.append(element);return element;
    });
   }
  }
  let shown={visible:false},identity=null;const flicker=createSwordHudFlicker();
  return {element:root,
    update(actor){
      const next=swordHudState(actor);
      if(next.state!==shown.state||next.family!==shown.family||actor?.id!==identity)flicker.reset();
      identity=actor?.id;shown=next;root.hidden=!next.visible;
      if(!next.visible)return;
      root.dataset.state=String(next.state);root.dataset.point=String(next.point);root.dataset.active=String(next.active);
      root.setAttribute('aria-label',next.label);root.setAttribute('aria-valuenow',String(Math.round(next.ratio*100)));
      root.setAttribute('aria-valuetext',`${next.label}, ${Math.round(next.ratio*100)}%`);
      for(const [family,sides] of Object.entries(groups))for(const [side,pictures] of Object.entries(sides))pictures.forEach((element,i)=>{
        element.hidden=family!==next.family||side!==next.side||!next.pictures.includes(i);
        const charge=family==='elesis'&&side==='red'&&i===2;
        const fill=i===1||i===(family==='elesis'&&side==='red'?3:2)||charge;
        element.style.clipPath=fill?`inset(0 ${100-(charge?next.chargeRatio:next.ratio)*100}% 0 0)`:'';
      });
    },
    render(dt){
      if(!shown.visible||!shown.active)return;
      const picture=groups[shown.family]?.[shown.side]?.[shown.flickerPicture];
      if(picture)picture.style.opacity=String(Math.max(0,Math.min(1,flicker.step(dt))));
    },
    dispose(){root.remove();}
  };
}
