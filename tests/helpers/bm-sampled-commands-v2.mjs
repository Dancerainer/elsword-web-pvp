import assert from 'node:assert/strict';
import {bmFixture} from './bm-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';

/** DOM-style levels, sampled on separate simulation packets. Inspector tap()
 * bypasses this device path and must not be used for feedback reproduction. */
export function bmSampledFixture(options={}){
  const fixture=bmFixture({gap:4000,...options}),{sim,a}=fixture;
  const input=createInputBuffer({sampledLevels:true}),frames=[];
  const step=(count=1)=>{for(let i=0;i<count;i++){
    const packet=input.consume(sim.state.time+1/60,1/60);
    assert.equal(packet.sampledDevice,true);
    sim.step(1/60,{bm:packet});
    frames.push({time:sim.state.time,state:a.state,serial:a.stateSerial,animationTime:a.animationTime,
      x:a.x,y:a.y,vy:a.vy,grounded:a.grounded,lineId:a.lineId,pressed:packet.pressed,
      blackHoleCount:a.sourceBladeMaster?.blackHoleCount,blackHoleRemaining:a.sourceBladeMaster?.blackHoleRemaining});
  }};
  const down=key=>input.down(key,sim.state.time+.001),up=key=>input.up(key,sim.state.time+.001);
  const press=key=>{down(key);step();up(key);step();};
  const until=(predicate,message,max=360)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),message??`Last state ${a.state} at ${a.animationTime}`);};
  const wait=state=>until(()=>a.state===state,`Expected ${state}, got ${a.state}`);
  const at=time=>until(()=>a.animationTime>=time,`Expected animation time ${time}`);
  const zzz=()=>{press('Z');press('Z');wait('RSI_COMBO_ZZ');press('Z');wait('RSI_COMBO_ZZZ');};
  const upFinisher=()=>{zzz();down('UP');press('Z');up('UP');wait('RSI_RBM_COMBO_ZZZupZ');};
  const xzzz=()=>{press('X');press('Z');wait('RBM_COMBO_XZ');press('Z');wait('RBM_COMBO_XZZ');press('Z');wait('RBM_COMBO_XZZZ');};
  const blackHole=()=>{zzz();press('X');wait('RBM_COMBO_ZZZX');press('Z');wait('RBM_COMBO_ZZZXZ');};
  const dashJumpThird=()=>{
    const key=a.facing>0?'RIGHT':'LEFT';press(key);down(key);step();
    assert.equal(a.state,'RSI_DASH');press('UP');assert.equal(a.state,'RSI_DASH_JUMP');
    up(key);step(5);press('Z');wait('RSI_DASH_JUMP_COMBO_Z');press('Z');wait('RSI_DASH_JUMP_COMBO_ZZ');
    at(.11);press('Z');wait('RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ');
  };
  return {...fixture,input,frames,step,down,up,press,until,wait,at,zzz,upFinisher,xzzz,blackHole,dashJumpThird};
}
