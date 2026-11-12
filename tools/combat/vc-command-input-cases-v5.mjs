/** Deterministic browser/native-input QA prefixes, 0-based frame at 60 Hz.
 * These describe current input replay, not original-client capture. */
export const VC_COMMAND_INPUT_CASES=Object.freeze([
  {id:'zzzz',frames:360,screenshots:[6,20,40,68,120]},
  {id:'zzxx',frames:360,screenshots:[6,20,36,64,140]},
  {id:'xxxx',frames:360,screenshots:[12,32,56,88,180,230]},
  {id:'airzxx',frames:360,screenshots:[15,30,45,58,95]},
  {id:'airxxxx',frames:360,screenshots:[15,25,42,65,90,140]},
  {id:'dashzzz',frames:360,screenshots:[15,35,55,90]},
  {id:'jumpz',frames:180,screenshots:[15,30,60]},
  {id:'jumpx',frames:180,screenshots:[15,30,60]},
]);
export function feedVcCommandInput(input,sim,actor,mode,frame){
  const edge=(key,down)=>input[down?'down':'up'](key,sim.state.time+.001);
  const direction=actor.facing>0?'RIGHT':'LEFT';
  if(mode.startsWith('air')||mode.startsWith('dash')){
    if(frame===0||frame===2)edge(direction,true);
    if(frame===1||frame===10)edge(direction,false);
  }
  if(mode.startsWith('air')||mode.startsWith('jump')){if(frame===3)edge('UP',true);if(frame===4)edge('UP',false);}
  const list=mode==='airzxx'?[[10,'Z'],[20,'X'],[30,'X']]:mode==='airxxxx'?[[10,'X'],[20,'X'],[40,'X'],[70,'X']]:
    mode==='dashzzz'?[[10,'Z'],[20,'Z'],[30,'Z']]:mode==='jumpz'?[[10,'Z']]:mode==='jumpx'?[[10,'X']]:[];
  for(const [n,key]of list){if(frame===n)edge(key,true);if(frame===n+1)edge(key,false);}
  if(['zzzz','zzxx','xxxx'].includes(mode)){
    const key=mode==='xxxx'||mode==='zzxx'&&!['RSI_WAIT','RSI_COMBO_Z'].includes(actor.state)?'X':'Z';
    edge(key==='Z'?'X':'Z',false);
    if(frame<100&&frame%2===0)edge(key,true);else{edge('Z',false);edge('X',false);}
  }
}
