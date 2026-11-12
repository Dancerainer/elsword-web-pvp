import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAwakeningBeadView} from '../../apps/web/awakening-bead.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/rf-awakening-bead-fx-v14.json',import.meta.url)));

/** Owned DOM/WebGL/Image fixtures: no browser/global patch or external I/O. */
function fixture({shaderFail=false,linkFail=false,imageMode='success',noContext=false,uploadFail=false}={}){
  const calls=[],live=new Set(),notes=[],images=[],children=[],listeners=new Map();let serial=0,removed=false,losses=0;
  const canvas={style:{},dataset:{},width:300,height:150,setAttribute(){},getContext(){return noContext?null:gl;},
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
    remove(){removed=true;const i=children.indexOf(canvas);if(i>=0)children.splice(i,1);}};
  const lose=()=>listeners.get('webglcontextlost')?.({preventDefault(){calls.push(['preventDefault']);}});
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,BLEND:5,SRC_ALPHA:770,DST_ALPHA:772,
    DEPTH_TEST:7,CULL_FACE:8,ARRAY_BUFFER:9,DYNAMIC_DRAW:10,FLOAT:11,TEXTURE_2D:12,TEXTURE_MIN_FILTER:13,
    TEXTURE_MAG_FILTER:14,LINEAR:15,TEXTURE_WRAP_S:16,TEXTURE_WRAP_T:17,CLAMP_TO_EDGE:18,RGBA:19,
    UNSIGNED_BYTE:20,COLOR_BUFFER_BIT:21,TRIANGLES:22,
    getShaderParameter(){return !shaderFail;},getProgramParameter(){return !linkFail;},
    getShaderInfoLog(){return 'owned shader failure';},getProgramInfoLog(){return 'owned link failure';},
    getAttribLocation(){return 0;},getUniformLocation(){return {};},
    getExtension(name){assert.equal(name,'WEBGL_lose_context');return {loseContext(){losses++;lose();}};},
    texImage2D(...args){calls.push(['texImage2D',...args]);if(uploadFail)throw Error('owned upload failure');}};
  for(const kind of ['Shader','Program','Buffer','Texture']){
    gl['create'+kind]=()=>{const handle={kind,id:++serial};live.add(handle);return handle;};
    gl['delete'+kind]=handle=>{assert.ok(live.has(handle),'GPU object released exactly once');live.delete(handle);calls.push(['delete'+kind]);};
  }
  for(const method of ['shaderSource','compileShader','attachShader','linkProgram','useProgram','enable','blendFunc','disable',
    'clearColor','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','uniform2f','bindTexture',
    'texParameteri','viewport','clear','bufferSubData','drawArrays'])gl[method]=(...args)=>calls.push([method,...args]);
  class OwnedImage{
    constructor(){this.onload=null;this.onerror=null;images.push(this);}
    set src(value){this.url=value;if(!value)return;queueMicrotask(()=>{if(imageMode==='success')this.onload?.();if(imageMode==='error')this.onerror?.();});}
    get src(){return this.url;}
  }
  const document={defaultView:{Image:OwnedImage},createElement(name){assert.equal(name,'canvas');return canvas;}};
  const host={append(child){assert.equal(child,canvas);children.push(child);}};
  const options={document,host,index:structuredClone(index),onUnsupported:e=>notes.push(e),loadTimeoutMs:25};
  return {options,canvas,calls,live,notes,images,children,listeners,lose,get removed(){return removed;},get losses(){return losses;}};
}

test('successful HUD uses the owned image once, batches original three draws and explicitly releases context on idempotent disposal',async()=>{
  const f=fixture(),view=await createAwakeningBeadView(f.options);
  assert.equal(view.proof().ready,true);assert.equal(f.live.size,5);assert.equal(f.images.length,1);
  assert.equal(f.images[0].url,'/assets/ui/awakening-bead/secretVelder_perpit_fire_flame-f70a64220a.png');
  assert.ok(f.calls.some(c=>c[0]==='blendFunc'&&c[1]===770&&c[2]===772));
  for(let i=0;i<30;i++)view.render(1/60,3);
  assert.equal(f.canvas.dataset.active,'true');assert.ok(Number(f.canvas.dataset.particles)>0);
  const draws=f.calls.filter(c=>c[0]==='drawArrays').length;assert.ok(draws>0);assert.equal(draws%3,0);
  view.render(0,2);assert.equal(view.runtime.count,0);assert.equal(f.canvas.dataset.active,'false');
  view.dispose();view.dispose();view.render(1/60,3);
  assert.equal(f.live.size,0);assert.equal(f.losses,1);assert.equal(f.removed,true);assert.equal(f.listeners.size,0);
  assert.equal(f.calls.filter(c=>c[0]==='drawArrays').length,draws);assert.deepEqual(f.notes,[]);
});

