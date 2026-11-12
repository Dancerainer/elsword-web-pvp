import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createManaBreakRenderClock,manaBreakGuidePositions,updateManaBreakBar} from '../../apps/web/mana-break-hud.mjs';
import {createInputStepClock} from '../../apps/web/input-step-clock.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const root=new URL('../../',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,root)));
const manifest=read('artifacts/native/manifest.json'),native=await createNativeRuntime({manifest,
  map:read('artifacts/scene/sander-garpai-rock-pvp/collision.json'),loadBinary:file=>readFileSync(new URL('artifacts/native/'+file,root))});
const actor=(charge,id='rf')=>({id,manaBreak:{charge,maxCharge:300}});

for(const hz of [30,60,80,120,144])test(`green display follows completed 60Hz charge packets at ${hz}Hz without an 80ms HUD gate`,()=>{
  const packet=createInputStepClock(),display=createManaBreakRenderClock();
  let a=actor(0),previousShown=0,distinct=0;display.reset(a);packet.rebase(0);
  for(let frame=1;frame<=hz;frame++){
    const step=packet.advance(frame/hz);
    for(const cutoff of step.cutoffs){a=actor(Math.fround(Math.min(300,a.manaBreak.charge+Math.fround(130*Math.fround(1/60)))));display.push(a);}
    const before=structuredClone(a),shown=display.sample(a,step.alpha);
    assert.ok(shown.charge>=previousShown);assert.ok(shown.charge<=a.manaBreak.charge);
    assert.ok(a.manaBreak.charge-shown.charge<=130/60+.001);assert.deepEqual(a,before);
    if(shown.charge!==previousShown)distinct++;previousShown=shown.charge;
  }
  assert.ok(distinct>=hz-2,`${distinct} redraws / ${hz}`);
});
test('release, spending, MP clamp, actor replacement and reset snap to authoritative state',()=>{
  const display=createManaBreakRenderClock();display.reset(actor(128));display.push(actor(130));
  assert.equal(display.sample(actor(130),.5).charge,129);
  display.push(actor(0));assert.equal(display.sample(actor(0),0).charge,0);
  display.reset(actor(180));display.push(actor(70));assert.equal(display.sample(actor(70),0).charge,70);
  display.reset(actor(10));display.push(actor(12));assert.equal(display.sample(actor(100,'target'),0).charge,100);
  assert.equal(display.sample(actor(12),0,{exact:true}).charge,12);
  display.reset(actor(155));assert.equal(display.sample(actor(155),0).charge,155);
  for(const alpha of [-1,2,NaN])assert.throws(()=>display.sample(actor(155),alpha),RangeError);
});
test('DOM paints interpolated width while accessibility reports actual charge; unchanged samples do not write DOM',()=>{
  let writes=0;const attrs=new Map(),style={};let hidden=true;
  const element={style,get hidden(){return hidden;},set hidden(v){hidden=v;writes++;},getAttribute:k=>attrs.get(k),setAttribute(k,v){attrs.set(k,v);writes++;}};
  updateManaBreakBar(element,{charge:99,fraction:99/300,maximum:300},{authoritativeCharge:101});
  assert.equal(style.width,`${224*99/300}px`);assert.equal(hidden,false);assert.equal(attrs.get('aria-valuenow'),'101');
  const before=writes;updateManaBreakBar(element,{charge:99,fraction:99/300,maximum:300},{authoritativeCharge:101});assert.equal(writes,before);
  updateManaBreakBar(element,{charge:0,fraction:0,maximum:300});assert.equal(hidden,true);assert.equal(style.width,'0px');
});
test('MP guides use original two-pixel texture and literal 2016 NEW positions with original max-MP offsets',()=>{
  assert.deepEqual(manaBreakGuidePositions(300),[{mp:100,left:176,top:53},{mp:200,left:250,top:53}]);
  const expanded=manaBreakGuidePositions(400);
  assert.equal(expanded[0].left,157.33333587646484);assert.equal(expanded[1].left,212.6666717529297);
  assert.equal(manaBreakGuidePositions(100).length,0);assert.deepEqual(manaBreakGuidePositions(NaN),[]);
  const ui=read('artifacts/ui/manifest.json').pieces.MP_100_BAR;
  assert.equal(ui.width,2);assert.equal(ui.height,12);
  assert.equal(createHash('sha256').update(readFileSync(new URL('artifacts/ui/mp_100_bar.png',root))).digest('hex'),ui.sha256);
});
test('independent declared-rate expectation: compiled gauge reaches 100MP on charge packet47 and 300MP on139',()=>{
  let charge=0,first100=0,first300=0;
  for(let frame=1;frame<=150;frame++){
    charge=native.manaBreak.evaluate('frame',{mp:300,charge,canCharge:true,elapsed:1/60,chargeRate:130}).charge;
    if(charge>=100&&!first100)first100=frame;if(charge>=300&&!first300)first300=frame;
  }
  assert.equal(first100,47);assert.equal(first300,139);assert.equal(charge,300);
  assert.equal(native.manaBreak.evaluate('frame',{mp:300,charge:0,canCharge:true,elapsed:1,chargeRate:130}).charge,130);
  assert.equal(native.manaBreak.evaluate('frame',{mp:80,charge:0,canCharge:true,elapsed:1,chargeRate:130}).charge,80);
  assert.equal(native.manaBreak.evaluate('frame',{mp:300,charge:130,canCharge:false,elapsed:1,chargeRate:130}).charge,0);
});
