import {resolveValue,seededRandom} from '../../packages/effect-runtime/index.mjs';

/** ParticleSystem.cpp1368 resolves DrawCount once while parsing a template;
 * Clone5525 copies it. Keep this presentation-only RNG separate from combat
 * and from per-particle animation sampling. Target rand order is unmeasured. */
export function createNativeParticleDrawCounts(index,{random=seededRandom(2016),nativeRandom,onUnsupported=()=>{}}={}){
  random.nativeRandom=nativeRandom;
  const counts=new WeakMap();
  for(const template of Object.values(index.templates)){
    const declaration=template.fields.DrawCount??1;
    const supported=typeof declaration==='number'||template.kind==='particle'&&
      declaration&&Array.isArray(declaration.random)&&declaration.random.length===2&&declaration.random.every(Number.isFinite);
    const resolved=supported?resolveValue(declaration,random):NaN;
    if(!Number.isFinite(resolved)){
      onUnsupported({type:'unsupported-visual',id:template.name+':draw-count',detail:'No confirmed finite DrawCount consumer; sequence omitted'});
      counts.set(template,0);
    }else counts.set(template,Math.max(0,Math.trunc(resolved)));
  }
  return (template,override)=>override??counts.get(template)??0;
}
