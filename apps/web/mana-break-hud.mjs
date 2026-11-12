import {manaBreakGauge} from './hud-values.mjs';

/** Display adapter: interpolate two completed Gauge packets while charging.
 * A release, reservation/consumption or MP clamp takes effect immediately.
 * This clock never predicts charge or writes an authoritative actor. */
export function createManaBreakRenderClock() {
  let previous=null,current=null;
  const capture=actor=>actor?{id:actor.id,...manaBreakGauge(actor)}:null;
  return {
    reset(actor){previous=current=capture(actor);},
    push(actor){previous=current;current=capture(actor);},
    sample(actor,alpha,{exact=false}={}){
      if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new RangeError('Render alpha must be in [0, 1]');
      const actual=manaBreakGauge(actor);
      if(exact||!previous||!current||actor.id!==current.id||previous.id!==current.id||
          actual.maximum!==current.maximum||previous.maximum!==current.maximum||
          actual.charge!==current.charge||current.charge<=previous.charge)return actual;
      const charge=previous.charge+(current.charge-previous.charge)*alpha;
      return {...actual,charge,fraction:Math.max(0,Math.min(1,charge/actual.maximum))};
    },
  };
}

/** Target2016 NEW HUD literal points, plus the fixed-V5 UpdateMpGuidePoint
 * offsets: 224/maxMP * 100/200 minus the corresponding 300-MP position. */
export function manaBreakGuidePositions(maximumMp) {
  if(!Number.isFinite(maximumMp)||maximumMp<=0)return [];
  const f=Math.fround,unit=f(224/f(maximumMp)),third=f(224/3);
  return [{mp:100,left:176+f(f(unit*100)-third),top:53},
    {mp:200,left:250+f(f(unit*200)-f(third*2)),top:53}]
    .filter(point=>point.mp<maximumMp);
}

export function updateManaBreakBar(element,gauge,{authoritativeCharge=gauge.charge}={}) {
  const width=`${224*gauge.fraction}px`,hidden=authoritativeCharge<=0;
  if(element.style.width!==width)element.style.width=width;
  if(element.hidden!==hidden)element.hidden=hidden;
  const charge=String(authoritativeCharge),maximum=String(gauge.maximum);
  if(element.getAttribute('aria-valuenow')!==charge)element.setAttribute('aria-valuenow',charge);
  if(element.getAttribute('aria-valuemax')!==maximum)element.setAttribute('aria-valuemax',maximum);
}
