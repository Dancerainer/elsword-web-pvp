/** Current simulation evidence, kept separate from the C++ source oracle. */
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {vcFixture} from '../../tests/helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createPoseLibrary,sampleLocalTransform} from '../assets/character/sample_pose.mjs';
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root));
const original=createPoseLibrary(JSON.parse(gunzipSync(read('artifacts/vc/source-proof/pose-tracks.json.gz'))));
const ZXX='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',FINISH='RVC_DASH_JUMP_COMBO_XX_FINISH',dt=1/60;
const cases=[];let checked=0,maxRootError=0,maxVerticalIntegrationError=0,maxHorizontalIntegrationError=0;
for(const facing of[-1,1])for(const mode of['zxx','xxxx'])for(const follow of['none','same-zxx','reverse-xx','haze','flame']){
  const {sim,a}=vcFixture({skillId:follow==='flame'?24218:24221,position:[facing*-700,3080,0],gap:2500,facing});
  const input=createInputBuffer({sampledLevels:true}),direction=facing>0?'RIGHT':'LEFT';
  const followDirection=follow==='reverse-xx'?(facing>0?'LEFT':'RIGHT'):direction;
  const from=mode==='zxx'?ZXX:FINISH,events=[],frames=[],inputs=[];let startFollow=-1;
  const edge=(key,down,i)=>{input[down?'down':'up'](key,sim.state.time+.001);inputs.push({frame:i+1,key,down});};
  for(let i=0;i<230;i++){
    if(i===0||i===2)edge(direction,true,i);if(i===1||i===10)edge(direction,false,i);
    if(i===3)edge('UP',true,i);if(i===4)edge('UP',false,i);
    for(const [n,key]of mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:[[10,'X'],[20,'X'],[40,'X'],[70,'X']]){
      if(i===n)edge(key,true,i);if(i===n+1)edge(key,false,i);
    }
    if(startFollow<0&&follow!=='none'&&a.state===from&&a.animationTime>(mode==='zxx'?.25:.31)&&!a.grounded)startFollow=i;
    if(startFollow>=0){
      const j=i-startFollow;
      if(follow==='haze'||follow==='flame'){
        if(j===0)edge('A',true,i);if(j===1)edge('A',false,i);
      }else{
        if(j===0||j===2)edge(followDirection,true,i);if(j===1||j===3)edge(followDirection,false,i);
        for(const[n,key]of follow==='same-zxx'?[[2,'Z'],[12,'X'],[22,'X']]:[[2,'X'],[12,'X']]){
          if(j===n)edge(key,true,i);if(j===n+1)edge(key,false,i);
        }
      }
    }
    const before={state:a.state,serial:a.stateSerial,x:a.x,y:a.y,root:{...a.motionMoveNow},grounded:a.grounded};
    sim.step(dt,{vc:input.consume(sim.state.time+dt)},{snapshot:false});
    events.push(...sim.drainEvents().filter(e=>e.actorId==='vc'&&['stateChanged','velocityEvent','skillStarted'].includes(e.type)).map(e=>({frame:Math.round(e.time/dt),...e})));
    if(a.state.includes('DASH_JUMP_COMBO')&&before.serial===a.stateSerial&&!before.grounded&&!a.grounded){
      if(a.presentationTransition.enabled)throw Error('Unexpected authored hard-transition blend');
      const rootPose=sampleLocalTransform(original,a.animationName,a.animationTime,'Bip01');
      const rootError=Math.max(Math.abs(a.motionMoveNow.x-rootPose.translation[0]),Math.abs(a.motionMoveNow.z-rootPose.translation[2]));
      const vertical=Math.abs(a.y-before.y-a.vy*dt),horizontal=Math.abs(a.x-before.x-a.vx*dt-(rootPose.translation[0]-before.root.x)*a.facing);
      maxRootError=Math.max(maxRootError,rootError);maxVerticalIntegrationError=Math.max(maxVerticalIntegrationError,vertical);maxHorizontalIntegrationError=Math.max(maxHorizontalIntegrationError,horizontal);checked++;
      if(rootError>.003||vertical>.003||horizontal>.003)throw Error(JSON.stringify({mode,follow,facing,i,state:a.state,rootError,vertical,horizontal}));
    }
    if(i<175)frames.push({frame:i+1,state:a.state,animationTime:a.animationTime,stopped:a.animationStopped,grounded:a.grounded,
      x:a.x,y:a.y,vx:a.vx,vy:a.vy,facing:a.facing,gravityDisabled:!!a.skillDisableGravity,
      rootXZ:[a.motionMoveNow.x,a.motionMoveNow.z],speed:a.animationPlaybackSpeed,blend:a.presentationTransition.enabled});
  }
  if(follow==='haze'||follow==='flame'){
    const skillId=follow==='flame'?24218:24221;
    if(!events.some(e=>e.type==='skillStarted'&&e.skillId===skillId))throw Error('Full chain failed to cast '+skillId);
  }
  cases.push({facing,mode,follow,initial:{x:facing*-700,y:3080},inputs,
    peakY:Math.max(...frames.map(f=>f.y)),events,frames});
}
const report={schema:'vc-air-motion-validation-v4',evidenceClass:'current-simulation-traces-and-original-key-data-check',targetClientMeasured:false,
  rootProof:'Full source-proof pose-tracks.json.gz Bip01 translations independently compared with packed runtime motion sampler; original keys, not original-client movement.',
  physicsProof:'Actual airborne displacement compared with post-friction velocity and original root XZ; bounded C++ source equations separately in contracts/vc-air-flow-source-v4.json.',
  cancellation:'User-confirmed target2016 airborne 66 follow-up adaptation, not present in fixed-V5 EventProcess.',
  boundaries:['No original-client or real-time feel acceptance.','Scalar step and pose checks do not establish native Future/Now frame-buffer phase or actual D3DX clock rounding.','Source Y root motion stays visual; physics consumes source XZ only.'],
  checked,maxRootError,maxVerticalIntegrationError,maxHorizontalIntegrationError,cases};
writeFileSync(new URL('reports/vc-air-motion-validation-v4.json',root),JSON.stringify(report)+'\n');
console.log(JSON.stringify({cases:cases.length,checked,maxRootError,maxVerticalIntegrationError,maxHorizontalIntegrationError,
  timeline:cases.filter(c=>c.facing===1).map(c=>({mode:c.mode,follow:c.follow,peakY:c.peakY,events:c.events.filter(e=>e.type==='stateChanged'||e.type==='skillStarted').map(e=>({frame:e.frame,state:e.state,skill:e.skillId,reason:e.reason}))}))}));
