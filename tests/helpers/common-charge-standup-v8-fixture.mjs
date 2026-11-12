/** Actual converted body helpers + Garpai collision for shared recovery checks. */
import {dashZxFixture} from '../../tools/combat/rf_dash_zx_audit.mjs';
import {lkCommandFixture} from './lk-command-fixture.mjs';
import {vcFixture} from './vc-fixture.mjs';
import {bmFixture} from './bm-fixture.mjs';
import {fixture as rsFixture} from './rs-fixture.mjs';
import {make as isFixture} from '../fixtures/is-native-simulation.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';

export async function commonRecoveryFixture(profession,{facing=1,gap=30,sampledLevels=false}={}){
  let f;
  if(profession==='RF'){
    const rf=await dashZxFixture({facing,gap});
    f={sim:rf.s,a:rf.a,b:rf.b};
  }else if(profession==='LK'){
    const lk=await lkCommandFixture({facing,gap,preset:{passives:[],guildPassives:[]}});
    f={sim:lk.sim,a:lk.actor,b:lk.target};
  }else if(profession==='BM')f=bmFixture({facing,gap,passives:[]});
  else if(profession==='RS')f=rsFixture({facing,distance:gap});
  else if(profession==='IS'){
    const sim=isFixture({facing,distance:gap});f={sim,a:sim.actor('is'),b:sim.actor('target')};
  }
  else f=vcFixture({facing,gap,passives:[]});
  const input=createInputBuffer({sampledLevels});
  return {...f,input,step:()=>f.sim.step(1/60,{[f.a.id]:input.consume(f.sim.state.time+1/60)},{snapshot:false}),
    tap:key=>input.tap(key,f.sim.state.time+.001),
    down:key=>input.down(key,f.sim.state.time+.001),
    up:key=>input.up(key,f.sim.state.time+.001)};
}

export function receivedStrike(f,extra={}){
  return f.sim.applyHit(f.b,f.a,{DAMAGE:{PHYSIC:.001},DAMAGE_TYPE:0,REACT_TYPE:1,
    BACK_SPEED_X:0,BACK_SPEED_Y:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0,FORCE_DOWN:0,...extra},
    {kind:'character',powerMultiplier:1});
}

export function beginDown(f,state='RSI_DAMAGE_DOWN_FRONT'){
  f.sim.enter(f.a,state,'diagnostic-down-fixture');f.sim.drainEvents();
}

export function runDownChoice(f,key,{maxSteps=240}={}){
  beginDown(f);const pendingState=f.a.state;
  while(f.a.state===pendingState&&f.a.animationTime<=.66)f.step();
  f.tap(key);f.step();
  const events=[];
  for(let i=0;i<maxSteps;i++){
    f.step();events.push(...f.sim.drainEvents());
    if(events.some(e=>e.type==='stateChanged'&&e.actorId===f.a.id&&e.state==='RSI_WAIT'))break;
  }
  return events;
}
