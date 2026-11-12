/** Bounded fixed-V5 X_SKIN_MESH consumer: global RunEvent sets AniSpeed before
 * XSkinAnim::OnFrameMove(dt*speed), KTDGXMeshPlayer.cpp1607–1633,1951,3004.
 * Only finite literal global AniSpeed events are supported. */
export function advanceLiteralMeshClock(effect,template,dt){
 const events=(template.events??[]).filter(e=>e.property==='AniSpeed');
 if(events.some(e=>e.fade||!Number.isFinite(e.value)||!Number.isFinite(e.start)))return {supported:false};
 const f=Math.fround,before=effect.sourceMeshGlobalTime??0,global=f(before+f(dt));
 let speed=effect.sourceMeshAnimationSpeed??f(events.find(e=>e.start===0)?.value??1);
 for(const event of events)if(event.start>0&&before<f(event.start)&&global>=f(event.start))speed=f(event.value);
 effect.sourceMeshGlobalTime=global;
 effect.sourceMeshAnimationSpeed=speed;
 effect.animationTime=f(f(effect.animationTime)+f(f(dt)*speed));
 return {supported:true,speed};
}

/** Bounded single-play main-handle consumer. MeshPlayer PlayProcess reads the
 * PREVIOUS SkinAnim end pulse (2119–2123), before SkinAnim advances (1951).
 * The existing executor supplies its mesh clock; this does not implement the
 * complete original animation controller or infer unknown/repeating clips. */
const singlePlayPeriods=new WeakMap();
export function singlePlayMeshPeriod(template){
 if(!template||typeof template!=='object')return null;
 if(singlePlayPeriods.has(template))return singlePlayPeriods.get(template);
 const names=(template.events??[]).filter(event=>event.property==='AniName');
 const speeds=(template.events??[]).filter(event=>event.property==='AniSpeed');
 const period=template.animationClips?.find(clip=>clip.name===template.initialAnimation?.name)?.durationSeconds;
 const supported=template.fields?.MeshType==='X_SKIN_MESH'&&template.fields.LifeType==='LT_PLAY_COUNT'
   &&template.fields.PlayCount===1&&template.initialAnimation?.playback==='XAP_ONE'&&Number.isFinite(period)&&period>0
   &&names.every(event=>event.start===0&&!event.fade&&event.value?.animation===template.initialAnimation.name
     &&event.value?.playback==='XAP_ONE')
   &&speeds.every(event=>!event.fade&&Number.isFinite(event.value)&&event.value>=0&&Number.isFinite(event.start)
     &&event.clock!=='animation');
 const result=supported?Math.fround(period):null;singlePlayPeriods.set(template,result);return result;
}
export function prepareSinglePlayMeshEnd(effect,period){
 const f=Math.fround;
 // SkinAnim XAP_ONE .cpp:787–794 uses a strict transition-window boundary;
 // ChangeAnim .cpp:1272–1282 bounds its end transition by .03f.
 effect.sourceSinglePlayMeshEndPending=f(effect.animationTime)>f(period-Math.max(f(period/10),f(.03)));
}

/** Bounded first-stage consumer from DamageEffect.cpp2395-2420.
 * The GLOBAL_TIME table uses the mesh global clock independently of USE_GLOBAL_TIME.
 * EventTimerGlobal (MeshPlayer2677-2692) uses before <= t && after > t.
 * Multiple-next-stage ownership is deliberately outside this helper. */
export function firstGlobalDamageStageCrossed(raw,before,after){
 const field=raw?.DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME;
 const time=typeof field==='number'?field:field?.['1'];
 if(!Number.isFinite(time)||time<0||!Number.isFinite(before)||!Number.isFinite(after))return false;
 return before<=Math.fround(time)&&after>Math.fround(time);
}

/** Consume the next declared damage stage using its own global timer. BM's
 * shockwaves declare both NEXT and NEXT2 at .2/.4; USE_GLOBAL_TIME only
 * chooses the attack-window clock and must not truncate this stage table. */
export function nextEffectDamageStage(raw,stage,{beforeGlobal,afterGlobal,damageClock}){
 const next=stage+1,key=next===1?'DAMAGE_DATA_NEXT':`DAMAGE_DATA_NEXT${next}`;
 if(!raw?.[key])return stage;
 const event=(field,index)=>typeof field==='number'?(index===1?field:undefined):field?.[String(index)];
 const global=event(raw.DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME,next);
 const local=event(raw.DAMAGE_DATA_CHANGE_TIME,next);
 const globalCrossed=Number.isFinite(global)&&global>=0&&beforeGlobal<=Math.fround(global)&&afterGlobal>Math.fround(global);
 const localReached=Number.isFinite(local)&&local>=0&&damageClock>=local;
 return globalCrossed||localReached?next:stage;
}
export function effectStageDamageData(raw,stage=0){
 return raw?.[stage===0?'DAMAGE_DATA':stage===1?'DAMAGE_DATA_NEXT':`DAMAGE_DATA_NEXT${stage}`];
}
