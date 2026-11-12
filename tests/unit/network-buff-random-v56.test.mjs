/** Two current-only seeds. Controlled application wires, not native SCTP/WAN.
 * Replaceable input/status packets have20% loss and20..150ms delay/reordering.
 * Reliable controls keep per-direction order; one initial Buff repair is
 * deliberately omitted to model an application/connection rebuild gap. */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buffRoom} from '../helpers/network-buff-room-v38.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
import {buildBuffRows,buffRemainingSeconds} from '../../apps/web/buff-bar.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(sourceCommit,/^[a-f0-9]{40}$/);
// Repeat the independent V55 scenarios against the current program while
// preserving its historical source lock and sealed report unchanged.
const reportDirectory=new URL('../../runtime/v56/network-buff-random/',import.meta.url);
mkdirSync(reportDirectory,{recursive:true});
const reportFile=new URL(Date.now()+'-'+process.pid+'.json',reportDirectory);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['apps/web/online-client.mjs','apps/web/input-prediction.mjs','packages/online/owner-buff-sync.mjs',
  'packages/online/owned-status.mjs','packages/online/owned-buff-display.mjs','packages/combat-core/rf-profile.json',
  'packages/combat-core/buffs.mjs','packages/online/owned-state.mjs',
  'tests/helpers/network-buff-room-v38.mjs','tests/unit/network-buff-random-v56.test.mjs'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,sha(readFileSync(new URL('../../'+file,import.meta.url)))]));
const results=[];
const seeds=[2016551001,2016551002];
const snapshot=row=>row.value.type==='buff-sync'&&row.value.kind==='snapshot';
const randomFor=seed=>{let state=seed>>>0;return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};};

