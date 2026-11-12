import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

test('an explicitly unconfirmed source marker still blocks guessed poses after original LK clocks have been measured',async t=>{
  const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
  const profile=json('packages/combat-core/lk-profile.json'),source=json('artifacts/lk/fx/index.json');
  const name='SwordStorm_M03';assert.equal(source.templates[name].animationRequiresUnconfirmedRate,false);
  const template={...source.templates[name],animationRequiresUnconfirmedRate:true};
  const pose=json('artifacts/lk/'+template.poseData);assert.deepEqual(pose.unsupportedTracks,[]);
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('LK-source-clock-test',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,fileURLToPath(new URL('../../artifacts/lk/'+file,import.meta.url))));
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
  const view=await createEffectsView({scene,engine,index:{...source,templates:{[name]:template}},profile:bounded,effectPoses:{[template.poseData]:pose},samplers:{}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  await view.prewarm([]);await view.prewarmActors([{id:'LK',professionId:'LK',loadout:[]}]);
  assert.equal(view.proof().meshInstances,0);assert.equal(view.proof().prewarmedTemplates,1);
  assert.ok(view.proof().unsupported.includes(name+':animation-rate'));
});
