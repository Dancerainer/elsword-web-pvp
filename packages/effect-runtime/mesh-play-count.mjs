/** Fixed V5 XMeshTemplet.h842 initializes the absent PlayCount to zero.
 * It is not one: MeshPlayer increments first and tests equality afterwards. */
export const originalMeshPlayCount=template=>template.fields.PlayCount??0;

/** Presentation-only retirement after a proved permanent zero-output tail.
 * Raw PlayCount and source animation are unchanged. The original zero-count
 * instance otherwise remains owned indefinitely. Reject depth writes, child
 * emitters, nonstandard material passes and unhandled events. DESTALPHA is an
 * identity destination factor only when the renderer explicitly has an opaque
 * target. This can never stand in for a combat-effect lifetime. */
export function terminalTransparentMeshTime(template,{opaqueTarget=false}={}){
  const fields=template.fields;
  if(template.kind!=='mesh'||fields.LifeType!=='LT_PLAY_COUNT'||originalMeshPlayCount(template)!==0||
    template.unsupported?.length||(fields.ZWriteEnable!==undefined&&fields.ZWriteEnable!==false&&fields.ZWriteEnable!==0)||
    (fields.RenderType??fields.MeshRenderType??'RT_REAL_COLOR')!=='RT_REAL_COLOR'||
    (fields.SourceBlendMode??'D3DBLEND_SRCALPHA')!=='D3DBLEND_SRCALPHA')return null;
  const destination=fields.DestBlendMode??'D3DBLEND_INVSRCALPHA';
  if(destination!=='D3DBLEND_INVSRCALPHA'&&destination!=='D3DBLEND_ONE'&&!(opaqueTarget&&destination==='D3DBLEND_DESTALPHA'))return null;
  if(Object.keys(fields).some(key=>/Particle|DieEvent|SlashTrace|Outline|OutLine/i.test(key))||
    Object.keys(template.repeated??{}).length||
    template.events.some(event=>event.clock==='animation'||!['Color','Size','AniName','AniSpeed','Velocity','DirSpeed','Texture','Rotate'].includes(event.property)))return null;
  const colors=template.events.filter(event=>event.property==='Color');
  if(!colors.length||colors.some(event=>!Number.isFinite(event.start)||!Number.isFinite(event.end)||event.end<event.start||
    !Array.isArray(event.value)||event.value.length!==4||!event.value.every(Number.isFinite)))return null;
  const last=colors.at(-1),end=last.end;
  if(last.value[3]!==0||colors.some(event=>event.start>end||event.end>end))return null;
  return end;
}
