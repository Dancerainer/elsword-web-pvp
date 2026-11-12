import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';

// Execute the actual browser tick and recording reset. Rendering is a no-op;
// combat, source collision, keyboard packets and snapshot replay remain real.
test('36,005 practice ticks rotate the input window before stepping and the exported suffix replays exactly',async()=>{
  const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
  const tick=source.slice(source.indexOf('function tick('),source.indexOf("listenBattleWindow('keydown'"));
  const begin=source.match(/^function beginRecording\(reason\).*$/m)[0];
  const sim=await make({passives:[]});sim.drainEvents();
  const context={performance,active:true,mode:'practice',paused:false,slotPreparation:false,
    guildPanel:{isOpen:()=>false},inputBuffer:{consume:()=>({held:[],pressed:[],released:[],sampledDevice:true,pureDouble:[],oneDouble:[]})},
    actorsNow:()=>sim.state.actors,simulation:sim,secondPressed:[],authoritativePvp:null,
    ownsLocalUnit:()=>false,usesCombatPlayback:()=>false,isPvpMode:()=>false,drain:()=>sim.drainEvents(),
    frame:0,replay:[],stateNow:()=>sim.snapshot(),initialSnapshot:null,recordingReason:'initial',
    effectsView:{step(){}},worldColorView:{step(){}},actorRenderClock:{push(){}},manaBreakRenderClock:{push(){}},damageNumbers:{step(){}},
    inputStageTrace:{record:()=>[]},perf:{lastInput:0,stepMs:[],steps:0},measure(){}};
  context.frameSupervisor={presentation:(_stage,callback)=>callback(),proof:()=>null};
  vm.createContext(context);vm.runInContext(begin+'\n'+tick,context);context.beginRecording('initial');
  let maxLength=0,expectedInitial;
  for(let frame=0;frame<36005;frame++){
    if(frame===36000)expectedInitial=sim.snapshot();
    context.tick();maxLength=Math.max(maxLength,context.replay.length);
  }
  assert.equal(maxLength,36000);assert.equal(context.replay.length,5);
  assert.equal(context.recordingReason,'automatic-practice-window');
  const wire=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(wire(context.initialSnapshot),wire(expectedInitial));
  const replay=await make({passives:[]});replay.restore(wire(context.initialSnapshot));replay.drainEvents();
  for(const input of wire(context.replay)){replay.step(input.dt,input.inputs,{snapshot:false});replay.drainEvents();}
  assert.deepEqual(wire(replay.snapshot()),wire(sim.snapshot()));
});
