/** Actual Native key paths; only the source starts with awakening/DP. No
 * mirrored formation, injected source clock, or synthetic hit is prepared. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaybackNativeAssets,playbackNativeOwner,nativeDt,canonicalPlaybackReport,playbackRoom} from '../../tools/validation/measure-combat-playback-v12.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
const empty={held:[],pressed:[],released:[],sampledDevice:true},press=key=>({...empty,held:[key],pressed:[key]});
const assets=await loadPlaybackNativeAssets();
for(const profession of ['RF','LP'])test(`actual ${profession} awakening key initializes the unawakened receiver through reliable startup intent`,t=>{
  let now=0;const options={sourceProfession:profession,clock:()=>now},source=playbackNativeOwner(assets,'source',options),receiver=playbackNativeOwner(assets,'target',options);
  t.after(()=>{source.clear();receiver.clear();});
  const a=source.sim.actor('source'),remote=receiver.sim.actor('source'),local=receiver.sim.actor('target');
  // Keep the recipient beyond the actual aura so legitimate local incoming
  // damage/gauge gain cannot masquerade as a source-resource overwrite.
  local.x=1200;local.y=3080;local.z=0;local.landPosition=[1200,3080,0];local.lineId=local.lastTouchLineId=2;
  for(const ctx of [source,receiver])for(const actor of ctx.sim.state.actors){actor.inputLock=0;actor.forceInvincible=0;actor.pvpPresentation=null;}
  if(a.sourceAdd)a.sourceAdd.dp=8000;else a.awakening.orbs=3;
  assert.equal(remote.awakening.remaining,0);if(remote.sourceAdd){assert.equal(remote.sourceAdd.formation,false);assert.equal(remote.sourceAdd.dp,0);}
  const localAwake=structuredClone(local.awakening),localAdd=structuredClone(local.sourceAdd);
  for(let frame=1;frame<=100;frame++){
    now+=1000/60;const result=source.step(frame===1?press('AWAKEN'):empty);
    if(result.report){assert.equal(receiver.sync.receiveActions('source',result.report.actions,1,result.report.frameSeq),true);
      const admission=receiver.sync.receivePeerResult(receiver.sim,'source',result.report,'target');assert.equal(admission.validated,true);}
    receiver.step(empty);
  }
  assert.ok(remote.awakening.remaining>0,'Native startup receives pending intent; a pose remaining clock is not copied');
  if(remote.sourceAdd){assert.equal(remote.sourceAdd.formation,true);assert.ok(remote.sourceAdd.dp>0);}
  else assert.equal(remote.awakening.full,true);
  assert.deepEqual(local.awakening,localAwake);assert.deepEqual(local.sourceAdd,localAdd);
});
test('actual MM A/S factory selection/fire/switch gives each receiver a fresh Native generator clock and keeps later pose from resetting it',async t=>{
  const {originalAddFixture}=await import('../helpers/add-native-pose-fixture.mjs');
  let now=0;const from=originalAddFixture('MM',{skillId:29013,networkOwnerId:'add'}),to=originalAddFixture('MM',{skillId:29013,networkOwnerId:'target'});
  for(const f of [from,to])f.sim.configureLoadout([{skillId:29013},{skillId:29017},...Array(6).fill(null)],'add');
  const selectedId=from.a.loadout[0].skillId;
  const one=f=>{const sync=createLocalOwnershipSync({combatPlaybackVersion:1,ownerStatusVersion:1,continuousAuraVersion:2,clock:()=>now});
    sync.reconcile(f.sim,playbackRoom(f.sim),f.sim.networkOwnerId);
    // Life initialization installs detached room actors. Fixture references
    // from before reconcile are no longer the Native simulation's actors.
    f.a=f.sim.actor('add');f.b=f.sim.actor('target');return {f,sync};};
  const source=one(from),receiver=one(to);t.after(()=>{source.sync.clear();receiver.sync.clear();});
  from.a.sourceAdd.dp=8000;from.a.inputLock=to.a.inputLock=to.b.inputLock=0;
  from.b.x=to.b.x=2000;assert.equal(to.a.sourceAdd.generator,null);assert.equal(to.a.sourceAdd.dp,0);
  const seen=new Set(),sourceSeen=new Set(),sourceEvents=new Set(),unsupported=[];let previous=null,shortened=false,stage=0,switchedAt=null,lastQuery=null;
  for(let frame=1;frame<=720;frame++){
    now+=1000/60;source.sync.beforeStep(from.sim,'add');
    let input=empty;
    // Drive the same actual key path as a player. Selection/fire are different
    // Native operations; a fixed frame number can press during awakening or
    // while the previous operation still owns input and never perform either.
    if(stage===0&&frame>=4){input=press('AWAKEN');stage=1;}
    else if(from.a.state==='RSI_WAIT'&&from.a.skillId===null&&from.a.sourceAdd.formation){
      const slot=stage===3?1:0;lastQuery=from.sim.skillAvailability('add',slot);
      if(lastQuery.available&&stage===1&&lastQuery.mode==='generator-select'){input=press('A');stage=2;}
      else if(lastQuery.available&&stage===2&&lastQuery.mode==='generator-fire'&&sourceSeen.has(selectedId+':ready')){input=press('A');stage=3;}
      else if(lastQuery.available&&stage===3&&lastQuery.mode==='generator-switch'&&sourceSeen.has(selectedId+':firing')){input=press('S');stage=4;switchedAt=frame;}
    }
    from.sim.step(nativeDt,{...source.sync.remoteInputs(from.sim,'add'),add:input},{snapshot:false});
    const events=from.sim.drainEvents();for(const event of events){sourceEvents.add(event.type);if(event.type==='unsupported')unsupported.push(event);}
    const sourceGenerator=from.a.sourceAdd.generator;if(sourceGenerator)sourceSeen.add(sourceGenerator.skillId+':'+sourceGenerator.phase);
    const raw=source.sync.afterStep(from.sim,'add',events,input);
    if(raw){const packet=canonicalPlaybackReport(raw);assert.equal(receiver.sync.receiveActions('add',packet.actions,1,packet.frameSeq),true);
      assert.equal(receiver.sync.receivePeerResult(to.sim,'add',packet,'target').validated,true);}
    receiver.sync.beforeStep(to.sim,'target');to.sim.step(nativeDt,{...receiver.sync.remoteInputs(to.sim,'target'),target:empty},{snapshot:false});
    receiver.sync.afterStep(to.sim,'target',to.sim.drainEvents(),empty);
    const g=to.a.sourceAdd.generator;if(g){seen.add(g.skillId+':'+g.phase);
      if(previous&&previous.generation===g.generation&&g.remaining<previous.remaining)shortened=true;previous=structuredClone(g);}
    if(switchedAt!==null&&frame>=switchedAt+90)break;
  }
  const sourceDiagnostic=JSON.stringify({stage,state:from.a.state,skillId:from.a.skillId,inputLock:from.a.inputLock,worldStop:from.a.worldStop,sourceAdd:from.a.sourceAdd,query:lastQuery,seen:[...sourceSeen],events:[...sourceEvents],unsupported});
  assert.equal(stage,4,'source AWAKEN/select/fire/switch must all really execute: '+sourceDiagnostic);
  assert.ok(sourceSeen.has(selectedId+':ready'),'source Native selection: '+sourceDiagnostic);
  assert.ok(sourceSeen.has(selectedId+':firing'),'source Native fire: '+sourceDiagnostic);
  assert.ok(sourceSeen.has('29017:ready'),'source Native switch: '+sourceDiagnostic);
  assert.ok(sourceEvents.has('addGeneratorSelected'));assert.ok(sourceEvents.has('addGeneratorFired'));
  assert.ok(seen.has(selectedId+':ready'));assert.ok(seen.has(selectedId+':firing'));assert.ok(seen.has('29017:ready'));
  assert.ok(shortened,'regular source reports do not replace the local generator lifetime');
  assert.equal(to.b.sourceAdd.dp,0);assert.equal(to.b.sourceAdd.formation,false);
});
