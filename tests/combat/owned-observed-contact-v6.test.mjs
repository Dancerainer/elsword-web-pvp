/** Actual frozen pose/helpers and native damage consumers. Exact named frames
 * and artificial late arrival exercise the Web contact adapter, not 2016 gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function make(profession,owner){
 const {native,samplers}=await assets.createRuntime();
 assert.ok(assets.profiles[profession],'six-profession prepared source closure is required');
 const sim=createSimulation({profile:assets.profiles[profession],profiles:assets.profiles,preset:{...assets.presets[profession],onlineMatch:true,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
   presets:assets.presets,map:assets.map,seed:2016,networkOwnerId:owner,commonBuffs:assets.commonBuffs,
   actors:[{id:'source',professionId:profession,team:0,position:[2022.98,2840,0],lineId:6,facing:-1,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
     {id:'victim',professionId:profession,team:1,position:[['RF','VC','BM'].includes(profession)?1920:1937.98,2840,0],lineId:6,facing:1,passives:[],guildPassives:[],loadout:Array(8).fill(null)}],...samplers,
   nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
   nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
 for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','observed-native-fixture');}sim.drainEvents();return sim;
}
for(const profession of ['RF','LK','VC','RS','BM','IS'])test(`${profession} native Z uses one exact past victim body, preserves present resources/position and cannot repeat across live/history copies`,async()=>{
 const source=await make(profession,'source'),victim=await make(profession,'victim'),consumer=createRemoteActionConsumer({clock:()=>0});
 let report;for(let frame=1;frame<=60;frame++){
   source.step(1/60,frame===1?{source:{held:['Z'],pressed:['Z']}}:{},{snapshot:false});
   victim.step(1/60,{}, {snapshot:false});victim.drainEvents();
   if(source.drainEvents().some(event=>event.type==='hit'&&event.targetId==='victim')){
     report=encodeOwnedState(source,'source',{epoch:1,frameSeq:frame});break;}
 }
 assert.ok(report,'actual first Z creates a native contact at the authored close gap');
 consumer.rememberVictim(victim,'victim',1,report.frameSeq);const target=victim.actor('victim'),pastPosition=[target.x,target.y,target.z];
 const hp=Math.floor(target.hpMax*.8);target.hp=hp;target.mp=27;target.x=600;target.landPosition[0]=600;
 // This case isolates historical geometry while the current owner is
 // vulnerable. Current invulnerability has its own rejection test below.
 target.invincible=false;target.stateSerial+=30;const serial=target.stateSerial;consumer.rememberVictim(victim,'victim',1,report.frameSeq+6);
 const action=encodeCriticalAction(report,{id:report.frameSeq,effectIds:new Set(report.effects.map(effect=>effect.id)),
   targetViews:[{playerId:'victim',epoch:1,frameSeq:report.frameSeq,position:pastPosition}]}),step=victim.state.step;
 assert.equal(consumer.receive('source',[action],1,report.frameSeq+6),true);consumer.consume(victim,'victim',()=>1);
 const hits=victim.drainEvents().filter(event=>event.type==='hit'&&event.targetId==='victim');
 assert.equal(hits.length,1,'real source helpers hit the named body rather than the current out-of-range body');
 assert.equal(target.hp,hp-hits[0].amount);assert.equal(target.x,600);assert.ok(target.mp>=27);assert.ok(target.stateSerial>serial);
 assert.equal(victim.state.step,step,'no victim/world timestep was replayed');
 consumer.receive('source',[action],1,report.frameSeq+6);consumer.consume(victim,'victim',()=>1);assert.equal(target.hp,hp-hits[0].amount);consumer.clear();
});
for(const profession of ['RF','LK','VC','RS','BM','IS'])test(`${profession} native Z accepts the actual interpolated displayed victim body, preserving live resources and source rules`,async()=>{
 const source=await make(profession,'source'),victim=await make(profession,'victim'),consumer=createRemoteActionConsumer({clock:()=>0});
 let report;for(let frame=1;frame<=60;frame++){
   source.step(1/60,frame===1?{source:{held:['Z'],pressed:['Z']}}:{},{snapshot:false});
   victim.step(1/60,{}, {snapshot:false});victim.drainEvents();
   if(source.drainEvents().some(event=>event.type==='hit'&&event.targetId==='victim')){report=encodeOwnedState(source,'source',{epoch:1,frameSeq:frame});break;}
 }
 assert.ok(report);const target=victim.actor('victim'),first=structuredClone(target),frame=report.frameSeq;
 consumer.rememberVictim(victim,'victim',1,frame);target.x+=20;target.animationTime+=.05;
 consumer.rememberVictim(victim,'victim',1,frame+3);const second=structuredClone(target);
 const clock=createRemoteActorClock({captureContacts:true,minDelayMs:0,maxDelayMs:0});
 clock.observe(first,{epoch:1,frameSeq:frame,at:frame*1000/60,actor:first});
 clock.observe(second,{epoch:1,frameSeq:frame+3,at:(frame+3)*1000/60,actor:second});
 clock.contacts([target],'source',{now:(frame+1.5)*1000/60});const reference=clock.observationReference('victim');
 assert.ok(reference?.positionSamples,'real display interpolation supplies a bounded source witness');
 assert.ok(Math.abs(reference.position[0]-(first.x+10))<1e-6);
 const hp=Math.floor(target.hpMax*.8);Object.assign(target,{hp,mp:27,x:600,invincible:false,stateSerial:target.stateSerial+30});
 consumer.rememberVictim(victim,'victim',1,frame+6);const serial=target.stateSerial,step=victim.state.step;
 const action=encodeCriticalAction(report,{id:frame,effectIds:new Set(report.effects.map(effect=>effect.id)),targetViews:[{playerId:'victim',...reference}]});
 assert.equal(consumer.receive('source',[action],1,frame+6),true);consumer.consume(victim,'victim',()=>1);
 const hits=victim.drainEvents().filter(event=>event.type==='hit'&&event.targetId==='victim');assert.equal(hits.length,1);
 assert.equal(target.hp,hp-hits[0].amount);assert.equal(target.x,600);assert.ok(target.mp>=27);assert.ok(target.stateSerial>serial);assert.equal(victim.state.step,step);
 consumer.receive('source',[action],1,frame+6);consumer.consume(victim,'victim',()=>1);assert.equal(target.hp,hp-hits[0].amount);consumer.clear();
});
test('RF actual Native history cannot charge a currently invincible owner even when its older body was a real source contact',async()=>{
 const source=await make('RF','source'),victim=await make('RF','victim'),consumer=createRemoteActionConsumer({clock:()=>0});
 let report;
 for(let frame=1;frame<=60;frame++){
   source.step(1/60,frame===1?{source:{held:['Z'],pressed:['Z']}}:{},{snapshot:false});
   victim.step(1/60,{}, {snapshot:false});victim.drainEvents();
   if(source.drainEvents().some(event=>event.type==='hit'&&event.targetId==='victim'&&event.amount>0)){
     report=encodeOwnedState(source,'source',{epoch:1,frameSeq:frame});break;
   }
 }
 assert.ok(report,'the original source helpers must first prove a real contact');
 consumer.rememberVictim(victim,'victim',1,report.frameSeq);const target=victim.actor('victim'),pastPosition=[target.x,target.y,target.z];
 Object.assign(target,{hp:Math.floor(target.hpMax*.8),mp:27,x:600,invincible:true,stateSerial:target.stateSerial+30});target.landPosition[0]=600;
 consumer.rememberVictim(victim,'victim',1,report.frameSeq+6);const before=structuredClone(target),step=victim.state.step;
 const action=encodeCriticalAction(report,{id:report.frameSeq,effectIds:new Set(report.effects.map(effect=>effect.id)),
   targetViews:[{playerId:'victim',epoch:1,frameSeq:report.frameSeq,position:pastPosition}]});
 assert.equal(consumer.receive('source',[action],1,report.frameSeq+6),true);consumer.consume(victim,'victim',()=>1);
 assert.deepEqual(target,before,'current HP/MP/Buffs/state/position/protection remain final');assert.equal(victim.state.step,step);
 assert.equal(victim.drainEvents().some(event=>event.type==='hit'&&event.targetId==='victim'),false);
 assert.equal(consumer.diagnostics.victimProtection.localInvincibility,1);consumer.clear();
});
