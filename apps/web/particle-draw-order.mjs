/** Fixed V5 Manager.cpp1124..1132: alpha objects sort by Layer ascending,
 * then sequence distance descending. ParticleSystem.cpp5367 moves the sequence
 * matrix to its emitter position; its default Object center is zero.
 * Presentation keeps each emitter as a separate draw unit, so this order also
 * reaches the scene's transparent queue across mesh and plane templates.
 */
export function nativeEffectLayer(fields){return Number.isInteger(fields.Layer)?fields.Layer:0;}

export function particlesInNativeDrawOrder(runtime,cameraPosition){
  const distances=new Map(),rows=[];
  for(const p of runtime.particles.values()){
    if((p.template.fields.DrawCount??1)<=0||p.options.hidden===true)continue;
    if(!distances.has(p.emitterId)){
      const position=runtime.emitters.get(p.emitterId)?.position??p.position;
      distances.set(p.emitterId,(position[0]*.01-cameraPosition[0])**2+
        (position[1]*.01-cameraPosition[1])**2+(-position[2]*.01-cameraPosition[2])**2);
    }
    rows.push(p);
  }
  rows.sort((a,b)=>nativeEffectLayer(a.template.fields)-nativeEffectLayer(b.template.fields)||
    distances.get(b.emitterId)-distances.get(a.emitterId)||a.emitterId-b.emitterId||a.id-b.id);
  return rows;
}
