/** Actual source WASM, authored Garpai floor and original Native helpers.
 * Two independent owners intentionally observe different current positions.
 * No hit injection, guessed box, historical dt0 damage or resource equality
 * is used. Fixture anchors/protection entries are explicit test preparation;
 * these are Web semantics, not original-client or WAN fidelity claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlaybackNativeAssets,playbackNativeOwner,nativeDt} from '../../tools/validation/measure-combat-playback-v12.mjs';

const assets=await loadPlaybackNativeAssets(),empty={held:[],pressed:[],released:[],sampledDevice:true};
const press=key=>({...empty,held:[key],pressed:[key]});
function move(actor,x){actor.x=x;actor.landPosition=[x,3080,0];actor.y=3080;actor.z=0;actor.lineId=2;actor.lastTouchLineId=2;actor.grounded=true;}
function pair(t,{sourceProfession='RF',skill=null,receiverX=1200}={}){
  let now=0;
  const options={sourceProfession,sourceSkill:skill,targetProfession:'RF',clock:()=>now},a=playbackNativeOwner(assets,'source',options),b=playbackNativeOwner(assets,'target',options);
  t.after(()=>{a.clear();b.clear();});
  for(const ctx of [a,b]){
    for(const id of ['buddy','other'])move(ctx.sim.actor(id),id==='buddy'?-1400:1400);
    const local=ctx.sim.actor(ctx.id);local.inputLock=0;local.forceInvincible=0;local.pvpPresentation=null;local.mp=local.mpMax;
    if(local.sourceAdd)local.sourceAdd.dp=8000;local.awakening.gauge=0;local.awakening.orbs=0;
  }
  move(a.sim.actor('target'),80);move(b.sim.actor('target'),receiverX);
  let zeroDt=0;const original=b.sim.tickEffects;b.sim.tickEffects=function(dt,selected){if(dt===0)zeroDt++;return original.call(this,dt,selected);};
  const deliver=result=>{
    if(!result.report)return;
    assert.ok(result.report.actions.every(action=>action.playback?.version===1),'real new producer never falls back to historical collision samples');
    assert.equal(b.sync.receiveActions('source',result.report.actions,1,result.report.frameSeq),true);
  };
  return {a,b,deliver,advance(){now+=1000/60;},get zeroDt(){return zeroDt;}};
}
function warm(f,count=3){for(let frame=0;frame<count;frame++){f.advance();f.deliver(f.a.step(empty));f.b.step(empty);}}
function assertNoImmediateLoss(f,result){
  const target=f.b.sim.actor('target'),hp=target.hp,buffs=structuredClone(target.buffs);
  f.deliver(result);f.b.sync.beforeStep(f.b.sim,'target');
  assert.equal(target.hp,hp,'event admission cannot retroactively charge HP');assert.deepEqual(target.buffs,buffs,'event admission cannot apply a historical debuff');assert.equal(f.zeroDt,0);
}

test('RF earns actual outgoing MP/awakening on its local observed contact while the other owner already moved away',t=>{
  const f=pair(t);warm(f);const a=f.a.sim.actor('source'),b=f.b.sim.actor('target');a.mp=20;const hp=b.hp,observedHp=f.a.sim.actor('target').hp;
  let rewarded=false;
  for(let frame=1;frame<=90;frame++){
    f.advance();const before={mp:a.mp,gauge:a.awakening.gauge,orbs:a.awakening.orbs},result=f.a.step(frame===1?press('Z'):empty);
    assertNoImmediateLoss(f,result);f.b.step(empty,{prepared:true});
    const hit=result.events.find(event=>event.type==='hit'&&event.actorId==='source'&&event.targetId==='target'&&event.amount>0);
    if(hit){assert.ok(a.mp>before.mp,'actual local outgoing hit grants MP in that Native step');
      assert.ok(a.awakening.gauge>before.gauge||a.awakening.orbs>before.orbs,'actual local outgoing hit grants awakening in that Native step');rewarded=true;break;}
  }
  assert.equal(rewarded,true,'a real input and Native helper must produce a nonzero outgoing hit');
  assert.equal(b.hp,hp,'recipient current pose rejects a source-view contact that happened elsewhere');
  assert.equal(f.a.sim.actor('target').hp,observedHp,'source does not own observed recipient HP');assert.equal(f.zeroDt,0);
});

test('LP finite attack runs on the recipient current clock and only damages a recipient who walks into its local helper',t=>{
  const f=pair(t,{sourceProfession:'LP',skill:29000,receiverX:500});warm(f,8);
  const availability=f.a.sim.skillAvailability('source',0);assert.equal(availability.available,true,JSON.stringify(availability));
  // Initially miss on the recipient. The source observation remains nearby.
  move(f.b.sim.actor('target'),1100);const target=f.b.sim.actor('target'),hp=target.hp;let started=false,localContact=false,walked=false;
  for(let frame=1;frame<=180;frame++){
    f.advance();const result=f.a.step(frame===1?press('A'):empty);assertNoImmediateLoss(f,result);
    started ||= result.events.some(event=>event.type==='skillStarted'&&event.actorId==='source');
    // Use a normal Native movement input, never a historical hit position.
    const input=frame>=12?{...empty,held:['LEFT'],pressed:frame===12?['LEFT']:[]}:empty;
    const beforeX=target.x,received=f.b.step(input,{prepared:true});walked ||= target.x<beforeX;
    const hit=received.events.find(event=>event.type==='hit'&&event.actorId==='source'&&event.targetId==='target'&&event.amount>0);
    if(hit){assert.ok(walked,'the owner walked with the Native controller before contact');assert.ok(target.hp<hp);localContact=true;break;}
  }
  assert.equal(started,true,'equipped original Energy Boom executes from input');assert.equal(localContact,true,'positive Native playback eventually confirms current contact');assert.equal(f.zeroDt,0);
});

test('current native down invulnerability rejects Maximum Cannon damage and its authored burn on the receiving screen',t=>{
  const f=pair(t,{skill:24025,receiverX:80});warm(f,8);const target=f.b.sim.actor('target');
  const burn=assets.profiles.RF.damageEffects.DamageEffect_SA_Raven_MaximumCannon.raw.DAMAGE_DATA.BUFF_FACTOR;
  assert.equal(burn.BUFF_TEMPLET_ID,37,'the attack really carries the authored burn');
  f.b.sim.enter(target,'RSI_DAMAGE_DOWN_FRONT','explicit-current-native-down-window');assert.equal(target.invincible,true);
  const hp=target.hp,buffs=structuredClone(target.buffs);let cast=false,sourceHit=false;
  for(let frame=1;frame<=120;frame++){
    f.advance();const result=f.a.step(frame===1?press('A'):empty);cast ||= result.events.some(event=>event.type==='skillStarted'&&event.actorId==='source');
    assertNoImmediateLoss(f,result);const received=f.b.step(empty,{prepared:true});
    assert.equal(received.events.some(event=>event.type==='hit'&&event.targetId==='target'),false);
    assert.equal(target.hp,hp);assert.deepEqual(target.buffs,buffs);
    if(result.events.some(event=>event.type==='hit'&&event.actorId==='source'&&event.targetId==='target'&&event.amount>0)){sourceHit=true;break;}
  }
  assert.equal(cast,true);assert.equal(sourceHit,true,'the other screen actually saw the same damaging cast');assert.equal(f.zeroDt,0);
});

test('current native SUPER_ARMOR keeps the receiving action when an independent RF Z lands',t=>{
  const f=pair(t,{receiverX:80});warm(f);const target=f.b.sim.actor('target');
  f.b.sim.enter(target,'RSI_OVER_TAKER_COMBO_XXfrontXX','explicit-current-native-armored-action');assert.equal(target.superArmor,true);
  const state=target.state,serial=target.stateSerial,hp=target.hp;let hit=false;
  for(let frame=1;frame<=50;frame++){
    f.advance();const result=f.a.step(frame===1?press('Z'):empty);assertNoImmediateLoss(f,result);const received=f.b.step(empty,{prepared:true});
    if(received.events.some(event=>event.type==='hit'&&event.actorId==='source'&&event.targetId==='target'&&event.amount>0)){
      assert.ok(target.hp<hp);assert.equal(target.superArmor,true);assert.equal(target.state,state);assert.equal(target.stateSerial,serial);hit=true;break;
    }
  }
  assert.equal(hit,true,'a real positive-dt Native contact must exercise the armor branch');assert.equal(f.zeroDt,0);
});

test('a real ended LP finite record never ticks damage at receipt and a later old birth cannot resurrect it',t=>{
  const f=pair(t,{sourceProfession:'LP',skill:29000,receiverX:80});warm(f,8);
  const name='DamageEffect_SI_SA_AN_Energy_Boom_Projectile';let birth,terminal;
  // Withhold this cast's traffic until its real source finite lifetime ends.
  // The receiving owner remains live and vulnerable throughout the test.
  for(let frame=1;frame<=300;frame++){
    f.advance();const result=f.a.step(frame===1?press('A'):empty);
    for(const action of result.report?.actions??[]){
      if(!birth&&action.effects.some(effect=>effect.name===name&&!effect.dead))birth={action:structuredClone(action),frameSeq:result.report.frameSeq};
      if(birth&&action.effects.some(effect=>effect.id===birth.action.effects.find(effect=>effect.name===name).id&&effect.dead))terminal={action:structuredClone(action),frameSeq:result.report.frameSeq};
    }
    f.b.step(empty);if(terminal)break;
  }
  assert.ok(birth,'normal Native execution must produce a real finite birth');assert.ok(terminal,'normal positive source ticks must produce its actual terminal');
  const target=f.b.sim.actor('target'),before=structuredClone(target);
  assert.equal(f.b.sync.receiveActions('source',[terminal.action],1,terminal.frameSeq),true);f.b.sync.beforeStep(f.b.sim,'target');
  assert.deepEqual(target,before);assert.equal(f.zeroDt,0);
  assert.equal(f.b.sync.receiveActions('source',[birth.action],1,terminal.frameSeq),true);f.b.sync.beforeStep(f.b.sim,'target');
  assert.equal(target.hp,before.hp);assert.deepEqual(target.buffs,before.buffs);
  assert.equal(f.b.sim.state.effects.some(effect=>effect.ownerId==='source'&&effect.name===name&&effect.active&&!effect.dead),false);
  assert.equal(f.zeroDt,0);assert.equal(nativeDt,1/60);
});
