import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSwordHudParticleController,SWORD_HUD_TEMPLATES} from '../../apps/web/way-of-sword-particles.mjs';
const index=JSON.parse(readFileSync(process.env.LK_FX_INDEX??new URL('../../contracts/lk-fx-index.json',import.meta.url)));
const hud=JSON.parse(readFileSync(new URL('../../contracts/lk-sword-ui-source-v2.json',import.meta.url)));
index.swordHudAnchors=Object.fromEntries([['blue','g_pStatic_EL_BLUE'],['red','g_pStatic_EL_RED']].map(([side,name])=>{
  const row=hud.groups[name][4];return [side,[row.position[0]+row.size[0]/2,row.position[1]+row.size[1]/2,0]];
}));
const actor=(point,state,id='p')=>({id,professionId:'LK',wayOfSword:{point,state},wayOfSwordLimits:{vigor:4800,destruction:-4800}});
test('original source flare/ring fields retain finite entry effects and continuous aura',()=>{
  for(const kind of ['vitality','demolition']){
    const [entry,ring,loop]=[1,2,3].map(n=>index.templates[`elswrod_${kind}_UI_0${n}`]);
    assert.equal(entry.fields.TriggerCount,1);assert.equal(entry.fields.Lifetime,.5);
    assert.equal(ring.fields.TriggerCount,1);assert.equal(ring.fields.Lifetime,1);assert.equal(ring.fields.DrawCount,2);
    assert.equal(loop.fields.TriggerTime,999999999);assert.equal(loop.fields.Lifetime,.85);
    assert.equal(loop.textures['state_potion_flare.dds'].source.sha256,'19fe0a588ceeec44fd6447d24486becfeddc9b37b9fea9b1b4935f51987e8eca');
  }
});
test('source HUD starts three sequences once, retains active gauge consumption and clears on exit/actor replacement',()=>{
  const errors=[],c=createSwordHudParticleController({index,onUnsupported:e=>errors.push(e)});
  c.step(1/60,actor(4000,1));assert.equal(c.runtime.count,0);
  c.step(1/60,actor(4800,2));assert.equal(c.runtime.emitters.size,3);
  const ids=[...c.runtime.emitters.keys()];
  assert.deepEqual([...c.runtime.emitters.values()].map(e=>e.name),SWORD_HUD_TEMPLATES.slice(0,3));
  for(const emitter of c.runtime.emitters.values())assert.deepEqual(emitter.position,index.swordHudAnchors.blue);
  c.step(1/60,actor(4200,2));assert.deepEqual([...c.runtime.emitters.keys()],ids);
  for(let i=0;i<1200;i++)c.step(1/60,actor(400,2));
  assert.equal(c.runtime.emitters.size,1);assert.ok(c.runtime.count<=1);assert.deepEqual(errors,[]);
  c.step(1/60,actor(-4800,-2));
  assert.deepEqual([...c.runtime.emitters.values()].map(e=>e.name),SWORD_HUD_TEMPLATES.slice(3));
  const redEmitter=[...c.runtime.emitters.values()][0];c.step(1/60,actor(-4800,-2,'new-player'));
  assert.notStrictEqual([...c.runtime.emitters.values()][0],redEmitter);
  c.step(0,actor(0,0));assert.equal(c.runtime.count,0);assert.equal(c.runtime.emitters.size,0);
  c.step(.02,actor(4800,2));c.step(0,{professionId:'RF'});assert.equal(c.runtime.count,0);
  c.clear();assert.equal(c.proof().active,false);
});
