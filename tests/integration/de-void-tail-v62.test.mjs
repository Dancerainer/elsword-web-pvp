/** Per-packet actual uploaded colors across original carrier retirement.
 * Current Web/NullEngine evidence; never an original-client/GPU pixel gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {voidDisplayFixture,VOID_CARRIER,VOID_P09,DT} from '../helpers/de-void-display-fixture-v62.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';

function release(f,hold){f.step({add:{pressed:['A'],held:['A']}});f.until(()=>f.a.state.endsWith('_LOOP'),{add:{held:['A']}});
 for(let i=0;i<Math.ceil(hold/DT);i++)f.step({add:{held:['A']}});
 const carrier=f.sim.state.effects.find(e=>e.name===VOID_CARRIER);assert.ok(carrier);
 assert.ok(f.colorRows().some(r=>r.alpha>0),'held original ground is genuinely visible');
 f.until(()=>carrier.sourceAddVoidCollapse);return carrier;
}
function assertTailWindow(f,carrier,{beforeStep=()=>{}}={}){
 const samples=[],localIds=new Set([carrier.id]),uploadedIntermediate=new Set();let zero=false,intermediate=0,tailSamples=0,mesh=0,quad=0;
 for(let frame=0;frame<600;frame++){
  beforeStep(frame);f.step();const current=f.sim.state.effects.find(e=>e.ownerId===f.a.id&&e.name===VOID_CARRIER&&(e.id===carrier.id||e.networkId===carrier.id)),rows=f.colorRows();
  if(current)localIds.add(current.id);
  const alpha=current?.sourceAddVoidCollapse?.alpha;
  if(alpha>0&&alpha<1){intermediate++;
   for(const row of rows)if(row.kind==='mesh'&&/fx-ATT_Void_Field_P0[12]-/.test(row.name)&&row.alpha>0&&row.alpha<1)
    uploadedIntermediate.add(Math.round(row.alpha*1e6));
  }
  if(alpha===0)zero=true;
  if(zero){const reopened=rows.filter(r=>r.alpha>0);samples.push({frame,time:f.sim.state.time,carrierElapsed:current?.elapsed??null,rows:rows.length,reopened});
   assert.equal(reopened.length,0,'ground reappeared after original collapse alpha reached zero: '+JSON.stringify(samples.slice(-4)));
   mesh+=rows.filter(r=>r.kind==='mesh').length;quad+=rows.filter(r=>r.kind==='quad').length;
   if(!current&&rows.length)tailSamples++;
  }
 }
 assert.ok(zero);assert.ok(intermediate>=8,'fade must contain distinct live intermediate packets, rather than instantaneous hiding');
 assert.ok(uploadedIntermediate.size>=8,'actual Jin materials must expose multiple positive fading values, rather than switching directly off');
 assert.ok(mesh>0&&quad>0,'sample real mesh material and actual quad upload while transparent');
 assert.ok(tailSamples>0,'test must cover surviving AutoDie ground after original collapse/natural carrier retirement');
 const p09=f.events.find(e=>e.type==='effectStarted'&&e.name===VOID_P09);
 assert.ok(p09&&f.events.some(e=>e.type==='effectEnded'&&e.effectId===p09.effectId&&e.reason==='add-void-handle-stop'));
 assert.ok(f.events.some(e=>e.type==='effectEnded'&&localIds.has(e.effectId)),'original main carrier retires independently');
 return {samples,intermediate,tailSamples};
}
for(const [restore,hold]of [['none',.2],['none',2.1],['none',4.4],['owned-apply',2.1],['owned-new-view',4.4]])test(`Void release remains faded through carrier expiry and finite tails (${restore}/held${hold}s)`,async t=>{
 const f=await voidDisplayFixture(t),carrier=release(f,hold);let restored=false;
 assertTailWindow(f,carrier,{beforeStep(){if(restore==='none'||restored||carrier.sourceAddVoidCollapse.alpha>=.65)return;
  const wire=JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:101})));
  validateOwnedState(wire);validateOwnedReferences(wire,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});applyOwnedState(f.sim,f.a.id,wire);
  if(restore==='owned-new-view')f.rebuild();restored=true;
 }});assert.equal(restored,restore!=='none');
});

test('Void production V1 remote controls preserve fade through recipient reconstruction and original carrier retirement',async t=>{
 const source=originalAddFixture('DE',{skillId:29023}),f=await voidDisplayFixture(t),receiver=f.sim;
 source.a.mp=source.a.mpMax;source.b.x=2000;source.sim.networkOwnerId=source.a.id;receiver.networkOwnerId=f.b.id;
 source.sim.networkCombatPlaybackVersion=1;receiver.networkCombatPlaybackVersion=1;
 const producer=createCombatPlaybackProducer({version:1}),playback=createRemoteCombatPlayback({clock:()=>source.sim.state.time*1000});playback.bind(receiver,f.b.id,()=>1);
 t.after(()=>playback.clear());
 let zero=false,intermediate=0,tailSamples=0,carrierId=null,reconstructed=false;const samples=[],uploadedIntermediate=new Set();
 for(let frame=1;frame<=690;frame++){
  const input=frame===1?{pressed:['A'],held:['A']}:source.a.state.endsWith('_LOOP')&&source.a.stateTime<.2?{held:['A']}:{held:[]};
  producer.beforeStep(source.sim,source.a.id);source.sim.step(DT,{[source.a.id]:input},{snapshot:false});
  const events=source.sim.drainEvents(),action=producer.capture(source.sim,source.a.id,{epoch:1,frameSeq:frame,events,held:input.held});
  if(action)playback.receiveActions(source.a.id,[decodeNetworkBinary(encodeNetworkBinary(action))],1,frame);
  playback.beforeStep(receiver,f.b.id,()=>1);receiver.step(DT,playback.remoteInputs(receiver,f.b.id),{snapshot:false});playback.afterStep(receiver);f.present();
  const carrier=receiver.state.effects.find(e=>e.name===VOID_CARRIER);if(carrier)carrierId=carrier.id;
  const alpha=carrier?.sourceAddVoidCollapse?.alpha;
  if(alpha>0&&alpha<1){intermediate++;
   for(const row of f.colorRows())if(row.kind==='mesh'&&/fx-ATT_Void_Field_P0[12]-/.test(row.name)&&row.alpha>0&&row.alpha<1)
    uploadedIntermediate.add(Math.round(row.alpha*1e6));
  }
  if(!reconstructed&&alpha>0&&alpha<.65){f.rebuild();reconstructed=true;}
  if(alpha===0)zero=true;
  if(zero){const rows=f.colorRows(),reopened=rows.filter(r=>r.alpha>0);samples.push({frame,carrier:carrier?.id??null,rows:rows.length,reopened});
   assert.equal(reopened.length,0,'remote ground reappeared: '+JSON.stringify(samples.slice(-4)));if(!carrier&&rows.length)tailSamples++;
  }
 }
 assert.ok(carrierId!==null&&zero&&reconstructed&&intermediate>=8&&tailSamples>0);
 assert.ok(uploadedIntermediate.size>=8);
});
