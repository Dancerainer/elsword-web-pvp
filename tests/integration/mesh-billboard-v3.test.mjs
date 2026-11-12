import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,Matrix,Quaternion,Vector3,VertexBuffer,FreeCamera,SceneLoader} from '@babylonjs/core';
import {nativeMeshBillboardRotationToRef} from '../../apps/web/native-mesh-billboard.mjs';
import {nativeBillboardRotationToRef} from '../../apps/web/particle-billboard.mjs';
import {createActorView} from '../../apps/web/actor-presentation.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {fixtureRoot,visualIndex,poses,make,profile} from '../helpers/rf-passive-fixture-v12.mjs';

const source=JSON.parse(readFileSync(new URL('../fixtures/fx-mesh-billboard-v3.json',import.meta.url)));
// Independent scalar order taken from D3DX RotationYawPitchRoll; neither the
// helper nor Babylon's quaternion/matrix supplies the expected coordinates.
const turn=(v,[pitch,yaw,roll])=>{
  const [x,y,z]=[pitch,yaw,roll].map(a=>a*Math.PI/180),[a,b,c]=v;
  const rx=a*Math.cos(z)-b*Math.sin(z),ry=a*Math.sin(z)+b*Math.cos(z);
  const py=ry*Math.cos(x)-c*Math.sin(x),pz=ry*Math.sin(x)+c*Math.cos(x);
  return [rx*Math.cos(y)+pz*Math.sin(y),py,-rx*Math.sin(y)+pz*Math.cos(y)];
};
const rowPoint=(v,m)=>[0,1,2].map(i=>v[0]*m[i]+v[1]*m[4+i]+v[2]*m[8+i]+m[12+i]);
const close=(actual,expected,tolerance=2e-5)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance,`${actual} vs ${expected}`));
const rotation=(angles)=>Quaternion.RotationYawPitchRoll(angles[1]*Math.PI/180,angles[0]*Math.PI/180,angles[2]*Math.PI/180);

