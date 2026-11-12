/** Read original metadata only; never execute the original client or Lua. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(readFileSync(p,'utf8'));
const professions=['LK','RS','IS'].map(profession=>{
 const folder=profession.toLowerCase(),profile=json(`packages/combat-core/${folder}-profile.json`),posePath=`artifacts/${folder}/runtime-pose.json`,pose=json(posePath),
  poseInputs=[posePath,...(pose.sharedPose?[`artifacts/${folder}/${pose.sharedPose}`]:[])].map(path=>({path,sha256:sha(readFileSync(path))})),
  clips=[...pose.clips,...(pose.sharedPose?json(`artifacts/${folder}/${pose.sharedPose}`).clips:[])],clip=clips.find(c=>c.name==='JumpAttackX');
 if(!clip)throw new Error('No original JumpAttackX for '+profession);
 const def=profile.states.RSI_JUMP_COMBO_X;
 return {profession,unitClass:profile.target.unitClass,originalDeclarationSource:profile.sources.elsword,sourceState:def.sourceState,rawSha256:sha(JSON.stringify(def.raw)),
  clip:def.clip,nativePlaybackField:clip.nativePlaybackField,poseInputs,
  actualTestLoad:'Separate profession profile/pose/effect samplers; the shared clip identity is checked independently for each profession.'};
});
writeFileSync('contracts/elsword-common-air-v57.json',JSON.stringify({schemaVersion:1,originalClientExecuted:false,rawConfigurationChanged:false,
 scope:'User-requested LK/RS/IS actual common8X follow-up, both facings; source declarations and fixedV5 ONE_WAIT reference remain distinct from Web observations',
 reference:'contracts/lk-ca-feedback-v57.json#/lk/airXClock',testScenarios:{high:'Original Garpai line4 y3800, physical forward+UP→X, then original lower lines; no actor teleport or synthetic floor.',
 contact:'Original Garpai line2, physical UP then20 native packets thenX into original standing defender helpers; no collision widening or HP injection.',
 neighbors:'Actual8Z/668Z/668X physical inputs, each profession own source-state/pose; retained WAIT and original grounded successor.'},professions},null,2)+'\n');
console.log(JSON.stringify({professions:professions.map(r=>({profession:r.profession,poseInputs:r.poseInputs.length,nativePlaybackField:r.nativePlaybackField}))}));
