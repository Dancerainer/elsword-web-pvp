/** Source expectations are independent: original Manager49/79 does not rearm
 * once on held; XXZZ32765210 has a mandatory2-loop gate. Exercise the complete
 * physical XXZZ chain instead of starting a mocked loop with consumed input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
const dt=1/60;
for(const id of ['LP','MM','DE'])test(`${id}: real XXZZ held fourth Z sustains original minimum2 loops without per-loop physical repeats`,()=>{
 const {sim,a,b}=originalAddFixture(id);b.team=a.team;a.mp=a.mpMax;
 const device=createSampledKeyboardBuffer(),packets=[],events=[];
 function step(){const p=device.consume(sim.state.time+dt);packets.push(p);sim.step(dt,{[a.id]:p},{snapshot:false});events.push(...sim.drainEvents());}
 function edge(key,on){device[on?'down':'up'](key,sim.state.time+.001);}
 function tap(key){edge(key,true);step();edge(key,false);step();}
 function until(fn,max=180){for(let n=0;n<max&&!fn();n++)step();assert.ok(fn(),'bounded real source state/input gate');}
 const source=()=>sim.profileFor(a).states[a.state].sourceState;
 step();tap('X');tap('X');until(()=>source()==='ANSI_COMBO_XX');
 until(()=>a.animationTime>.32);tap('Z');until(()=>source()==='ANSI_COMBO_XXZ');
 until(()=>a.animationTime>.42);const lastPress=packets.length;edge('Z',true);step();
 until(()=>source()==='ANSI_COMBO_XXZZ_START');until(()=>source()==='ANSI_COMBO_XXZZ_LOOP');
 const firstLoopTime=sim.state.time;
 until(()=>source()==='ANSI_COMBO_XXZZ_FINISH');
 assert.equal(events.filter(e=>e.type==='addXxzzLoop'&&e.actorId===a.id).length,2);
 assert.ok(sim.state.time>firstLoopTime,'the minimum is a sustained phase, not immediate Finish');
 assert.equal(packets.slice(lastPress).filter(p=>p.pressed.includes('Z')).length,1);
 assert.ok(packets.slice(lastPress).every(p=>p.held.includes('Z')),'the actual fourth Z stays held through both loop entries');
 assert.equal(a.sourceAddCombat.xxzzLoops,0);
});
