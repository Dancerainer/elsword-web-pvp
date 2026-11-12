/** Current simulator -> production HUD wiring. No browser rendering or
 * target-client execution is implied by this headless DOM regression. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {vcFixture,vcProfile,vcPreset} from '../helpers/vc-fixture.mjs';
import {activateVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {createBuffBar} from '../../apps/web/buff-bar.mjs';
import {createAddHud} from '../../apps/web/add-hud.mjs';
import {awakeningCountdown} from '../../apps/web/hud-values.mjs';
const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const renderSource=game.slice(game.indexOf('function updateHud('),game.indexOf('\nfunction renderActor('));
const rosterSource=game.slice(game.indexOf('function actorsNow('),game.indexOf('\nfunction say('));
class Element{
  constructor(){this.children=[];this.dataset={};this.style={};this.classList={toggle(){}};}
  setAttribute(name,value){this[name]=value;}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
}
function hudFixture(simulation){
  const host=new Element();host.ownerDocument={createElement:()=>new Element()};
  const buffBar=createBuffBar({host,profile:vcProfile,profileForBuff:buff=>simulation.profileFor(simulation.actor(buff.sourceActorId))});
  const addHud=createAddHud({document:host.ownerDocument,host:new Element()});
  const nodes={},node=key=>nodes[key]??=new Element();
  const state={simulation,localPlayerId:'vc',profile:vcProfile,preset:vcPreset,profession:{id:'VC',name:'Veteran Commander'},
    authoritativePvp:null,isPvpMode:()=>true,wayOfSwordHud:null,skillSwordCues:null,addHud,
    hud:new Proxy(nodes,{get:(_,key)=>node(key)}),$:node,updateManaGuides(){},beads:[new Element(),new Element(),new Element()],
    wakeGauge:new Element(),nativeRage:new Element(),awakeningCountdown,paused:false,frame:0,skillButtons:[],buffBar,pvpHud:null,mode:'online'};
  vm.createContext(state);vm.runInContext(rosterSource+'\n'+renderSource,state);
  return {state,bar:buffBar.element,render:()=>{state.updateHud(state.actorsNow());assert.equal(addHud.element.hidden,true,'VC does not display Add resources');}};
}
function advance(sim,seconds){for(let i=0;i<seconds*60;i++)sim.step(1/60,{}, {snapshot:false});}

test('actual VC skill input produces a timed icon through game.updateHud, stacks refresh, expiration removes it',()=>{
  const f=vcFixture({gap:2500}),h=hudFixture(f.sim);h.render();assert.equal(h.bar.children[0].children.length,0);
  for(let i=0;i<240&&!f.a.buffs.some(buff=>buff.templateId===250);i++)f.sim.step(1/60,{vc:{pressed:i%2===0?['A']:[]}},{snapshot:false});
  assert.ok(f.sim.state.events.some(event=>event.type==='skillStarted'));
  h.render();const positive=h.bar.children[0],icon=positive.children[0];
  assert.equal(icon.dataset.buffId,'250');assert.equal(icon.children[2].textContent,'16');assert.equal(icon.children[3].textContent,'');
  advance(f.sim,1.25);h.render();assert.equal(positive.children[0],icon);assert.equal(icon.children[2].textContent,'15');
  activateVeteranOverheat(f.sim,f.a);h.render();assert.equal(icon.children[3].textContent,'x2');assert.equal(icon.children[2].textContent,'16');
  advance(f.sim,17);h.render();assert.equal(positive.children.length,0);assert.equal(h.bar.children[1].children.length,0);
});

test('received native burn counts down on row two, roster order cannot swap the local HUD, cleared snapshots remove it',()=>{
  const f=vcFixture({gap:2500}),h=hudFixture(f.sim);
  const factor=vcProfile.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR;
  f.sim.applyHit(f.b,f.a,{REACT_TYPE:0,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:0},BUFF_FACTOR:factor},{kind:'character',skillId:24218});
  activateVeteranOverheat(f.sim,f.b);f.sim.state.actors.reverse();h.render();
  assert.equal(h.bar.children[0].children.length,0,'the other actor buff is never shown in the owner bar');
  const negative=h.bar.children[1],icon=negative.children[0];assert.equal(icon.dataset.buffId,'37');assert.equal(icon.children[2].textContent,'5');
  advance(f.sim,2.1);h.render();assert.equal(icon.children[2].textContent,'3');
  const snapshot=f.sim.snapshot();snapshot.actors.find(actor=>actor.id==='vc').buffs=[];f.sim.restore(snapshot);h.render();
  assert.equal(negative.children.length,0,'snapshot removal is reflected by the production update function');
  h.state.mode='lobby';h.render();assert.equal(h.bar.hidden,true);
});
