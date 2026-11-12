import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPickerDialogController} from '../../apps/web/skill-picker-dialog.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings,coreKeyLabel} from '../../packages/input/key-bindings.mjs';

// Use the platform DOM-standard EventTarget dispatch (including cancellation
// and stopImmediatePropagation), not direct calls to keyboard callbacks. This
// headless check does not claim browser layout/focus/GPU validation.
const keyEvent=(type,{repeat=false}={})=>{
  const event=new Event(type,{cancelable:true});
  Object.defineProperties(event,{code:{value:'Escape'},key:{value:'Escape'},repeat:{value:repeat}});return event;
};
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const setup=source.slice(source.indexOf('const pickerDialog='),source.indexOf("$('.picker-tree-scroll').addEventListener"));
function fixture({pausedBefore=false,preparing=false}={}){
  const keyboardTarget=new EventTarget(),closeButton=new EventTarget(),picker={hidden:false},inputBuffer=createInputBuffer();
  const calls={hide:0,cancel:0,reset:0,focus:0,downstream:0};
  const context={window:keyboardTarget,document:{},pickerTooltip:{hide(){calls.hide++;}},
    cancelPickerDrag(){calls.cancel++;},createPickerDialogController,inputBuffer,performance:{now:()=>1000},
    slotPreparation:preparing,paused:true,pickerWasPaused:pausedBefore,professionId:'RF',professionPreferences:new Map(),
    mode:'practice',currentSession:{role:'gm'},configurationLocked:false,keyBindings:normalizeKeyBindings(),
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),coreKeyLabel,practiceSnapshot:null,
    resetDisplayClock(){calls.reset++;},canvas:{focus(){calls.focus++;}},$:selector=>selector==='.skill-picker'?picker:closeButton};
  context.professionSwitch=createProfessionSwitch({current:()=>context.professionId,canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  vm.createContext(context);vm.runInContext(setup+'\nthis.dialog=pickerDialog;',context);
  keyboardTarget.addEventListener('keydown',()=>calls.downstream++);
  keyboardTarget.addEventListener('keyup',()=>calls.downstream++);
  return {keyboardTarget,closeButton,picker,inputBuffer,calls,context};
}

for(const pausedBefore of [false,true])test(`Escape uses the production close path and restores previous pause=${pausedBefore}`,()=>{
  const f=fixture({pausedBefore});f.context.keyTranslator.down('ArrowRight');f.inputBuffer.down('RIGHT',.1);f.inputBuffer.consume();
  const event=keyEvent('keydown');assert.equal(f.keyboardTarget.dispatchEvent(event),false);
  assert.equal(f.picker.hidden,true);assert.equal(f.context.paused,pausedBefore);
  assert.deepEqual(f.calls,{hide:1,cancel:1,reset:1,focus:1,downstream:0});
  const input=f.inputBuffer.consume();assert.deepEqual(input.held,[]);assert.deepEqual(input.released,['RIGHT']);
  assert.equal(f.keyboardTarget.dispatchEvent(keyEvent('keydown',{repeat:true})),false);
  assert.equal(f.keyboardTarget.dispatchEvent(keyEvent('keyup')),false);assert.equal(f.calls.downstream,0);
  assert.equal(f.keyboardTarget.dispatchEvent(keyEvent('keydown')),true,'closed dialog leaves a fresh Escape to its normal surface');
  assert.equal(f.calls.downstream,1);assert.equal(f.calls.hide,1);f.context.dialog.destroy();
});

test('close button and Escape share cleanup; repeated open listeners are not added',()=>{
  const f=fixture();f.closeButton.dispatchEvent(new Event('click'));assert.equal(f.picker.hidden,true);
  f.picker.hidden=false;f.context.paused=true;f.keyboardTarget.dispatchEvent(keyEvent('keydown'));
  assert.equal(f.calls.hide,2);assert.equal(f.calls.cancel,2);assert.equal(f.calls.downstream,0);
  f.context.dialog.destroy();f.picker.hidden=false;f.keyboardTarget.dispatchEvent(keyEvent('keydown'));
  assert.equal(f.calls.hide,2);assert.equal(f.calls.downstream,1);
});

const applyHandlers=source.slice(source.indexOf('async function applyLoadout('),source.indexOf("$('#skills').onclick="));
for(const fail of [false,true])test(`Escape waits for the production async ${fail?'rollback':'save'} before resuming`,async()=>{
  const f=fixture(),original=[{skillId:10},...Array(7).fill(null)],next=[{skillId:11},...Array(7).fill(null)];
  const actor={id:'rf',loadout:structuredClone(original)};let resolve,reject,recordings=0;
  Object.assign(f.context,{structuredClone,loadout:structuredClone(original),selectedSlot:0,branchChoices:{},
    skillPreferences:{async save(value){return structuredClone(value);}},
    baselineSnapshot:{actors:[structuredClone(actor)]},practiceSnapshot:{actors:[structuredClone(actor)]},actorsNow:()=>[actor],preset:{skillKeys:['A']},
    simulation:{configureLoadout(value){actor.loadout=structuredClone(value);return structuredClone(value);}},
    effectsView:{prewarm(){return new Promise((ok,bad)=>{resolve=ok;reject=bad;});}},
    beginRecording(){recordings++;},rebuildSlots(){},rebuildPicker(){}});
  vm.runInContext(applyHandlers+'\nthis.apply=applyLoadout;',f.context);
  const pending=f.context.apply(next);assert.equal(f.context.slotPreparation,true);assert.equal(f.picker.inert,true);
  f.keyboardTarget.dispatchEvent(keyEvent('keydown'));f.keyboardTarget.dispatchEvent(keyEvent('keyup'));
  assert.equal(f.picker.hidden,false);assert.equal(f.context.paused,true);assert.equal(f.calls.hide,0);
  if(fail)reject(Error('prewarm failure'));else resolve();
  assert.equal(await pending,!fail);assert.equal(f.context.slotPreparation,false);assert.equal(f.picker.inert,false);
  assert.deepEqual(actor.loadout,fail?original:next);assert.deepEqual(f.context.loadout,fail?original:next);
  assert.deepEqual(f.context.baselineSnapshot.actors[0].loadout,fail?original:next);assert.equal(recordings,fail?0:1);
  assert.deepEqual(f.context.practiceSnapshot.actors[0].loadout,fail?original:next);
  assert.equal(f.picker.hidden,true);assert.equal(f.context.paused,false);assert.equal(f.calls.hide,1);
  f.context.dialog.preparationSettled();assert.equal(f.calls.hide,1);f.context.dialog.destroy();
});

test('focus loss clears a suppressed Escape hold',()=>{
  const f=fixture();f.keyboardTarget.dispatchEvent(keyEvent('keydown'));f.keyboardTarget.dispatchEvent(new Event('blur'));
  assert.equal(f.keyboardTarget.dispatchEvent(keyEvent('keydown')),true);assert.equal(f.calls.downstream,1);f.context.dialog.destroy();
});
