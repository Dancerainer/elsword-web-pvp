import {assetUrl} from './asset-urls.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';

export const RAVEN_BEAD_TEMPLATE='raven_powrUp_UI_01';

/** Fixed V5 HUD owns one sequence only at available-bead count == 3.
 * Combat awakening/full state does not control this UI emitter.
 */
export function createAwakeningBeadController({index,nativeRandom,onUnsupported=()=>{}}){
  const t=index.templates?.[RAVEN_BEAD_TEMPLATE];
  if(!t||t.fields.particleType!=='PT_2D_PLANE'||t.fields.DrawCount!==3)
    throw new TypeError('Original target Raven HUD particle required');
  const position=index.presentation.hudLocalPosition;
  const runtime=createEffectRuntime({index,nativeRandom,onUnsupported});
  let emitter=null;
  return {runtime,template:t,
    step(dt,orbs){
      if(orbs===3&&!emitter)emitter=runtime.add(RAVEN_BEAD_TEMPLATE,{position});
      if(orbs!==3&&emitter){runtime.stop(emitter.id,true);emitter=null;}
      if(dt>0)runtime.step(dt);
    },
    clear(){runtime.clear();emitter=null;},
    proof(){return {template:RAVEN_BEAD_TEMPLATE,emitters:runtime.emitters.size,particles:runtime.count,
      availableBeadsActive:!!emitter,drawCount:t.fields.DrawCount,anchor:[...position],targetClientMeasured:false};}
  };
}

/** Native RHW: centered quad, full Size, Rotate.z, color and top-row UV.
 * Write into a retained batch; emitters remain independent of game RNG.
 */
export function writeAwakeningBeadVertices(particles,buffer){
  let offset=0;
  for(const p of particles){
    const [w,h]=p.values.Size,[x,y]=p.position,angle=p.values.Rotate[2]*Math.PI/180;
    const c=Math.cos(angle),s=Math.sin(angle),color=p.values.Color;
    for(const [dx,dy,u,v] of [[-.5,-.5,0,0],[-.5,.5,0,1],[.5,-.5,1,0],[.5,-.5,1,0],[-.5,.5,0,1],[.5,.5,1,1]]){
      if(offset+8>buffer.length)throw new RangeError('Original Raven HUD particle cap exceeded');
      buffer[offset++]=x+dx*w*c-dy*h*s;buffer[offset++]=y+dx*w*s+dy*h*c;
      buffer[offset++]=u;buffer[offset++]=v;
      for(const value of color)buffer[offset++]=value;
    }
  }
  return offset/8;
}

const vertex='attribute vec2 position; attribute vec2 uv; attribute vec4 color; uniform vec2 resolution; varying vec2 texUV; varying vec4 tint; void main(){gl_Position=vec4(position.x/resolution.x*2.0-1.0,1.0-position.y/resolution.y*2.0,0.0,1.0);texUV=uv;tint=color;}';
const fragment='precision mediump float; uniform sampler2D image; varying vec2 texUV; varying vec4 tint; void main(){gl_FragColor=texture2D(image,texUV)*tint;}';

/** Small independent over-UI renderer for the original PT_2D_PLANE resource.
 * Exact declared blend factors are retained. Offscreen/browser composition
 * is a display adapter; native framebuffer/GPU equivalence is unverified.
 */
