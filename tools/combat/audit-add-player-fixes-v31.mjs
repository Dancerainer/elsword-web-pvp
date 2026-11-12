import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
const read=p=>readFile(p,'utf8').then(JSON.parse),reference=await read('contracts/add-reference-consumers-v1.json');
const digest=createHash('sha256').update(await readFile('.cache/add-feedback-v31/X2GUAdd.cpp')).digest('hex');
assert.equal(digest,reference.source.sha256);
const methods=reference.methods.filter(m=>/^(?:AirDash|JumpUp|JumpDown|DashJump|LevitationWait|FormationModeStart|SetCustomAnimName|ProcessMagnetronDamageEffect|AttackMagnetronDamageEffect|ANSI_A_APT_MAGNETRON_DYNAMO_|ResetPsychicStormData|ANSI_SA_ALP_PSYCHIC_STORM_FINISH_FrameMove|ANSI_SA_ATT_VOID_FIELD_END_FrameMove)/.test(m.method));
const motions=[],voices=[];
for(const [id,prefix]of [['LP','APT'],['MM','AAT'],['DE','ATT']]){
 const p=PROFESSION_PROFILES[id];
 for(const name of [prefix+'_Formation_Start',prefix+'_Formation_Wait',prefix+'_Formation_DashEnd','Formation_Dash']){assert.ok(p.clips[name]);motions.push({profession:id,name,clip:p.clips[name]});}
 const state=p.states.ANSI_SA_AN_VOID_BREAKER,bank=state.raw.SOUND_SET0;assert.equal(bank.USE_HYPER_SOUND,1);
 voices.push({profession:id,sourceState:state.sourceState,sourcePc:state.sourcePc,bank});
}
const xzz=PROFESSION_PROFILES.DE.states.ANSI_ADE_DASH_JUMP_COMBO_XZZ;
assert.ok(xzz.raw.DISABLE_GRAVITY_TIME_END>xzz.clip.durationSeconds);
const missingDpRate=[];
for(const id of ['LP','MM','DE'])for(const [name,effect]of Object.entries(PROFESSION_PROFILES[id].damageEffects))for(const stage of ['DAMAGE_DATA','DAMAGE_DATA_NEXT']){
 const data=effect.raw[stage];if(data?.DYNAMO_PARTICLE_RATE_TYPE?.$symbol==='DYNAMO_PARTICLE_RATE_TYPE.DPRT_SPEICAL_ACITVE')missingDpRate.push({id,name,stage,sourcePc:effect.sourcePc,rawRate:data.DYNAMO_PARTICLE_RATE_TYPE,damage:data.DAMAGE});
}
const report={schemaVersion:1,originalClientMeasured:false,reference:reference.source,methods,motions,voices,missingDpRate,
 qualifications:['Fixed V5 contains marked later reconstruction; methods carry individual hashes and reconstruction flags.',
 'SetCustomAnimName only directly lists first promotions; second promotions inherit their original motion prefix through an explicit Web adapter.',
 'ADE_DASH_JUMP_COMBO_XZZ free-fall exit fixes an unreachable gravity boundary; matching2016 native exit callback remains unavailable.',
 'Magnetron29205 is LP-only in the original2016 tree; the player common Add label does not promote it to other careers.',
 'Magnetron3/120 degrees/.3s and original Dummy02 refer to qualified reference callbacks. LOT_UID_VECTOR uses the already compiled native steering bridge.',
 'Missing DPRT_SPEICAL_ACITVE resource enum is never given a made-up rate. Only independently known scalar attack fields execute.',
 'Original SlashTrace events remain separate from explicit mesh Velocity/DirSpeed; this motion executor does not invent the trace display.',
 'VoidField collapse member/lingering-bind consumer remains unsupported; original reference explicit cleanup is a documented deviation and Web handle reclamation.'],
 airExit:{sourceState:xzz.sourceState,sourcePc:xzz.sourcePc,raw:xzz.raw,clip:xzz.clip}};
await writeFile('contracts/add-player-fixes-v31.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceSha256:digest,methods:methods.length,motions:motions.length,voices:voices.length}));
