/** Current application transport: victim-owned debuff mutations must recover
 * independently when the replaceable full pose is lost. This is not WAN proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buffRoom} from '../helpers/network-buff-room-v38.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createBuffFromFactor} from '../../packages/combat-core/buffs.mjs';
const snapshot=row=>row.value.type==='buff-sync'&&row.value.kind==='snapshot';
const profiles=Object.fromEntries(['RF','LK','BM'].map(id=>[id,JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const f=Math.fround,nativeValues={buffFixed:(v,r)=>f(f(v)*f(1-r)),buffRelation:(a,m,r)=>f(f(f(a)*f(m))*f(1-r)),buffPercent:(v,r)=>f(f(v)*f(1-r)),
  buffInterval(sum,interval,elapsed){const n=f(f(sum)+f(elapsed));return n>=f(interval)?{sum:0,triggered:true}:{sum:n,triggered:false};}};
const dropBodies=r=>r.wire.splice(0,r.wire.length,...r.wire.filter(row=>!(row.from==='b'&&row.label==='input'&&(row.value.owner||row.value.ownerDelta))));
async function mixedRoom(t,profession){
  const r=await buffRoom(t,{ids:['a','b']});
  for(const [owner,e]of Object.entries(r.endpoints)){
    e.sync.clear();e.sim=createSimulation({profile:profiles.RF,profiles,defaultProfession:'RF',networkOwnerId:owner,seed:2016,
      map:{sceneId:'buff-priority-v55',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
      preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
      actors:[{id:'a',professionId:profession,team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
        {id:'b',professionId:'RF',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  }
  r.state();await r.bootstrap();return r;
}
function grant(r,profession,factor){const sim=r.endpoints.b.sim,created=createBuffFromFactor(profiles[profession],{
  factor,sourceActor:sim.actor('a'),targetActor:sim.actor('b'),roll:0,nativeValues});
  assert.equal(created.supported,true);assert.equal(created.accepted,true);sim.actor('b').buffs=[created.buff];return created.buff;}

test('new victim-owned Weapon Break mutation is sent immediately after a recent acknowledged empty snapshot',async t=>{
  const r=await buffRoom(t,{ids:['a','b']});await r.bootstrap();await r.advance(50);
  const buff=r.addBuff('b','a');assert.equal(buff.factorId,42);assert.equal(buff.templateId,48);
  await r.send('b');
  // Lose only the current replaceable full pose, preserving the independent
  // protection packet and reliable auxiliary messages. No old executable runs.
  dropBodies(r);
  await r.drain();
  assert.equal(r.endpoints.a.sim.actor('b').buffs[0]?.factorId,42);
  const repairs=r.history.filter(row=>row.from==='b'&&snapshot(row)&&row.value.snapshot.buffs.some(buff=>buff.factorId===42));
  assert.equal(repairs.length,1);assert.equal(repairs[0].at,50,'actual mutation never waits for the250ms same-snapshot retry interval');
  assert.deepEqual(r.errors,[]);
});

for(const [profession,factor,template,ratio]of [['RF',42,48,.57],['LK',70,78,.6],['BM',250,78,.46]])
test(`${profession} factor${factor} Buff creation, refresh and removal recover before retry pacing when full poses are lost`,async t=>{
  const r=await mixedRoom(t,profession);await r.advance(50);grant(r,profession,factor);
  await r.send('b');dropBodies(r);await r.drain();const observer=r.endpoints.a.sim.actor('b');
  assert.equal(observer.buffs[0]?.templateId,template);assert.equal(observer.buffs[0].sourceActorId,'a');assert.equal(observer.buffs[0].factorId,factor);
  assert.ok(observer.buffs[0].behaviors.some(row=>Math.abs(row.value-ratio)<1e-6),JSON.stringify(observer.buffs[0].behaviors));
  const first=r.history.filter(row=>row.from==='b'&&snapshot(row)).at(-1),firstRevision=first.value.snapshot.revision;
  await r.advance(25);grant(r,profession,factor);await r.send('b');dropBodies(r);await r.drain();
  const refreshed=r.history.filter(row=>row.from==='b'&&snapshot(row)).at(-1);
  assert.equal(refreshed.at,75);assert.ok(refreshed.value.snapshot.revision>firstRevision);
  await r.advance(25);r.endpoints.b.sim.actor('b').buffs=[];await r.send('b');dropBodies(r);await r.drain();assert.deepEqual(observer.buffs,[]);
  const removed=r.history.filter(row=>row.from==='b'&&snapshot(row)).at(-1);assert.equal(removed.at,100);assert.deepEqual(removed.value.snapshot.buffs,[]);
  await r.deliver(first);assert.deepEqual(observer.buffs,[],'old Buff snapshot cannot resurrect an ended debuff');
  const count=r.history.filter(row=>row.from==='b'&&snapshot(row)).length;await r.advance(1000);await r.drain();
  assert.equal(r.history.filter(row=>row.from==='b'&&snapshot(row)).length,count,'ACKed unchanged snapshot retains existing no-retry behavior');
  assert.deepEqual(r.errors,[]);
});

test('Buff first-mutation urgency retains backpressure and sends only the latest unsent mutation on recovery',async t=>{
  const r=await mixedRoom(t,'RF'),control=r.endpoints.b.channels.get('a:control');await r.advance(50);
  const before=r.history.filter(row=>row.from==='b'&&snapshot(row)).length;control.bufferedAmount=50000;
  for(let n=0;n<20;n++){if(n%2)r.endpoints.b.sim.actor('b').buffs=[];else grant(r,'RF',42);await r.send('b');dropBodies(r);}
  grant(r,'RF',42);await r.send('b');dropBodies(r);await r.drain();
  assert.equal(r.history.filter(row=>row.from==='b'&&snapshot(row)).length,before);
  assert.ok(r.endpoints.b.client.performance().peerControls.a.wire.outboundRetained<=16);
  control.bufferedAmount=0;control.onbufferedamountlow();await r.drain();
  assert.equal(r.endpoints.a.sim.actor('b').buffs[0]?.factorId,42);
  assert.equal(r.history.filter(row=>row.from==='b'&&snapshot(row)).length,before+1);
  assert.deepEqual(r.errors,[]);
});
