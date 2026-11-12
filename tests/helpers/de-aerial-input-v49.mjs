import {originalAddFixture} from './add-native-pose-fixture.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
import source from '../../contracts/de-aerial-cancel-v49.json' with {type:'json'};
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
export function replayDeAerialCancels({commands=addCommands,cycles=2,facing=1,extraX=false}={}){
 const {sim,a,b}=originalAddFixture('DE'),input=createSampledKeyboardBuffer(),trace=[],packets=[];
 sim.nativeCommandsByProfession.DE=commands;b.x=2000;a.facing=facing;let frame=0;
 const step=(events=[])=>{
  frame++;for(const [method,key]of events)input[method](key,(frame-.5)/60);
  const keys=input.consume(frame/60),before={state:a.state,time:a.animationTime,grounded:a.grounded};
  sim.step(1/60,{add:keys},{snapshot:false});packets.push({frame,...keys});
  trace.push({frame,before,state:a.state,time:a.animationTime,grounded:a.grounded,x:a.x,y:a.y});return trace.at(-1);
 };
 const direction=facing===1?'RIGHT':'LEFT',rounds=[];
 for(let cycle=0;cycle<cycles;cycle++){
  step([['up',direction]]);step([['down',direction]]);step([['up',direction]]);step();step([['down',direction]]);
  step();step([['down','UP']]);step([['up','UP']]);step();step();step([['down','Z']]);step([['up','Z']]);
  for(let i=0;i<5;i++)step();step([['down','X']]);step([['up','X']]);
  let entered=false,landing=null,exit=null,enteredFrames=0;
  for(let i=0;i<130;i++){
   const row=step(extraX&&enteredFrames===5?[['down','X']]:extraX&&enteredFrames===6?[['up','X']]:[]);
   if(row.state===source.state.name){entered=true;enteredFrames++;}
   if(entered&&row.grounded&&!landing)landing=row;
   if(entered&&row.state!==source.state.name){exit=row;break;}
  }
  rounds.push({entered,landing,exit});
 }
 return {rounds,trace,packets,attacks:sim.state.events.filter(e=>e.type==='addDeAerialZx'),profile:sim.profileFor(a)};
}
