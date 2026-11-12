import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSkillAvailability} from '../../packages/combat-core/skill-availability.mjs';
import {createSkillSlot,updateSkillSlotAvailability} from '../../apps/web/skill-slot.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};

class Element {
  constructor(){this.children=[];this.dataset={};this.attributes={};this.className='';this.classList={
    add:name=>{this.className+=' '+name;},toggle:(name,on)=>{const names=new Set(this.className.split(' '));
      if(on)names.add(name);else names.delete(name);this.className=[...names].join(' ');}};}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  querySelector(selector){return this.children.find(child=>child.className===selector.slice(1));}
}
const document={createElement:()=>new Element()};
const actorFor=(extra={})=>({hp:100,mp:150,state:'RSI_WAIT',grounded:true,animationTime:0,
  loadout:[{skillId:24027,branchId:'none'},...Array(7).fill(null)],cooldowns:{},...extra});
const query=actor=>evaluateSkillAvailability({actor,profile,preset,slot:'A'});
const render=availability=>{const element=createSkillSlot(document,{key:'A',slot:{skillId:24027},definition:null});
  updateSkillSlotAvailability(element,availability);return element;};

const locks=[['jump',{state:'RSI_JUMP_UP',grounded:false},'state-or-ground-condition',150],
  ['combo',{state:'RSI_COMBO_Z'},'state-or-ground-condition',150],
  ['knockdown',{state:'RSI_DAMAGE_DOWN_FRONT'},'state-or-ground-condition',150],
  ['input lock',{inputLock:1},'input-blocked',null],['stun',{buffControls:{inputBlock:true}},'input-blocked',null],
  ['hitstop',{hitStop:1},'time-stopped',null],['world stop',{worldStop:1},'time-stopped',null],['dead',{hp:0},'dead',null]];
for(const [name,lock,reason,mpCost] of locks)test(`${name} keeps color unless independent MP/CD fail; core rejection remains ${reason}`,()=>{
  for(const [mp,cd,display,text] of [[150,0,'normal',''],[149,0,'insufficient-mp',''],
    [150,.01,'cooldown','1'],[149,1.01,'insufficient-mp','2']]){
    const actor=actorFor({...lock,mp,cooldowns:{24027:cd}}),before=structuredClone(actor),availability=query(actor),element=render(availability);
    assert.equal(availability.available,false);assert.equal(availability.reason,reason);assert.equal(availability.mpCost,mpCost);
    assert.equal(availability.cooldownRemaining,cd);assert.equal(availability.mode,'cast');
    assert.equal(availability.resourceMpInsufficient,mp<150);assert.equal(availability.resourceCooldownRemaining,cd);
    assert.equal(element.dataset.displayAvailability,display);assert.equal(element.className.includes('unavailable'),display!=='normal');
    assert.equal(element.querySelector('.cooldown').textContent,text);assert.equal(element.attributes['aria-disabled'],'true');
    assert.deepEqual(actor,before,'pure resource observation does not mutate combat state');
  }
});

test('trait price and MP equality use the same policy; other rejection reasons do not take display priority',()=>{
  const actor=actorFor({inputLock:1,mp:120,loadout:[{skillId:24027,branchId:'memo-21'},...Array(7).fill(null)]});
  assert.equal(query(actor).reason,'input-blocked');assert.equal(query(actor).mpCost,null);
  assert.equal(query(actor).resourceMpInsufficient,false);assert.equal(render(query(actor)).dataset.displayAvailability,'normal');
  actor.mp=119.999;assert.equal(query(actor).resourceMpInsufficient,true);
  actor.inputLock=0;const available=query(actor);assert.equal(available.reason,'insufficient-mp');assert.equal(available.mpCost,120);
  actor.mp=120;assert.equal(query(actor).available,true);assert.equal(query(actor).cooldown,10);
});

test('paid Shadow return has zero independent MP/CD even under input lock; a used return restores ordinary resources',()=>{
  const actor=actorFor({mp:0,state:'RSI_SI_A_RF_SHADOW_STEP',skillId:24217,loadout:[{skillId:24217,branchId:'none'},...Array(7).fill(null)],
    cooldowns:{24217:7},sourceShadowStep:{skillId:24217,key:'A',returnUsed:false}});
  const paid=query(actor);assert.equal(paid.available,true);assert.equal(paid.mode,'shadow-return');assert.equal(paid.mpCost,0);
  assert.equal(paid.cooldownRemaining,7);assert.equal(paid.resourceMpInsufficient,false);assert.equal(paid.resourceCooldownRemaining,0);
  assert.equal(render(paid).dataset.displayAvailability,'normal');assert.equal(render(paid).querySelector('.cooldown').textContent,'');
  actor.inputLock=1;const blocked=query(actor);assert.equal(blocked.available,false);assert.equal(blocked.reason,'input-blocked');
  assert.equal(blocked.mpCost,null);assert.equal(blocked.mode,'cast');assert.equal(render(blocked).dataset.displayAvailability,'normal');
  assert.equal(render(blocked).querySelector('.cooldown').textContent,'');
  actor.sourceShadowStep.returnUsed=true;const used=query(actor);assert.equal(used.reason,'input-blocked');
  assert.equal(used.resourceMpInsufficient,true);assert.equal(used.resourceCooldownRemaining,7);
  assert.equal(render(used).dataset.displayAvailability,'insufficient-mp');assert.equal(render(used).querySelector('.cooldown').textContent,'7');
});

test('legacy state gray metadata is ignored by the HUD; malformed traits keep the previous error ordering',()=>{
  const actor=actorFor({state:'RSI_COMBO_Z'}),availability=query(actor);
  assert.equal(availability.displayUnavailable,true);assert.equal(render(availability).dataset.displayAvailability,'normal');
  actor.loadout[0].branchId='forged';actor.inputLock=1;
  assert.equal(query(actor).reason,'input-blocked','invalid pricing must not bypass the earlier lock rejection');
  actor.inputLock=0;assert.throws(()=>query(actor),/Unknown trait/);
});
