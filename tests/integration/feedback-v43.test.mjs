import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,TransformNode,Animation,AnimationGroup,Vector3} from '@babylonjs/core';
import {sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {createOpeningPoseHandoff} from '../../apps/web/opening-pose-handoff.mjs';
import {createPoseAudio} from '../../apps/web/pose-audio.mjs';
import {createInterfaceAudio} from '../../apps/web/interface-audio.mjs';
import {skillLabel} from '../../packages/localization/skills.mjs';
import sourceText from '../../packages/localization/skill-text.json' with {type:'json'};

test('opening final frame remains exact despite native looping playback, including first handoff frame',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),bone=new TransformNode('bone',scene);
 const clips=new Map();
 for(const [name,start,end] of [['Start',0,20],['Wait',100,100]]){
  const animation=new Animation(name,'position',60,Animation.ANIMATIONTYPE_VECTOR3);
  animation.setKeys([{frame:0,value:new Vector3(start,0,0)},{frame:120,value:new Vector3(end,0,0)}]);
  const group=new AnimationGroup(name,scene);group.addTargetedAnimation(animation,bone);clips.set(name,group);
 }
 const view={clips,group:null,channelBindings:new Map(),bindPose:[{target:bone,position:new Vector3(0,0,0)}],blendPose:[{target:bone,position:new Vector3(0,0,0)}],sourceDurations:new Map([['Start',2],['Wait',2]]),sourcePlayback:new Map([['Start',0],['Wait',0]]),resetBindPose(){bone.position.setAll(0);}};
 try{
  sampleAnimation(view,'Start',2,false);assert.equal(bone.position.x,0,'reproduce original native wrap');
  const handoff=createOpeningPoseHandoff();
  for(const time of [1.99,2,2,2]){
   handoff.sample({phase:'intro',presentation:{animationName:'Start',duration:2},time});
   sampleAnimation(view,'Start',time,false,null,true);
   assert.equal(bone.position.x,time===1.99?19.9:20);
  }
  const transition=handoff.sample({phase:'fight',dt:0}).transition;
  sampleAnimation(view,'Wait',0,true,transition);assert.equal(bone.position.x,20,'no frame-zero flash at admission');
  sampleAnimation(view,'Wait',.1,true,{...transition,elapsedSeconds:.1});assert.equal(bone.position.x,60);
  sampleAnimation(view,'Wait',.2,true,null);assert.equal(bone.position.x,100);
 }finally{scene.dispose();engine.dispose();}
});

test('result receipt clock rebase does not replay a local defeat voice; a later pose still plays',()=>{
 const played=[],profile={states:{LOSE:{raw:{SOUND_PLAY0:{1:0,2:'defeat.ogg'}}},START:{raw:{SOUND_PLAY0:{1:0,2:'start.ogg'}}}}};
 const audio=createPoseAudio({profileFor:()=>profile,localActorId:()=> 'me',play:name=>played.push(name)});
 const actor={id:'me',x:0,y:0,z:0,pvpPresentation:{state:'LOSE'}};
 for(const time of [0,.5,1,0,.5,1,2])audio.step(actor,time);
 assert.deepEqual(played,['defeat.ogg']);
 actor.pvpPresentation=null;audio.step(actor,0);actor.pvpPresentation={state:'START'};audio.step(actor,0);
 actor.pvpPresentation={state:'LOSE'};audio.step(actor,0);assert.deepEqual(played,['defeat.ogg','start.ogg','defeat.ogg']);
});

test('cancel cue respects volume and uses the original failure asset; successful matching does not invoke it',()=>{
 const played=[],manifest={files:{lobby:{file:'lobby.ogg'},queueCancel:{file:'Battle_Atena_Fail.ogg'},matchSuccess:{file:'success.ogg'}}};
 const audio=createInterfaceAudio({manifest,storage:{getItem:()=> '100'},createAudio:url=>({play(){played.push(url);},pause(){}})});
 audio.matchAccepted('room');assert.deepEqual(played,['/assets/audio/success.ogg']);
 for(const value of [null,{}, {queued:true},{queued:false,matchId:'race'},{queued:false,match:{id:'race'}}])assert.equal(audio.cancelAccepted(value),false);
 assert.equal(played.length,1);
 audio.cancelAccepted({queued:false});assert.equal(played.at(-1),'/assets/audio/Battle_Atena_Fail.ogg');
 audio.setVolume(0);assert.equal(audio.cancelAccepted({queued:false}),false);assert.equal(played.length,2);
 const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
 assert.match(game,/const result=await online.cancel\(\);interfaceAudio\?\.cancelAccepted\(result\);return result/);
});

test('NA source names reach the skill display with distinct enhanced identities',()=>{
 assert.ok(Object.keys(sourceText).length>80);
 for(const [id,row] of Object.entries(sourceText)){
   assert.equal(skillLabel({id:Number(id)}),row.name.replace(/#C[0-9a-f]{6}|#CX/gi,'').trim());
 }
 assert.equal(skillLabel({id:21000}),'Mega Slash');
 assert.equal(skillLabel({id:21026}),'[Enhanced] Mega Slash');
 assert.equal(skillLabel({id:24007}),'Nuclear');
});
