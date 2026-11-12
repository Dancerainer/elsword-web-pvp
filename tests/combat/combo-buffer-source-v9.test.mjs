import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeCommands} from '../../packages/native-source/commands.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const path=p=>new URL('../../'+p,import.meta.url),read=p=>JSON.parse(readFileSync(path(p),'utf8'));
const profile=read('packages/combat-core/rf-profile.json'),config=read('config/rf-preset.json');
const source=read('contracts/rf-native-runtime-sources.json'),manifest=read('artifacts/native/manifest.json');
const bytes=readFileSync(path('artifacts/native/commands.wasm'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const map={sceneId:'source-input-latch-v9',lines:[{lineId:0,start:[-8000,0,0],end:[8000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
// Literal branch thresholds from pinned Raven.cpp; these are not 2016 recordings.
const chains=[
  {state:'RSI_COMBO_Z',key:'Z',flag:1,until:.3,after:.29,next:'RSI_COMBO_ZZ',grounded:true},
  {state:'RSI_COMBO_ZZ',key:'X',flag:2,until:.39,after:.39,next:'RSI_COMBO_ZZX',grounded:true},
  {state:'RSI_COMBO_ZZX',key:'X',flag:1,until:.6,after:.6,next:'RSI_COMBO_ZZXX',grounded:true},
  {state:'RSI_DASH_JUMP_COMBO_Z',key:'X',flag:2,until:null,after:.2,next:'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX',grounded:false},
  {state:'RRF_DASH_JUMP_COMBO_X',key:'X',flag:1,until:.39,after:.39,next:'RRF_DASH_JUMP_COMBO_XX',grounded:false},
];
const actor=(state,extra={})=>({state,animationTime:0,animationBeforeTime:0,animationOneshotTimer:0,animationStopped:false,
  sourceCommandFlags:0,vx:0,vy:0,passiveSpeed:{x:-1,y:-1},facing:1,grounded:true,y:0,landPosition:[0,0,0],
  canNotJumpTime:0,canNotAttackTime:0,reAttackZ1Time:0,mp:300,stats:{moveSpeedMultiplier:1},...extra});
const commands=()=>createNativeCommands({bytes});
async function make(state='RSI_COMBO_Z',extra={}){
  const nativeCommands=await commands(),nativeGeometry=await createNativeGeometry({bytes:readFileSync(path('artifacts/native/geometry.wasm')),map});
  const s=createSimulation({profile,map,nativeCommands,nativeGeometry,
    preset:{...config,passives:[],attributes:{...config.attributes,animationSpeedMultiplier:1,moveSpeedMultiplier:1,jumpSpeedMultiplier:1}},
    actors:[{id:'rf',team:0,x:0,y:0,lineId:0,...extra}]});
  const a=s.actor('rf');s.enter(a,state,'source-input-fixture');s.drainEvents();return {s,a,nativeCommands};
}
const step=(s,input={},dt=.005)=>s.step(dt,input,{snapshot:false});
const save=s=>JSON.parse(JSON.stringify(s.snapshot()));
const advanceToChange=(s,state,limit=500)=>{for(let i=0;i<limit&&s.actor('rf').state===state;i++)step(s);};

test('actual pinned input/consumer bytes and the copied native binary are verified independently',()=>{
  assert.equal(source.commit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  for(const relativePath of ['X2Lib/X2GURaven.cpp','X2Lib/X2GUUser.cpp','X2Lib/X2Game.cpp','X2Lib/X2Game.h','KTDXLIB/KTDIDevice.cpp']){
    const f=source.files.find(f=>f.relativePath===relativePath);assert.ok(f,relativePath);
    const raw=readFileSync(path('.cache/native-source-runtime/'+relativePath));assert.equal(sha(raw),f.sha256);assert.equal(raw.length,f.bytes);
    assert.equal(createHash('sha1').update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex'),f.gitBlob);
  }
  assert.equal(sha(bytes),manifest.modules.commands.sha256);
});

test('original Z/ZZ/ZZX/668Z/668X callbacks retain early press flags after complete release',async()=>{
  const c=await commands();
  for(const chain of chains){
    const a=actor(chain.state,{animationTime:.05,grounded:chain.grounded});
    const early=c.runEvent(a,{pressed:[chain.key]},profile);assert.equal(early.flags,chain.flag,chain.state);assert.equal(early.state,null);
    const released=c.runEvent({...a,sourceCommandFlags:early.flags,animationTime:.1},{released:[chain.key]},profile);
    assert.equal(released.flags,chain.flag,chain.state);assert.equal(released.state,null);
    const next=c.runEvent({...a,sourceCommandFlags:released.flags,animationTime:chain.after+.001},{},profile);
    assert.equal(next.state,chain.next,chain.state);
  }
});

test('fresh taps at each inclusive latch boundary survive; taps beyond finite windows are rejected',async()=>{
  const c=await commands();
  for(const chain of chains.filter(c=>c.until!=null)){
    const at=actor(chain.state,{animationTime:chain.until,grounded:chain.grounded});
    const r=c.runEvent(at,{pressed:[chain.key]},profile);assert.equal(r.flags,chain.flag,chain.state);assert.equal(r.state,null);
    const next=c.runEvent({...at,sourceCommandFlags:r.flags,animationTime:chain.until+.001},{},profile);assert.equal(next.state,chain.next);
    const late=c.runEvent({...at,animationTime:chain.until+.001},{pressed:[chain.key]},profile);
    assert.equal(late.flags,0,chain.state);assert.equal(late.state,null,chain.state);
  }
  const r=c.runEvent(actor('RSI_DASH_JUMP_COMBO_Z',{animationTime:.201,grounded:false}),{pressed:['X']},profile);
  assert.equal(r.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','668Z has no finite input cutoff and may branch on this same late tick');
});

test('Z/ZZ/ZZX/668Z branch thresholds are strict; prelatched 668X uses its distinct inclusive .39 threshold',async()=>{
  const c=await commands();
  for(const chain of chains){
    const a=actor(chain.state,{animationTime:chain.after,sourceCommandFlags:chain.flag,grounded:chain.grounded});
    const at=c.runEvent(a,{},profile);assert.equal(at.state,chain.state==='RRF_DASH_JUMP_COMBO_X'?chain.next:null,chain.state);
    const over=c.runEvent({...a,animationTime:chain.after+.001},{},profile);assert.equal(over.state,chain.next,chain.state);
  }
});

test('native ZZ replaces previous early Z/X selection; 668Z independently retains both flags and gives Z precedence',async()=>{
  const c=await commands(),zz=actor('RSI_COMBO_ZZ',{animationTime:.1});
  let r=c.runEvent(zz,{pressed:['Z']},profile);assert.equal(r.flags,1);
  r=c.runEvent({...zz,sourceCommandFlags:r.flags,animationTime:.15},{pressed:['X']},profile);assert.equal(r.flags,2);
  assert.equal(c.runEvent({...zz,sourceCommandFlags:r.flags,animationTime:.391},{},profile).state,'RSI_COMBO_ZZX');
  r=c.runEvent(zz,{pressed:['X']},profile);r=c.runEvent({...zz,sourceCommandFlags:r.flags},{pressed:['Z']},profile);assert.equal(r.flags,1);
  assert.equal(c.runEvent({...zz,sourceCommandFlags:r.flags,animationTime:.391},{},profile).state,'RSI_COMBO_ZZZ');
  const dz=actor('RSI_DASH_JUMP_COMBO_Z',{animationTime:.1,grounded:false});
  r=c.runEvent(dz,{pressed:['X']},profile);r=c.runEvent({...dz,sourceCommandFlags:r.flags},{pressed:['Z']},profile);assert.equal(r.flags,3);
  assert.equal(c.runEvent({...dz,sourceCommandFlags:r.flags,animationTime:.201},{},profile).state,'RSI_DASH_JUMP_COMBO_ZZ');
});

test('opposite held direction clears ordinary Z/ZZ/ZZX latches exactly as the source callbacks require',async()=>{
  const c=await commands();
  for(const chain of chains.filter(c=>c.grounded)){
    const r=c.runEvent(actor(chain.state,{animationTime:chain.after+.001,sourceCommandFlags:chain.flag}),{held:['LEFT']},profile);
    assert.equal(r.flags,0,chain.state);assert.notEqual(r.state,chain.next,chain.state);
  }
});

test('browser-to-core early down/up taps keep the source latch without needing held attack keys',async()=>{
  for(const chain of chains){
    const {s,a}=await make(chain.state);a.animationTime=.02;
    if(!chain.grounded){a.y=2000;a.grounded=false;a.lineId=null;a.vy=0;}
    const buffer=createInputBuffer();buffer.down(chain.key,1);buffer.up(chain.key,1.001);
    const input=buffer.consume();assert.deepEqual(input.held,[]);assert.deepEqual(input.pressed,[chain.key]);
    step(s,input,.001);assert.equal(a.sourceCommandFlags,chain.flag,chain.state);
    advanceToChange(s,chain.state);assert.equal(a.state,chain.next,chain.state);
  }
});

test('two same-key browser taps in one interval start one attack and latch one followup, without reusing the first edge',async()=>{
  const {s,a}=await make('RSI_WAIT'),buffer=createInputBuffer();buffer.tap('Z',1);buffer.tap('Z',1.002);
  step(s,buffer.consume(),.001);assert.equal(a.state,'RSI_COMBO_Z');assert.equal(a.sourceCommandFlags,0);assert.equal(buffer.pending,2);
  step(s,buffer.consume(),.001);assert.equal(a.sourceCommandFlags,1);assert.equal(buffer.pending,0);
  advanceToChange(s,'RSI_COMBO_Z');assert.equal(a.state,'RSI_COMBO_ZZ');assert.equal(a.sourceCommandFlags,0,'state start clears old flags');
});

test('source input latch is part of the complete snapshot before release and after state change',async()=>{
  const first=await make('RSI_COMBO_ZZ'),second=await make('RSI_COMBO_ZZ');
  step(first.s,{pressed:['X']},.001);assert.equal(first.a.sourceCommandFlags,2);first.s.drainEvents();second.s.restore(save(first.s));
  for(let i=0;i<120;i++){step(first.s);step(second.s);assert.deepEqual(save(first.s),save(second.s));assert.deepEqual(first.s.drainEvents(),second.s.drainEvents());}
});

test('existing source flags survive hitstop, and the current host pending-edge extension retains a released tap',async()=>{
  const {s,a}=await make('RSI_COMBO_ZZ');a.animationTime=.05;step(s,{pressed:['Z']},.001);requestActorStop(a,'hit',.02);
  const buffer=createInputBuffer();buffer.tap('X',1);step(s,buffer.consume(),.01);assert.equal(a.sourceCommandFlags,1);assert.deepEqual(a.pendingPressed,['X']);
  // The source queue deducts this packet before its stop gate: .02 is
  // exhausted by the second .01 packet, whose native callback then resumes.
  step(s,{},.01);assert.equal(a.sourceCommandFlags,2);assert.deepEqual(a.pendingPressed,[]);
  advanceToChange(s,'RSI_COMBO_ZZ');assert.equal(a.state,'RSI_COMBO_ZZX');
  // This delayed edge is a host policy: User.cpp:6767 skips native callbacks
  // while stopped. It is not claimed to be a measured original input queue.
});

test('current host stop-edge merge has same-frame Z priority for distinct rapid ZX/XZ taps; no original-order claim',async()=>{
  for(const keys of [['Z','X'],['X','Z']]){
    const {s,a}=await make('RSI_COMBO_ZZ');a.animationTime=.05;requestActorStop(a,'hit',.02);const b=createInputBuffer();
    for(const key of keys)b.tap(key,1);step(s,b.consume(),.01);assert.deepEqual(a.pendingPressed,keys);
    step(s,{},.01);assert.equal(a.sourceCommandFlags,1,'merged oneZ+oneX follows native else-if Z priority');
  }
});

test('source StateChangeDashIfPossible request is routed to ground Dash during early ZZX double input',async()=>{
  const {s,a}=await make('RSI_COMBO_ZZX');a.animationTime=.1;
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]},.001);
  step(s,{released:['RIGHT']},.001);
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1.1}]},.001);
  assert.equal(a.state,'RSI_DASH');assert.equal(a.unsupported.some(e=>e.id==='state:DASH_REQUEST'),false);
});

test('original SetInputData attack lock filters Z/X before every native combo latch, even on its last locked frame',async()=>{
  for(const [state,key] of [['RSI_COMBO_Z','Z'],['RSI_COMBO_ZZ','X'],['RSI_COMBO_ZZX','X']]){
    const {s,a}=await make(state);a.animationTime=.1;a.canNotAttackTime=.001;
    step(s,{pressed:[key],held:[key]},.001);assert.equal(a.sourceCommandFlags,0,state);assert.equal(a.canNotAttackTime,0);
    step(s,{pressed:[key]},.001);assert.ok(a.sourceCommandFlags>0,state+' fresh edge after lock');
  }
});

test('native pureDouble is held level: a later ZZX callback sees it without generating another DASH edge',async()=>{
  const c=await commands();
  for(const [held,level] of [['RIGHT','pureDoubleRight'],['LEFT','pureDoubleLeft']]){
    const a=actor('RSI_COMBO_ZZX',{animationTime:.1,facing:held==='RIGHT'?1:-1});
    const r=c.runEvent(a,{held:[held],[level]:true},profile);assert.equal(r.state,'DASH_REQUEST');
    const released=c.runEvent(a,{held:[]},profile);assert.equal(released.state,null);
  }
});

test('held double-direction survives state start and full JSON restoration, then clears on release',async()=>{
  const first=await make('RSI_WAIT'),second=await make('RSI_WAIT'),a=first.a;
  step(first.s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1}]},.001);
  step(first.s,{released:['RIGHT']},.001);
  step(first.s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:1.1}]},.001);
  assert.ok(a.doubleHeldDirections?.includes('RIGHT'),'source held-level must be explicitly serialized');
  first.s.enter(a,'RSI_COMBO_ZZX','source-held-double-fixture');a.animationTime=.1;first.s.drainEvents();second.s.restore(save(first.s));
  step(first.s,{held:['RIGHT']},.001);step(second.s,{held:['RIGHT']},.001);assert.equal(a.state,'RSI_DASH');assert.deepEqual(save(first.s),save(second.s));
  step(first.s,{released:['RIGHT']},.001);assert.equal(a.doubleHeldDirections.includes('RIGHT'),false);
  first.s.enter(a,'RSI_COMBO_ZZX','source-released-double-fixture');a.animationTime=.1;step(first.s,{held:['RIGHT']},.001);assert.equal(a.state,'RSI_COMBO_ZZX');
});

test('a double tap released within each browser interval cannot leave pureDouble held for a later single press',async()=>{
  const {s,a}=await make('RSI_WAIT'),buffer=createInputBuffer();buffer.tap('RIGHT',1);buffer.tap('RIGHT',1.1);
  for(let i=0;i<2;i++){const input=buffer.consume();assert.deepEqual(input.held,[]);step(s,input,.001);}
  assert.equal(a.doubleHeldDirections?.includes('RIGHT')??false,false,'the second down/up has already released its persistent level');
  s.enter(a,'RSI_COMBO_ZZX','source-after-release-fixture');a.animationTime=.1;
  step(s,{pressed:['RIGHT'],held:['RIGHT'],edges:[{key:'RIGHT',down:true,time:2}]},.001);
  assert.equal(a.state,'RSI_COMBO_ZZX','one fresh press after the original .4 timeout cannot request Dash');
});
