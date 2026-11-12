/** Independently inspect a saved browser input trace; never an original-client oracle. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcFixture,vcProfile,vcPreset,vcEffectIndex,vcEffectPoses} from '../../tests/helpers/vc-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const paths=process.argv.slice(2);
if(!paths.length)paths.push('runtime/traces/rf-1791632473817-820c78f1.json','runtime/traces/rf-1791632930919-b473d31e.json','runtime/traces/rf-1791633674954-81127694.json');
const rawPose=json('artifacts/vc/runtime-pose.json');
const characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?json('artifacts/vc/'+rawPose.sharedPose):null);
const profiles=Object.fromEntries(['RF','LK','VC'].map(id=>[id,json('packages/combat-core/'+id.toLowerCase()+'-profile.json')]));
const commonBuffs=json('artifacts/common-buffs/catalog.json');
const fields=['state','animationTime','animationStopped','x','y','z','vx','vy','facing','grounded','lineId','hp','mp'];
const point=a=>Object.fromEntries(fields.map(k=>[k,a[k]]));
const cases=[];
for(const path of paths){
  const raw=read(path),trace=JSON.parse(raw),{native,map}=vcFixture();
  assert.equal(trace.purpose,'current-simulation-trace-not-native-ground-truth');
  const actorId='player-1';
  const sim=createSimulation({profile:vcProfile,profiles,commonBuffs,map,preset:vcPreset,seed:trace.initial.seed,versions:trace.initial.versions,
    actors:trace.initial.actors.map(a=>({id:a.id,professionId:a.professionId,team:a.team,position:[a.x,a.y,a.z],facing:a.facing,lineId:a.lineId,loadout:a.loadout,passives:a.passives})),
    ...createNativeSamplers({profile:vcProfile,characterPose,effectIndex:vcEffectIndex,effectPoses:vcEffectPoses}),
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
  sim.restore(trace.initial);sim.drainEvents();
  const frames=[],events=[];
  for(const [i,packet]of trace.inputs.entries()){
    const before=point(sim.actor(actorId));
    sim.step(packet.dt,packet.inputs,{snapshot:false});
    frames.push({step:i+1,time:sim.state.time,dt:packet.dt,input:packet.inputs[actorId]??{},before,after:point(sim.actor(actorId))});
    events.push(...sim.drainEvents().filter(e=>e.actorId===actorId).map(e=>({step:i+1,...e})));
  }
  const recordedFinal=point(trace.final.actors.find(a=>a.id===actorId)),replayedFinal=point(sim.actor(actorId));
  assert.deepEqual(replayedFinal,recordedFinal,'Replay must match all recorded final motion/state fields');
  const select=es=>es.filter(e=>e.actorId===actorId&&['stateChanged','jump','skillStarted'].includes(e.type)&&e.reason!=='initial')
    .map(e=>({time:e.time,type:e.type,state:e.state,reason:e.reason,skillId:e.skillId,dash:e.dash,verticalSpeed:e.verticalSpeed}));
  assert.deepEqual(select(events),select(trace.events),'Every recorded state, jump and skill event must match replay');
  const followups=events.filter(e=>e.type==='stateChanged'&&e.reason==='user-target2016-vc-air-followup');
  assert.ok(followups.length>0,'Browser trace must contain a real input-driven air follow-up');
  const proofs=followups.map(e=>{
    const frame=frames[e.step-1],takeoff=events.filter(j=>j.type==='jump'&&j.step<e.step).at(-1);
    const skill=events.find(j=>j.type==='skillStarted'&&j.step>e.step);
    const endStep=skill?.step??trace.inputs.length;
    assert.ok(takeoff,'Follow-up must originate from a real recorded jump');
    const flight=frames.filter(f=>f.step>=takeoff.step&&f.step<=endStep);
    assert.equal(flight.filter(f=>f.after.grounded).length,0,'The observed chain must remain airborne');
    assert.equal(events.filter(j=>j.type==='jump'&&j.step>takeoff.step&&j.step<=endStep).length,0,'Air follow-up must not emit another takeoff');
    assert.equal(frame.input.oneDouble?.length,1,'Follow-up must consume the recorded sampled double-direction');
    const vyExpected=Math.max(vcProfile.physics.MAX_G_SPEED,frame.before.vy-vcProfile.physics.G_ACCEL*frame.dt);
    const vxExpected=Math.sign(frame.before.vx)*Math.max(0,Math.abs(frame.before.vx)-vcProfile.physics.RELOAD_ACCEL*frame.dt);
    assert.ok(Math.abs(frame.after.vy-vyExpected)<0.00001,'Double-direction must preserve gravity evolution, not inject jump velocity');
    assert.ok(Math.abs(frame.after.vx-vxExpected)<0.00001,'Double-direction must preserve inertia with authored friction, not set a new dash velocity');
    assert.equal(frame.after.facing,frame.input.oneDouble[0]==='LEFT'?-1:1,'Air follow-up must use the actual second directional press');
    assert.ok(Math.abs(frame.after.y-frame.before.y-frame.after.vy*frame.dt)<0.00001,'Double-direction must integrate one physical step');
    const skillFrame=skill?frames[skill.step-1]:null;
    if(skillFrame){assert.equal(skillFrame.before.grounded,false);assert.ok(skillFrame.after.state.includes('FLY'),'Browser skill must enter an airborne branch');}
    return {takeoffStep:takeoff.step,followupStep:e.step,endStep,airborneFrames:flight.length,groundedFrames:0,extraJumpEvents:0,
      followup:frame,followupVelocityExpected:{vx:vxExpected,vy:vyExpected},skill:skill?{step:skill.step,skillId:skill.skillId,frame:skillFrame}:null,
      stateSequence:events.filter(j=>j.type==='stateChanged'&&j.step>=takeoff.step&&j.step<=endStep).map(({step,time,state,reason})=>({step,time,state,reason})),
      frames:flight.map(({step,time,after})=>({step,time,...after}))};
  });
  cases.push({path,sha256:createHash('sha256').update(raw).digest('hex'),versions:trace.versions,recordingReason:trace.recordingReason,
    inputSteps:trace.inputs.length,initial:point(trace.initial.actors.find(a=>a.id===actorId)),recordedFinal,replayedFinal,
    exactFinalMotionAndState:true,allRecordedStateJumpSkillEventsMatchReplay:true,proofs});
}
const report={schema:'vc-air-browser-validation-v4',evidenceClass:'browser-recorded-current-simulation-input-trace-plus-independent-headless-replay',targetClientMeasured:false,
  limits:['Manual 60 Hz inspector input and frame stepping do not validate real-time input feel or uninterrupted GPU animation.',
    'Headless replay verifies the saved browser trace with current core and original-key samplers; it is not an independent original-client answer.',
    'The Z/X attack following a double-direction can apply its own authored velocity; absence of a new jump is checked at the double-direction step.',
    'New GPU screenshots confirm discrete air poses and updated camera/effects after the inspector render fix. They do not establish frame-perfect screenshot-to-trace mapping or real-time animation continuity.'],
  historicalVisualFailures:[
    {path:'runtime/vc-air-zxx-follow-browser-v4.png',finding:'Earlier standing scene and toast for rf-1791632466566-9ff0b553.json, not the final skill frame of its audited trace.',acceptedAsTerminalFrameEvidence:false},
    {path:'runtime/vc-air-xxxx-follow-browser-v4.png',finding:'Trace toast and HP/MP/cooldown updated, but 3D actor/camera remained at the earlier right platform standing scene, conflicting with the recorded airborne final state.',acceptedAsTerminalFrameEvidence:false}],
  visualReview:{method:'Independent manual view_image inspection of saved actual-browser GPU images; qualitative correspondence, not automated pixel comparison.',
    trace:'runtime/traces/rf-1791633674954-81127694.json',inspectorRenderFixObserved:true,
    images:[
      {path:'runtime/vc-main-final-zxx-before.png',phase:'First ZXX before the new 66',observations:['Actor visibly airborne above the central platform.','Active right-side explosion and smoke beside the aerial attack pose.','Camera shows the central arena, not the obsolete right spawn-platform standing image.']},
      {path:'runtime/vc-main-final-zxx-after.png',phase:'Second ZXX after the new 66',observations:['Actor remains visibly airborne in a changed pose with a new right-side explosion phase.','Camera/arena projection changed consistently with the second higher aerial sequence.']},
      {path:'runtime/vc-main-final-air-skill.png',phase:'Air Flame Sword start at the end of the recorded sequence',observations:['Actor visibly changes to the aerial sword-start pose below the upper platform.','MP is 270/300, down from the preceding 300/300 images; Q shows cooldown 5.','Trace-save toast names rf-1791633674954-81127694.json, matching the third audited record.','Residual attack smoke remains beside the actor; this first skill frame does not document the complete skill visual lifespan.']}
    ].map(v=>({...v,sha256:createHash('sha256').update(read(v.path)).digest('hex')}))},
  cases};
writeFileSync(new URL('reports/vc-air-browser-v4.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(cases.map(c=>({path:c.path,steps:c.inputSteps,proofs:c.proofs.map(p=>({takeoff:p.takeoffStep,followup:p.followupStep,skill:p.skill?.step,airborneFrames:p.airborneFrames,groundedFrames:p.groundedFrames,extraJumpEvents:p.extraJumpEvents})),exactFinal:c.exactFinalMotionAndState})),null,2));
