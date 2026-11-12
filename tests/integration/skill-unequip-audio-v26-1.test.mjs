import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {editPickerLoadout} from '../../apps/web/skill-picker.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function pickerEdit('),source.indexOf('async function quickEquipSkill('));

test('unequip sound waits for a successful current-owner save, with failed, locked, battle and empty removals silent',async()=>{
 for(const scenario of ['saved','failed','locked','battle','superseded','empty']){
  const sounds=[],message={textContent:''};let release;
  const pending=new Promise(resolve=>release=resolve);
  const context={loadout:[scenario==='empty'?null:{skillId:10},...Array(7).fill(null)],slotPreparation:false,configurationLocked:scenario==='locked',isPvpMode:()=>scenario==='battle',professionEpoch:0,selectedSlot:0,selectedSkillId:10,branchChoices:{},skillCatalog:{skills:[{id:10,type:6,maxLevel:1}]},supportFor:()=>({supported:true}),editPickerLoadout,applyLoadout:()=>pending,interfaceAudio:{play:key=>sounds.push(key)},rebuildPicker(){},$:()=>message};
  vm.createContext(context);vm.runInContext(handler+'\nthis.runEdit=pickerEdit;',context);
  const operation=context.runEdit({type:'remove',target:0});assert.deepEqual(sounds,[],scenario+' before save');
  if(scenario==='superseded')context.professionEpoch++;
  release(scenario!=='failed');await operation;
  assert.deepEqual(sounds,scenario==='saved'?['skillUnequip']:[],scenario);
 }
});
