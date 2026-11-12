/** GPU-facing matrix-cache regression with actual target meshes and inputs.
 * These are adapter invariants, not original-client screenshot expectations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const {createEffectsView}=await import(process.env.LK_MATRIX_BASELINE??'../../apps/web/effects-view.mjs');
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=resolve(root,'artifacts/lk');
const read=p=>JSON.parse(readFileSync(p)),index=read(resolve(assets,'fx/index.json')),preset=read(resolve(root,'config/lk-preset.json'));
const names=['Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','Elsword_RollingSmash_M02','RollingSmash_SwordWY01',
 'ELK_ArmagedonBladeM','ELK_ArmagedonBladeB01','ELK_ArmagedonBladeP01','ELK_ArmagedonBladeP02'];
const bounded={...index,templates:Object.fromEntries(names.map(n=>[n,index.templates[n]]))};
const poses=Object.fromEntries([...new Set(Object.values(bounded.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(resolve(assets,p))]));
for(const skillId of [21205,21008,0])for(const facing of [-1,1])test(`native traced meshes ${skillId||'668ZZZ'}/${facing}: rendered descendants follow without a forced audit update`,async t=>{
 const f=await lkCommandFixture({facing,gap:5000,preset:{...preset,guildPassives:[]}}),engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('traced-mesh-review',new Vector3(0,30,10),scene);
 const view=await createEffectsView({scene,engine,index:bounded,profile:f.profile,effectPoses:poses,
  samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler},loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assets,file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 f.sim.configureLoadout(skillId?[{skillId},...Array(7).fill(null)]:Array(8).fill(null),'lk');f.sim.drainEvents();
 const input=createInputBuffer(),direction=facing===1?'RIGHT':'LEFT',samples=new Map();let checks=0,phase=0,spinFrames=0;
 for(let frame=0;frame<230;frame++){
  if(!skillId){
   if(frame===0)input.tap(direction,f.sim.state.time+.001);
   if(frame===3)input.down(direction,f.sim.state.time+.001);
   if(frame===6)input.tap('UP',f.sim.state.time+.001);
   const source=f.profile.states[f.actor.state].sourceState;
   if(frame>9&&phase===0&&f.actor.state==='RSI_DASH_JUMP'||phase===1&&source==='ESSI_DASH_JUMP_COMBO_Z1'&&f.actor.animationTime>.04||phase===2&&source==='ESSI_DASH_JUMP_COMBO_Z2'&&f.actor.animationTime>.04){
    input.tap('Z',f.sim.state.time+.001);phase++;
   }
  }
  const keys=skillId?(frame===0?{pressed:['A']}:skillId===21008&&frame>160?{held:[direction],pressed:frame===161?['Z']:[]}:{}):input.consume(f.sim.state.time+1/60);
  f.sim.step(1/60,{lk:keys},{snapshot:false});for(const event of f.sim.drainEvents())view.event(event,f.sim.state);
  view.step(1/60,f.sim.state);view.render();scene.render();
  if(f.actor.state==='ESSI_ESK_DASH_JUMP_ZZZ')spinFrames++;
  // Save what rendering saw BEFORE any force-compute or diagnostics. The
  // former proof() refreshed these matrices and concealed stale descendants.
  const meshes=scene.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()>0&&names.some(n=>m.name.startsWith('fx-'+n+'-')));
  const cached=meshes.map(mesh=>({mesh,world:Array.from(mesh.getWorldMatrix().m)}));
  for(const {mesh,world}of cached){
   if(frame%20===0){
    const recomputed=Array.from(mesh.computeWorldMatrix(true).m);
    assert.ok(world.every((n,i)=>Math.abs(n-recomputed[i])<1e-5),mesh.name+' cached draw did not follow current bone on frame '+frame);
   }
   const positions=samples.get(mesh.name)??[];positions.push(world.slice(12,15));samples.set(mesh.name,positions);checks++;
  }
 }
 assert.ok(checks>80,'actual original mesh draws required');
 if(!skillId){assert.equal(phase,3,'all three Z inputs must be delivered');assert.ok(spinFrames>0,'all three Z inputs must reach the spinning continuation');}
 const family=skillId===21008?'ELK_ArmagedonBladeM':'Elsword_RollingSmash_M01';
 const moved=[...samples].filter(([name])=>name.startsWith('fx-'+family+'-')).some(([,positions])=>positions.length>2&&
  positions.some(p=>Math.hypot(...p.map((n,i)=>n-positions[0][i]))>.1));
 assert.ok(moved,'a persistent original mesh must follow the changing owner pose');
});
