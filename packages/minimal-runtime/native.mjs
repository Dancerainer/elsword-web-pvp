export const KEYS=['LEFT','RIGHT','UP','DOWN','Z','X'];
const VK=[37,39,38,40,90,88];
export const MOVE_STATES=['','RSI_WAIT','RSI_WALK','RSI_JUMP_READY','RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_DASH',
 'RSI_JUMP_LANDING','RSI_DASH_JUMP','RSI_DASH_END','RSI_COMBO_Z','RSI_COMBO_X','RSI_JUMP_COMBO_Z',
 'RSI_JUMP_COMBO_X','RSI_DASH_COMBO_Z','RSI_DASH_COMBO_X'];
export async function loadMinimalNative(manifest,load){
 const modules={};
 for(const name of ['input','movement']){
   const record=manifest.modules?.[name];if(!record||record.file!==name+'.wasm')throw Error('Invalid minimal manifest');
   const bytes=new Uint8Array(await load(record.file));
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==record.sha256)throw Error('Minimal module hash mismatch: '+name);
   const module=await WebAssembly.compile(bytes);
   if(WebAssembly.Module.imports(module).length)throw Error('Unexpected native imports');
   modules[name]=(await WebAssembly.instantiate(module)).exports;
   modules[name].__wasm_call_ctors?.();
 }
 let used=false;
 return {createDevice:()=>{if(used)throw Error('Load a separate WASM instance for each device');used=true;return createDevice(modules.input);},movement:createMovement(modules.movement)};
}
// One loadMinimalNative per simulation; device state is never shared between matches.
function createDevice(e){
 let lastEvent=-Infinity,lastSample=-Infinity,previous=[];
 const stamp=n=>{if(!Number.isFinite(n)||n<0)throw Error('Nonnegative millisecond timestamp required');return Math.floor(n)>>>0;};
 e.device_reset();
 return {
  enqueue(key,down,time){const i=KEYS.indexOf(key);if(i<0)throw Error('Unsupported device key');if(typeof down!=='boolean')throw Error('Boolean key edge required');
   if(time<lastEvent||time<lastSample)throw Error('Input timestamps must be ordered and not precede consumed time');
   const result=e.device_enqueue(stamp(time),VK[i],down?1:0);if(result<0)throw Error('Native input queue overflow');lastEvent=time;},
  sample(time,dt){if(time<lastSample||!Number.isFinite(dt)||dt<=0||dt>.25)throw Error('Invalid device interval');
   const ptr=e.device_sample(stamp(time),dt),m=Array.from(new Uint32Array(e.memory.buffer,ptr,4));lastSample=time;
   const held=KEYS.filter((_,i)=>m[2]&(1<<i)),pressed=KEYS.filter((_,i)=>m[3]&(1<<i));
   const released=previous.filter(k=>!held.includes(k));previous=held;
   return {sourceDevice:'v5-winkey-v1',held,pressed,released,pureDoubleLeft:!!(m[0]&1),pureDoubleRight:!!(m[0]&2)};},
  snapshot(){return {schema:1,lastEvent:Number.isFinite(lastEvent)?lastEvent:null,lastSample:Number.isFinite(lastSample)?lastSample:null,
    previous:[...previous],bytes:Array.from(new Uint8Array(e.memory.buffer,e.device_state_ptr(),e.device_state_size()))};},
  restore(s){if(s?.schema!==1||s.bytes?.length!==e.device_state_size()||s.bytes.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid device snapshot');
    // FIFO fields are native POD; snapshots are local trusted recorder output, not network messages.
    new Uint8Array(e.memory.buffer,e.device_state_ptr(),e.device_state_size()).set(s.bytes);
    previous=[...s.previous];lastEvent=s.lastEvent??-Infinity;lastSample=s.lastSample??-Infinity;},
 };
}
function createMovement(e){return {
 handles:state=>MOVE_STATES.indexOf(state)>0&&MOVE_STATES.indexOf(state)<=6,
 evaluate(a,keys,profile,canDown){
   const mask=set=>KEYS.reduce((n,k,i)=>n|(set.has(k)?1<<i:0),0),d=profile.states[a.state];
   const twice=(keys.pureDoubleLeft?1:0)|(keys.pureDoubleRight?2:0);
   const f=Math.fround,jump=f(f(profile.physics.JUMP_SPEED)*f(a.stats.jumpSpeedMultiplier));
   const dashJump=f(f(profile.physics.DASH_JUMP_SPEED)*f(a.stats.jumpSpeedMultiplier));
   const ended=a.animationStopped||a.animationTime>d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03);
   if(!e.movement_run(MOVE_STATES.indexOf(a.state),mask(keys.held),mask(keys.pressed),twice,a.facing,+a.grounded,a.vy,jump,dashJump,+ended,+canDown,a.reAttackZ1Time,+a.reAttackZ1Right))throw Error('Unsupported movement state');
   const result=Array.from(new Float32Array(e.memory.buffer,e.movement_result_ptr(),4));
   return {state:MOVE_STATES[result[0]],offsetY:result[1],vy:result[2],commonCalls:result[3]};
 }
};}
