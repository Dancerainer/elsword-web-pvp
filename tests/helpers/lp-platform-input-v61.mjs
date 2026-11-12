import {originalAddFixture} from './add-native-pose-fixture.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
/** Same production device and physical66/8/Z/X order as the existing DE
 * aerial-input helper. Starting positions are explicit authored Garpai tiers. */
export function lpPlatformInput({side=1,unhit=false,epochs=false}={}){
 const fixture=originalAddFixture('LP'),{sim,a,b,profile}=fixture,input=createSampledKeyboardBuffer();
 const startX=(unhit?500:900)*side,targetX=(unhit?1000:1300)*side,targetY=unhit?3560:3320,line=unhit?9:side===1?5:3;
 Object.assign(a,{x:startX,y:3080,z:0,grounded:true,lineId:2,lastTouchLineId:2,landPosition:[startX,3080,0],vx:0,vy:0,facing:side});
 Object.assign(b,{x:targetX,y:targetY,z:0,grounded:true,lineId:line,lastTouchLineId:line,landPosition:[targetX,targetY,0],vx:0,vy:0});
 a.sourceAdd.formation=true;a.sourceAdd.dp=8000;
 const lives={add:1,target:2};if(epochs)sim.networkEpochFor=id=>lives[id];
 const direction=side===1?'RIGHT':'LEFT',packets=[],trace=[];
 const events=new Map([[0,[['down',direction]]],[1,[['up',direction]]],[3,[['down',direction]]],
  [5,[['down','UP']]],[6,[['up','UP']]],[10,[['down','Z']]],[11,[['up','Z']]],
  [17,[['down','X']]],[18,[['up','X']]],[60,[['up',direction]]]]);
 let frame=0;
 function device(){for(const [method,key]of events.get(frame)??[])input[method](key,(frame+.5)/60);return input.consume((frame+1)/60);}
 function step(){const keys=device();sim.step(1/60,{add:keys},{snapshot:false});packets.push({frame,...keys});
  const current=sim.actor('add');trace.push({frame,state:profile.states[current.state].sourceState,serial:current.stateSerial,position:[current.x,current.y,current.z],grounded:current.grounded,lineId:current.lineId});frame++;}
 return {...fixture,get a(){return sim.actor('add');},get b(){return sim.actor('target');},packets,trace,lives,line,targetY,step,until(end){while(frame<end)step();},
  primeDevice(end){while(frame<end){device();frame++;}}};
}
