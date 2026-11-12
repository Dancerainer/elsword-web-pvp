import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,NullEngine,Scene,FreeCamera,Vector3,MeshBuilder,PBRMaterial,ShaderMaterial} from '@babylonjs/core';
import {installNativeEffectRenderState} from '../../apps/web/effect-render-state.mjs';
import {SceneLoader} from '@babylonjs/core';
import {resolve} from 'node:path';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

const vertex='precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;void main(){gl_Position=worldViewProjection*vec4(position,1.0);}';
const fragment='precision highp float;void main(){gl_FragColor=vec4(1.,1.,1.,.5);}';
function setup(){
  const engine=new NullEngine();engine.setAlphaMode=Engine.prototype.setAlphaMode;
  const scene=new Scene(engine);scene.skipFrustumClipping=true;
  const camera=new FreeCamera('camera',new Vector3(0,0,10),scene);camera.setTarget(Vector3.Zero());
  let active=null;const draws=[];
  engine.drawElementsType=engine.drawArraysType=function(){draws.push({name:active?.name,
    mode:this.getAlphaMode(),blend:this.alphaState._blendFunctionParameters.slice(0,4),
    depthTest:this.getDepthBuffer(),depthWrite:this.getDepthWrite(),depthFunction:this.getDepthFunction(),
    blendEnabled:this.alphaState.alphaBlend});};
  function plane(name,material,order){
    const mesh=MeshBuilder.CreatePlane(name,{size:1},scene);mesh.material=material;mesh.alphaIndex=order;
    mesh.onBeforeRenderObservable.add(()=>{active=mesh;});return mesh;
  }
  async function compile(){for(const mesh of scene.meshes)if(mesh.material&&mesh.getTotalVertices())await mesh.material.forceCompilationAsync(mesh);}
  return {engine,scene,draws,plane,compile,dispose(){scene.dispose();engine.dispose();}};
}
function native(scene,engine,name,{src=770,dst=772,depthTest=false,depthWrite=false}={}){
  const material=new ShaderMaterial(name,scene,{vertexSource:vertex,fragmentSource:fragment},
    {attributes:['position'],uniforms:['worldViewProjection'],needAlphaBlending:true});
  material.alphaMode=Engine.ALPHA_COMBINE;material.disableDepthWrite=!depthWrite;material.forceDepthWrite=depthWrite;
  installNativeEffectRenderState(material,engine,{sourceBlend:src,destBlend:dst,depthTest});
  return material;
}
function pbr(scene,name,mode=PBRMaterial.PBRMATERIAL_ALPHABLEND){
  const material=new PBRMaterial(name,scene);material.unlit=true;material.transparencyMode=mode;
  if(mode===PBRMaterial.PBRMATERIAL_ALPHABLEND)material.alpha=.5;
  return material;
}

test('actual repeated draws restore native factors for same-mode PBR world/fade materials and opaque/alpha-test characters',async()=>{
  const s=setup();try{
    const first=native(s.scene,s.engine,'native-dest-alpha'),second=native(s.scene,s.engine,'native-add',{src:1,dst:1,depthTest:true});
    s.plane('native-a',first,1);s.plane('native-a-same-material',first,2);
    const map=s.plane('map-transparent',pbr(s.scene,'map-material'),3);
    const extra=s.plane('native-add',second,4);
    s.plane('character-fade',pbr(s.scene,'fade-material'),5);
    s.plane('character-normal',pbr(s.scene,'opaque-material',PBRMaterial.PBRMATERIAL_OPAQUE),0);
    s.plane('map-cutout',pbr(s.scene,'cutout-material',PBRMaterial.PBRMATERIAL_ALPHATEST),0);
    await s.compile();
    for(let frame=0;frame<4;frame++){
      extra.setEnabled(frame%2===0);map.position.z=frame*.1;s.draws.length=0;s.scene.render();
      for(const name of ['native-a','native-a-same-material']){
        const rows=s.draws.filter(d=>d.name===name);assert.equal(rows.length,1);
        assert.deepEqual(rows[0].blend,[770,772,770,772]);assert.equal(rows[0].depthTest,false);assert.equal(rows[0].depthWrite,false);
      }
      if(extra.isEnabled()){
        const draw=s.draws.find(d=>d.name==='native-add');assert.ok(draw);
        assert.deepEqual(draw.blend,[1,1,1,1]);assert.equal(draw.depthTest,true);
      }
      for(const name of ['map-transparent','character-fade']){
        const rows=s.draws.filter(d=>d.name===name);assert.equal(rows.length,1);
        assert.deepEqual(rows[0].blend,[770,771,1,1],name+' must retain regular alpha combine');
        assert.equal(rows[0].depthTest,true);assert.equal(rows[0].depthWrite,false);assert.equal(rows[0].mode,Engine.ALPHA_COMBINE);
      }
      for(const name of ['character-normal','map-cutout']){
        const rows=s.draws.filter(d=>d.name===name);assert.equal(rows.length,1);
        assert.equal(rows[0].blendEnabled,false);assert.equal(rows[0].depthTest,true);assert.equal(rows[0].depthWrite,true);
      }
      assert.equal(s.engine.getDepthBuffer(),true);assert.equal(s.engine.getDepthWrite(),true);
      assert.equal(s.engine.getAlphaMode(),Engine.ALPHA_DISABLE);
    }
  }finally{s.dispose();}
});

