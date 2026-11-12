import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,validateOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

for(const mode of ['flame','crow'])test(`VC ${mode} owner report remains valid at every real command/skill frame`,()=>{
  const {sim,a}=vcFixture({skillId:24022,gap:1500});
  sim.networkOwnerId=a.id;
  const seen=new Set();
  for(let i=0;i<360;i++){
    let held=[],pressed=[];
    if(mode==='flame'){
      if(i===0){held=['RIGHT'];pressed=['DASH','RIGHT'];}
      else if(i<180){held=['Z'];if(i>2&&i%7===3)pressed=['Z'];}
    }else if(i<190&&i%2===0){held=['A'];pressed=['A'];}
    sim.step(1/60,{vc:{held,pressed}},{snapshot:false});seen.add(a.state);
    assert.doesNotThrow(()=>validateOwnedState(encodeOwnedState(sim,a.id,{frameSeq:i+1})),`frame=${i} state=${a.state} VC=${JSON.stringify(a.sourceVeteranCommander)}`);
    sim.drainEvents();
  }
  assert.ok([...seen].some(s=>s.includes(mode==='flame'?'ZZZPushZ':'IGNITION_CROW')),[...seen].join(','));
});

test('VC remote overheat notice does not create an incomplete actor control object',()=>{
  const source=vcFixture({skillId:24022,gap:1500}),target=vcFixture({skillId:24022,gap:1500});
  source.sim.networkOwnerId='vc';target.sim.networkOwnerId='target';
  const playback=createRemoteCombatPlayback({clock:()=>source.sim.state.time*1000});
  playback.bind(target.sim,'target',()=>0);
  let notices=0,receivedNotices=0,previousSerial=-1;
  for(let i=0;i<240;i++){
    const input=i<190&&i%2===0?{held:['A'],pressed:['A']}:{};
    source.sim.step(1/60,{vc:input},{snapshot:false});
    const packet=encodeOwnedState(source.sim,'vc',{frameSeq:i+1}),action=encodeCriticalAction(packet,{id:i+1});
    action.playback={version:1,start:source.a.stateSerial!==previousSerial,held:input.held??[]};
    previousSerial=source.a.stateSerial;
    playback.receiveActions('vc',[action],0,i+1);
    playback.beforeStep(target.sim,'target',()=>0);
    target.sim.step(1/60,playback.remoteInputs(target.sim,'target'),{snapshot:false});playback.afterStep(target.sim);
    if(source.a.sourceVeteranCommander?.overheatNotice)notices++;
    assert.doesNotThrow(()=>encodeOwnedState(target.sim,'vc',{frameSeq:i+1}),`frame=${i} VC=${JSON.stringify(target.a.sourceVeteranCommander)}`);
    source.sim.drainEvents();receivedNotices+=target.sim.drainEvents().filter(e=>e.type==='overheatIcon'&&e.networkArrival).length;
  }
  assert.ok(notices>0);assert.equal(receivedNotices,1,'repeated control samples cannot restart the same notice');playback.clear();
});

test('an expired VC notice is consumed without creating a late icon or a partial actor object',()=>{
  const source=vcFixture({skillId:24022,gap:1500}),target=vcFixture({skillId:24022,gap:1500});
  source.sim.networkOwnerId='vc';target.sim.networkOwnerId='target';
  for(let i=0;!source.a.sourceVeteranCommander?.overheatNotice&&i<90;i++)
    source.sim.step(1/60,{vc:i%2===0?{pressed:['A'],held:['A']}:{}},{snapshot:false});
  const packet=encodeOwnedState(source.sim,'vc',{frameSeq:100}),action=encodeCriticalAction(packet,{id:1});
  action.playback={version:1,start:true,held:[]};
  const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(target.sim,'target',()=>0);
  target.sim.drainEvents();playback.receiveActions('vc',[action],0,140);playback.beforeStep(target.sim,'target',()=>0);
  assert.equal(target.sim.drainEvents().filter(e=>e.type==='overheatIcon').length,0);
  assert.doesNotThrow(()=>encodeOwnedState(target.sim,'vc',{frameSeq:1}));playback.clear();
});