test('optional index rejection or timeout resolves to an unsupported stopped view without allocating DOM/GPU',async()=>{
  for(const timeout of [false,true]){
    const f=fixture();let signal;
    const view=await createAwakeningBeadView({...f.options,loadTimeoutMs:5,loadIndex:s=>{signal=s;return timeout?new Promise(()=>{}):Promise.reject(Error('owned index HTTP 404'));}});
    assert.equal(view.proof().stopped,true);assert.equal(view.proof().ready,false);assert.equal(f.children.length,0);
    assert.equal(f.live.size,0);assert.equal(f.images.length,0);assert.equal(f.notes.length,1);
    if(timeout)assert.equal(signal.aborted,true);
    assert.doesNotThrow(()=>{view.render(1/60,3);view.dispose();});
  }
});

test('shader and program-link failures release every partially allocated object and leave main initialization free to continue',async()=>{
  for(const failure of [{shaderFail:true},{linkFail:true}]){
    const f=fixture(failure),view=await createAwakeningBeadView(f.options);
    assert.equal(view.proof().ready,false);assert.equal(f.live.size,0);assert.equal(f.losses,1);assert.equal(f.removed,true);
    assert.equal(f.images.length,0);assert.equal(f.notes.length,1);assert.match(f.notes[0].id,/shader/);
    assert.doesNotThrow(()=>view.render(1/60,3));
  }
});

test('texture network failure, timeout or upload failure clean canvas, handlers, GPU objects and context',async()=>{
  for(const failure of [{imageMode:'error'},{imageMode:'hold'},{uploadFail:true}]){
    const f=fixture(failure),view=await createAwakeningBeadView({...f.options,loadTimeoutMs:5});
    assert.equal(view.proof().ready,false);assert.equal(f.live.size,0);assert.equal(f.losses,1);assert.equal(f.removed,true);
    assert.equal(f.images[0].onload,null);assert.equal(f.images[0].onerror,null);assert.equal(f.images[0].url,'');
    assert.equal(f.notes.length,1);assert.match(f.notes[0].id,/texture/);
    assert.doesNotThrow(()=>{view.render(1/60,3);view.dispose();});
  }
});

test('missing WebGL is reported once and removes the optional canvas',async()=>{
  const f=fixture({noContext:true}),view=await createAwakeningBeadView(f.options);
  assert.equal(view.proof().stopped,true);assert.equal(f.removed,true);assert.equal(f.losses,0);assert.equal(f.notes.length,1);
  assert.equal(f.children.length,0);assert.doesNotThrow(()=>{view.render(1/60,3);view.dispose();});
});

test('context loss after initialization permanently stops HUD, clears particles and never draws/restarts again',async()=>{
  const f=fixture(),view=await createAwakeningBeadView(f.options);
  for(let i=0;i<30;i++)view.render(1/60,3);assert.ok(view.runtime.count>0);
  const draws=f.calls.filter(c=>c[0]==='drawArrays').length;f.lose();
  assert.equal(view.proof().stopReason,'context-lost');assert.equal(view.runtime.count,0);assert.equal(f.live.size,0);
  assert.equal(f.removed,true);assert.equal(f.losses,1);assert.equal(f.notes.length,1);assert.match(f.notes[0].detail,/until page reload/);
  view.render(1/60,3);view.dispose();f.lose();
  assert.equal(f.calls.filter(c=>c[0]==='drawArrays').length,draws);assert.equal(f.notes.length,1);
});

test('context loss while image initialization is pending resolves the optional view without hanging',async()=>{
  const f=fixture({imageMode:'hold'}),pending=createAwakeningBeadView(f.options);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.images.length,1);f.lose();
  const view=await pending;assert.equal(view.proof().stopReason,'context-lost');assert.equal(f.notes.length,1);
  assert.equal(f.live.size,0);assert.equal(f.images[0].onload,null);assert.equal(f.images[0].onerror,null);
});