export async function createAwakeningBeadView({document,host,index,loadIndex,nativeRandom,onUnsupported=()=>{},loadTimeoutMs=15000,
  controllerFactory=createAwakeningBeadController,className='wake-bead-fire',textureRoot='/assets/ui/awakening-bead/',canvasWidth=335,canvasHeight=145}){
  let controller=null,canvas=null,gl=null,program=null,buffer=null,texture=null,image=null,vertices=null;
  const shaders=[],timers=new Set(),aborters=new Set(),textures=new Map();
  let dpr=0,stopped=false,ready=false,reported=false,phase='index',pendingImageReject=null,stopReason=null;
  function report(reason,error){
    if(reported)return;reported=true;
    onUnsupported({type:'unsupported-visual',id:className+'-'+reason,
      detail:'Optional original HUD flame disabled: '+(error?.message??reason)});
  }
  function cleanup(reason){
    if(stopped)return;stopped=true;ready=false;stopReason=reason;
    if(canvas)canvas.removeEventListener('webglcontextlost',contextLost);
    for(const timer of timers)clearTimeout(timer);timers.clear();
    for(const aborter of aborters)aborter.abort();aborters.clear();
    const reject=pendingImageReject;pendingImageReject=null;
    if(image){image.onload=null;image.onerror=null;image.src='';}
    reject?.(new Error('Original HUD flame stopped: '+reason));
    controller?.clear();
    if(gl){
      // Deletion and explicit context release also apply to partially created
      // views. Remove the loss handler first: own disposal is not a GPU error.
      for(const [method,resource] of [...[...new Set([...textures.values(),texture])].map(value=>['deleteTexture',value]),['deleteBuffer',buffer],['deleteProgram',program],
        ...shaders.map(shader=>['deleteShader',shader])]){
        if(resource)try{gl[method](resource);}catch{/* Already lost contexts cannot retain usable resources. */}
      }
      try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{/* Context may already have been lost. */}
    }
    canvas?.remove();
  }
  function contextLost(event){
    event.preventDefault();
    // Conservative permanent stop. The main scene owns its render loop; this
    // optional widget never creates a recovery loop or silently restarts.
    cleanup('context-lost');report('context-lost',new Error('HUD WebGL context lost; flame stopped until page reload'));
  }
  async function bounded(factory,label){
    const aborter=new AbortController();aborters.add(aborter);
    let timer;
    try{return await Promise.race([Promise.resolve().then(()=>factory(aborter.signal)),new Promise((_,reject)=>{
      timer=setTimeout(()=>{aborter.abort();reject(new Error('Original HUD '+label+' load timed out'));},loadTimeoutMs);timers.add(timer);
    })]);}finally{clearTimeout(timer);timers.delete(timer);aborters.delete(aborter);}
  }
  const view={get runtime(){return controller?.runtime;},
    clear(){controller?.clear();},
    proof(){return {...controller?.proof(),ready,stopped,stopReason,targetClientMeasured:false};},
    render(dt,orbs){
      if(!ready||stopped)return;
      controller.step(dt,orbs);
      const ratio=Math.max(1,globalThis.devicePixelRatio||1);
      if(dpr!==ratio){dpr=ratio;canvas.width=Math.round(canvasWidth*dpr);canvas.height=Math.round(canvasHeight*dpr);gl.viewport(0,0,canvas.width,canvas.height);}
      gl.clear(gl.COLOR_BUFFER_BIT);
      for(const template of controller.templates??[controller.template]){
        const particles=controller.templates?[...controller.runtime.particles.values()].filter(p=>p.name===template.name):controller.runtime.particles.values();
        const count=writeAwakeningBeadVertices(particles,vertices);
        if(count){gl.bindTexture(gl.TEXTURE_2D,textures.get(template.name));gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices.subarray(0,count*8));for(let i=0;i<(template.fields.DrawCount??1);i++)gl.drawArrays(gl.TRIANGLES,0,count);}
      }
      canvas.dataset.particles=String(controller.runtime.count);canvas.dataset.active=String(controller.proof().availableBeadsActive??controller.proof().active);
    },dispose(){cleanup('disposed');}};
  try{
    if(!(Number.isFinite(loadTimeoutMs)&&loadTimeoutMs>0))throw new TypeError('Positive HUD resource timeout required');
    if(loadIndex)index=await bounded(loadIndex,'index');
    controller=controllerFactory({index,nativeRandom,onUnsupported});const templates=controller.templates??[controller.template];
    phase='context';canvas=document.createElement('canvas');canvas.className=className;canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText=`position:absolute;inset:0;width:${canvasWidth}px;height:${canvasHeight}px;pointer-events:none;`;host.append(canvas);
    canvas.addEventListener('webglcontextlost',contextLost);
    gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:false});
    if(!gl)throw new Error('HUD WebGL renderer unavailable');
    phase='shader';
    function compile(kind,source){const shader=gl.createShader(kind);if(!shader)throw new Error('HUD shader allocation failed');shaders.push(shader);
      gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
    program=gl.createProgram();if(!program)throw new Error('HUD program allocation failed');
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.DST_ALPHA);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
    buffer=gl.createBuffer();if(!buffer)throw new Error('HUD vertex buffer allocation failed');
    vertices=new Float32Array(Math.max(...templates.map(t=>t.fields.NumParticles))*6*8);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.byteLength,gl.DYNAMIC_DRAW);
    for(const [name,size,offset] of [['position',2,0],['uv',2,8],['color',4,16]]){
      const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,32,offset);}
    gl.uniform2f(gl.getUniformLocation(program,'resolution'),canvasWidth,canvasHeight);
    phase='texture';
    for(const t of templates){
    if(t.fields.SourceBlendMode!=='D3DBLEND_SRCALPHA'||t.fields.DestBlendMode!=='D3DBLEND_DESTALPHA')throw new Error('Unsupported original HUD blend factors');
    texture=gl.createTexture();if(!texture)throw new Error('HUD texture allocation failed');textures.set(t.name,texture);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    image=new (document.defaultView?.Image??globalThis.Image)();const resource=Object.values(t.textures)[0];
    await bounded(()=>new Promise((resolve,reject)=>{pendingImageReject=reject;
      image.onload=()=>{pendingImageReject=null;resolve();};image.onerror=()=>{pendingImageReject=null;reject(new Error('Original Raven HUD flame texture failed to load'));};
      image.src=assetUrl(textureRoot+resource.file);
    }),'texture');
    if(stopped)return view;
    image.onload=null;image.onerror=null;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    }
    ready=true;
  }catch(error){cleanup('initialization-'+phase);report(phase,error);}
  return view;
}