test('mesh rotation consumers and the frozen mesh sample retain independent source bytes',()=>{
  for(const file of source.consumerSources){const bytes=readFileSync(new URL('../../'+file.path,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
  const body=readFileSync(new URL('../../'+source.consumerSources[0].path,import.meta.url),'latin1');
  const mesh=body.slice(body.indexOf('void CKTDGParticleSystem::CParticleEventSequence::OnFrameRenderMesh_Draw()'),body.indexOf('#ifdef SKINMESH_PARTICLE_TEST',body.indexOf('void CKTDGParticleSystem::CParticleEventSequence::OnFrameRenderMesh_Draw()')));
  assert.match(mesh,/vRotDegree\s*=\s*pPart->GetRotate\(\)\s*\+\s*pPart->GetRotateLocal\(\)/);
  assert.match(mesh,/GetMatrix\( m_BillBoardType \)/);
  assert.doesNotMatch(mesh,/m_bReverseY/,'ReverseY belongs to the separate plane consumer');
});

test('PT_MESH BT_ALL consumes axis plus local rotation; plane billboard still consumes local alone',()=>{
  const camera=[13,27,-9],billboard=rotation(camera),local=[18,36,123],axis=[11,180,-23];
  const result=new Quaternion(),scratch=new Quaternion(),matrix=Matrix.Identity(),point=[1.25,-.75,.25];
  nativeMeshBillboardRotationToRef(billboard,local,axis,result,scratch);Matrix.FromQuaternionToRef(result,matrix);
  const expected=turn(turn(point,[-local[0]-axis[0],-local[1]-axis[1],local[2]+axis[2]]),camera);
  close(Vector3.TransformCoordinates(Vector3.FromArray(point),matrix).asArray(),expected,2e-6);
  nativeBillboardRotationToRef(billboard,local,false,result,scratch);Matrix.FromQuaternionToRef(result,matrix);
  const plane=Vector3.TransformCoordinates(Vector3.FromArray(point),matrix).asArray();
  close(plane,turn(turn(point,[-local[0],-local[1],local[2]]),camera),2e-6);
  assert.ok(plane.some((n,i)=>Math.abs(n-expected[i])>.1),'old plane helper must fail the mesh-axis counterexample');
});

test('actual SCA clone child world vertices match source nodeLocal then SizeScale, mesh rotation and billboard',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const template=visualIndex.templates.Raven_Explosion2_P02;
  assert.equal(template.fields.Mesh,source.mesh);
  const container=await loadPoseContainer(scene,resolve(fixtureRoot,'artifacts/rf',template.glb));
  const view=createActorView(container,scene,'original-sca-v3',.01,poses[template.poseData]);
  t.after(()=>{view.dispose();container.dispose();scene.dispose();engine.dispose();});
  const child=view.meshes.find(m=>m.getTotalVertices()>0),actualPositions=child.getVerticesData(VertexBuffer.PositionKind),actualUvs=child.getVerticesData(VertexBuffer.UVKind);
  assert.equal(actualPositions.length,18,'original two triangles, with no invented back face');
  // Source exporter reflects Z and triangle order to retain the same faces.
  const vertexOrder=[0,3,1,2,0,1];
  for(let i=0;i<vertexOrder.length;i++){
    const native=source.nativeVertices[vertexOrder[i]],uv=source.nativeUvs[vertexOrder[i]];
    close(Array.from(actualPositions.slice(i*3,i*3+3)),[native[0],native[1],-native[2]],1e-7);
    close(Array.from(actualUvs.slice(i*2,i*2+2)),uv,1e-7);
  }
  let checked=0,maximumError=0;
  for(const camera of [[0,0,0],[13,27,-9],[-22,157,11]])for(const axis of [[0,0,0],[0,180,0],[12,55,-31]])for(const local of [[0,0,0],[18,36,123]]){
    const size=[.57,.21,1],scale=[.5,.3,.3],position=[1489.046937,2943.202272,-.939724];
    view.root.position.set(position[0]*.01,position[1]*.01,-position[2]*.01);
    view.root.scaling.set(...size.map((n,i)=>n*scale[i]*.01));
    view.root.rotationQuaternion??=new Quaternion();
    nativeMeshBillboardRotationToRef(rotation(camera),local,axis,view.root.rotationQuaternion,new Quaternion());
    const childWorld=child.computeWorldMatrix(true);
    for(let i=0;i<vertexOrder.length;i++){
      const authored=rowPoint(source.nativeVertices[vertexOrder[i]],source.nativeCircleRowMatrix);
      const stretched=authored.map((n,j)=>n*size[j]*scale[j]);
      const turned=turn(stretched,local.map((n,j)=>n+axis[j]));
      const render=turn([turned[0],turned[1],-turned[2]],camera).map((n,j)=>(n+(j===2?-position[j]:position[j]))*.01);
      const actual=Vector3.TransformCoordinates(Vector3.FromArray(Array.from(actualPositions.slice(i*3,i*3+3))),childWorld).asArray();
      close(actual,render);maximumError=Math.max(maximumError,...actual.map((n,j)=>Math.abs(n-render[j])));checked++;
    }
  }
  assert.equal(checked,108);
  t.diagnostic(JSON.stringify({sourceMesh:source.mesh,sourceSha256:source.source.sha256,actualCloneVerticesChecked:checked,maximumRenderUnitError:maximumError,nativeGpuMeasured:false}));
});

test('actual EnchantHand and GuardianStrike P02 particles carry the source global rotation into their production clone world vertices',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const camera=new FreeCamera('mesh-source-production',new Vector3(0,0,10),scene);camera.setTarget(Vector3.Zero());
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve(fixtureRoot,'artifacts/rf',file)));
  const name='Raven_Explosion2_P02',template=visualIndex.templates[name];
  const index={...visualIndex,templates:{[name]:template}};
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  t.after(()=>{scene.dispose();engine.dispose();});
  for(const skillId of [24206,24006])for(const facing of [-1,1]){
    const s=await make({skillId,passives:[]});s.actor('rf').facing=facing;s.drainEvents();
    const view=await createEffectsView({scene,engine,index,profile:bounded,effectPoses:poses,
      samplers:{effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:s.effectBoneSampler}});
    let checked=0,maximumError=0,first=null;
    try{
      for(let frame=0;frame<90;frame++){
        s.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
        for(const e of s.drainEvents())view.event(e,s.state);
        view.step(1/60,s.state);view.render();
        const samples=view.proof({includeDraws:true}).nativeParticleDraws.samples.filter(p=>p.name===name);
        for(const p of samples){
          assert.deepEqual(p.axis,[0,facing<0?180:0,0],'both confirmed source consumers set AxisAngle and AddRotate together');
          assert.equal(p.drawCount,template.fields.DrawCount);
          first??={frame,axis:p.axis,scale:p.scale,rotate:p.rotate,size:p.size,position:p.position};
          const child=p.meshes.find(m=>m.name==='Circle01');assert.ok(child);
          const matrix=Array.from(child.world);
          for(const native of source.nativeVertices){
            const authored=rowPoint(native,source.nativeCircleRowMatrix);
            const stretched=authored.map((n,j)=>n*p.size[j]*p.scale[j]);
            const nativeWorld=turn(stretched,p.rotate.map((n,j)=>n+p.axis[j])).map((n,j)=>n+p.position[j]);
            const expected=[nativeWorld[0]*.01,nativeWorld[1]*.01,-nativeWorld[2]*.01];
            const actual=rowPoint([native[0],native[1],-native[2]],matrix);
            close(actual,expected);maximumError=Math.max(maximumError,...actual.map((n,j)=>Math.abs(n-expected[j])));checked++;
          }
        }
      }
      assert.ok(checked>40,`${skillId}/${facing}: original P02 must actually render for more than one packet`);
      t.diagnostic(JSON.stringify({skillId,facing,first,actualProductionVerticesChecked:checked,maximumRenderUnitError:maximumError,nativeGpuMeasured:false}));
    }finally{view.clear();}
  }
});

test('actual current XXX source closure does not claim the independent P02 mesh consumer',()=>{
  const raw=profile.damageEffects.DamageEffect_RF_XXX.raw;
  const names=new Set(Object.entries(raw).filter(([key])=>/^(?:PASSIVE|START|TIME|HIT)_PARTICLE\d+$/.test(key)).map(([,entry])=>entry.PARTICLE_NAME));
  for(const name of names){const t=visualIndex.templates[name];assert.ok(t,name);
    for(const field of ['TraceParticleList','FinalParticleList'])for(const child of t.repeated?.[field]??(t.fields[field]?[t.fields[field]]:[]))names.add(child);}
  assert.equal(names.has('Raven_Explosion2_P02'),false,'current XXX issue must be checked against its own quad chain');
  assert.ok(names.has('EMK_BigBurst_P03'));
});
