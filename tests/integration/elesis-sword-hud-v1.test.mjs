import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {swordHudState,createWayOfSwordHud} from '../../apps/web/way-of-sword-hud.mjs';
import {manaBreakGauge} from '../../apps/web/hud-values.mjs';
import {skillSwordCueState} from '../../apps/web/skill-sword-cues.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../contracts/'+file,import.meta.url)));
const index=read('lk-sword-ui-source-v2.json'),elesisIndex=read('elesis-ui-source-v1.json').sword;
const actor=(id,point,state,charge=0)=>({id:'player',professionId:id,wayOfSword:{point,state},
  wayOfSwordLimits:{vigor:4800,destruction:-4800},sourceElesisBreakCharge:charge,manaBreak:{charge:100,maxCharge:300}});
const element=()=>({style:{},dataset:{},attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;},append(v){this.children.push(v);},remove(){}});
for(const id of ['GM','BH','CA'])test(`${id} uses the separate original annihilation charge layer and gale labels`,()=>{
  const input=actor(id,-2400,-2,1000),before=structuredClone(input),display=swordHudState(input);
  assert.deepEqual(display.pictures,[0,1,2,3,5]);assert.equal(display.flickerPicture,3);
  assert.equal(display.label,'Annihilation active');assert.equal(display.chargeRatio,.5);
  assert.deepEqual(swordHudState(actor(id,-2400,-1)).pictures,[0,1,4]);
  assert.equal(swordHudState(actor(id,4800,2)).label,'Gale active');
  assert.equal(manaBreakGauge(input).charge,0);assert.equal(manaBreakGauge(actor(id,0,0)).charge,100);
  assert.equal(skillSwordCueState(input,{raw:{m_usWOSType:1}}),'red');
  assert.deepEqual(input,before);
});
test('switching from Elesis to Elsword keeps charge, flicker and original bead identities separate',()=>{
  const view=createWayOfSwordHud({document:{createElement:element},host:element(),index,elesisIndex});
  view.update(actor('BH',-1200,-2,1500));view.render(.4);
  const visible=()=>view.element.children.filter(e=>!e.hidden);
  assert.deepEqual(visible().map(e=>e.dataset.piece),['EL_BG','EL_RED','EL_RED_2','EL_EFFECT','EL_RED_FULL']);
  assert.equal(visible()[1].style.clipPath,'inset(0 75% 0 0)');
  assert.equal(visible()[2].style.clipPath,'inset(0 25% 0 0)');
  assert.ok(Math.abs(Number(visible()[3].style.opacity)-1)<1e-6);
  assert.ok(visible().every(e=>e.src.includes('/elesis-way-of-sword/')));
  view.update(actor('LK',-1200,-2));view.render(0);
  assert.deepEqual(visible().map(e=>e.dataset.piece),['EL_BG','EL_RED','EL_EFFECT','EL_RED_FULL']);
  assert.ok(Math.abs(Number(visible()[2].style.opacity)-.1)<1e-6);
  view.update(actor('CA',0,0));assert.deepEqual(visible().map(e=>e.dataset.piece),['EL_BG','EL_GRAY']);
});
