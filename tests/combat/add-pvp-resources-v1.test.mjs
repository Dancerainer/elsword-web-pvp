/** Existing user-selected Web room rules, tested independently of skill motion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpMatch,OPENING_HA_SKILL_IDS} from '../../packages/pvp/index.mjs';
import {createBattleResourcePools} from '../../apps/server/battle-driver.mjs';
import {initializeAddSystems,syncAddAwakening} from '../../packages/combat-core/add-systems.mjs';
const expectedHa={LP:[29600,29603],MM:[29601,29604],DE:[29602,29605]};
function fixture(professionId='LP'){
  const players=[{id:'a',professionId,team:0},{id:'b',professionId:'RF',team:1}],map={sceneId:'add-pvp-wire',
    lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}],
    starts:players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*1000,0,0],lineId:0,facingRight:true}))};
  const actors=players.map(p=>({...p,hp:1000,hpMax:1000,mp:0,mpMax:600,x:0,y:0,z:0,core:{phase:'absent'},cooldowns:{},
    awakening:{orbs:0,gauge:0,remaining:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0}}));
  initializeAddSystems(actors[0]);const templates=structuredClone(actors);
  const poses={};for(const kind of ['start','win','lose'])poses[kind]=[{weight:100,state:'ANSI_START',animationName:'AddPose',duration:2}];
  const profile={target:{unitClass:{LP:122,MM:123,DE:126}[professionId]},presentation:{pvpPoses:poses},
    states:{ANSI_START_INTRUDE:{animationName:'AddRespawn',clip:{durationSeconds:.75}}}};
  const sim={state:{actors},profileFor:a=>a.id==='a'?profile:{target:{unitClass:107}}};
  const match=new PvpMatch({players,map,mode:'1v1',rules:{respawnEnabled:true},versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'},specialResourcePools:createBattleResourcePools(players),
    onRespawn(id){const index=sim.state.actors.findIndex(a=>a.id===id);return sim.state.actors[index]=structuredClone(templates[index]);}});
  match.start(sim);match.advance(match.introDuration,sim);return {players,map,sim,match};
}

test('server registration unions Add and Elsword resources once in mixed rosters',()=>{
  assert.deepEqual(createBattleResourcePools([{professionId:'RF'}]),[]);
  const add=createBattleResourcePools([{professionId:'LP'},{professionId:'MM'},{professionId:'DE'}]);
  assert.deepEqual(add.map(pool=>pool.id),['add-dp','add-mutation']);
  const mixed=createBattleResourcePools([{professionId:'LK'},{professionId:'MM'}]);
  assert.equal(new Set(mixed.map(pool=>pool.id)).size,mixed.length);
  assert.ok(mixed.some(pool=>pool.id==='add-dp'));assert.ok(mixed.length>2);
});

for(const id of ['LP','MM','DE'])test(`${id} opening uses Add poses, no initial soul, and both HA generations`,()=>{
  const {match,sim}=fixture(id),a=sim.state.actors[0];
  assert.equal(a.sourceAdd.dp,0);assert.equal(a.sourceAdd.mutation,0);assert.equal(a.awakening.gauge,0);
  assert.equal(sim.state.actors[1].awakening.gauge,50,'ordinary professions retain existing room policy');
  assert.deepEqual(a.cooldowns,Object.fromEntries(expectedHa[id].map(skillId=>[skillId,180])));
  for(const skillId of expectedHa[id])assert.ok(OPENING_HA_SKILL_IDS.includes(skillId));
  assert.equal(match.player('a').pose.animationName,'AddPose');
});

for(const lead of [-1,0,1,2,3])test(`score lead ${lead} applies corrected Add DP revival and preserves mutation`,()=>{
  const {match,sim}=fixture('MM'),a=sim.state.actors[0];
  Object.assign(a.sourceAdd,{dp:4001,mutation:5,formation:true,switchCooldown:3,
    generator:{skillId:29013,phase:'ready',generation:1,remaining:30}});syncAddAwakening(a);
  a.mp=101;a.hp=0;a.deathComplete=true;a.sourceTimeRing={remaining:1};a.sourceTimeSickness=10;
  match.state.score=lead<0?[0,-lead]:[lead,0];match.state.fightTime=90;
  const player=match.player('a');Object.assign(player,{alive:false,respawnAt:90});
  assert.equal(match.respawn(player,sim),true);const revived=sim.state.actors[0],keep=lead>=2?0:lead===1?.5:1;
  assert.equal(revived.sourceAdd.dp,lead>0?2000:4001);assert.equal(revived.sourceAdd.mutation,5);
  assert.equal(revived.mp,101*keep);assert.equal(revived.sourceAdd.formation,false);assert.equal(revived.sourceAdd.generator,null);
  assert.equal(revived.awakening.remaining,0);assert.equal(revived.awakening.gauge,0);
  assert.equal(revived.sourceTimeRing,undefined);assert.equal(revived.sourceTimeSickness,undefined);
  assert.deepEqual(revived.cooldowns,{29601:90,29604:90});assert.equal(revived.pvpPresentation.state,'ANSI_START_INTRUDE');
  assert.equal(revived.pvpPresentation.animationName,'AddRespawn');assert.equal(revived.pvpPresentation.duration,.75);
  assert.equal(match.respawn(player,sim),false,'duplicate room revival cannot apply retention twice');
});

test('Add room snapshot freezes resource registration and remaining opening delay',()=>{
  const {match,sim}=fixture('DE'),snapshot=JSON.parse(JSON.stringify(match.snapshot()));
  assert.deepEqual(snapshot.specialResourcePoolIds,['add-dp','add-mutation']);
  assert.doesNotThrow(()=>match.restore(snapshot));
  const invalid=structuredClone(snapshot);invalid.specialResourcePoolIds=[];assert.throws(()=>match.restore(invalid),/Different PvP special/);
  match.state.fightTime=181;sim.state.actors[0].cooldowns={};match.applyOpeningHaCooldown(sim.state.actors[0]);
  assert.deepEqual(sim.state.actors[0].cooldowns,{});
});
