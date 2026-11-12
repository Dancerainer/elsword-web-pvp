/** KTDGPicChar.cpp: zero-gap DrawText, width is advance, not glyph size.
 * Lane direction is +X; facing does not mirror the readable digit textures. */
export function layoutDamageDigits(amount, position, width) {
  if (!Number.isFinite(amount) || amount <= 0 || !Array.isArray(position) ||
      position.length !== 3 || position.some(n => !Number.isFinite(n)) || !Number.isFinite(width) || width <= 0) return [];
  const text=String(Math.trunc(amount));
  if (!/^\d+$/.test(text)) return [];
  return [...text].map((digit,index)=>({digit,position:[position[0]-width*text.length/2+width*index,position[1],position[2]]}));
}

/** Red is selected by the compiled critical block's bShowRedPicture flag.
 * Back/double-hit consumers remain separate from this critical subset. */
export function emitDamageNumber(runtime, manifest, event) {
  if (!['hit','observedHit'].includes(event.type) || !event.damageNumber) return 0;
  if(!['normal','red'].includes(event.damageNumber.style))return 0;
  const style=manifest.styles[event.damageNumber.style];
  if (!style) return 0;
  const template=manifest.templates[style.template];
  const digits=layoutDamageDigits(event.amount,event.damageNumber.position,style.width);
  let available=template.fields.NumParticles-[...runtime.particles.values()].filter(p=>p.name===style.template).length;
  let count=0;
  for (const glyph of digits) {
    if (available--<=0) break;
    if (!manifest.glyphs[glyph.digit]) continue;
    if (runtime.emitParticle(style.template,{...glyph,style:event.damageNumber.style})) count++;
  }
  return count;
}

/** Native full-string center/advance includes the blank prefix gap; no font glyph is invented. */
export function layoutRecoveryText(amount,position,style) {
  if(!Number.isFinite(amount)||amount<=0||!Array.isArray(position)||position.length!==3||
    position.some(n=>!Number.isFinite(n))||!Number.isFinite(style?.width)||style.width<=0||
    !Number.isFinite(style.offsetY)||!['HP+ ','MP+ ','DP+ ','+ '].includes(style.prefix))return [];
  const integer=String(Math.trunc(amount));if(!/^\d+$/.test(integer))return [];
  const text=style.prefix+integer,width=style.width;
  return [...text].flatMap((digit,index)=>digit===' '?[]:[{digit,
    position:[position[0]-width*text.length/2+index*width,position[1]+style.offsetY,position[2]]}]);
}

/** User-requested web adapter: Raven End has no original DrawText consumer.
 * Only actual restoration is shown; clamped/absent recovery is never inferred. */
export function emitAwakeningRecoveryNumbers(runtime,manifest,event) {
  if(event.type!=='awakeningEnded'||manifest.recovery?.event!=='awakeningEnded')return 0;
  return emitRecoveryFields(runtime,manifest,event,manifest.recovery.amountFields,manifest.recovery.positionField);
}

/** Guild healing uses the same original green HP+ glyph/particle declarations.
 * The guild consumer already supplies its y+50 anchor; avoid adding that offset
 * twice. Event identity remains separate from Raven awakening-end recovery. */
export function emitGuildRecoveryNumbers(runtime,manifest,event) {
  if(event.type!=='guildHpRecovered')return 0;
  return emitRecoveryFields(runtime,manifest,event,{hp:'restoredHp'},'position',true);
}

/** Force Finger's recipient and caster use their own authoritative events.
 * Both anchors are model position+50, matching the qualified Add consumer.
 * Existing original blue MP glyphs and red signed MP glyphs are reused. */
export function emitForceFingerResourceNumbers(runtime,manifest,event){
  if(event.type==='addForceFingerTransfer'&&event.resource==='MP')
    return emitRecoveryFields(runtime,manifest,event,{mp:'restored'},'position',true);
  if(event.type==='addForceFingerRecipient'&&Number.isFinite(event.drain)&&event.drain>0)
    return emitBuffMpLossNumber(runtime,manifest,{type:'buffMpChanged',delta:-event.drain,drawText:true,
      resourceNumber:{resource:'mp',style:'red',position:event.position}});
  return 0;
}

const addRecoveryEvents=new Set(['addFantasyTracerMpRecovered','addStasisMpRecovered',
  'addOverlimitResourceRecovered','addMutationMpRecovered','addMindControlRefund']);

/** Original2016 DP popup3273cf00 formats "DP+ %d" and original PC_D.dds
 * exists in data049 ordinal81. V61's imported glyph subset omitted D.
 * Red DP/blue MP remains the user's project rule, separate from the source
 * caller/style audit; resource amounts and event producers are untouched. */
export function withAddResourceNumberStyles(manifest){
  return {...manifest,styles:{...manifest.styles,dp:{...manifest.styles.red,
    glyphs:'0123456789DP+',prefix:'DP+ ',offsetY:0}}};
}
export function emitAddResourceRecoveryNumbers(runtime,manifest,event){
  if(!addRecoveryEvents.has(event.type)||!['MP','DP'].includes(event.resource))return 0;
  return emitRecoveryFields(runtime,manifest,event,{[event.resource.toLowerCase()]:'amount'},'position',true);
}

function emitRecoveryFields(runtime,manifest,event,amountFields,positionField,anchorIncludesOffset=false) {
  let count=0;
  for(const [name,field] of Object.entries(amountFields)){
    const style=manifest.styles[name],template=manifest.templates[style?.template];if(!template)continue;
    const glyphs=layoutRecoveryText(event[field],event[positionField],anchorIncludesOffset?{...style,offsetY:0}:style);
    let available=template.fields.NumParticles-[...runtime.particles.values()].filter(p=>p.name===style.template).length;
    for(const glyph of glyphs){
      if(available--<=0)break;
      if(!manifest.glyphs[glyph.digit]||!style.glyphs.includes(glyph.digit))continue;
      if(runtime.emitParticle(style.template,{...glyph,style:name}))count++;
    }
  }
  return count;
}

/** BuffChangeNowMp::DrawText696: headY-50, red PicChar, "MP %d".
 * Display the declared signed delta (the native consumer draws after clamping
 * MP), using the original glyphs and a centered 26-unit advance. Luna98 uses
 * a percentage display independent of resource arithmetic. */
export function emitBuffMpLossNumber(runtime,manifest,event){
  if(!['buffMpChanged','observedBuffMpChanged'].includes(event.type)||!event.drawText||event.delta>=0||!Number.isFinite(event.delta)||
    event.resourceNumber?.resource!=='mp'||event.resourceNumber.style!=='red')return 0;
  const position=event.resourceNumber.position,style=manifest.styles.red,template=manifest.templates[style?.template];
  if(!template||!Array.isArray(position)||position.length!==3||position.some(n=>!Number.isFinite(n)))return 0;
  const percent=event.resourceNumber.percent;
  const text='MP '+(event.templateId===98&&Number.isFinite(percent)&&percent<0?Math.round(percent)+'%':Math.trunc(event.delta));
  if(!/^MP -\d+%?$/.test(text))return 0;
  let available=template.fields.NumParticles-[...runtime.particles.values()].filter(p=>p.name===style.template).length,count=0;
  for(let i=0;i<text.length;i++){
    const digit=text[i];if(digit===' '||!manifest.glyphs[digit])continue;if(available--<=0)break;
    if(runtime.emitParticle(style.template,{digit,style:'red',position:[position[0]-style.width*text.length/2+i*style.width,position[1],position[2]]}))count++;
  }
  return count;
}
