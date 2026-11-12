/** Target2016 Phoenix BDT_AFTER_IMAGE D3DXCOLOR call245, with the fixed
 * KTDGXSkinAfterImage packet timer/fade consumer. GPU rendering is a host port. */
export const PHOENIX_AFTERIMAGE_COLOR=Object.freeze([1,.157,0,1]);
export const AFTERIMAGE_REFERENCE=Object.freeze({intervalSeconds:.02,birthAlpha:.5,fadePerSecond:1.6,localImages:10,remoteImages:5});
// User-requested Phoenix display budget, independent of the fixed V5 timer.
export const PHOENIX_AFTERIMAGE_INTERVAL_SECONDS=.1;
export function phoenixAfterimageEnabled(actor){
  return actor?.hidden!==true&&actor?.hp>0&&(actor.buffs??[]).some(buff=>buff.templateId===4&&
    buff.factorId===46&&!buff.identityCleared&&Object.values(buff.displayer?.COMBINATION??{}).includes(8)&&
    buff.displayer?.BDT_AFTER_IMAGE?.COLOR?.$symbol==='call@4.return0');
}
export function createAfterimageClock(count){
  if(![5,10].includes(count))throw new TypeError('Original afterimage count required');
  let next=0,index=0;const alpha=Array(count).fill(0);
  return {step(dt,enabled){
    let capture=null;
    if(enabled){next-=dt;if(next<=0){capture=index;alpha[index]=AFTERIMAGE_REFERENCE.birthAlpha;
      index=(index+1)%count;next=PHOENIX_AFTERIMAGE_INTERVAL_SECONDS;}}
    for(let i=0;i<count;i++)alpha[i]=Math.max(0,alpha[i]-AFTERIMAGE_REFERENCE.fadePerSecond*dt);
    return {capture,alpha};
  },clear(){next=0;index=0;alpha.fill(0);}};
}
