/** Original four icon textures are callback roots, independent of loadout.
 * Controlled loader completion probes readiness; it is not a GPU image test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {collectEffectTemplates,collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {veteranOverheatIconTemplates} from '../../apps/web/vc-overheat-icons.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const full=JSON.parse(readFileSync(new URL('../../packages/combat-core/vc-profile.json',import.meta.url)));
const profile={...full,states:{},skillCatalog:[],effectSets:{},damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
const iconIndex={...index,templates:Object.fromEntries(veteranOverheatIconTemplates.map(name=>[name,index.templates[name]]))};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const waitFor=async predicate=>{
  const deadline=Date.now()+2000;
  while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(predicate(),'preparation did not reach the controlled loader');
};

test('real VC native direct-damage callback roots prewarm Napalm/Crow/command fire and all their original child textures',()=>{
  const roots=['DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_1','DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_2',
    'DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_3','DAMAGE_EFFECT_IGNITION_CROW','DAMAGE_EFFECT_IGNITION_CROW_OVERHEAT',
    'DAMAGE_EFFECT_DASH_JUMP_X_BULLET','DAMAGE_EFFECT_DASH_JUMP_X_BULLET_LOOP'];
  for(const name of roots)assert.ok(full.sourceLiteralResources.includes(name),name+' independently frozen callback literal');
  const names=new Set(),seen=new Set();
  const visit=value=>{
    if(typeof value==='string'){
      if(seen.has(value))return;seen.add(value);
      const t=index.templates[value];if(t){names.add(value);visit(t.fields);visit(t.events);visit(t.repeated);}
      visit(full.damageEffects[value]?.raw);visit(full.effectSets[value]?.raw);
    }else if(value&&typeof value==='object')for(const v of Object.values(value))visit(v);
  };
  for(const root of roots)visit(root);
  const budget=collectEffectMeshBudget(full,index,[],{effectQuality:{level:'medium',particleDivisor:8}});
  for(const name of names)assert.ok(budget.templates.has(name),'missing original callback descendant: '+name);
  for(const name of ['RVC_C_dashJumpX_hitGround_P02','RVC_C_dashJumpX_hitGround_P05','RVC_C_dashJumpX_hitGround_P05_1','RVC_C_dashJumpX_hitGround_P07'])assert.ok(names.has(name));
  assert.deepEqual(budget.unsupported,[]);
  // Direct skill roots are material-preparation roots, not combo/full-density
  // policy. The original deadlier mesh bursts retain finite resource demand.
  assert.ok([...budget.demands.values()].reduce((sum,row)=>sum+row.views,0)<400);
});

test('actual four callback-only VC notice textures are awaited before the view is ready, including an empty loadout',async t=>{
  assert.deepEqual([...collectEffectTemplates(profile,iconIndex,[])].sort(),[...veteranOverheatIconTemplates].sort());
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('icon-prewarm-v4',new Vector3(0,0,10),scene);
  const original=engine.createTexture.bind(engine),pending=[];
  t.mock.method(engine,'createTexture',function(...args){const onLoad=args[5];args[5]=null;
    const texture=original(...args);texture.isReady=false;pending.push({texture,onLoad});return texture;});
  let view,finished=false;
  const creation=createEffectsView({scene,engine,index:iconIndex,profile,samplers:{},assetBase:'/assets/vc/'}).then(result=>{view=result;finished=true;return result;});
  t.after(()=>{view?.clear();scene.dispose();engine.dispose();});
  await waitFor(()=>pending.length===4);assert.equal(finished,false);
  for(const row of pending.slice(0,3)){row.texture.isReady=true;row.onLoad();}
  await turn();assert.equal(finished,false,'three notices cannot make the fourth missing texture ready');
  pending[3].texture.isReady=true;pending[3].onLoad();await creation;
  const proof=view.proof();assert.equal(proof.prewarmedTemplates,4);assert.equal(proof.textureStatus.ready,4);
  assert.deepEqual(proof.textureStatus.failures,[]);
  for(const row of proof.textureStatus.overheat){assert.equal(row.textures.length,1);assert.equal(row.textures[0].ready,true);
    assert.ok(row.textures[0].url.startsWith('/assets/vc/fx/textures/'));}
  await view.prewarmResources([]);assert.equal(pending.length,4,'resource prewarm reuses the same completed texture loads');
});

test('a failed original icon texture rejects readiness before shader compilation instead of accepting a fallback',async t=>{
  const name=veteranOverheatIconTemplates[0],selected={...iconIndex,templates:{[name]:iconIndex.templates[name]}};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('icon-failed-v4',new Vector3(0,0,10),scene);
  const original=engine.createTexture.bind(engine);let fail,compiled=0;
  t.mock.method(engine,'createTexture',function(...args){fail=args[6];args[5]=null;
    const texture=original(...args);texture.isReady=false;return texture;});
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{compiled++;});
  t.after(()=>{scene.dispose();engine.dispose();});
  const failure=assert.rejects(createEffectsView({scene,engine,index:selected,profile,samplers:{}}),/injected original icon failure/);
  await waitFor(()=>typeof fail==='function');fail('injected original icon failure');await failure;
  assert.equal(compiled,0,'failed sampler never reaches the warmed-material stage');
});
