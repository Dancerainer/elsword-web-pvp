/** Compiled-native inputs and frozen-source consumer regressions. These are
 * Web ownership/host tests, not original-client multiplayer or timing gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {make,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {encodeOwnedState,encodeCriticalAction,applyOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {singlePlayMeshPeriod} from '../../packages/combat-core/literal-mesh-clock.mjs';
const dt=1/60;
function pinned(path){
  const manifest=JSON.parse(readFileSync(new URL('../../contracts/rf-native-runtime-sources.json',import.meta.url)));
  const row=manifest.files.find(row=>row.relativePath===path),bytes=readFileSync(new URL('../../.cache/native-source-runtime/'+path,import.meta.url));
  assert.ok(row,path);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);return bytes.toString('latin1');
}
async function arcAt(frame,{hyper=false}={}){
  const source=await make({skillId:24008,passives:[]});source.networkOwnerId='rf';
  const actor=source.actor('rf');actor.inputLock=0;source.enter(actor,'RSI_WAIT','late-arc-regression');
  if(hyper)actor.awakening.remaining=20;
  source.drainEvents();
  for(let i=1;i<=frame;i++){
    const input=i===1?{rf:{pressed:['A'],held:['A']}}:[181,241,301,361].includes(i)?{rf:{pressed:['Z'],held:['Z']}}:{};
    source.step(dt,input,{snapshot:false});source.drainEvents();
  }
  return source;
}

test('frozen Raven release and main-mesh death sources pin the instance-control/lifetime boundary',()=>{
  const raven=pinned('X2Lib/X2GURaven.cpp'),mesh=pinned('KTDXLIB/KTDGXMeshPlayer.cpp'),skin=pinned('KTDXLIB/KTDGXSkinAnim.cpp'),damage=pinned('X2Lib/X2DamageEffect.cpp');
  const release=raven.slice(raven.indexOf('pEffect->SetAttackTime( D3DXVECTOR2( 0, 9999 ) )')-300,raven.indexOf('pEffect->SetAttackTime( D3DXVECTOR2( 0, 9999 ) )')+900);
  assert.match(release,/SetDirSpeed\( 3000\.f \)/);assert.match(release,/SetMaxLifeTime\( 0\.35f \)/);
  assert.match(mesh,/IsAnimationEnd\(\) == true[\s\S]*?m_NowPlayCount\+\+;[\s\S]*?PlayEnd\(\)/);
  assert.match(skin,/case XAP_ONE:[\s\S]*?m_fAnimCurrTime > m_fAnimMaxTime - m_fTransitionTime[\s\S]*?m_bAnimEnd\s*=\s*true/);
  const frame=damage.slice(damage.indexOf('void CX2DamageEffect::CEffect::OnFrameMove'),damage.indexOf('void CX2DamageEffect::CEffect::OnFrameMove')+25000);
  assert.ok(frame.indexOf('IsLiveInstanceHandle( m_hMeshInstHandle ) == false')<frame.indexOf('DamageCheck( &m_DamageData )'));
  const wild=raven.slice(raven.indexOf('void CX2GURaven::RSI_SA_RRF_WILD_CHARGING_StateEnd()'),raven.indexOf('void CX2GURaven::RSI_SA_RRF_WILD_CHARGE_DASH_FrameMove()'));
  assert.ok(wild.includes('StopEffectSet'),'original WildCharge cleanup remains the authoritative stop');
});

test('frozen single-play templates are bounded; unknown clocks, fades and repeated clips stay unsupported',()=>{
  for(const name of ['SI_SA_RRF_WILD_CHARGE03','Raven_MaximumCanon_Mesh01','Raven_Overtaker_Sp1a_ChargedBolt','NUCLEAR_Effect_Nuclear','Raven_OverTaker_Iron_Attack01'])
    assert.ok(singlePlayMeshPeriod(profile.effectTemplates[name])>0,name);
  const template=profile.effectTemplates.SI_SA_RRF_WILD_CHARGE03;
  for(const changed of [{...template,animationClips:[]},{...template,fields:{...template.fields,PlayCount:2}},
    {...template,events:[...template.events,{property:'AniSpeed',start:0,value:1,fade:true}]},
    {...template,initialAnimation:{...template.initialAnimation,playback:'XAP_LOOP'}}])assert.equal(singlePlayMeshPeriod(changed),null);
});

test('WildCharge previous-packet mesh end skips later collision dispatch and emits exactly one native end',async()=>{
  const sim=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  const effect=sim.createEffect(sim.actor('rf'),{NAME:'SI_SA_RRF_WILD_CHARGE_ATTACK'},{birthAnchor:{position:[2022.98,2840,0],rotation:[0,0,0],facing:1}});
  let calls=0;sim.checkHits=()=>{calls++;return 0;};sim.checkGroundHits=()=>{calls++;return 0;};
  sim.drainEvents();let steps=0;
  while(!effect.sourceSinglePlayMeshEndPending&&steps++<80)sim.tickEffects(dt);
  assert.ok(effect.sourceSinglePlayMeshEndPending);assert.ok(sim.state.effects.includes(effect));assert.ok(calls>0);
  const before=calls,clock=effect.elapsed;sim.drainEvents();sim.tickEffects(dt);
  assert.equal(calls,before,'dead main handle skips all remaining collision consumers');assert.equal(effect.elapsed,clock);
  assert.ok(!sim.state.effects.includes(effect));assert.equal(sim.drainEvents().filter(e=>e.type==='effectEnded'&&e.effectId===effect.id&&e.reason==='original-mesh-play-end').length,1);
  sim.tickEffects(dt);assert.equal(sim.drainEvents().filter(e=>e.type==='effectEnded'&&e.effectId===effect.id).length,0);
});

for(const hyper of [false,true])test(`last released native Arc first arrives late with motion, active window and legal victim hit${hyper?' Hyper':''}`,async()=>{
  const source=await arcAt(366,{hyper}),receiver=await make({skillId:24008,passives:[]});receiver.networkOwnerId='target';receiver.state.nextEffectId=1000;
  assert.equal(source.actor('rf').sourceArcEnemy.data.length,0,'actual A and four accepted Z hits release the last held spear');
  const canonical=source.state.effects.find(e=>e.sourceArcHandle===4);assert.ok(canonical);assert.equal(canonical.initialDirSpeed,3000);
  const report=encodeOwnedState(source,'rf',{epoch:1,frameSeq:366});
  assert.ok(!Object.hasOwn(report.effects.find(e=>e.id===canonical.id),'damage'));assert.ok(!Object.hasOwn(report.effects.find(e=>e.id===canonical.id),'initialDirSpeed'));
  applyOwnedState(receiver,'rf',report);receiver.drainEvents();
  const remote=receiver.state.effects.find(e=>e.networkId===canonical.id);assert.ok(remote.id>=1000);
  assert.equal(remote.initialDirSpeed,canonical.initialDirSpeed);assert.equal(remote.damage.ATTACK_TIME_START,canonical.damage.ATTACK_TIME_START);assert.equal(remote.damage.ATTACK_TIME_END,canonical.damage.ATTACK_TIME_END);
  assert.equal(receiver.actor('rf').sourceArcEnemy.effectIds[4],remote.id);const birth=[...remote.currentAnchor.position],hits=[];
  for(let i=0;i<24;i++){
    source.step(dt,{}, {snapshot:false});source.drainEvents();receiver.step(dt,{}, {snapshot:false});
    hits.push(...receiver.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='target'&&e.origin?.id===remote.id));
    if(i===0)assert.deepEqual(remote.currentAnchor.position,canonical.currentAnchor.position,'first independent native mesh phase matches the source');
  }
  assert.ok(Math.hypot(...remote.currentAnchor.position.map((v,i)=>v-birth[i]))>100,'released spear actually travels from its birth anchor');
  assert.equal(hits.length,1,'legitimate released source can hit once without a duplicate');assert.ok(hits[0].amount>0);
  assert.ok(!receiver.state.effects.includes(remote),'native released lifetime also retires after first arrival');
});

test('held Arc first arrival retains zero speed and inactive canonical window',async()=>{
  const source=await arcAt(100),receiver=await make({skillId:24008,passives:[]});receiver.networkOwnerId='target';receiver.state.nextEffectId=1000;
  applyOwnedState(receiver,'rf',encodeOwnedState(source,'rf',{epoch:1,frameSeq:100}));
  const imported=receiver.state.effects.filter(e=>e.sourceArcHandle);assert.equal(imported.length,4);
  for(const effect of imported){assert.equal(effect.initialDirSpeed,0);assert.equal(effect.damage.ATTACK_TIME_END,0);}
  receiver.step(dt,{}, {snapshot:false});assert.equal(receiver.actor('rf').sourceArcEnemy.data.length,4);
  assert.ok(imported.every(e=>e.initialDirSpeed===0&&e.damage.ATTACK_TIME_END===0));
});

test('last released Arc at an actual native collision sample is accepted once through history only and leaves no mesh',async t=>{
  const source=await arcAt(366),receiver=await make({skillId:24008,passives:[]});receiver.networkOwnerId='target';receiver.state.nextEffectId=1000;
  const check=source.checkHits.bind(source);let sample,victimPose;
  // Capture the real native collision callback before the outer damage loop
  // destroys its hit-limit effect. This is a source-phase sample, not a claim
  // that the ordinary20Hz end-of-step uploader retains a destroyed effect.
  source.checkHits=(attacker,shapes,data,hits,origin)=>{
    const effect=source.state.effects.find(e=>e.id===origin.id),before=structuredClone(source.actor('target'));
    const accepted=check(attacker,shapes,data,hits,origin);
    if(accepted&&effect?.sourceArcHandle===4&&!sample){sample=encodeOwnedState(source,'rf',{epoch:1,frameSeq:source.state.step});victimPose=before;}
    return accepted;
  };
  for(let step=0;step<24&&!sample;step++){source.step(dt,{}, {snapshot:false});source.drainEvents();}
  assert.ok(sample,'actual fourth spear reaches a native victim helper');Object.assign(receiver.actor('target'),victimPose);
  const wire=sample.effects.find(e=>e.sourceArcHandle===4),action=encodeCriticalAction(sample,{id:sample.frameSeq,effectIds:new Set([wire.id])});
  const consumer=createRemoteActionConsumer({clock:()=>0});t.after(()=>consumer.clear());
  consumer.receive('rf',[action],1,action.frameSeq);assert.equal(consumer.consume(receiver,'target',()=>1),1);
  const first=receiver.drainEvents();assert.equal(first.filter(e=>e.type==='hit'&&e.targetId==='target'&&e.origin?.kind==='effect').length,1);
  assert.equal(first.filter(e=>e.actorId==='rf'&&e.type==='effectStarted').length,0,'history cannot create an orphan renderer parent');assert.equal(receiver.state.effects.length,0);
  consumer.receive('rf',[{...action,id:action.id+1,frameSeq:action.frameSeq+1}],1,action.frameSeq+1);consumer.consume(receiver,'target',()=>1);
  assert.equal(receiver.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='target'&&e.origin?.kind==='effect').length,0,'source/life receipt survives repeated history');assert.equal(receiver.state.effects.length,0);
});

test('two remote owners may reuse an Arc source ID through history-first/live handoff without capturing another local effect',async t=>{
  const source=await arcAt(366),receiver=await make({skillId:24008,passives:[]});receiver.networkOwnerId='target';
  // Four-player roster, with a second browser reusing the first browser's ID.
  // These extra roster entries isolate adapter identity, not new native gold.
  for(const [id,team] of [['other-source',0],['other-victim',1]])receiver.state.actors.push({...structuredClone(receiver.actor('rf')),id,team,x:3000,y:2840});
  const report=encodeOwnedState(source,'rf',{epoch:1,frameSeq:366}),wire=report.effects.find(e=>e.sourceArcHandle===4);
  receiver.state.nextEffectId=wire.id;
  const protectedEffect=receiver.createEffect(receiver.actor('target'),{NAME:'Raven_ReadyS_PM'},{start:1000});
  receiver.state.nextEffectId=1000;
  const consumer=createRemoteActionConsumer({clock:()=>0});t.after(()=>consumer.clear());
  const action=encodeCriticalAction(report,{id:366,effectIds:new Set([wire.id])});
  consumer.receive('rf',[action],1,366);consumer.receive('other-source',[action],1,366);
  assert.equal(consumer.consume(receiver,'target',()=>1),2);receiver.drainEvents();
  assert.equal(receiver.state.effects.length,1,'temporary history leaves only the receiver live effect');
  applyOwnedState(receiver,'rf',report);applyOwnedState(receiver,'other-source',report);consumer.adopt(receiver,'rf',1);consumer.adopt(receiver,'other-source',1);
  const a=receiver.state.effects.find(e=>e.ownerId==='rf'&&e.networkId===wire.id),b=receiver.state.effects.find(e=>e.ownerId==='other-source'&&e.networkId===wire.id);
  assert.ok(a&&b);assert.notEqual(a.id,b.id);assert.equal(a.initialDirSpeed,3000);assert.equal(b.initialDirSpeed,3000);
  assert.equal(receiver.actor('rf').sourceArcEnemy.effectIds[4],a.id);assert.equal(receiver.actor('other-source').sourceArcEnemy.effectIds[4],b.id);
  for(let i=0;i<24;i++){receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();}
  assert.ok(receiver.state.effects.includes(protectedEffect));assert.notEqual(protectedEffect.dead,true);
  assert.ok(!receiver.state.effects.includes(a)&&!receiver.state.effects.includes(b));
});

test('ten actual native Wild casts retain remote charge stop handles and return packets/effects to a bounded baseline',async()=>{
  const source=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),receiver=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  source.networkOwnerId='rf';receiver.networkOwnerId='target';const sourceSync=createLocalOwnershipSync(),sync=createLocalOwnershipSync();
  const initial={snapshot:source.snapshot(),ownership:{mode:'local-owner-v1',actors:{rf:{epoch:1},target:{epoch:1}}}};
  sourceSync.reconcile(source,initial,'rf');sync.reconcile(receiver,initial,'target');receiver.state.nextEffectId=1000;
  let seenGroups=0,sourceStops=0,remoteStops=0;const bytes=[];
  for(let cycle=0;cycle<10;cycle++){
    const actor=source.actor('rf');actor.mp=300;actor.cooldowns={};actor.inputLock=0;source.enter(actor,'RSI_WAIT','controlled-independent-recast');source.drainEvents();
    for(let frame=0;frame<360;frame++){
      sourceSync.beforeStep(source,'rf');source.step(dt,frame===0?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
      const events=source.drainEvents();sourceStops+=events.filter(e=>e.type==='effectEnded'&&e.reason==='original-stop-effect-set'&&/WILD_CHARGE0[12]/.test(e.name)).length;
      const report=sourceSync.afterStep(source,'rf',events);
      if(report){report.actions=report.actions.map(({ageFrames,...action})=>action);sync.receivePeer(receiver,'rf',report,'target');}
      const group=receiver.actor('rf').sourceWildChargeEffectGroup;
      if(group?.length){seenGroups++;for(const entry of group){const effect=receiver.state.effects.find(e=>e.id===entry.id);assert.ok(effect,'remote cleanup handles remain live');assert.equal(effect.ownerId,'rf');assert.ok(effect.id>=1000);}}
      sync.beforeStep(receiver,'target');receiver.step(dt,{}, {snapshot:false});remoteStops+=receiver.drainEvents().filter(e=>e.type==='effectEnded'&&e.reason==='original-stop-effect-set'&&/WILD_CHARGE0[12]/.test(e.name)).length;
    }
    assert.equal(source.state.effects.length,0,'source record count after cast '+cycle);assert.equal(receiver.state.effects.length,0,'receiver record count after cast '+cycle);
    bytes.push(Buffer.byteLength(JSON.stringify(encodeOwnedState(source,'rf',{epoch:1,frameSeq:(cycle+1)*360}))));
  }
  assert.ok(seenGroups>20);assert.equal(sourceStops,20);assert.equal(remoteStops,20);
  assert.ok(bytes.at(-1)<=bytes[0]+128,'completed casts cannot add old attack meshes to future owner packets');
});

for(const hyper of [false,true])for(const firstFrame of [8,18,28,35])test(`native Power Assault first report at ${firstFrame} preserves subsequent motion${hyper?' Hyper':''}`,async()=>{
  const source=await make({skillId:24027,passives:[],positions:[[2022.98,2840,0],[-10000,2840,0]]}),receiver=await make({skillId:24027,passives:[],positions:[[2022.98,2840,0],[-10000,2840,0]]});
  source.networkOwnerId='rf';receiver.networkOwnerId='target';const actor=source.actor('rf');actor.inputLock=0;source.enter(actor,'RSI_WAIT','native-power-first-report');if(hyper)actor.awakening.remaining=20;source.drainEvents();
  for(let frame=1;frame<=firstFrame;frame++){source.step(dt,frame===1?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});source.drainEvents();}
  receiver.state.nextEffectId=1000;const report=encodeOwnedState(source,'rf',{epoch:1,frameSeq:firstFrame});applyOwnedState(receiver,'rf',report);receiver.drainEvents();
  assert.deepEqual(report.actor.passiveSpeed,source.actor('rf').passiveSpeed);assert.deepEqual(encodeCriticalAction(report,{id:firstFrame}).actor.passiveSpeed,report.actor.passiveSpeed);
  for(let step=0;step<80;step++){
    source.step(dt,{}, {snapshot:false});source.drainEvents();receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();const a=source.actor('rf'),b=receiver.actor('rf');
    for(const key of ['x','y','z','vx','vy'])assert.equal(b[key],a[key],key+' at step '+step);
    assert.deepEqual(b.passiveSpeed,a.passiveSpeed);
    for(const e of source.state.effects.filter(e=>e.ownerId==='rf'&&e.damage)){
      const other=receiver.state.effects.find(other=>other.networkId===e.id);assert.ok(other);
      assert.deepEqual(other.sourcePosedAnchor?.position??other.currentAnchor?.position,e.sourcePosedAnchor?.position??e.currentAnchor?.position);
    }
  }
  assert.equal(source.state.effects.length,0);assert.equal(receiver.state.effects.length,0);
});

test('passive movement control rejects malformed/range-invalid values and keeps old owner packets readable',async()=>{
  const source=await make({skillId:24027,passives:[]}),receiver=await make({skillId:24027,passives:[]});
  const report=encodeOwnedState(source,'rf',{epoch:1,frameSeq:0});
  for(const value of [null,[],1500,{x:1500},{x:'1500',y:-1},{x:Infinity,y:-1},{x:NaN,y:-1}])
    assert.throws(()=>validateOwnedState({...report,actor:{...report.actor,passiveSpeed:value}}),/invalid-owner/);
  const tooFast={...report,actor:{...report.actor,passiveSpeed:{x:1000001,y:-1}}};
  assert.throws(()=>validateOwnedReferences(tooFast,receiver.actor('rf'),profile,receiver.map),/owner-state-out-of-range/);
  const old=structuredClone(report);delete old.actor.passiveSpeed;assert.doesNotThrow(()=>validateOwnedState(old));
  assert.doesNotThrow(()=>applyOwnedState(receiver,'rf',old));assert.deepEqual(receiver.actor('rf').passiveSpeed,{x:-1,y:-1});
});

test('native first-late Seven Burst and Valkyrie preserve their unchanged passive controls and motion',async()=>{
  for(const skillId of [24028,24029]){
    const positions=[[2022.98,2840,0],[-10000,2840,0]],source=await make({skillId,passives:[],positions}),receiver=await make({skillId,passives:[],positions});source.networkOwnerId='rf';receiver.networkOwnerId='target';
    source.actor('rf').inputLock=0;source.enter(source.actor('rf'),'RSI_WAIT','native-related-passive-control');source.drainEvents();let frame=0;
    do{source.step(dt,++frame===1?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});source.drainEvents();}while(frame<20);
    assert.equal(source.actor('rf').skillId,skillId,'the actual native skill is active at first arrival');
    assert.deepEqual(source.actor('rf').passiveSpeed,{x:-1,y:-1},'these native routes keep their original sentinel');
    applyOwnedState(receiver,'rf',encodeOwnedState(source,'rf',{epoch:1,frameSeq:frame}));
    for(let step=0;step<12;step++){source.step(dt,{}, {snapshot:false});source.drainEvents();receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();for(const key of ['x','y','vx','vy'])assert.ok(receiver.actor('rf')[key]===source.actor('rf')[key],skillId+':'+key);assert.deepEqual(receiver.actor('rf').passiveSpeed,source.actor('rf').passiveSpeed);}
  }
});

for(const hyper of [false,true])test(`native Power Assault delayed first report preserves six legitimate skill hits${hyper?' Hyper':''}`,async()=>{
  const source=await make({skillId:24027,passives:[]}),receiver=await make({skillId:24027,passives:[]});source.networkOwnerId='rf';receiver.networkOwnerId='target';
  source.actor('rf').inputLock=0;source.enter(source.actor('rf'),'RSI_WAIT','actual-power-hit-fixture');if(hyper)source.actor('rf').awakening.remaining=20;source.drainEvents();
  for(let frame=1;frame<=8;frame++){source.step(dt,frame===1?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});source.drainEvents();}
  applyOwnedState(receiver,'rf',encodeOwnedState(source,'rf',{epoch:1,frameSeq:8}));receiver.drainEvents();const nativeHits=[],receivedHits=[];
  for(let step=0;step<100;step++){source.step(dt,{}, {snapshot:false});nativeHits.push(...source.drainEvents().filter(e=>e.type==='hit'&&e.origin?.skillId===24027));receiver.step(dt,{}, {snapshot:false});receivedHits.push(...receiver.drainEvents().filter(e=>e.type==='hit'&&e.origin?.skillId===24027));}
  assert.equal(nativeHits.length,6);assert.equal(receivedHits.length,6);assert.deepEqual(receivedHits.map(e=>e.amount),nativeHits.map(e=>e.amount));
  // Local victim reactions can alter later body positions independently; this
  // comparison is an accepted-hit regression, not a four-player pose golden.
});
