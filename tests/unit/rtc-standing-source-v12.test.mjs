/** Current Web fixture admission, without Native, a browser or source-client execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createStandingRtcSource} from '../../tools/rtc-standing-source-v12.mjs';
import {assessOnlinePeerHealth} from '../../tools/rtc-browser-evidence-v6.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'standing-transport-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
 starts:[0,1].map(index=>({index,kind:'SetTeamStartPos',teamFlag:index===0,position:[index*250,0,0],lineId:0,facingRight:index===0}))};
const input=frameSeq=>({held:[],pressed:[],released:[],frameSeq});
function fixture(){
 const simulation=createSimulation({profile,map,preset:{passives:[],guildPassives:[]},seed:2016,
  actors:[{id:'source',team:0,position:[0,0,0],lineId:0},{id:'target',team:1,position:[250,0,0],lineId:0}]});
 const template=encodeOwnedState(simulation,'source',{epoch:1}),source=createStandingRtcSource({template,playerId:'source',profile,ownerStatusVersion:1,combatPlaybackVersion:1});
 return {simulation,template,source};
}
test('standing fixture uses real status and playback producers and emits initial/periodic controller starts',()=>{
 const {simulation,template,source}=fixture(),before=structuredClone(template),actions=[];
 for(let frame=3;frame<=90;frame+=3){
  const report=source.sample(frame);validateOwnedState(report);
  validateOwnedReferences(report,simulation.actor('source'),profile,map,{actors:simulation.state.actors});
  assert.equal(report.actor.sourceStatusClock.version,1);assert.ok(report.actor.sourceStatusClock.frameSeq<=frame);
  for(const action of report.actions){assert.deepEqual(action.playback,{version:1,start:true,held:[]});
   assert.deepEqual(action.actor.sourceStatusClock,report.actor.sourceStatusClock);assert.equal(action.actor.worldStop,template.actor.worldStop);actions.push(action.id);}
 }
 assert.deepEqual(actions,[3,30,60,90]);assert.equal(source.diagnostics().playback.actions,4);
 assert.deepEqual(template,before);assert.throws(()=>source.sample(90),/frame-must-advance/);
});
test('current owner driver rejects old fixture shape, then ACKs every modern fixture action and final pose',t=>{
 const {simulation,template,source}=fixture(),players=simulation.state.actors.map(actor=>({id:actor.id,username:actor.id,professionId:'RF',team:actor.team,loadout:actor.loadout}));
 const pvp=new PvpMatch({mode:'1v1',players,map,seed:2016,versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'},rules:{scoreLimit:100}});
 const driver=createLocalOwnerBattleDriver({match:{id:'standing-driver',players,ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1},
  simulation,pvp,manual:true,clock:()=>0,emit:()=>{},finish:()=>assert.fail('room cannot finish')});
 t.after(()=>driver.stop());for(const player of players)driver.ready(player.id);driver.tick(10);
 assert.equal(driver.snapshot().pvp.phase,'fight');
 const old={...structuredClone(template),frameSeq:3};assert.throws(()=>driver.submitInput('source',{frames:[input(3)],owner:old}),/owner-status-clock-required/);
 const receipts=[];
 for(let frame=3;frame<=90;frame+=3){
  const report=source.sample(frame);
  if(report.actions.length){const unmarked=structuredClone(report);delete unmarked.actions[0].playback;
   assert.throws(()=>driver.submitInput('source',{frames:[input(frame)],owner:unmarked}),/combat-playback-required/);}
  const ack=driver.submitInput('source',{frames:[input(frame)],owner:report});
  assert.equal(ack.ignored,undefined);assert.equal(ack.frameSeq,frame);receipts.push(...ack.consumedActionIds);
 }
 assert.deepEqual(receipts,[3,30,60,90]);assert.equal(driver.snapshot().ownership.actors.source.frameSeq,90);
});
test('current eight-credit health contract is exact and does not weaken the legacy four-credit default',()=>{
 const peer={playerId:'a',transport:{ownerFatal:null,peerControls:{b:{negotiated:true,failed:false,degraded:false,frontierComplete:true,creditLimit:8,inflightPackets:8,wire:{encodeFailures:0,decodeFailures:0}}}}};
 assert.deepEqual(assessOnlinePeerHealth(peer,{expectedNativeCreditLimit:8}),[]);
 assert.ok(assessOnlinePeerHealth(peer).includes('native-control-credit-invalid:a/b'));
 peer.transport.peerControls.b.inflightPackets=9;assert.ok(assessOnlinePeerHealth(peer,{expectedNativeCreditLimit:8}).includes('native-control-credit-invalid:a/b'));
});
