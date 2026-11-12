/** Real sealed resources/runtime; assertions cover peer binding to the combat
 * template snapshot created before the server starts a life, not factory
 * dispatch, original-client combat or GPU evidence. The factory route has its
 * own server profession-driver tests. --root stays authoritative. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createNetworkPeerSimulation} from '../../tools/network-match-peer.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const programRoot=process.env.LK_TEST_PROGRAM_ROOT??project;
const assetRoot=process.env.RF_ASSET_ROOT??path.join(programRoot,'artifacts');
const moduleFor=relative=>import(pathToFileURL(path.join(programRoot,relative)).href);
let loaded;
async function dependencies(){return loaded??=Promise.all([
  moduleFor('packages/combat-assets/server-assets.mjs'),moduleFor('packages/pvp/index.mjs'),
  moduleFor('packages/combat-core/index.mjs'),moduleFor('packages/online/owned-state.mjs'),
]).then(async([assetModule,pvp,combat,owned])=>{
  // One decoded asset closure and one original runtime/sampler closure per
  // map are sufficient for these sequential snapshot-binding scenarios.
  // Sampler actor caches use the four reused actor ids, not actor objects;
  // effects are weakly cached. Every simulation still has independent state.
  const original=await assetModule.loadServerCombatAssets({root:programRoot,assetRoot});
  const scenes=new Map(),runtimeLoads=new Map();
  const assets={...original,forScene(sceneId){
    if(!scenes.has(sceneId)){
      const selected=original.forScene(sceneId);let runtime;
      scenes.set(sceneId,{...selected,createRuntime(){
        if(!runtime){runtimeLoads.set(sceneId,(runtimeLoads.get(sceneId)??0)+1);runtime=selected.createRuntime();}
        return runtime;
      }});
    }
    return scenes.get(sceneId);
  }};
  return {assets,pvp,combat,owned,runtimeLoads};
});}
async function room(t,professions){
 const d=await dependencies(),players=professions.map((professionId,i)=>({id:'peer-'+i,username:'peer-'+i,team:i%2,professionId,
  unitClass:d.assets.profiles[professionId].target.unitClass,loadout:Array(8).fill(null),branchChoices:{}}));
 assert.deepEqual(d.assets.professions,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true},'complete RF/LK/VC converted fixtures are required');
 const sceneId=d.assets.maps[0].id,selected=d.assets.forScene(sceneId);
 const match={id:'native-peer-restore-'+professions.join('-'),mode:players.length===2?'1v1':'2v2',sceneId,
  players,seed:20161010,versions:{...d.assets.versions,baseline:d.assets.profile.target.build,
   networkOwnership:d.owned.OWNERSHIP_PROTOCOL,...selected.versions}};
 const {native,samplers}=await selected.createRuntime(),spawns=d.pvp.chooseTeamSpawns(selected.map,players);
 // Match the factory's pre-life combat construction without loading a second
 // complete private asset cache or retaining server timers in this unit test.
 const template=d.combat.createSimulation({
  profile:d.assets.profile,profiles:d.assets.profiles,map:selected.map,preset:{...d.assets.preset,onlineMatch:true},
  presets:Object.fromEntries(Object.entries(d.assets.presets).map(([id,preset])=>[id,{...preset,onlineMatch:true}])),
  commonBuffs:d.assets.commonBuffs,actors:players.map((player,i)=>({...player,...spawns[i],position:spawns[i].position,loadout:player.loadout})),
  seed:match.seed,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,
  nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,
  nativeCritical:native.critical,nativeManaBreak:native.manaBreak,
  versions:{...native.versions,...selected.versions,...match.versions,matchRules:d.pvp.PVP_RULE_VERSION,networkOwnership:d.owned.OWNERSHIP_PROTOCOL},
 });
 const snapshot=template.snapshot();
 const create=snapshot=>createNetworkPeerSimulation({assets:d.assets,createSimulation:d.combat.createSimulation,match,snapshot,localPlayerId:players[0].id});
 return {...d,match,snapshot,create,native};
}

for(const professions of [['RF','RF','RF','RF'],['LK','RF'],['VC','LK'],['RF','LK','VC','VC'],['IS','LK'],['RF','LK','VC','IS'],['RS','IS'],['BM','LK'],['BM','RF','VC','LK']])test('native peer restores server-template '+professions.join('/')+' snapshot with its profession/common-buff closure',async t=>{
 const f=await room(t,professions),sim=await f.create(f.snapshot);
 assert.deepEqual(sim.snapshot(),f.snapshot);assert.equal(sim.networkOwnerId,'peer-0');
 assert.deepEqual(sim.state.profileIds,f.snapshot.profileIds);assert.equal(sim.state.commonBuffVersion,f.assets.commonBuffs.targetVersion);
 assert.ok(sim.nativeGeometry);assert.ok(sim.nativeCommands);assert.equal(typeof sim.effectBoneSampler,'function');
 assert.equal(sim.nativeGeometry,f.native.geometry);assert.equal(f.runtimeLoads.get(f.match.sceneId),1,'same-map scenarios reuse one original Native runtime');
 sim.step(1/60,{'peer-0':{held:[],pressed:[],released:[]}},{snapshot:false});
 for(const actor of sim.state.actors){
  const report=f.owned.encodeOwnedState(sim,actor.id,{epoch:1,frameSeq:1});
  assert.doesNotThrow(()=>f.owned.validateOwnedReferences(report,actor,sim.profileFor(actor),sim.map,{profiles:sim.profiles,actors:sim.state.actors}));
  assert.equal(actor.actorVersions.preset,f.assets.presets[actor.professionId].presetVersion);
  assert.equal(actor.formulaRules.combatLevel,85);const bonus={RF:30,LK:0,VC:30,RS:60,BM:30,IS:60}[actor.professionId];assert.equal(actor.equipmentAttributes.mpMax,bonus);assert.equal(actor.mpMax,300+bonus);
 }
});

test('native peer still rejects mismatched frozen profession, preset and global-buff identities',async t=>{
 const f=await room(t,['LK','RF']);
 for(const mutate of [
  snapshot=>{snapshot.commonBuffVersion='wrong-global-buff-version';},
  snapshot=>{snapshot.profileIds.RF='wrong-profile';},
  snapshot=>{snapshot.actors[0].actorVersions.preset='wrong-preset';},
  snapshot=>{snapshot.actors[0].profileId=f.assets.profiles.RF.profileId;},
 ]){const changed=structuredClone(f.snapshot);mutate(changed);await assert.rejects(f.create(changed),/Snapshot actor profession\/profile\/version mismatch|Actor profile identity mismatch/);}
});
