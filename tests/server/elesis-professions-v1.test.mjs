/** Actual original assets / native runtime. Web ownership, not native packets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {normalize} from '../../apps/server/skill-preferences.mjs';
test('three Elesis and three Elsword actors freeze distinct identities, source resources and owner state in one native room',async t=>{
 const root=resolve(import.meta.dirname,'../..'),factory=await createBattleDriverFactory({root,assetRoot:root+'/artifacts'});
 const ids=['GM','BH','CA','LK','RS','IS'],players=ids.map((professionId,i)=>{
  const profile=getProfessionProfile(professionId),preset=getProfessionPreset(professionId),skillId=i<3?28026:21027;
  return {id:'p'+i,username:'p'+i,team:i<3?0:1,professionId,unitClass:profile.target.unitClass,
   ...normalize({loadout:[{skillId},...Array(7).fill(null)],branchChoices:{}},profile,preset)};
 });
 for(const id of ids)assert.equal(factory.professions[id],true,'complete source asset closure '+id);
 const match={id:'elesis-source-room',mode:'3v3',players,seed:20161013,sceneId:factory.maps[0].id,
  versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
 const driver=await factory({match,emit(){},finish(){}});t.after(()=>driver.stop());
 for(const p of players)driver.ready(p.id);
 const initial=driver.snapshot();
 for(let i=0;i<3;i++){
  const actor=initial.snapshot.actors.find(a=>a.id==='p'+i),profile=getProfessionProfile(ids[i]);
  assert.equal(actor.core.phase,'absent');assert.deepEqual(actor.wayOfSword,{point:0,state:0});
  assert.equal(actor.sourceElesisBreakCharge,0);assert.equal(actor.destructionRageRemaining,undefined);
  assert.equal(actor.cooldowns[[28603,28604,28605][i]],180);
  assert.ok(profile.presentation.pvpPoses.start.some(p=>p.animationName===actor.pvpPresentation.animationName));
  for(const field of ['profile','preset','reference'])assert.match(match.versions.professions[ids[i]][field],/^[a-f0-9]{64}$/);
 }
 driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');
 const packet=(id,patch={})=>{const current=driver.snapshot(),actor=current.snapshot.actors.find(a=>a.id===id);
  const report=encodeOwnedState({state:current.snapshot,profileFor:()=>getProfessionProfile(actor.professionId)},id,
   {epoch:current.ownership.actors[id].epoch,frameSeq:(current.ownership.actors[id].frameSeq??0)+1});Object.assign(report.actor,patch);return report;};
 const submit=(id,report)=>driver.submitInput(id,{frames:[{held:[],frameSeq:report.frameSeq}],owner:report});
 for(const p of players)assert.equal(submit(p.id,packet(p.id)).accepted,true);
 for(let i=0;i<3;i++){
  const id='p'+i;assert.equal(submit(id,packet(id,{wayOfSword:{point:-4800,state:-2},sourceElesisBreakCharge:2000})).accepted,true);
  assert.throws(()=>submit(id,packet(id,{sourceElesisBreakCharge:2001})),/owner/);
  assert.throws(()=>submit(id,packet(id,{destructionRageRemaining:6})),/elesis-elsword-rage/);
  const versions=structuredClone(match.versions);versions.professions[ids[i]].profile='0'.repeat(64);
  await assert.rejects(factory({match:{...match,versions},emit(){},finish(){}}),/profession-version-mismatch/);
 }
 assert.throws(()=>submit('p3',packet('p3',{sourceElesisBreakCharge:0})),/invalid-elesis-state/);
 // All three lose a life together while their team is behind. The server
 // must register their own resource pool before replacing actors with clean
 // templates; otherwise the stored sword balance silently resets to zero.
 const beforeDeath=[];
 for(let i=0;i<3;i++){
  const id='p'+i,death=packet(id,{hp:0,deathComplete:true,sourceElesisBreakCharge:0,wayOfSword:{point:-2400,state:-2}});
  beforeDeath.push(death);assert.equal(submit(id,death).accepted,true);
 }
 driver.tick(.1);driver.tick(24);
 const revived=driver.snapshot();assert.deepEqual(revived.pvp.score,[0,3]);
 for(let i=0;i<3;i++){
  const id='p'+i,actor=revived.snapshot.actors.find(a=>a.id===id);
  assert.equal(revived.ownership.actors[id].epoch,2);
  assert.deepEqual(actor.wayOfSword,{point:-2400,state:-1});assert.equal(actor.sourceElesisBreakCharge,0);
  assert.equal(submit(id,{...beforeDeath[i],frameSeq:999}).ignored,'old-life');
 }
});
