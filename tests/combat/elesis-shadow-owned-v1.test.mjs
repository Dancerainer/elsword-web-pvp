import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-skill-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {ELESIS_SHADOW_LINK,tickElesisShadowLinks} from '../../packages/combat-core/elesis-shadow-edge.mjs';
const active=s=>s.state.effects.filter(e=>e.name===ELESIS_SHADOW_LINK&&!e.dead);
function start(){
 const {profile,make}=elesisFixture('CA'),source=make(28215),receiver=make(28215);receiver.networkOwnerId='target';receiver.state.nextEffectId=500000;
 source.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<120&&!active(source).length;i++)source.step(1/60,{}, {snapshot:false});
 source.step(1/60,{}, {snapshot:false});assert.equal(active(source).length,1);
 const packet=JSON.parse(JSON.stringify(encodeOwnedState(source,'elesis',{epoch:1,frameSeq:30})));
 return {source,receiver,profile,packet};
}
function receive(f,p=f.packet){
 validateOwnedState(p);validateOwnedReferences(p,f.receiver.actor('elesis'),f.profile,f.receiver.map,{profiles:{CA:f.profile},actors:f.receiver.state.actors});
 applyOwnedState(f.receiver,'elesis',p);
}
test('Shadow Edge owned and critical packets preserve bounded identity; receiver rebuilds scale and actually accepts original slow',()=>{
 const f=start(),wire=f.packet.effects.find(e=>e.sourceElesisShadowLink);assert.ok(wire);assert.equal(wire.definition,undefined);
 const action=encodeCriticalAction(f.packet,{id:1,effectIds:new Set([wire.id])});assert.deepEqual(action.effects[0].sourceElesisShadowLink,wire.sourceElesisShadowLink);
 receive(f);let e=active(f.receiver)[0];assert.equal(e.networkId,wire.id);assert.notEqual(e.id,wire.id);
 assert.equal(e.definition.SCALE_X,wire.sourceElesisShadowLink.scale);assert.equal(e.definition.SCALE_Y,1/1.6);
 assert.ok(!f.receiver.actor('target').buffs.some(b=>b.templateId===432),'wire target claim alone cannot grant slow');
 f.receiver.tickEffects(0);assert.ok(f.receiver.actor('target').buffs.some(b=>b.templateId===432),'actual source explosion helper must hit local victim');
 f.receiver.effectAnchorSampler=()=>null;
 const a=f.receiver.actor('elesis'),b=f.receiver.actor('target');b.x=a.x+400;b.y=a.y;b.z=a.z;f.receiver.tickEffects(1/60);
 e=active(f.receiver)[0];assert.ok(e);assert.equal(e.definition.SCALE_X,400/530);
 b.x=a.x+1201;f.receiver.tickEffects(1/60);assert.equal(active(f.receiver).length,0);assert.ok(!b.buffs.some(v=>v.templateId===432));
});
test('Shadow Edge subsequent source scale reconstructs idempotently on an existing remote identity',()=>{
 const f=start();receive(f);const e=active(f.receiver)[0],a=f.source.actor('elesis'),b=f.source.actor('target');f.source.effectAnchorSampler=()=>null;b.x=a.x+530;b.y=a.y;b.z=a.z;tickElesisShadowLinks(f.source,.000001);
 const p=encodeOwnedState(f.source,'elesis',{epoch:1,frameSeq:31});receive(f,p);assert.equal(active(f.receiver)[0],e);assert.equal(e.definition.SCALE_X,1);
 receive(f,{...p,frameSeq:32});assert.equal(e.definition.SCALE_X,1);assert.equal(e.definition.SCALE_Y,.625);
});
test('Shadow Edge complete owner expiry followed by old critical sample cannot revive the live link',()=>{
 const f=start();receive(f);f.receiver.tickEffects(0);assert.ok(f.receiver.actor('target').buffs.some(b=>b.templateId===432));
 const e=active(f.receiver)[0],consumer=createRemoteActionConsumer({clock:()=>0});
 consumer.remember(f.receiver,'target',()=>1);
 const wire=f.packet.effects.find(e=>e.sourceElesisShadowLink),action=encodeCriticalAction(f.packet,{id:4,effectIds:new Set([wire.id])});
 tickElesisShadowLinks(f.source,8.01);const ended=encodeOwnedState(f.source,'elesis',{epoch:1,frameSeq:40});receive(f,ended);assert.equal(active(f.receiver).length,0);assert.ok(!f.receiver.actor('target').buffs.some(b=>b.templateId===432));
 consumer.receive('elesis',[action],1,40);assert.equal(consumer.consume(f.receiver,'target',()=>1),1);assert.equal(active(f.receiver).length,0);
 assert.ok(!f.receiver.state.effects.includes(e));assert.ok(!f.receiver.actor('target').buffs.some(b=>b.templateId===432));consumer.clear();
});
test('Shadow Edge received latest link clock/scale survives replay of an older critical control snapshot',()=>{
 const f=start();receive(f);f.receiver.tickEffects(0);const e=active(f.receiver)[0],consumer=createRemoteActionConsumer({clock:()=>0});
 const latestCaster=f.receiver.actor('elesis'),victim=f.receiver.actor('target');latestCaster.x=1100;victim.x=700;
 assert.ok(Math.abs(f.packet.actor.x-victim.x)>1200,'old caster pose would incorrectly break the latest live link');
 assert.ok(victim.buffs.some(b=>b.templateId===432));
 e.sourceElesisShadowLink.remaining=3;e.sourceElesisShadowLink.scale=.75;e.definition.SCALE_X=.75;const before=structuredClone(e.sourceElesisShadowLink);
 consumer.remember(f.receiver,'target',()=>1);const wire=f.packet.effects.find(e=>e.sourceElesisShadowLink),action=encodeCriticalAction(f.packet,{id:5,effectIds:new Set([wire.id])});
 consumer.receive('elesis',[action],1,35);consumer.consume(f.receiver,'target',()=>1);
 assert.equal(active(f.receiver)[0],e);assert.deepEqual(e.sourceElesisShadowLink,before);assert.equal(e.definition.SCALE_X,.75);assert.ok(victim.buffs.some(b=>b.templateId===432));consumer.clear();
});
test('Shadow Edge full packet and recursive critical controls reject invalid fields, target membership and duplicate bindings',()=>{
 const f=start(),wire=f.packet.effects.find(e=>e.sourceElesisShadowLink);
 for(const patch of [{remaining:9},{scale:3},{targetId:''},{extra:1}]){const p=structuredClone(f.packet);Object.assign(p.effects.find(e=>e.id===wire.id).sourceElesisShadowLink,patch);assert.throws(()=>validateOwnedState(p),/Shadow Edge/);}
 const missing=structuredClone(f.packet);missing.effects.find(e=>e.id===wire.id).sourceElesisShadowLink.targetId='missing';assert.throws(()=>receive(f,missing),/Shadow Edge target/);
 const duplicate=structuredClone(f.packet);duplicate.effects.push({...structuredClone(wire),id:900001});assert.throws(()=>validateOwnedState(duplicate),/target-count/);
 const p=structuredClone(f.packet);p.actions=[encodeCriticalAction(p,{id:7,effectIds:new Set([wire.id])})];p.actions[0].effects[0].sourceElesisShadowLink.remaining=9;assert.throws(()=>validateOwnedState(p),/Shadow Edge/);
});
function contactBeforeLink(){
 const f=start(),withoutLink=structuredClone(f.packet);withoutLink.effects=withoutLink.effects.filter(e=>!e.sourceElesisShadowLink);
 receive(f,withoutLink);f.receiver.tickEffects(0);
 assert.ok(f.receiver.actor('target').hp<f.receiver.actor('target').hpMax,'local explosion is really accepted');
 assert.equal(active(f.receiver).length,0);assert.ok(!f.receiver.actor('target').buffs.some(b=>b.templateId===432));
 assert.equal(f.receiver.state.localOwnerElesisShadowContacts.length,1);return f;
}
test('late Link plus independently accepted local contact settles once, including snapshot/restore',()=>{
 const f=contactBeforeLink(),snapshot=JSON.parse(JSON.stringify(f.receiver.snapshot()));
 assert.ok(!JSON.stringify(encodeOwnedState(f.receiver,'target',{epoch:1,frameSeq:31})).includes('localOwnerElesisShadowContacts'),'local authorization cannot be supplied by an owned packet');
 const restored=elesisFixture('CA').make(28215);restored.networkOwnerId='target';restored.restore(snapshot);
 const copy={...f,receiver:restored},packet={...f.packet,frameSeq:31};
 for(const target of [f,copy]){
  receive(target,packet);target.receiver.tickEffects(.000001);
  assert.ok(target.receiver.actor('target').buffs.some(b=>b.templateId===432));
  assert.equal(target.receiver.state.localOwnerElesisShadowContacts[0].settled,true);
 }
 assert.deepEqual(restored.snapshot(),f.receiver.snapshot());
 const b=f.receiver.actor('target');b.buffs=[];
 receive(f,{...f.packet,frameSeq:32});f.receiver.tickEffects(.000001);
 assert.ok(!b.buffs.some(v=>v.templateId===432),'duplicate Link cannot reroll/reinstall an already settled slow');
});
test('expired or cross-epoch local contact never authorizes a later Link buff',()=>{
 for(const why of ['expired','epoch']){
  const f=contactBeforeLink();
  if(why==='expired')for(let i=0;i<481;i++)f.receiver.step(1/60,{}, {snapshot:false});
  else f.receiver.networkEpochFor=()=>2;
  receive(f,{...f.packet,frameSeq:33});f.receiver.tickEffects(.000001);
  assert.ok(!f.receiver.actor('target').buffs.some(v=>v.templateId===432),why);
 }
});
