import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpectatorCamera,spectatorText} from '../../apps/web/spectator-camera.mjs';
const fixture=()=>({localId:'me',actors:[['me',0],['a',0],['b',0],['x',1],['y',1]].map(([id,team])=>({id,team,hp:100})),
  players:[['me',0],['a',0],['b',0],['x',1],['y',1]].map(([id,team])=>({id,team,alive:true,connected:true,nickname:id}))});
const kill=(s,id)=>{Object.assign(s.actors.find(a=>a.id===id),{hp:0,hidden:true,deathComplete:true});s.players.find(p=>p.id===id).alive=false;};
test('completed death selects a living teammate; Z/X cycle with wrap and skip dead/disconnected players',()=>{
  const s=fixture(),before=structuredClone(s),c=createSpectatorCamera();
  assert.equal(c.update(s).targetId,'me');kill(s,'me');assert.equal(c.update(s).targetId,'a');
  assert.equal(c.cycle(1),true);assert.equal(c.update(s).targetId,'b');assert.equal(c.cycle(1),true);assert.equal(c.view().targetId,'a');
  assert.equal(c.cycle(-1),true);assert.equal(c.view().targetId,'b');s.players.find(p=>p.id==='b').connected=false;
  assert.equal(c.update(s).targetId,'a');assert.equal(c.cycle(1),false);assert.equal(c.view().kind,'ally');
  assert.equal(before.actors[0].hp,100);assert.equal(s.actors[1].hp,100);
});
test('HP death is observed before the roster catches up; actor pvpDead also excludes a stale live HP',()=>{
  const s=fixture(),c=createSpectatorCamera();Object.assign(s.actors[0],{hp:0,deathComplete:true});s.actors[1].pvpDead=true;
  assert.equal(c.update(s).targetId,'b');
});
test('enemy is chosen randomly once, cannot cycle, and is reselected only when unavailable',()=>{
  const s=fixture();for(const id of ['me','a','b'])kill(s,id);
  let draws=0;const c=createSpectatorCamera({random:()=>{draws++;return .9;}}),before=structuredClone(s);
  assert.equal(c.update(s).targetId,'y');assert.equal(c.view().kind,'enemy');assert.equal(c.cycle(1),false);
  assert.equal(c.update(s).targetId,'y');assert.equal(draws,1);assert.deepEqual(s,before);
  kill(s,'y');assert.equal(c.update(s).targetId,'x');assert.equal(draws,2);
});
test('all dead freezes the previous camera, then teammate/local revival restores tracking immediately',()=>{
  const s=fixture(),c=createSpectatorCamera();kill(s,'me');assert.equal(c.update(s).targetId,'a');
  for(const a of s.actors)kill(s,a.id);const hold=c.update(s);
  assert.equal(hold.targetId,'a');assert.equal(hold.kind,'hold');assert.equal(hold.tracking,false);assert.equal(c.cycle(1),false);
  s.actors[2].hp=100;s.players[2].alive=true;assert.equal(c.update(s).targetId,'b');assert.equal(c.view().tracking,true);
  s.actors[0].hp=100;s.players[0].alive=true;assert.equal(c.update(s).targetId,'me');assert.equal(c.view().spectating,false);
});
test('practice/lobby resets to local actor and missing roster never invents a living target',()=>{
  const s=fixture(),c=createSpectatorCamera();kill(s,'me');c.update(s);
  assert.equal(c.update({...s,enabled:false}).targetId,'me');assert.equal(c.view().spectating,false);
  assert.equal(c.update({actors:[],players:[],localId:'me'}).kind,'hold');c.reset();assert.equal(c.view().targetId,null);
});
test('spectator labels expose switching only for multiple living teammates',()=>{
  const s=fixture(),c=createSpectatorCamera();assert.equal(spectatorText(c.update(s)),'');kill(s,'me');
  assert.match(spectatorText(c.update(s)),/Z \/ X/);kill(s,'b');assert.doesNotMatch(spectatorText(c.update(s)),/Switch/);
  kill(s,'a');assert.match(spectatorText(c.update(s)),/Opponent view/);
});
