/** Execute the production async handlers; inject a real resource-load failure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {editPickerLoadout} from '../../apps/web/skill-picker.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings,coreKeyLabel} from '../../packages/input/key-bindings.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('async function pickerEdit('),source.indexOf("$('#skills').onclick="));

for(const failure of ['prewarm','configure','save'])test(`failed ${failure} preserves slot selection, equipment and visible controls`,async()=>{
  const original=[{skillId:10,branchId:'none'},...Array(7).fill(null)],actor={id:'rf',loadout:structuredClone(original)};
  const definition=id=>({id,name:'Example',type:6,maxLevel:1,branches:[]});
  const elements=new Map([['.skill-picker',{inert:false}],['.picker-message',{textContent:''}]]);
  const context={structuredClone,loadout:structuredClone(original),selectedSlot:0,selectedSkillId:10,slotPreparation:false,professionId:'RF',professionEpoch:0,professionPreferences:new Map(),
    mode:'practice',isPvpMode:()=>false,currentSession:{role:'gm'},configurationLocked:false,keyBindings:normalizeKeyBindings(),
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),coreKeyLabel,
    branchChoices:{},skillCatalog:{skills:[definition(10),definition(11)]},supportFor:()=>({supported:true}),
    pickerDialog:{preparationSettled(){}},
    editPickerLoadout,actorsNow:()=>[actor],baselineSnapshot:{actors:[structuredClone(actor)]},practiceSnapshot:{actors:[structuredClone(actor)]},
    preset:{skillKeys:['A','S','D','C','Q','W','E','R']},beginRecording:()=>assert.fail('failed edits cannot change recording baseline'),
    $:selector=>elements.get(selector),rebuildSlots(){context.visibleLoadout=structuredClone(context.loadout);},
    rebuildPicker(){context.visibleSelection={slot:context.selectedSlot,skill:context.selectedSkillId};},
    simulation:{configureLoadout(next){
      if(failure==='configure'&&next[4]?.skillId===11)throw Error('resource/config failure');
      actor.loadout=structuredClone(next);return structuredClone(next);
    }},effectsView:{async prewarm(){if(failure==='prewarm')throw Error('resource/config failure');}},
    skillPreferences:{async save(){throw Error('resource/config failure');}},
  };
  context.professionSwitch=createProfessionSwitch({current:()=>context.professionId,canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  vm.createContext(context);vm.runInContext(handlers+'\nthis.runEdit=pickerEdit;',context);
  assert.equal(await context.runEdit({type:'equip',skillId:11,target:4}),false);
  assert.deepEqual(actor.loadout,original);assert.deepEqual(context.loadout,original);
  assert.deepEqual(context.practiceSnapshot.actors[0].loadout,original);
  assert.equal(context.selectedSlot,0);assert.equal(context.selectedSkillId,10);
  assert.deepEqual(context.visibleSelection,{slot:0,skill:10});assert.deepEqual(context.visibleLoadout,original);
  assert.equal(context.slotPreparation,false);assert.equal(elements.get('.skill-picker').inert,false);
  assert.match(elements.get('.picker-message').textContent,/resource\/config failure/);
});
