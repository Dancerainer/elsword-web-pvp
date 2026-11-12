/** One exact original GM66XX generator, not a general random-mesh fallback.
 * Endpoint ranges/times are source declarations. Seed and shared-instance
 * clock are explicit Web adapters, not recovered original TLS trajectories. */
import source from '../../contracts/gm-dash-xx-spawn-rotation-v37.json' with {type:'json'};
import {compileEvents} from '../effect-runtime/index.mjs';
export const GM_SPAWN_ROTATION_VERSION='gm66xx-shared-original-rotate-web-v37';
export const GM_SPAWN_SET=source.setName,GM_SPAWN_EFFECT=source.effectName,GM_SPAWN_TEMPLATE=source.templateName;
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const bounded=(n,min,max)=>Number.isFinite(n)&&Math.fround(n)===n&&n>=min&&n<=max;
const resolvedTemplates=new WeakMap(),verifiedTemplates=new WeakSet();
export function isGMSpawnRotationEffect(effect,profile){
 return effect?.name===GM_SPAWN_EFFECT&&effect.mainEffectName===GM_SPAWN_TEMPLATE&&effect.setName===GM_SPAWN_SET&&
  (!profile||profile.target?.unitClass===120);
}
function verifyTemplate(template){
 if(verifiedTemplates.has(template))return;
 if(template?.name!==GM_SPAWN_TEMPLATE||template.declarationSha256!==source.source.declarationSha256||
  JSON.stringify(template.events?.filter(e=>e.property==='Rotate'))!==JSON.stringify(source.rotateEvents))
  throw new TypeError('Invalid original GM spawn rotation declaration');
 verifiedTemplates.add(template);
}
export function validateGMSpawnRotation(effect,profile){
 const value=effect?.sourceGMSpawnRotation;if(value===undefined)return true;
 if(!isGMSpawnRotationEffect(effect,profile)||!plain(value)||Object.keys(value).length!==3||
  !['version','initialYaw','endYaw'].every(k=>Object.hasOwn(value,k))||value.version!==GM_SPAWN_ROTATION_VERSION||
  !bounded(value.initialYaw,0,50)||!bounded(value.endYaw,3600,7200))throw new TypeError('invalid-owner-gm-spawn-rotation');
 if(profile)verifyTemplate(profile.effectTemplates?.[GM_SPAWN_TEMPLATE]);
 return true;
}
/** Invoke once after mainEffectName is resolved; exactly two source random
 * yaw declarations advance the simulation's snapshot-owned RNG. */
export function initializeGMSpawnRotation(effect,profile,rng){
 if(!isGMSpawnRotationEffect(effect,profile))return false;
 if(effect.sourceGMSpawnRotation!==undefined){validateGMSpawnRotation(effect,profile);return false;}
 verifyTemplate(profile.effectTemplates[GM_SPAWN_TEMPLATE]);
 if(typeof rng!=='function')throw new TypeError('GM spawn rotation requires explicit Web seeded RNG');
 const channels=compileEvents({events:source.rotateEvents},()=>{const n=rng();
  if(!Number.isFinite(n)||n<0||n>=1)throw new TypeError('Invalid GM spawn seeded RNG result');return n;});
 const events=channels.get('Rotate');
 effect.sourceGMSpawnRotation={version:GM_SPAWN_ROTATION_VERSION,initialYaw:events[0].value[1],endYaw:events[1].value[1]};
 return true;
}
/** Return a cached numeric view of this source instance. Original templates
 * remain immutable, and receiver ID remapping never resolves random values. */
export function resolvedGMSpawnTemplate(template,effect){
 if(effect?.sourceGMSpawnRotation===undefined)return null;
 validateGMSpawnRotation(effect);verifyTemplate(template);
 const value=effect.sourceGMSpawnRotation,cached=resolvedTemplates.get(value);
 if(cached?.source===template)return cached.template;
 let rotate=0;
 const resolved={...template,events:template.events.map(event=>event.property==='Rotate'?
  {...event,value:[0,rotate++===0?value.initialYaw:value.endYaw,0]}:event)};
 resolvedTemplates.set(value,{source:template,template:resolved});return resolved;
}
export function sampleGMSpawnRotation(effect,time){
 validateGMSpawnRotation(effect);
 if(effect?.sourceGMSpawnRotation===undefined||!Number.isFinite(time)||time<0)throw new TypeError('GM source instance and clock required');
 const {initialYaw,endYaw}=effect.sourceGMSpawnRotation,fade=source.rotateEvents[1];
 const ratio=Math.max(0,Math.min(1,(time-fade.start)/(fade.end-fade.start)));
 return [0,initialYaw+(endYaw-initialYaw)*ratio,0];
}
