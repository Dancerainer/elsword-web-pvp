/** Original SetLinkMainEffectByPos overrides absolute mesh size, not a
 * multiplier of the template Size. This specific beam starts at (1,.5,.5). */
export const ADD_FURY_DRONE='Mesh_ADD_Ultimate_Fury_Attack_Dron';
export const ADD_FURY_BEAM='DamageEffect_AMM_Ultimate_Fury_Dynamo';
export function addLinkedDefinition(profile,effect,definition){
 if(effect.sourceAddLinkScale===undefined)return definition;
 if(![ADD_FURY_BEAM,'DamageEffect_ANSI_AMM_COMBO_ZZXX'].includes(effect.name))throw new TypeError('Add link scale requires Ultimate Fury beam');
 const size=profile.effectTemplates[profile.damageEffects[effect.name].raw.MAIN_EFFECT_NAME].initialSize;
 return {...definition,SCALE_X:effect.sourceAddLinkScale/size[0],SCALE_Y:1/size[1],SCALE_Z:1/size[2]};
}
export function validateAddFuryEffectState(effect,profession,actors=[]){
 const s=effect.sourceAddFury;
 if(s===undefined){if(effect.sourceAddLinkScale!==undefined)throw new TypeError('Add link requires Fury identity');return;}
 if(!s||typeof s!=='object'||Array.isArray(s))throw new TypeError('Invalid Add Fury state object');
 const command=s.kind==='command';
 const keys=['role','index','group','targetId',...(s.role==='drone'&&s.index===0?['remaining','activeElapsed']:[]),...(s.timer!==undefined?['timer']:[]),...(command?['kind',...(s.index===0&&s.role==='drone'?['anchor']:[])]:[])];
 if(profession!=='MM'||!['drone','beam'].includes(s.role)||!Number.isInteger(s.index)||s.index<0||s.index>3||
    !Number.isInteger(s.group)||s.group<0||Object.keys(s).some(k=>!keys.includes(k))||keys.some(k=>!(k in s))||
    !(s.targetId===null||typeof s.targetId==='string'&&s.targetId.length>0)||(command?effect.skillId!=null:effect.skillId!==29017)||
    effect.name!==(s.role==='drone'?ADD_FURY_DRONE:command?'DamageEffect_ANSI_AMM_COMBO_ZZXX':ADD_FURY_BEAM)||command&&(s.index>2||s.role==='drone'&&s.index===0&&(!Array.isArray(s.anchor)||s.anchor.length!==3||!s.anchor.every(Number.isFinite))))throw new TypeError('Invalid Add Fury effect identity');
 if(s.timer!==undefined&&(!Number.isFinite(s.timer)||s.timer<0||s.timer>Math.fround(.5)))throw new TypeError('Invalid Add Fury timer');
 if(s.role==='drone'&&s.index===0&&(!Number.isFinite(s.remaining)||s.remaining<0||s.remaining>(command?1.75:6)||
    !Number.isFinite(s.activeElapsed)||s.activeElapsed<0||s.activeElapsed>13.6))throw new TypeError('Invalid Fury elapsed state');
 if(s.role==='beam'&&(!Number.isFinite(effect.sourceAddLinkScale)||effect.sourceAddLinkScale<=0||effect.sourceAddLinkScale>10)||
    s.role==='drone'&&effect.sourceAddLinkScale!==undefined)throw new TypeError('Invalid Fury link scale');
 if(s.targetId!==null&&actors.length){const target=actors.find(a=>a.id===s.targetId),owner=actors.find(a=>a.id===effect.ownerId);
  if(!target||!owner||target.team===owner.team)throw new TypeError('Invalid Fury target ownership');}
}
