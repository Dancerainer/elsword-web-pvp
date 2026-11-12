/** Web registration policy fixtures; numeric combat expectations live separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFESSION_IDS,PROFESSIONS,normalizeProfessionFlags,effectiveProfessionFlags,selectEnabledProfession} from '../../packages/professions/catalog.mjs';
import {awakeningAttachmentsFor,awakeningActorEligible,createAwakeningEffects} from '../../apps/web/awakening-effects.mjs';
import {swordHudState} from '../../apps/web/way-of-sword-hud.mjs';
import {skillSwordCueState} from '../../apps/web/skill-sword-cues.mjs';
import {pvpMemberProfession} from '../../apps/web/pvp-hud.mjs';
import {createProfessionSamplers} from '../../packages/combat-assets/profession-samplers.mjs';

test('IS registration keeps target class112, own portraits and opt-in legacy settings',()=>{
  assert.deepEqual(PROFESSION_IDS,['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']);
  assert.equal(PROFESSIONS.IS.unitClass,112);assert.equal(PROFESSIONS.IS.portraitUrl,'/assets/is/ui/portrait-party.png');
  const legacy={RF:true,LK:false,VC:true};assert.deepEqual(normalizeProfessionFlags(legacy),{...legacy,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.deepEqual(legacy,{RF:true,LK:false,VC:true});
  assert.deepEqual(normalizeProfessionFlags({RF:false,LK:false}),{RF:false,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.deepEqual(effectiveProfessionFlags({RF:false,LK:false,VC:false,IS:false}),{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.equal(selectEnabledProfession('IS',{RF:false,LK:false,VC:false,IS:true}),'IS');
  assert.equal(selectEnabledProfession('IS',legacy),'RF');
  for(const IS of [1,'true',null])assert.throws(()=>normalizeProfessionFlags({...legacy,IS}),/Invalid profession flags/);
});

test('IS aura registers only IS actors and uses the four Elsword attachments across direction, death and restore',()=>{
  const profile={target:{unitClass:112}},adds=[],stops=[];
  const runtime={add(name,options){const emitter={id:adds.length+1,name,options,position:options.position,particles:new Set()};adds.push(emitter);return emitter;},stop(id,immediate){stops.push([id,immediate]);}};
  const actors=['RF','LK','VC','IS'].map((professionId,i)=>({id:professionId,professionId,hp:100,facing:1,awakening:{remaining:60},x:i}));
  const samplers={effectAnchorSampler:({definition},actor)=>({position:[actor.x,definition.BONE_NAME.includes('Foot')?0:10,0]})};
  const aura=createAwakeningEffects({runtime,samplers,maxHyperModeTime:30,attachments:awakeningAttachmentsFor(profile),eligibleActor:a=>awakeningActorEligible(profile,a)});
  aura.step({actors});assert.equal(adds.length,4);assert.equal(aura.proof().actors,1);
  assert.deepEqual(adds.map(row=>row.name),['HyperBoostRight','HyperBoostLeft','HyperBoostRight','HyperBoostLeft']);
  assert.deepEqual(aura.proof().attachments.map(row=>row.bone),['Bip01_R_Foot','Bip01_L_Foot','Bip01_R_UpperArm','Bip01_L_UpperArm']);
  actors[3].facing=-1;aura.step({actors});assert.equal(adds.length,4);
  assert.deepEqual(aura.proof().attachments.map(row=>row.bone),['Bip01_L_Foot','Bip01_R_Foot','Bip01_L_UpperArm','Bip01_R_UpperArm']);
  actors[3].hp=0;aura.step({actors});assert.equal(aura.proof().emitters,0);assert.deepEqual(stops,[[1,true],[2,true],[3,true],[4,true]]);
  actors[3].hp=100;aura.step({actors});assert.equal(adds.length,8);assert.equal(aura.proof().emitters,4);
  actors[3].awakening.remaining=0;aura.step({actors});assert.equal(aura.proof().emitters,0);
});

test('IS sword HUD and skill slot color consume the actor resource without modifying it',()=>{
  for(const [state,point,side] of [[2,2400,'blue'],[-2,-2400,'red']]){
    const actor={professionId:'IS',wayOfSword:{state,point},wayOfSwordLimits:{vigor:4800,destruction:-4800}},before=structuredClone(actor);
    assert.deepEqual(swordHudState(actor),{visible:true,family:'elsword',chargeRatio:0,flickerPicture:2,state,side,active:true,ratio:.5,point,label:state>0?'Vitality active':'Destruction active',pictures:[0,1,2,4]});
    assert.equal(skillSwordCueState(actor,{raw:{m_usWOSType:state>0?2:1}}),side);
    assert.equal(skillSwordCueState(actor,{raw:{m_usWOSType:0}}),null);assert.deepEqual(actor,before);
    assert.deepEqual(swordHudState({...actor,professionId:'VC'}),{visible:false});
  }
});

test('mixed allies and enemies retain IS portraits and sample their own pose library',()=>{
  assert.equal(pvpMemberProfession({professionId:'IS',actor:{professionId:'LK'}}),PROFESSIONS.IS);
  assert.equal(pvpMemberProfession({actor:{professionId:'IS'}}),PROFESSIONS.IS);
  const methods=['collisionSampler','defenderSampler','motionOffsetSampler','effectAnchorSampler','effectSampler','effectBoneSampler'];
  const samplers=createProfessionSamplers(Object.fromEntries(PROFESSION_IDS.map(id=>[id,Object.fromEntries(methods.map(method=>[method,()=>id]))])));
  for(const method of ['collisionSampler','defenderSampler','motionOffsetSampler'])assert.equal(samplers[method]({professionId:'IS'}),'IS');
  for(const method of ['effectAnchorSampler','effectSampler','effectBoneSampler'])assert.equal(samplers[method]({}, {professionId:'IS'}),'IS');
});
