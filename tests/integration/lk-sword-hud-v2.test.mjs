import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {swordHudState,createWayOfSwordHud,createSwordHudFlicker} from '../../apps/web/way-of-sword-hud.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/lk-sword-ui-source-v2.json',import.meta.url)));
const actor=(point,state)=>({id:'player',professionId:'LK',wayOfSword:{point,state},wayOfSwordLimits:{vigor:4800,destruction:-4800}});

test('fixed UI switch: neutral, charging and active use the original picture indices',()=>{
  for(const [state,point,pictures] of [[0,0,[0,5]],[1,1200,[0,1,3]],[-1,-2400,[0,1,3]],[2,4800,[0,1,2,4]],[-2,-4800,[0,1,2,4]]]){
    const input=actor(point,state),before=structuredClone(input),view=swordHudState(input);
    assert.deepEqual(view.pictures,pictures);assert.equal(view.ratio,Math.abs(point/4800));
    assert.equal(view.side,state<0?'red':'blue');assert.deepEqual(input,before);
  }
});
test('consuming an active gauge preserves active presentation until authoritative state changes',()=>{
  assert.equal(swordHudState(actor(400,2)).active,true);
  assert.equal(swordHudState(actor(-200,-2)).active,true);
  assert.equal(swordHudState(actor(0,0)).active,false);
  assert.equal(swordHudState({...actor(4800,2),professionId:'RF'}).visible,false);
  assert.equal(swordHudState({...actor(4800,2),wayOfSwordLimits:null}).visible,false);
  assert.equal(swordHudState(actor(NaN,2)).visible,false);
});
function element(){return {style:{},dataset:{},attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;},append(v){this.children.push(v);},remove(){this.removed=true;}};}
test('DOM state changes remove the previous color, crop pixels, hide RF and reset on restored state',()=>{
  const host=element(),view=createWayOfSwordHud({document:{createElement:element},host,index});
  view.update(actor(2400,1));
  assert.equal(view.element.attributes['aria-valuenow'],'50');
  let visible=view.element.children.filter(e=>!e.hidden);
  assert.deepEqual(visible.map(e=>e.dataset.piece),['EL_BG','EL_BLUE','EL_BLUE_NORMAL']);
  assert.equal(visible[1].style.clipPath,'inset(0 50% 0 0)');
  view.update(actor(-1200,-2));view.render(.4);
  visible=view.element.children.filter(e=>!e.hidden);
  assert.deepEqual(visible.map(e=>e.dataset.piece),['EL_BG','EL_RED','EL_EFFECT','EL_RED_FULL']);
  assert.ok(Math.abs(Number(visible[2].style.opacity)-1)<1e-6);
  assert.equal(visible[1].style.clipPath,'inset(0 75% 0 0)');
  view.update(actor(0,0));assert.deepEqual(view.element.children.filter(e=>!e.hidden).map(e=>e.dataset.piece),['EL_BG','EL_GRAY']);
  view.update({professionId:'RF'});assert.equal(view.element.hidden,true);
  view.update(actor(4800,2));view.render(0);assert.equal(view.element.hidden,false);
  assert.ok(Math.abs(Number(view.element.children.find(e=>e.dataset.piece==='EL_EFFECT').style.opacity)-.1)<1e-6);
  view.dispose();assert.equal(view.element.removed,true);
});
test('original flicker starts at min alpha and turns only beyond the strict time bound',()=>{
  const flicker=createSwordHudFlicker();
  assert.ok(Math.abs(flicker.step(0)-.1)<1e-6);
  assert.ok(Math.abs(flicker.step(.4)-1)<1e-6);
  assert.ok(flicker.step(.01)>1);
  assert.ok(Math.abs(flicker.step(.41)-.1)<1e-6);
  assert.ok(flicker.step(.01)<.1);
  assert.ok(Math.abs(flicker.step(.01)-.1)<1e-6);
  assert.throws(()=>flicker.step(NaN),RangeError);
});
