/** Seeded application-delivery faults with actual four-player coordinators.
 * Full owner poses are unavailable during this repair-only test. Reliable
 * message loss models decoder/reconnect job retirement, not UDP/SCTP loss. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {buffRoom,settle} from '../helpers/network-buff-room-v38.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const baselineRef=process.env.WEB_PVP_V37_REF;
function oldModule(relative){
  const source=execFileSync('git',['show',`${baselineRef}:${relative}`],{cwd:root,encoding:'utf8'});
  const patched=source.replace(/from (['"])(\.[^'"]+)\1/g,(_all,quote,dependency)=>{
    const name=path.resolve(root,path.dirname(relative),dependency);
    const url=name.replaceAll('\\','/').endsWith('/owner-buff-sync.mjs')?oldModule('packages/online/owner-buff-sync.mjs'):pathToFileURL(name).href;
    return `from ${quote}${url}${quote}`;
  });return 'data:text/javascript;base64,'+Buffer.from(patched).toString('base64');
}
const oldClient=baselineRef?(await import(oldModule('apps/web/online-client.mjs'))).createOnlineClient:null;
// Keyed draws give equal delay/drop decisions for equal directed-link attempt
// numbers even though the newer client issues more heartbeat retries.
function draw(seed,text){let h=seed>>>0;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);h^=h>>>13;}return(h>>>0)/4294967296;}
const profiles=[{id:'loss20-jitter500',loss:.2,base:35,jitter:500,burst:0},{id:'loss40-burst2500',loss:.4,base:50,jitter:900,burst:2500}];
const results=[];
test('seeded four-player repair-only outages compare v37 with v38 at 20/40% application-message loss',{skip:!baselineRef&&'Set WEB_PVP_V37_REF to compare the archived client'},async t=>{
  for(const profile of profiles)for(const seed of [2016101701,2016101702,2016101703,2016101704,2016101705,2016101706])
    for(const version of ['v37','v38'])await t.test(`${profile.id}/${seed}/${version}`,async child=>{
      const r=await buffRoom(child,{clientFactory:version==='v37'?oldClient:createOnlineClient});await r.bootstrap();
      const scheduled=[],attempts=new Map(),converged=new Map();let dropped=0,packets=0,requests=0;
      for(const [index,id]of r.ids.entries())r.addBuff(id,r.ids[(index+2)%4]);
      for(const id of r.ids)await r.send(id);
      const collect=()=>{while(r.wire.length){const row=r.wire.shift();
        if(row.label==='input'&&!row.value.buffStatus)continue;
        const kind=row.value.kind??'compact',key=`${row.from}/${row.to}/${row.label}/${kind}`,attempt=(attempts.get(key)??0)+1;attempts.set(key,attempt);
        packets++;if(kind==='request')requests++;
        if(draw(seed,`${key}/${attempt}/loss`)<profile.loss){dropped++;continue;}
        const extra=profile.burst&&draw(seed,`${key}/${attempt}/burst`)<.25?profile.burst:0;
        scheduled.push({...row,due:r.now()+profile.base+draw(seed,`${key}/${attempt}/delay`)*profile.jitter+extra});
      }};
      for(let at=0;at<=15000;at+=50){
        collect();scheduled.sort((a,b)=>a.due-b.due);
        while(scheduled[0]?.due<=r.now()){await r.deliver(scheduled.shift());collect();scheduled.sort((a,b)=>a.due-b.due);}
        for(const owner of r.ids)for(const observer of r.ids)if(owner!==observer){const key=`${owner}/${observer}`;
          if(!converged.has(key)&&r.endpoints[observer].sim.actor(owner).buffs.length===1)converged.set(key,r.now());}
        await r.advance(50);await settle();
      }
      const values=[...converged.values()].sort((a,b)=>a-b),row={version,seed,profile:profile.id,links:12,recovered:converged.size,
        medianMs:values.length?values[Math.floor(values.length/2)]:null,maximumMs:values.at(-1)??null,packets,dropped,requests};results.push(row);
      if(version==='v38')assert.equal(converged.size,12,JSON.stringify(row));
      for(const [index,owner]of r.ids.entries())for(const observer of r.ids){const buffs=r.endpoints[observer].sim.actor(owner).buffs;
        if(!buffs.length)continue;assert.equal(buffs[0].targetActorId,owner);assert.equal(buffs[0].sourceActorId,r.ids[(index+2)%4]);}
      assert.deepEqual(r.errors,[]);
    });
  const before=results.filter(row=>row.version==='v37'),after=results.filter(row=>row.version==='v38');
  assert.ok(after.reduce((sum,row)=>sum+row.recovered,0)>before.reduce((sum,row)=>sum+row.recovered,0),'background repair closes idle missing baselines');
  if(process.env.V38_BUFF_REPORT)writeFileSync(process.env.V38_BUFF_REPORT,JSON.stringify({schemaVersion:1,
    scope:'Four production Web coordinators and ownership consumers; full owner poses withheld; idle Buff repair under application-message loss/reordering. No SCTP congestion, WAN or original 2016 runtime claim.',
    baseline:baselineRef,seededProfiles:profiles,results},null,2)+'\n');
});
