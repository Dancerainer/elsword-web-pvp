/** Actual LK/RS/IS profile and pose loads; original reference != Web trace. */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runCommonAir} from '../helpers/elsword-common-air-v57.mjs';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8')),
 source=read('contracts/elsword-common-air-v57.json'),cases=[];
after(()=>{mkdirSync(new URL('runtime/v57/',root),{recursive:true});writeFileSync(new URL('runtime/v57/elsword-common-air-release.json',root),
 JSON.stringify({evidenceClass:'current-Web sampled input with independently loaded original profession poses',originalClientExecuted:false,cases},null,2)+'\n');});
function verifyStopped(row){
 assert.equal(row.actualUnitClass,source.professions.find(p=>p.profession===row.profession).unitClass);
 assert.ok(row.packets.every(p=>p.sampledDevice===true),'only physical sampled device levels may drive the trace');
 const attack=row.clocks.filter(c=>c.serial===row.serial&&c.state===row.attackState),period=row.period,threshold=period-Math.max(period/10,.03),stopped=attack.find(c=>c.stopped);
 assert.ok(stopped,`${row.profession} must stop the actual command animation`);
 assert.ok(stopped.animationTime>threshold&&stopped.animationTime<period,'first eligible ONE_WAIT packet must precede the D3DX LOOP boundary');
 const held=attack.filter(c=>c.stopped);assert.ok(held.length>=6,'actual high Garpai takeoff must remain airborne long enough to check retained pose');
 assert.ok(held.every(c=>c.animationTime===stopped.animationTime),'the current source clip must not wrap or keep advancing');
 assert.ok(attack.every(c=>c.animationTime<period),'no D3DX LOOP boundary crossed');
 assert.ok(row.actualJump.length===1);assert.equal(row.actualJump[0].dash,row.dash);
 assert.ok(row.samplerEvaluations>0,'each profession actual helper pose must be evaluated; no invented minimum sample count');
 assert.equal(row.states.filter(n=>n===row.attackState).length,1);assert.equal(row.finalGrounded,true);assert.notEqual(row.finalState,row.attackState);
 return stopped;
}
for(const profession of ['LK','RS','IS']){
 test(`${profession}: independently loaded original8X declaration, clip and pose bytes match the reviewed source capsule`,()=>{
  const folder=profession.toLowerCase(),record=source.professions.find(r=>r.profession===profession),profile=read(`packages/combat-core/${folder}-profile.json`),raw=profile.states.RSI_JUMP_COMBO_X.raw;
  assert.equal(profile.target.unitClass,record.unitClass);assert.equal(raw.PLAY_TYPE,2);assert.deepEqual(raw.ATTACK_TIME0,{'1':.1,'2':.2666});
  assert.equal(raw.DAMAGE_DATA.REACT_TYPE,3);assert.equal(raw.DAMAGE_DATA.DAMAGE.PHYSIC,3.49);
  assert.equal(profile.states.RSI_JUMP_COMBO_X.clip.decodedKeysSha256,'3c989542135d8a8ebbc86c73c985e42919267682b8d0eabfbdc719941d7e02d9');
  for(const input of record.poseInputs){const bytes=readFileSync(new URL(input.path,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256);}
  assert.equal(record.nativePlaybackField,0);assert.equal(record.rawSha256,createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
 });
 for(const facing of [-1,1]){
  test(`${profession} ${facing}: physical UP→X from the actual high platform stops, never wraps, and leaves on real landing`,()=>{
   const row=runCommonAir(profession,facing);cases.push(row);verifyStopped(row);assert.equal(row.characterHits.length,0);assert.equal(row.totalPlayerHits,0);assert.equal(row.hpAfter,row.hpBefore);
   assert.ok(row.clocks.some(c=>c.state===row.attackState&&c.position[1]>3800),'real UP input must produce the high takeoff');
  });
  test(`${profession} ${facing}: physical descending UP→X accepts one original sword contact and one HP deduction`,()=>{
   const row=runCommonAir(profession,facing,{kind:'contact-X'});cases.push(row);
   assert.equal(row.actualUnitClass,source.professions.find(p=>p.profession===profession).unitClass);assert.ok(row.packets.every(p=>p.sampledDevice===true));
   assert.equal(row.actualJump.length,1);assert.equal(row.characterHits.length,1);assert.equal(row.totalPlayerHits,1);assert.ok(row.damageEvents>0);
   assert.equal(row.hpBefore-row.hpAfter,row.damageEvents,'one accepted character hit must account for all target HP loss');
   assert.equal(row.characterHits[0].data.REACT_TYPE,3);assert.equal(row.characterHits[0].data.DAMAGE.PHYSIC,3.49);
   assert.equal(row.states.filter(n=>n===row.attackState).length,1);assert.equal(row.finalGrounded,true);assert.notEqual(row.finalState,row.attackState);
  });
  for(const [key,dash]of [['Z',false],['Z',true],['X',true]])test(`${profession} ${facing}: real${dash?'668':'8'}${key} neighbor retains one WAIT pose and its own landing`,()=>{
   const row=runCommonAir(profession,facing,{kind:'neighbor',key,dash});cases.push(row);verifyStopped(row);assert.equal(row.totalPlayerHits,0);
  });
 }
}
