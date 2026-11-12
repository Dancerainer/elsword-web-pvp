/** Small target2016 declarations; no model or pose-key duplication.
 * Original RAVEN_FIGHTER.lua KL82 assignments 12805 / 12847; RF's already
 * converted GetChance clips supply both RF and VC body/helper sampling.
 */
export const RAVEN_STANDUP_SOURCE=Object.freeze({
  path:'asset_work/raw/data/data036.kom/RAVEN_FIGHTER.lua',
  sha256:'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3',
  evidenceClass:'target2016-declaration+original-D3DX-converted-keys; client-unmeasured',
});
const clips={
  SI_A_RF_GET_CHANCE_FRONT:{durationSeconds:.7,durationTicks:3360,ticksPerSecond:4800,
    sourceName:'SI_A_RF_GET_CHANCE_FRONT',decodedKeysSha256:'31cc8de972841020bcbbabd2097fee65cba30dbdab33281672d547a1b7af0967'},
  SI_A_RF_GET_CHANCE_BACK:{durationSeconds:.7,durationTicks:3360,ticksPerSecond:4800,
    sourceName:'SI_A_RF_GET_CHANCE_BACK',decodedKeysSha256:'d48bb97427c3637617d6e577548a6337b2b99cbb796bc188b9d066ef50af75fc'},
};
export const RAVEN_STANDUP_SHARED_CLIPS=Object.freeze(Object.keys(clips));
const base={SPEED_Y:0,SPEED_X:0,PLAY_TYPE:2,TRANSITION:0,LAND_CONNECT:0,
  INVINCIBLE:{'1':0,'2':100},SLASH_TRACE:{'1':0,'2':100},ATTACK_TIME0:{'1':.23,'2':.4},
  DAMAGE_DATA:{BACK_SPEED_Y:0,CAMERA_CRASH_GAP:5,CAMERA_CRASH_TIME:.2,DAMAGE_TYPE:0,HIT_TYPE:1,
    REACT_TYPE:2,DAMAGE:{PHYSIC:1},BACK_SPEED_X:500},IS_ATTACK_STATE:1};
export const RAVEN_NO_DOWN_STANDUP_STATES=Object.freeze(Object.fromEntries(['FRONT','BACK'].map(side=>{
  const name=`RSI_STANDUP_ATTACK_${side}_NO_DOWN`,animationName=`SI_A_RF_GET_CHANCE_${side}`;
  const raw={...structuredClone(base),ANIM_NAME:animationName,
    SOUND_PLAY0:{'1':side==='FRONT'?.492:.477,'2':'Raven_Slash1.ogg'},
    ...(side==='BACK'?{FLIP_DIR_END:1,SOUND_PLAY1:{'1':.973,'2':'Raven_Slash2.ogg'}}:{})};
  return [name,{raw,sourceState:name,sourcePc:{prototype:0,assignmentInstruction:side==='FRONT'?12805:12847},
    animationName,clip:clips[animationName],validation:RAVEN_STANDUP_SOURCE.evidenceClass}];
})));
