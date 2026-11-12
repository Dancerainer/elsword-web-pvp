/** Original Elsword_SwordMan.lua GetChance declarations. LK, RS and IS reuse
 * the two already converted Motion_Elsword.x clips; no new model or pose keys.
 * Source bytes and decoded keys: contracts/fast-standup-source-v2.json.
 */
export const ELSWORD_STANDUP_SOURCE=Object.freeze({
  path:'asset_work/raw/data/data036.kom/Elsword_SwordMan.lua',
  sha256:'743fc48b74fd35ed69a2e8573acd2d7759d3005340ff4e1655c0678dbf741031',
  evidenceClass:'target2016-declaration+original-D3DX-converted-keys; client-unmeasured',
});
const clips={
  SI_A_EL_GET_CHANCE_FRONT:{durationSeconds:.7,durationTicks:3360,ticksPerSecond:4800,
    sourceName:'SI_A_EL_GET_CHANCE_FRONT',decodedKeysSha256:'26e527809201eb883d7cd4fdd9ba24a6cd7478dc625f7935dfa6459ecbe8fe86'},
  SI_A_EL_GET_CHANCE_BACK:{durationSeconds:.7,durationTicks:3360,ticksPerSecond:4800,
    sourceName:'SI_A_EL_GET_CHANCE_BACK',decodedKeysSha256:'e5250c3860f9709f70f177b63f153e37634bead86d639fe523749b28ab7d4af4'},
};
const base={SPEED_Y:0,SPEED_X:0,PLAY_TYPE:2,TRANSITION:0,LAND_CONNECT:0,
  INVINCIBLE:{'1':0,'2':100},SLASH_TRACE:{'1':0,'2':100},ATTACK_TIME0:{'1':.23,'2':.4},
  DAMAGE_DATA:{CAMERA_CRASH_GAP:5,FORCE_DOWN:13.88,HIT_ADD_MP:5,TECH_POINT:413,
    BACK_SPEED_Y:0,CAMERA_CRASH_TIME:.2,WAY_OF_SWORD_TYPE:1,DAMAGE_TYPE:0,HIT_TYPE:1,
    REACT_TYPE:2,ATTACK_TYPE:2,BACK_SPEED_X:740,DAMAGE:{PHYSIC:2.75}},IS_ATTACK_STATE:1};
export const ELSWORD_NO_DOWN_STANDUP_STATES=Object.freeze(Object.fromEntries(['FRONT','BACK'].map(side=>{
  const name=`ESSI_STANDUP_ATTACK_${side}_NO_DOWN`,animationName=`SI_A_EL_GET_CHANCE_${side}`;
  return [name,{raw:{...structuredClone(base),ANIM_NAME:animationName,
    SOUND_PLAY0:{'1':side==='FRONT'?.33:.43,'2':'Slash.ogg'},...(side==='BACK'?{FLIP_DIR_END:1}:{})},
    sourceState:name,sourcePc:{prototype:0,assignmentInstruction:side==='FRONT'?6135:6196},
    animationName,clip:clips[animationName],validation:ELSWORD_STANDUP_SOURCE.evidenceClass}];
})));
