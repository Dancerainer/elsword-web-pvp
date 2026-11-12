import {originalAddFixture} from './add-native-pose-fixture.mjs';
import {lpOriginalMapFixture} from './lp-original-map-v62.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
/** Authored-map and real-input fixture. No actor/effect writes after initial
 * placement/resources. Tests that isolate a controlled accepted contact must
 * call it explicitly and must not describe that as native geometric contact. */
export async function lpZxInputV62({side=1,z=10,roof=true,epochs=false,unhit=false,networkOwnerId=null}={}){
 const fixture=roof?await lpOriginalMapFixture('elder-wally-castle-roof-stage4',{networkOwnerId}):originalAddFixture('LP',{networkOwnerId});
 const {sim,a,b,profile}=fixture,start=roof?[-900*side,0,0]:[(unhit?700:900)*side,3080,0],target=roof?[-300*side,144,0]:[1300*side,3320,0];
 const startLine=roof?(side===1?1:5):2,targetLine=roof?(side===1?2:4):(side===1?5:3);
 Object.assign(a,{x:start[0],y:start[1],z:start[2],grounded:true,lineId:startLine,lastTouchLineId:startLine,landPosition:[...start],vx:0,vy:0,facing:side});
 Object.assign(b,{x:target[0],y:target[1],z:target[2],grounded:true,lineId:targetLine,lastTouchLineId:targetLine,landPosition:[...target],vx:0,vy:0});
 a.sourceAdd.formation=true;a.sourceAdd.dp=8000;
 const lives={add:1,target:2};if(epochs)sim.networkEpochFor=id=>lives[id];
 const device=createSampledKeyboardBuffer(),direction=side===1?'RIGHT':'LEFT',events=new Map([[0,[['down',direction]]],[1,[['up',direction]]],[3,[['down',direction]]],
  [5,[['down','UP']]],[6,[['up','UP']]],[z,[['down','Z']]],[z+1,[['up','Z']]],[z+7,[['down','X']]],[z+8,[['up','X']]],[60,[['up',direction]]]]);
 const packets=[],trace=[],accepted=[],settled=[],apply=sim.applyHit.bind(sim),emit=sim.emit.bind(sim);
 sim.applyHit=(attacker,target,data,origin)=>{
  const e=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null;
  const before={time:sim.state.time,state:profile.states[attacker.state]?.sourceState,serial:attacker.stateSerial,position:[attacker.x,attacker.y,attacker.z],
   target:[target.x,target.y,target.z],targetGrounded:target.grounded,targetLine:target.lineId,name:e?.name,effectId:e?.id,ownerStateSerial:e?.ownerStateSerial,
   hitCountBefore:e?.hitCount,targetEpoch:sim.networkEpochFor?.(target.id)??0};
  const result=apply(attacker,target,data,origin);if(result.accepted&&attacker.id===a.id)accepted.push({...before,amount:result.amount});return result;
 };
 sim.emit=(type,id,data)=>{
  if(type==='lpZxTierSettled'&&id===a.id)settled.push({...structuredClone(data),time:sim.state.time,targetPosition:[b.x,b.y,b.z],targetLine:b.lineId,
   targetSupport:sim.nativeGeometry.support({position:[b.x,b.y,b.z],radius:profile.referenceSemantics.lineRadius,lastLineId:b.lineId})});
  return emit(type,id,data);
 };
 let frame=0;
 function packet(){for(const [method,key]of events.get(frame)??[])device[method](key,(frame+.5)/60);return device.consume((frame+1)/60);}
 function step(){const p=packet();sim.step(1/60,{add:p},{snapshot:false});packets.push({frame,...p});
  const current=sim.actor('add');trace.push({frame,state:profile.states[current.state].sourceState,position:[current.x,current.y,current.z],grounded:current.grounded,lineId:current.lineId,
   capture:current.sourceAddCombat?.lpZxTarget&&{...current.sourceAddCombat.lpZxTarget}});frame++;}
 return {...fixture,get a(){return sim.actor('add');},get b(){return sim.actor('target');},lives,packets,trace,accepted,settled,
  get frame(){return frame;},step,until(end){while(frame<end)step();},primeDevice(end){while(frame<end){packet();frame++;}}};
}
