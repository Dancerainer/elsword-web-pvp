import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {normalize} from '../../apps/server/skill-preferences.mjs';
test('actual RF LK VC owner room freezes all versions, accepts VC input and rejects RF-only state',async t=>{
  const root=resolve(import.meta.dirname,'../..'),factory=await createBattleDriverFactory({root,assetRoot:root+'/artifacts'});
  assert.deepEqual(factory.professions,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true});
  const players=['RF','LK','VC','VC'].map((professionId,i)=>({id:'p'+i,username:'p'+i,team:i<2?0:1,professionId,
    unitClass:getProfessionProfile(professionId).target.unitClass,...normalize({loadout:[{skillId:[24025,21027,24034,24021][i]},...Array(7).fill(null)],branchChoices:{}},getProfessionProfile(professionId),getProfessionPreset(professionId))}));
  const match={id:'vc-mixed',mode:'2v2',players,seed:15,sceneId:factory.maps[0].id,versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
  const driver=await factory({match,emit(){},finish(){}});t.after(()=>driver.stop());
  for(const player of players)driver.ready(player.id);
  const initial=driver.snapshot();assert.equal(initial.snapshot.actors.find(a=>a.id==='p2').cooldowns[24605],180);
  driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');
  const current=driver.snapshot();for(const player of players){
    const profile=getProfessionProfile(player.professionId),packet=encodeOwnedState({state:current.snapshot,profileFor:()=>profile},player.id,{epoch:current.ownership.actors[player.id].epoch,frameSeq:1});
    assert.equal(driver.submitInput(player.id,{frames:[{held:[],frameSeq:1}],owner:packet}).accepted,true);
  }
  const profile=getProfessionProfile('VC'),packet=encodeOwnedState({state:driver.snapshot().snapshot,profileFor:()=>profile},'p2',{epoch:current.ownership.actors.p2.epoch,frameSeq:2});
  packet.actor.state='RSI_SA_RRF_NUCLEAR';assert.throws(()=>driver.submitInput('p2',{frames:[{held:[],frameSeq:2}],owner:packet}),/owner/);
  assert.ok(factory.versions.professions.VC);assert.ok(factory.versions.professions.RF);assert.ok(factory.versions.professions.LK);
});
