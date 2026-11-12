import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {choosePickerBranch,applyPickerBranches} from '../../apps/web/skill-picker-state.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings,coreKeyLabel} from '../../packages/input/key-bindings.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const modeGuard=source.match(/^const isPvpMode=.*;$/m)?.[0];
assert.ok(modeGuard,'execute production PvP mode guard');
const handlers=source.slice(source.indexOf('async function selectBranch('),source.indexOf("$('#skills').onclick="));
const blank=()=>Array(8).fill(null);
const definitions=[{id:10,branches:[{id:'left',selectable:true},{id:'right',selectable:true}]},
  {id:11,branches:[{id:'left',selectable:true},{id:'right',selectable:true}]}];
function fixture({fail=false,wait=false}={}){
  const original=[{skillId:10,branchId:'none'},...blank().slice(1)],actor={id:'rf',loadout:structuredClone(original)};
  const elements=new Map([['.skill-picker',{inert:false}],['.picker-message',{textContent:''}]]);
  const saved=[],calls={settled:0,record:0};let resolve;
  const context={structuredClone,loadout:structuredClone(original),branchChoices:{10:'none'},slotPreparation:false,professionId:'RF',professionEpoch:0,professionPreferences:new Map(),
    mode:'practice',currentSession:{role:'gm'},configurationLocked:false,keyBindings:normalizeKeyBindings(),interfaceAudio:null,
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),coreKeyLabel,
    selectedSlot:0,selectedSkillId:10,choosePickerBranch,applyPickerBranches,pickerDefinitions:()=>definitions,
    actorsNow:()=>[actor],baselineSnapshot:{actors:[structuredClone(actor)]},practiceSnapshot:{actors:[structuredClone(actor)]},preset:{skillKeys:['A']},
    $:selector=>elements.get(selector),rebuildSlots(){},rebuildPicker(){},beginRecording(){calls.record++;},
    pickerDialog:{preparationSettled(){calls.settled++;}},
    simulation:{configureLoadout(value){actor.loadout=structuredClone(value);return structuredClone(value);}},
    effectsView:{async prewarm(){}},skillPreferences:{async save(config){
      saved.push(structuredClone(config));if(wait)await new Promise(ok=>{resolve=ok;});
      if(fail)throw Error('Skill setup save failed');return structuredClone(config);
    }}};
  context.professionSwitch=createProfessionSwitch({current:()=>context.professionId,canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  vm.createContext(context);vm.runInContext(modeGuard+'\n'+handlers+'\nthis.select=selectBranch;this.apply=applyLoadout;',context);
  return {context,actor,original,elements,saved,calls,release:()=>resolve()};
}

for(const fail of [false,true])test(`unequipped branch ${fail?'rolls back after save failure':'is saved along with all eight slots'}`,async()=>{
  const f=fixture({fail});await f.context.select(11,'left');
  assert.equal(f.saved.length,1);assert.equal(f.saved[0].branchChoices[11],'left');assert.deepEqual(f.saved[0].loadout,f.original);
  assert.equal(f.context.branchChoices[11],fail?undefined:'left');assert.deepEqual(f.actor.loadout,f.original);
  assert.equal(f.calls.record,fail?0:1);assert.equal(f.context.slotPreparation,false);assert.equal(f.elements.get('.skill-picker').inert,false);
  assert.match(f.elements.get('.picker-message').textContent,fail?/Skill setup save failed/:/Trait saved/);
});

test('picker stays busy until the server save finishes; overlapping branch edits are ignored',async()=>{
  const f=fixture({wait:true}),pending=f.context.select(10,'left');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.context.slotPreparation,true);assert.equal(f.elements.get('.skill-picker').inert,true);
  await f.context.select(11,'right');assert.equal(f.saved.length,1);assert.equal(f.context.branchChoices[11],undefined);
  f.release();await pending;assert.equal(f.context.slotPreparation,false);assert.equal(f.calls.settled,1);
  assert.equal(f.actor.loadout[0].branchId,'left');assert.equal(f.context.baselineSnapshot.actors[0].loadout[0].branchId,'left');
  assert.equal(f.context.practiceSnapshot.actors[0].loadout[0].branchId,'left');
});

test('queue configuration lock rejects branch and loadout edits before changing state or saving',async()=>{
  const f=fixture();f.context.configurationLocked=true;
  await f.context.select(10,'left');await f.context.select(11,'right');
  await f.context.apply([{skillId:11,branchId:'left'},...blank().slice(1)]);
  assert.deepEqual(f.actor.loadout,f.original);assert.deepEqual(f.context.loadout,f.original);
  assert.deepEqual(f.context.branchChoices,{10:'none'});assert.equal(f.context.selectedSkillId,10);
  assert.deepEqual(f.context.baselineSnapshot.actors[0].loadout,f.original);
  assert.deepEqual(f.context.practiceSnapshot.actors[0].loadout,f.original);
  assert.equal(f.saved.length,0);assert.deepEqual(f.calls,{settled:0,record:0});
  assert.equal(f.context.slotPreparation,false);assert.equal(f.elements.get('.skill-picker').inert,false);
});
