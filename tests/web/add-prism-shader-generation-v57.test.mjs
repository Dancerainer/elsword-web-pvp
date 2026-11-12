/** Web shader engineering regression, using the locked Babylon processor.
 * No engine, scene, GPU, original executable or extracted assets are run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ShaderStore} from '@babylonjs/core/Engines/shaderStore.js';
import {Process} from '@babylonjs/core/Engines/Processors/shaderProcessor.js';
import {WebGL2ShaderProcessor} from '@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js';
import {pbrPixelShader} from '@babylonjs/core/Shaders/pbr.fragment.js';
import {installAddPrismMaterial} from '../../apps/web/add-prism-display-v57.mjs';

const sample='TEXRD(albedoSampler,vAlbedoUV+uvOffset+nativePrismTex0Offset)';
const originals=['AN_PARTICLE_PRISM_01','AN_PARTICLE_PRISM_01_1','AN_PARTICLE_PRISM_02'];
const defines=['#define PBR','#define ALBEDO','#define ALBEDODIRECTUV 1','#define MAINUV1',
 '#define NORMAL','#define UNLIT','#define NUM_BONE_INFLUENCERS 0',
 '#define NUM_MORPH_INFLUENCERS 0','#define LIGHTCOUNT 0','#define MAXLIGHTCOUNT 0',
 '#define SCENE_MRT_COUNT 0','#define DEBUGMODE 0','#define TEXTURE_REPETITION_MODE 0'];
function materialFor(name){
 // Only material lifecycle callbacks are stubbed. The production plugin,
 // MaterialPluginManager, include store and WebGL2 source processor are real.
 const engine={_shouldUseHighPrecisionShader:true,_features:{},getCaps:()=>({drawBuffersExtension:true})};
 const material={name:'prism-source-generation',shaderLanguage:0,albedoTexture:null,unlit:false,
  getScene:()=>({getEngine:()=>engine}),onDisposeObservable:{add(){}},_dirtyCallbacks:{127(){}}};
 const template={name,fields:{Mesh:(name==='AN_PARTICLE_PRISM_01_1'?'AN_PARTICLE_PRISM_01':name)+'.Y',
  particleType:'PT_MESH',CullMode:'D3DCULL_CCW',MeshRenderType:name==='AN_PARTICLE_PRISM_02'?'RT_CARTOON_BLACK_EDGE':'RT_REAL_COLOR'},
  events:[{property:'TEX0UV'}]};
 const handle=installAddPrismMaterial(material,template);assert.ok(handle);
 return {material,handle,engine};
}
async function generate(name,{legacy=false,ubo=false}={}){
 const {material,handle,engine}=materialFor(name),manager=material.pluginManager;
 if(legacy){
  // Exact former expression-only rule, kept solely as an independent
  // regression stimulus. It demonstrates the actual processor's loss of ";".
  handle.uv.getCustomCode=type=>type==='fragment'?{
   '!TEXRD\\(albedoSampler,vAlbedoUV\\+uvOffset\\)':sample,
  }:null;
  manager._codeInjectionPoints={};
  for(const plugin of manager._plugins)manager._collectPointNames('fragment',plugin.getCustomCode('fragment',0));
 }
 manager._handlePluginEvent(8,{ubo:{addUniform(){}}});
 const inject=manager._injectCustomCode({},undefined);
 let injected;
 const shader=await new Promise(resolve=>Process(pbrPixelShader.shader,{
  defines:[...defines],indexParameters:{maxSimultaneousLights:0,maxSimultaneousMorphTargets:0},
  isFragment:true,shouldUseHighPrecisionShader:true,supportsUniformBuffers:ubo,
  shadersRepository:ShaderStore.ShadersRepository,includesShadersStore:ShaderStore.IncludesShadersStore,
  version:'300',platformName:'WEBGL2',processor:new WebGL2ShaderProcessor(),processingContext:{},
  processCodeAfterIncludes:(type,code)=>{injected=inject(type,code);return injected;},
 },resolve,engine));
 return {shader,injected};
}
test('locked Babylon generation reproduces expression-only injection losing its isolated semicolon',async()=>{
 const {shader,injected}=await generate('AN_PARTICLE_PRISM_02',{legacy:true});
 assert.ok(injected.includes(sample+'\n;'),'plugin manager appends a newline before the original semicolon');
 const line=shader.split('\n').find(line=>line.startsWith('vec4 albedoTexture='));
 assert.equal(line,'vec4 albedoTexture='+sample,'ShaderCodeCursor drops the standalone semicolon');
 assert.ok(shader.includes(line+'\nalbedoOpacityOut=albedoOpacityBlock('));
});
test('actual Prism rules retain the sampling statement terminator in generated WebGL2 PBR for all three templates',async t=>{
 const results=[];
 for(const name of originals)for(const ubo of [false,true]){
  const {shader,injected}=await generate(name,{ubo});
  const lines=shader.split('\n'),at=lines.findIndex(line=>line.startsWith('vec4 albedoTexture='));
  assert.ok(at>=0);
  assert.equal(lines[at],'vec4 albedoTexture='+sample+';',name+' final GPU source assignment');
  assert.equal(lines[at+1],'albedoOpacityOut=albedoOpacityBlock(',name+' following source statement');
  assert.ok(injected.includes(sample+';\n'),'replacement retains its own terminator before manager newline');
  assert.equal((shader.match(/vec4 albedoTexture=/g)??[]).length,1);
  assert.ok(shader.includes('nativePrismTex0Offset;'));
  assert.ok(!shader.includes('#include<'),'the locked PBR include tree was resolved');
  assert.ok(shader.includes('layout(location = 0) out vec4 glFragColor;'),'actual WebGL2 postprocessor ran');
  results.push({name,uniformBuffers:ubo,shaderBytes:Buffer.byteLength(shader),shaderSha256:createHash('sha256').update(shader).digest('hex')});
 }
 assert.equal(JSON.parse(readFileSync(new URL('../../node_modules/@babylonjs/core/package.json',import.meta.url))).version,'9.29.0');
 t.diagnostic(JSON.stringify({scope:'Actual Babylon9.29 shader source generation; no GPU compiler or original-client claim',results}));
});