for(const seed of seeds)test(`RF Weapon Break converges under random replaceable loss and reordered arrival, seed${seed}`,async t=>{
  const result={seed,passed:false,stages:[],packets:{scheduled:0,delivered:0,replaceable:0,replaceableDropped:0,
    omittedFirstBuffRepair:0,replaceableReordered:0,maximumPending:0,delayMinMs:null,delayMaxMs:null},
    maximumOutboundRetained:0,maximumInboundPending:0};results.push(result);
  try{
    const r=await buffRoom(t);await r.bootstrap();await r.advance(50);await r.drain();
    const random=randomFor(seed),pending=[],controlDue=new Map(),lastInputOrdinal=new Map();
    let ordinal=0,oldSnapshot=null;
    const initialHp=Object.fromEntries(r.ids.map(id=>[id,r.endpoints[id].sim.actor('b').hp]));
    const initialStats=Object.fromEntries(r.ids.map(id=>[id,{physicalAttack:r.endpoints[id].sim.actor('b').buffBaseStats.physicalAttack,
      magicAttack:r.endpoints[id].sim.actor('b').buffBaseStats.magicAttack}]));
    const observers=r.ids.filter(id=>id!=='b');
    function enqueue(){
      for(const row of r.wire.splice(0)){
        const id=++ordinal,replaceable=row.label==='input';
        if(replaceable){result.packets.replaceable++;if(random()<.2){result.packets.replaceableDropped++;continue;}}
        if(row.from==='b'&&row.to==='a'&&snapshot(row)&&row.value.snapshot.buffs.some(buff=>buff.factorId===42)&&!oldSnapshot){
          oldSnapshot=structuredClone(row);result.packets.omittedFirstBuffRepair++;continue;
        }
        const delay=20+Math.floor(random()*131),key=`${row.from}:${row.to}:${row.label}`;
        let due=r.now()+delay;
        if(!replaceable){due=Math.max(due,controlDue.get(key)??-Infinity);controlDue.set(key,due);}
        result.packets.delayMinMs=Math.min(result.packets.delayMinMs??Infinity,delay);
        result.packets.delayMaxMs=Math.max(result.packets.delayMaxMs??0,delay);
        pending.push({row,id,key,due,replaceable});result.packets.scheduled++;
      }
      result.packets.maximumPending=Math.max(result.packets.maximumPending,pending.length);
    }
    function queues(){for(const e of Object.values(r.endpoints))for(const control of Object.values(e.client.performance().peerControls)){
      result.maximumOutboundRetained=Math.max(result.maximumOutboundRetained,control.wire.outboundRetained);
      result.maximumInboundPending=Math.max(result.maximumInboundPending,control.wire.inboundPending);
      assert.ok(control.wire.outboundRetained<=16,'existing auxiliary outbound bound');
    }}
    const visible=id=>{const sim=r.endpoints[id].sim,actor=sim.actor('b');return {buffs:actor.buffs,stats:actor.stats,
      rows:buildBuffRows(actor,{profile:sim.profileFor(actor),profileForBuff:buff=>sim.profileFor(sim.actor(buff.sourceActorId))})};};
    async function tick(send){
      await r.advance(10);
      if(send&&r.now()%50===0)await r.send('b',3);
      enqueue();
      pending.sort((a,b)=>a.due-b.due||a.id-b.id);
      while(pending.length&&pending[0].due<=r.now()){
        const item=pending.shift();
        if(item.replaceable){if(item.id<(lastInputOrdinal.get(item.key)??-1))result.packets.replaceableReordered++;
          lastInputOrdinal.set(item.key,Math.max(item.id,lastInputOrdinal.get(item.key)??-1));}
        await r.deliver(item.row);result.packets.delivered++;enqueue();pending.sort((a,b)=>a.due-b.due||a.id-b.id);
      }
      queues();
      for(const id of r.ids)assert.equal(r.endpoints[id].sim.actor('b').hp,initialHp[id],'Buff status must not alter HP');
    }
    function validate(expected){
      for(const id of observers){const state=visible(id);
        assert.equal(state.buffs.length,expected?1:0,`${id} Buff count`);
        assert.equal(state.rows.length,expected?1:0,`${id} HUD row count`);
        if(expected){assert.equal(state.buffs[0].factorId,42);assert.equal(state.buffs[0].templateId,48);
          assert.equal(state.buffs[0].sourceActorId,'a');assert.equal(state.rows[0].templateId,48);assert.equal(state.rows[0].isDebuff,true);}
        for(const stat of ['physicalAttack','magicAttack'])assert.equal(state.stats[stat],expected?
          Math.fround(initialStats[id][stat]*Math.fround(.57)):initialStats[id][stat],`${id} ${stat}`);
      }
    }
    async function phase(name,expected){
      const start=r.now();let firstConverged=null;
      while(r.now()-start<900){await tick(true);
        if(firstConverged===null&&observers.every(id=>visible(id).buffs.length===(expected?1:0)))firstConverged=r.now()-start;}
      validate(expected);
      result.stages.push({name,startedAt:start,firstCountConvergenceMs:firstConverged,verifiedAt:r.now(),
        observers:observers.map(id=>{const state=visible(id);return {id,buffCount:state.buffs.length,rowCount:state.rows.length,
          remaining:state.buffs[0]?buffRemainingSeconds(state.buffs[0]):null,
          physicalAttack:state.stats.physicalAttack,magicAttack:state.stats.magicAttack};})});
    }
    r.addBuff('b','a');synchronizeBuffStats(r.endpoints.b.sim.actor('b'));await r.send('b');enqueue();
    await phase('create',true);assert.equal(result.packets.omittedFirstBuffRepair,1);
    const firstRevision=r.history.filter(row=>row.from==='b'&&snapshot(row)).at(-1).value.snapshot.revision;
    const beforeRefresh=r.endpoints.b.sim.actor('b').buffs[0].finalizers.find(row=>row.kind==='time').remaining;
    r.addBuff('b','a');synchronizeBuffStats(r.endpoints.b.sim.actor('b'));await r.send('b');enqueue();
    assert.ok(r.endpoints.b.sim.actor('b').buffs[0].finalizers.find(row=>row.kind==='time').remaining>beforeRefresh);
    await phase('refresh',true);
    const refreshed=r.history.filter(row=>row.from==='b'&&snapshot(row)).at(-1);
    assert.ok(refreshed.value.snapshot.revision>firstRevision);
    result.refreshRevision={before:firstRevision,after:refreshed.value.snapshot.revision};
    r.endpoints.b.sim.actor('b').buffs=[];synchronizeBuffStats(r.endpoints.b.sim.actor('b'));await r.send('b');enqueue();
    await phase('remove',false);
    assert.ok(oldSnapshot);await r.deliver(oldSnapshot);validate(false);result.staleSnapshotRejected=true;
    const before=r.history.filter(row=>row.from==='b'&&snapshot(row)).length;
    for(let i=0;i<100;i++)await tick(false);
    validate(false);result.snapshotsAfterRemovalAcknowledged=r.history.filter(row=>row.from==='b'&&snapshot(row)).length-before;
    assert.equal(result.snapshotsAfterRemovalAcknowledged,0,'ACKed unchanged snapshot cannot retry indefinitely');
    assert.equal(pending.length,0,'application transport drained');assert.equal(r.wire.length,0);
    for(const e of Object.values(r.endpoints))for(const control of Object.values(e.client.performance().peerControls)){
      assert.equal(control.wire.outboundRetained,0);assert.equal(control.wire.inboundPending,0);
    }
    assert.ok(result.packets.replaceableDropped>0);assert.ok(result.packets.replaceableReordered>0);
    assert.deepEqual(r.errors,[]);result.errors=r.errors;
    result.metrics=Object.fromEntries(r.ids.map(id=>[id,r.endpoints[id].client.performance().ownerBuffSync]));
    result.passed=true;console.log('V56_BUFF_RANDOM '+JSON.stringify(result));
  }catch(error){result.failure={message:error.message,stack:error.stack};throw error;}
});

after(()=>{
  const changed=sourceFiles.filter(file=>sourceHashes[file]!==sha(readFileSync(new URL('../../'+file,import.meta.url))));
  const finalHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const result={schemaVersion:1,classification:'current-only-four-coordinator-random-Buff-application-wire',
    sourceCommit,finalHead,sourceHashes,unchangedSources:changed.length===0,changedFiles:changed,
    seeds,planned:2,completed:results.length,passed:results.length===2&&results.every(row=>row.passed)&&!changed.length&&finalHead===sourceCommit,
    oldCodeExecuted:false,originalClientExecuted:false,rendererExecuted:false,
    fixture:{factor:42,templateId:48,sourceProfession:'RF',attackRatio:.57,durationSeconds:12,owner:'b',source:'a',peers:['a','c','d'],
      replaceableLoss:.2,randomDelayMs:[20,150],reliableControlOrderPreserved:true,explicitRepairOmissionPerCase:1,
      note:'Omitted first auxiliary Buff snapshot models an application/connection-rebuild gap, not permanent packet loss in reliable SCTP. Actor Buffs are populated from original factor42 through existing createBuffFromFactor fixture; no hit/geometry or original runtime claim.'},results};
  writeFileSync(reportFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  assert.deepEqual(changed,[]);assert.equal(finalHead,sourceCommit);
});
