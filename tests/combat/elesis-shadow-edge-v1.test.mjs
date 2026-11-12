import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-skill-fixture.mjs';
import {ELESIS_SHADOW_LINK,tickElesisShadowLinks,validateElesisShadowLink,castElesisShadowEdge} from '../../packages/combat-core/elesis-shadow-edge.mjs';
import {elesisCast,elesisInstanceDefinition} from '../../packages/combat-core/elesis-skills.mjs';
const links=s=>s.state.effects.filter(e=>e.name===ELESIS_SHADOW_LINK&&!e.dead);
function bind(extra=0){
 const s=elesisFixture('CA').make(28215),a=s.actor('elesis'),b=s.actor('target');
 for(let i=0;i<extra;i++){const target=structuredClone(b);target.id='target'+i;s.state.actors.push(target);}
 const bases=new Map(s.state.actors.map(b=>[b.id,b.stats.moveSpeedMultiplier]));
 a.hp-=10000;const hp=a.hp;s.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<120&&links(s).length<Math.min(3,extra+1);i++)s.step(1/60,{}, {snapshot:false});
 assert.ok(links(s).length,'original query must create links');return {s,a,b,bases,hp};
}
test('Shadow Edge original query binds at most three real targets and slows20percent',()=>{
 const {s,a,bases,hp}=bind(3);assert.equal(links(s).length,3);assert.equal(a.hp,hp,'unknown heal interval is not invented');
 const bound=new Set(links(s).map(e=>e.sourceElesisShadowLink.targetId));assert.equal(bound.size,3);
 for(const b of s.state.actors.filter(b=>b.id!==a.id)){
  const buff=b.buffs.find(v=>v.templateId===432);assert.equal(!!buff,bound.has(b.id));
  if(buff){assert.equal(buff.factorId,469);assert.equal(buff.finalizers[0].sourceDuration,8);assert.equal(buff.behaviors[0].value,Math.fround(.8));assert.ok(b.stats.moveSpeedMultiplier<bases.get(b.id));}
 }
 assert.ok(s.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.amount>0&&e.data.APPLIED_SKILL_ID===28215).length>=3);
});
test('Shadow Edge follows fallback endpoints with original530 link rate and breaks strictly beyond1200',()=>{
 const {s,a,b,bases}=bind(),e=links(s)[0];s.effectAnchorSampler=()=>null;b.x=a.x+1200;b.y=a.y;b.z=a.z;tickElesisShadowLinks(s,.000001);
 assert.equal(e.dead,undefined);assert.equal(e.sourceElesisShadowLink.scale,1200/530);assert.deepEqual(e.currentAnchor.position,[a.x,a.y+100,a.z]);
 const d=elesisInstanceDefinition(s.profileFor(a),e,{NAME:e.name});assert.equal(d.SCALE_X,1200/530);assert.equal(d.SCALE_Y,1/1.6);
 assert.deepEqual(elesisInstanceDefinition(s.profileFor(a),e,d),d,'definition restoration is idempotent');
 b.x=a.x+1200.01;tickElesisShadowLinks(s,.000001);assert.equal(e.dead,true);assert.ok(!b.buffs.some(v=>v.templateId===432));assert.equal(b.stats.moveSpeedMultiplier,bases.get(b.id));
});
test('Shadow Edge expiry and either participant death remove link and source slow',()=>{
 for(const why of ['expiry','owner-death','target-death']){const {s,a,b,bases}=bind(),e=links(s)[0];
  if(why==='owner-death')a.hp=0;if(why==='target-death')b.hp=0;
  tickElesisShadowLinks(s,why==='expiry'?8.01:.000001);assert.equal(e.dead,true,why);assert.ok(!b.buffs.some(v=>v.templateId===432),why);assert.equal(b.stats.moveSpeedMultiplier,bases.get(b.id));}
});
test('Shadow Edge recast preserves old links before query and retires them at the next .31 query',()=>{
 const {s,a,b}=bind(),e=links(s)[0];elesisCast(s,a,s.skill(28215,a));assert.notEqual(e.dead,true);
 castElesisShadowEdge(s,a);assert.equal(e.dead,true);assert.equal(links(s).length,1);assert.ok(b.buffs.some(v=>v.templateId===432));
});
test('Shadow Edge wire state rejects foreign skill/name/class/target and out-of-range controls',()=>{
 const {s,a}=bind(),e=links(s)[0];validateElesisShadowLink(e,'CA',s.state.actors);
 for(const patch of [{skillId:28024},{name:'foreign'},{sourceElesisShadowLink:{...e.sourceElesisShadowLink,scale:3}},{sourceElesisShadowLink:{...e.sourceElesisShadowLink,remaining:9}},{sourceElesisShadowLink:{...e.sourceElesisShadowLink,targetId:a.id}}])
  assert.throws(()=>validateElesisShadowLink({...e,...patch},'CA',s.state.actors),/Invalid Elesis/);
 assert.throws(()=>validateElesisShadowLink(e,'BH',s.state.actors),/Invalid Elesis/);
});
