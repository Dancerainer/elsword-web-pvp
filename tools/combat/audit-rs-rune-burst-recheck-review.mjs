/** Current simulator observations, kept separate from source expectations. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture,cast,steps} from '../../tests/helpers/rs-fixture.mjs';
const source=JSON.parse(readFileSync('contracts/rs-feedback-review-source.json','utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p,'utf8').replaceAll('\r\n','\n')).digest('hex');
const round=n=>Math.round(n*1e6)/1e6;
export function observe({facing=1,awake=false,speed=1.25,followup=null,delay=0,targetFacing=-facing}={}){
  const f=fixture({skillId:21018,facing});f.b.facing=targetFacing;
  f.a.stats.animationSpeedMultiplier=f.a.buffBaseStats.animationSpeedMultiplier=f.a.equipmentAttributes.animationSpeedMultiplier=speed;
  if(awake)f.a.awakening.remaining=60;
  const contacts=[],states=[];const apply=f.sim.applyParticipantHit.bind(f.sim);
  let mark=null,launch=null,recovery=null,firstInput=null,inputPhase=0,followupHit=null,maxHeight=0;
  f.sim.applyParticipantHit=(a,b,data,origin)=>{
    const out=apply(a,b,data,origin);
    if(out.accepted&&a.id==='rs'){
      const row={time:round(f.sim.state.time),ownerAnimationTime:round(a.animationTime),kind:origin.kind,skillId:origin.skillId??null,react:data.REACT_TYPE,state:b.state,
        y:round(b.y),vy:round(b.vy),fromFront:b.lastAttackerFront,flyCount:b.flyCount};
      contacts.push(row);if(origin.skillId===21018){if(data.REACT_TYPE===2)mark=row;if(data.REACT_TYPE===5)launch=row;}
      else if(launch&&!followupHit)followupHit=row;
    }
    return out;
  };
  cast(f);
  const markClock=f.sim.state.effects.find(e=>e.name==='DamageEffect_SA_ERS_SplashExplosion_Attack')?.clock;
  const forward=facing===1?'RIGHT':'LEFT';
  for(let frame=0;frame<180;frame++){
    let input={held:['Z']};
    if(launch&&followup&&f.sim.state.time+1e-9>=launch.time+delay&&(inputPhase>0||f.a.state==='RSI_WAIT')){
      if(inputPhase===0)firstInput={time:round(f.sim.state.time),y:round(f.b.y),state:f.b.state};
      if(followup==='Z')input={held:['Z'],pressed:inputPhase===0?['Z']:[]};
      else if(inputPhase===0)input={held:[forward],pressed:[forward]};
      else if(inputPhase===1)input={held:[],released:[forward]};
      else if(inputPhase===2)input={held:[forward],pressed:[forward]};
      else input={held:[forward,'Z'],pressed:inputPhase===3?['Z']:[]};
      inputPhase++;
    }
    steps(f.sim,1,input);maxHeight=Math.max(maxHeight,f.b.y-2840);
    if(!recovery&&f.a.state==='RSI_WAIT')recovery=round(f.sim.state.time);
    if(followupHit)break;
  }
  for(const e of f.sim.state.events)if(e.type==='stateChanged'&&e.actorId==='rs')states.push({time:round(e.time),state:e.state,reason:e.reason});
  return {scenario:{facing,awake,speed,followup,delay,targetFacing},mark,launch,recovery,firstInput,followupHit,
    maxHeight:round(maxHeight),contacts,states,markClock,targetEnd:f.b.state};
}
if(process.argv[1]===import.meta.filename){
  const timing=[],followups=[];
  for(const facing of [-1,1])for(const awake of [false,true])for(const speed of [1,1.25,1.8])timing.push(observe({facing,awake,speed}));
  for(const facing of [-1,1])for(const awake of [false,true])for(const followup of ['Z','66Z'])for(const delay of [0,.1,.2,.35,.5])
    followups.push(observe({facing,awake,followup,delay}));
  const out={schemaVersion:1,evidenceClass:'current-simulator-real-source-geometry',originalClientMeasurements:0,
    sources:{contract:'contracts/rs-feedback-review-source.json',contractSha256:sha('contracts/rs-feedback-review-source.json'),
      contractHashNormalization:'UTF-8 LF',
      rsProfileLfSha256:createHash('sha256').update(readFileSync('packages/combat-core/rs-profile.json','utf8').replaceAll('\r\n','\n')).digest('hex')},
    sourceExpectations:source.independentExpectations.splashLaunch,
    scope:'Original Garpai Rock line6, frozen original character/effect helper geometry, native WASM intersection, production passive/equipment1.25. Speeds1/1.8 are explicit sensitivity scenarios. 66Z supplies two physical direction edges with an intervening release, then a Z edge. Timing uses60Hz current simulator, not a target2016 runtime gold.',
    timing,followups,
    summary:{timingScenarios:timing.length,followupScenarios:followups.length,
      successfulFollowups:followups.filter(r=>r.followupHit).length,
      followupByCommand:Object.fromEntries(['Z','66Z'].map(k=>[k,{cases:followups.filter(r=>r.scenario.followup===k).length,
        accepted:followups.filter(r=>r.scenario.followup===k&&r.followupHit).length}]))},
    limitations:['Target2016 original-client trajectories remain zero and matching V6 consumers are unavailable.',
      'One production map position/distance164.87; late misses do not prove every possible pickup distance/state behaves identically.',
      'Fixed-V5 direct EffectSet default clock is qualified source evidence, not whole-client1:1.',
      'No launch-speed, mesh-lifetime, hitbox, hit-stop or invincibility value changed to make a late pickup succeed.']};
  writeFileSync('reports/rs-rune-burst-recheck-review.json',JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(out.summary));
}