test('native mesh depth write/function retain Babylon material bind/unbind lifecycle across same-mode draws',async()=>{
  const s=setup();try{
    const material=native(s.scene,s.engine,'native-depth-writer',{src:1,dst:1,depthTest:false,depthWrite:true});
    material.depthFunction=Engine.ALWAYS;
    s.plane('native-depth-writer',material,1);s.plane('next-map',pbr(s.scene,'map'),2);
    await s.compile();s.engine.setDepthFunction(Engine.LEQUAL);s.scene.render();
    const fx=s.draws.find(d=>d.name==='native-depth-writer'),map=s.draws.find(d=>d.name==='next-map');
    assert.ok(fx&&map);assert.equal(fx.depthTest,false);assert.equal(fx.depthWrite,true);assert.equal(fx.depthFunction,Engine.ALWAYS);
    assert.equal(map.depthTest,true);assert.equal(map.depthWrite,false);assert.equal(map.depthFunction,Engine.LEQUAL);
    assert.deepEqual(map.blend,[770,771,1,1]);assert.equal(s.engine.getDepthFunction(),Engine.LEQUAL);
  }finally{s.dispose();}
});

test('scope restores the exact incoming factor state without invalidating cached alpha mode',()=>{
  const s=setup();try{
    const material=native(s.scene,s.engine,'native-scope');
    s.engine.setAlphaMode(Engine.ALPHA_COMBINE);s.engine.alphaState.setAlphaBlendFunctionParameters(774,0,1,771);
    s.engine.setDepthBuffer(false);const mode=s.engine.getAlphaMode();
    material.onBindObservable.notifyObservers({});
    assert.deepEqual(s.engine.alphaState._blendFunctionParameters.slice(0,4),[770,772,770,772]);
    material.onUnBindObservable.notifyObservers(material);
    assert.deepEqual(s.engine.alphaState._blendFunctionParameters.slice(0,4),[774,0,1,771]);
    assert.equal(s.engine.getDepthBuffer(),false);assert.equal(s.engine.getAlphaMode(),mode);
  }finally{s.dispose();}
});

test('production clones retain explicit TRUE/FALSE and the source main mesh default FALSE depth-write',async t=>{
  const s=setup();let view;try{
    s.engine.getCaps().maxVertexUniformVectors=1024;
    const names=['Wedding_Heart_SkillAttack_01','SI_SA_RRF_WILD_CHARGE05','raven_powrUp_04'];
    assert.deepEqual(names.map(n=>visualIndex.templates[n].fields.ZWriteEnable),[true,undefined,false]);
    assert.deepEqual(names.map(n=>visualIndex.templates[n].kind),['mesh','mesh','particle']);
    t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_root,file,scene)=>{
      // Original geometry, bones and animation stay intact. Headless texture
      // omission is isolated to this loader; retain the real BLEND pass type.
      const container=await loadPoseContainer(scene,resolve(fixtureRoot,'artifacts/rf',file));
      const material=pbr(scene,'source-material-'+file);container.materials.push(material);
      for(const mesh of container.meshes)if(mesh.getTotalVertices())mesh.material=material;
      return container;
    });
    const index={...visualIndex,templates:Object.fromEntries(names.map(n=>[n,visualIndex.templates[n]]))};
    const bounded={...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
    view=await createEffectsView({scene:s.scene,engine:s.engine,index,profile:bounded,effectPoses:poses,samplers:{}});
    const state={actors:[{id:'rf',facing:1,awakening:{remaining:0,orbs:0}}],effects:[]};
    for(let i=0;i<names.length;i++)view.event({type:'effectStarted',effectId:i+1,actorId:'rf',name:names[i],definition:{},
      birthAnchor:{position:[0,0,0],facing:1}},state);
    for(let i=0;i<10;i++)view.step(1/60,state);view.render();
    // setup records meshes made through plane(); original asset clones are
    // tracked here independently by their actual draw-time mesh callback.
    let active=null;const draws=[];
    for(const mesh of s.scene.meshes)mesh.onBeforeRenderObservable.add(()=>{active=mesh;});
    s.engine.drawElementsType=s.engine.drawArraysType=function(){draws.push({name:active?.name,
      depthWrite:this.getDepthWrite(),depthTest:this.getDepthBuffer()});};
    await s.compile();s.scene.render();
    // Fixed XMeshTemplet defaults writes false; the old shared true default
    // was the rectangular XCrash occluder. Explicit declarations still win.
    for(const [name,expected]of names.map((n,i)=>[n,i===0])){
      const rows=draws.filter(d=>d.name?.startsWith('fx-'+name+'-'));assert.ok(rows.length>0,'must draw original '+name+' geometry');
      assert.ok(rows.every(d=>d.depthWrite===expected),name+' original ZWriteEnable must reach actual draw');
    }
    assert.equal(s.engine.getDepthBuffer(),true);
  }finally{view?.clear();s.dispose();}
});
