import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPeerInputController,createFightFileGate} from '../../tools/network-peer-controls.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
function simulation(actors,available=()=>({available:false})){return {actor:id=>actors.find(actor=>actor.id===id),state:{actors},skillAvailability:available};}
const actor=(id,team,x,hp=800000)=>({id,team,x,y:2840,hp,grounded:true});

test('default 1v1 peer retains the held-Z schedule and does not query skills',()=>{
  const sim=simulation([actor('local',0,100),actor('enemy',1,200)],()=>{throw Error('default peer never requests skills');});
  const controls=createPeerInputController();
  assert.deepEqual(controls.next(sim,'local',{phase:'fight',elapsed:0}).input,{held:['Z'],pressed:['Z'],released:[],sampledDevice:false});
  assert.deepEqual(controls.next(sim,'local',{phase:'fight',elapsed:.1}).input.pressed,[]);
  assert.deepEqual(controls.next(sim,'local',{phase:'fight',elapsed:.5}).input,{held:[],pressed:[],released:['Z'],sampledDevice:false});
  assert.deepEqual(controls.next(sim,'local',{phase:'fight',elapsed:1.2}).input.pressed,['Z']);
});

test('2v2 peer ignores the teammate and a dead opponent while pursuing the nearest living enemy',()=>{
  const sim=simulation([actor('local',0,100),actor('ally',0,110),actor('dead',1,90,0),actor('enemy',1,700)]);
  const result=createPeerInputController({mode:'2v2'}).next(sim,'local',{phase:'fight',elapsed:0});
  assert.equal(result.enemyId,'enemy');assert.deepEqual(result.input.held,['RIGHT']);
});

test('skill cycle consults actual availability, skips MP/cooldown gates and never changes player vitals or loadout',()=>{
  const loadout=Object.freeze([Object.freeze({skillId:24008}),null,Object.freeze({skillId:24009}),null,null,null,null,null]);
  const local=Object.freeze({...actor('local',0,100),mp:20,cooldowns:Object.freeze({24008:10}),loadout}),queries=[];
  const permitted=new Set([2]);
  const sim=simulation([local,actor('enemy',1,200)],(_id,slot)=>{queries.push(slot);return {available:permitted.has(slot),skillId:loadout[slot].skillId};});
  const controls=createPeerInputController({mode:'2v2'}),before=JSON.stringify(local);
  const first=controls.next(sim,'local',{phase:'fight',elapsed:0});assert.deepEqual(queries,[0,2]);
  assert.deepEqual(first.input.pressed,['D']);assert.deepEqual(first.skillAttempt,{slot:2,key:'D',skillId:24009});
  permitted.clear();assert.equal(controls.next(sim,'local',{phase:'fight',elapsed:1.3}).skillAttempt,null);
  permitted.add(0);assert.deepEqual(controls.next(sim,'local',{phase:'fight',elapsed:1.4}).input.pressed,['A']);
  assert.equal(JSON.stringify(local),before);
});

test('peer sends no attack input during slow/result phases',()=>{
  const sim=simulation([actor('local',0,100),actor('enemy',1,200)]),controls=createPeerInputController({mode:'2v2'});
  for(const phase of ['intro','slow','result'])assert.deepEqual(controls.next(sim,'local',{phase,elapsed:0}).input.held,[]);
});

test('fight-file gate sleeps until a filesystem notification and also accepts an already existing file',async t=>{
  const directory=path.join(root,'runtime',`network-peer-gate-${process.pid}`),file=path.join(directory,'release');
  await mkdir(directory,{recursive:true});t.after(async()=>{await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);});
  const gate=await createFightFileGate(file);t.after(()=>gate.close());assert.equal(gate.open,false);
  assert.equal(await gate.wait(5),false);const waiting=gate.wait(1000);await writeFile(file,'ready\n');
  assert.equal(await waiting,true);assert.equal(gate.open,true);
  const existing=await createFightFileGate(file);t.after(()=>existing.close());assert.equal(existing.open,true);assert.equal(await existing.wait(1000),true);
});
