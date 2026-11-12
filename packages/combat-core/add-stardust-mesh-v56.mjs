/** Original2016 Stardust mesh events with explicit Web instance inputs.
 * The target TLS seed/call order is not known. Freeze each sampled declaration
 * once, carry it on owner state, and reuse the normal numeric mesh executor. */
import source from '../../contracts/de-stardust-mesh-v56.json' with {type:'json'};
import {resolveValue} from '../effect-runtime/index.mjs';
export const STARDUST_CARRIER='Mesh_ATT_Stardust_Shower_Drop';
export const STARDUST_BALL='DamageEffect_ATT_Stardust_Shower_Ball';
export const STARDUST_BALL_MESH='ATT_Stardust_Shower_M01';
const f=Math.fround,cache=new WeakMap(),verified=new WeakSet();
const rows=new Map(source.rows.map(row=>[row.name,row]));
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const finite=(v,min,max)=>Number.isFinite(v)&&f(v)===v&&v>=f(min)&&v<=f(max);
export function stardustMeshMain(effect,profile){
 if(profile&&profile.target?.unitClass!==126)return null;
 return effect?.name===STARDUST_CARRIER?STARDUST_CARRIER:effect?.name===STARDUST_BALL?STARDUST_BALL_MESH:null;
}
function verify(template){
 if(verified.has(template))return;
 const row=rows.get(template?.name);
 if(!row||JSON.stringify(template.fields)!==JSON.stringify(row.fields)||JSON.stringify(template.events)!==JSON.stringify(row.events))
  throw new TypeError('Invalid original Stardust mesh declaration');
 verified.add(template);
}
export function validateAddStardustMesh(effect,profile,{required=false}={}){
 const v=effect?.sourceAddStardustMesh,main=stardustMeshMain(effect,profile);
 if(v===undefined){if(required&&main)throw new TypeError('missing-owner-stardust-instance');return true;}
 const ball=main===STARDUST_BALL_MESH,keys=ball?['version','lifeTime','velocityX']:['version','yaw'];
 if(!main||effect.mainEffectName!==main||effect.skillId!==29021||!plain(v)||v.version!==1||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||
  (ball?!finite(v.lifeTime,.6,.62)||!finite(v.velocityX,-1500,1500):!finite(v.yaw,0,360)))
  throw new TypeError('invalid-owner-stardust-instance');
 if(profile)verify(profile.effectTemplates[main]);
 if(effect.sourceShadowMesh){const m=effect.sourceShadowMesh;
  if(m.name!==main||m.maxLifeTime!==(ball?v.lifeTime:f(10))||m.gravity?.some(n=>n!==0)||m.dirSpeed!==0||m.useLand!==false)
   throw new TypeError('invalid-owner-stardust-motion');
 }
 return true;
}
export function resolvedAddStardustTemplate(template,effect){
 const v=effect?.sourceAddStardustMesh;if(v===undefined)return null;
 validateAddStardustMesh(effect);verify(template);
 const old=cache.get(v);if(old?.source===template)return old.template;
 const ball=effect.name===STARDUST_BALL;
 const result={...template,fields:{...template.fields,...(ball?{LifeTime:v.lifeTime}:{})},events:template.events.map(event=>
  ball&&event.property==='Velocity'&&event.start===.5?{...event,value:[v.velocityX,-5000,0]}:
  !ball&&event.property==='Rotate'?{...event,value:[0,v.yaw,0]}:event)};
 cache.set(v,{source:template,template:result});return result;
}
/** Restore static execution fields from local source plus the validated small
 * instance record. Receivers never draw another random value. */
export function restoreAddStardustMesh(effect,profile){
 if(effect.sourceAddStardustMesh===undefined)return false;
 validateAddStardustMesh(effect,profile);
 const template=resolvedAddStardustTemplate(profile.effectTemplates[effect.mainEffectName],effect);
 effect.templateFields=structuredClone(template.fields);
 effect.lifeTimeSeconds=template.fields.LifeTime;
 effect.initialVelocity=[0,0,0];effect.initialDirSpeed=0;
 effect.sourceSkillMeshControl=true;effect.sourceLiteralMotion=true;
 return true;
}
export function initializeAddStardustMesh(effect,profile,rng){
 const main=stardustMeshMain(effect,profile);if(!main)return false;
 if(effect.sourceAddStardustMesh!==undefined)return restoreAddStardustMesh(effect,profile);
 const template=profile.effectTemplates[main];verify(template);
 if(typeof rng!=='function')throw new TypeError('Stardust requires explicit Web seeded RNG');
 //31d0cb80 consumes a CRT word0..32767 and divides by32767. The Web
 // snapshot RNG supplies that explicit word; it is not the original TLS seed.
 const random=()=>{const n=rng();if(!Number.isFinite(n)||n<0||n>=1)throw new TypeError('Invalid Stardust seeded RNG');return f(Math.floor(n*32768)/32767);};
 effect.sourceAddStardustMesh=main===STARDUST_BALL_MESH?
  {version:1,lifeTime:resolveValue(template.fields.LifeTime,random),velocityX:resolveValue(template.events.find(e=>e.property==='Velocity'&&e.start===.5).value,random)[0]}:
  {version:1,yaw:resolveValue(template.events.find(e=>e.property==='Rotate').value,random)[1]};
 return restoreAddStardustMesh(effect,profile);
}
