/** Native source inputs and the finite frozen particle declaration. Replaying a
 * late presentation birth is a Web adapter, not original-client clock gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const dt=1/60;
for(const hyper of [false,true])test(`actual Power Assault ${hyper?'Hyper':'normal'} Ready birth survives the source packet and repeats only for a new source identity`,async t=>{
  const positions=[[2022.98,2840,0],[-10000,2840,0]],source=await make({skillId:24027,passives:[],positions}),receiver=await make({skillId:24027,passives:[],positions});
  source.networkOwnerId='rf';receiver.networkOwnerId='target';const sync=createLocalOwnershipSync(),consumer=createRemoteActionConsumer({clock:()=>0});t.after(()=>consumer.clear());
  const room={snapshot:source.snapshot(),ownership:{mode:'local-owner-v1',actors:{rf:{epoch:1},target:{epoch:1}}}};sync.reconcile(source,room,'rf');receiver.state.nextEffectId=1000;
  const seen=[];
  for(let cast=0;cast<2;cast++){
    const actor=source.actor('rf');actor.mp=300;actor.cooldowns={};actor.inputLock=0;source.enter(actor,'RSI_WAIT','controlled-ready-recast');if(hyper)actor.awakening.remaining=20;source.drainEvents();
    let packet,sourceBorn=0;
    for(let frame=0;frame<12&&!packet;frame++){
      sync.beforeStep(source,'rf');source.step(dt,frame===0?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});const events=source.drainEvents();
      sourceBorn+=events.filter(e=>e.type==='effectStarted'&&e.name==='RST_ReadyPM').length;const report=sync.afterStep(source,'rf',events);
      if(report?.actions.some(action=>action.effects.some(e=>e.name==='RST_ReadyPM')))packet=report;
    }
    assert.equal(sourceBorn,1,'real native source emits its Ready once');assert.ok(packet,'canonical birth reaches an ordinary source report');
    packet.actions=packet.actions.map(({ageFrames,...action})=>action);
    const action=packet.actions.find(action=>action.effects.some(e=>e.name==='RST_ReadyPM')),ready=action.effects.find(e=>e.name==='RST_ReadyPM');
    assert.equal(ready.setName,'EffectSet_SA_Raven_PowerAssault');assert.equal(ready.definitionMember,'EFFECT1');assert.equal(Object.hasOwn(ready,'damage'),false);
    consumer.receive('rf',[action],1,packet.frameSeq);assert.equal(consumer.consume(receiver,'target',()=>1),1);
    const first=receiver.drainEvents().filter(e=>e.type==='effectStarted'&&e.name==='RST_ReadyPM');assert.equal(first.length,1);
    assert.equal(receiver.state.effects.length,0,'presentation birth does not leave a temporary combat record');
    consumer.receive('rf',[action],1,packet.frameSeq);consumer.consume(receiver,'target',()=>1);
    assert.equal(receiver.drainEvents().filter(e=>e.type==='effectStarted'&&e.name==='RST_ReadyPM').length,0,'same action cannot birth again');
    const repeated={...structuredClone(action),id:action.id+1000,frameSeq:action.frameSeq+1};consumer.receive('rf',[repeated],1,repeated.frameSeq);consumer.consume(receiver,'target',()=>1);
    assert.equal(receiver.drainEvents().filter(e=>e.type==='effectStarted'&&e.name==='RST_ReadyPM').length,0,'new action with the same source effect identity cannot birth again');
    seen.push({wireId:ready.id,localId:first[0].effectId});
    for(let frame=0;frame<120;frame++){source.step(dt,{}, {snapshot:false});source.drainEvents();}
  }
  assert.notEqual(seen[0].wireId,seen[1].wireId,'second actual cast owns a new source effect ID');assert.notEqual(seen[0].localId,seen[1].localId);
});

test('frozen RST Ready parent and its actual trace children finish without a guessed TTL or a live mesh controller',()=>{
  const definition=profile.effectSets.EffectSet_SA_Raven_PowerAssault.raw.EFFECT1,template=visualIndex.templates.RST_ReadyPM;
  assert.equal(definition.TRACE_MORE,1);assert.equal(definition.BONE_NAME,'Bip01');assert.equal(definition.START_TIME,.01);
  assert.equal(template.kind,'particle');assert.equal(template.fields.TriggerCount,1);assert.equal(template.fields.NumParticles,1);assert.equal(template.fields.Lifetime,1);
  assert.deepEqual(template.repeated.TraceParticleList,['RST_ReadyP01','RST_ReadyP02','RST_ReadyP03','RuneGuardIce_S04']);
  for(const name of template.repeated.TraceParticleList)assert.ok(visualIndex.templates[name],'frozen child '+name+' is available');
  const runtime=createEffectRuntime({index:visualIndex});runtime.add('RST_ReadyPM',{position:[2022.98,2840,0],traceMore:true,anchor:state=>state.position});let peak=0;
  for(let frame=0;frame<600;frame++){runtime.step(dt,{position:[2022.98-frame,2840,0]});peak=Math.max(peak,runtime.count);}
  assert.ok(peak>0,'actual particles were emitted');assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});
