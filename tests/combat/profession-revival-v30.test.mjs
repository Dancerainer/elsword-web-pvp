/** Profession revival policy from qualified ReInit references and the user's
 * corrected Add rule. Map is a lifecycle carrier, not collision acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createBattleResourcePools} from '../../apps/server/battle-driver.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),empty=()=>Array(8).fill(null);
const map={sceneId:'revival-resource-carrier',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}],
  starts:[{kind:'SetTeamStartPos',teamFlag:1,position:[0,0,0],lineId:0,facingRight:1,index:0},
    {kind:'SetTeamStartPos',teamFlag:0,position:[1000,0,0],lineId:0,facingRight:0,index:1}]};
function fixture(id,team=0){
  const profile=read('packages/combat-core/'+id.toLowerCase()+'-profile.json');
  const sim=createSimulation({profile,map,preset:{...read('config/'+id.toLowerCase()+'-preset.json'),loadout:empty(),guildPassives:[],passives:[]},
    actors:[{id:'a',professionId:id,team,x:0,y:0,lineId:0,loadout:empty(),guildPassives:[],passives:[]},
      {id:'b',professionId:id,team:1-team,x:1000,y:0,lineId:0,loadout:empty(),guildPassives:[],passives:[]}]});
  const clean=structuredClone(sim.actor('a')),players=[{id:'a',professionId:id,team},{id:'b',professionId:id,team:1-team}];
  const match=new PvpMatch({players,map,mode:'1v1',rules:{respawnEnabled:true},specialResourcePools:createBattleResourcePools(players),
    versions:{referenceVersion:'source-audit',presetVersion:'production',programVersion:'candidate'},
    onRespawn(){const actor=structuredClone(clean);sim.state.actors[0]=actor;return actor;}});
  match.state.phase='fight';return {sim,match,profile};
}
function revive(f,lead){
  const old=f.sim.actor('a');old.hp=0;old.deathComplete=true;old.mp=101;
  const score=lead<0?[0,-lead]:[lead,0];f.match.state.score=old.team===0?score:score.reverse();f.match.state.fightTime=100;
  Object.assign(f.match.player('a'),{alive:false,respawnAt:100});
  assert.equal(f.match.respawn(f.match.player('a'),f.sim),true);
  const actor=f.sim.actor('a');assert.equal(actor.mp,101*(lead>=2?0:lead===1?.5:1));
  assert.equal(f.match.respawn(f.match.player('a'),f.sim),false,'no duplicate application');return actor;
}
function roundTrip(f,actor){
  const sender=createOwnerUploadDelta(),decoder=createOwnerUploadDelta(),receiver=fixture(actor.professionId);
  const state=encodeOwnedState(f.sim,'a',{epoch:2,frameSeq:100}),decoded=decoder.decode(JSON.parse(JSON.stringify(sender.encode(state))));
  decoded.commit();assert.deepEqual(decoded.report,validateOwnedState(state));
  validateOwnedReferences(decoded.report,receiver.sim.actor('a'),f.profile,map);applyOwnedState(receiver.sim,'a',decoded.report);
  return receiver.sim.actor('a');
}

for(const id of ['LK','RS','IS','GM','BH','CA'])test(id+' revival clears any leading sword gauge and ends active nonleading mode',()=>{
  for(const lead of [-2,0,1,2,3])for(const mode of [-2,2]){
    const f=fixture(id);f.sim.prepareWayOfSword('a',mode);const oldPoint=f.sim.actor('a').wayOfSword.point;
    const a=revive(f,lead),expected=lead>0?{point:0,state:0}:{point:oldPoint,state:Math.sign(mode)};
    assert.deepEqual(a.wayOfSword,expected,id+' lead '+lead+' mode '+mode);
    assert.equal(a.destructionRageRemaining??0,0);assert.equal(a.state,'RSI_WAIT');
    assert.deepEqual(roundTrip(f,a).wayOfSword,expected);
  }
});
for(const id of ['LP','MM','DE'])test(id+' revival gives exactly100 leading DP even below100, retaining all mutation points',()=>{
  for(const lead of [-2,0,1,2,3])for(const dp of [0,1000,2000,4001,8000]){
    const f=fixture(id);Object.assign(f.sim.actor('a').sourceAdd,{dp,mutation:5,formation:true});
    const a=revive(f,lead),expected=lead>0?2000:dp;
    assert.equal(a.sourceAdd.dp,expected,id+' lead '+lead+' previous raw DP '+dp);
    assert.equal(a.sourceAdd.mutation,5);assert.equal(a.sourceAdd.formation,false);
    const restored=roundTrip(f,a);assert.equal(restored.sourceAdd.dp,expected);assert.equal(restored.sourceAdd.mutation,5);
  }
});
test('blue leading team applies the same profession resources to all nine affected professions',()=>{
  for(const id of ['LK','RS','IS','GM','BH','CA','LP','MM','DE']){
    const f=fixture(id,1),old=f.sim.actor('a');
    if(old.sourceAdd)Object.assign(old.sourceAdd,{dp:0,mutation:5});else f.sim.prepareWayOfSword('a',-2);
    const a=revive(f,1);assert.deepEqual(f.match.state.score,[0,1]);
    if(a.sourceAdd){assert.equal(a.sourceAdd.dp,2000);assert.equal(a.sourceAdd.mutation,5);}
    else assert.deepEqual(a.wayOfSword,{point:0,state:0});
  }
});
