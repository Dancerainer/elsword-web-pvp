import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLobbyModePreference,availableLobbyMode} from '../../apps/web/lobby-mode-preference.mjs';
import {KEYBOARD_MAIN_ROWS,KEYBOARD_NAV_ROWS,KEYBOARD_NUMPAD} from '../../apps/web/keyboard-layout.mjs';
import {withAddResourceNumberStyles,emitAddResourceRecoveryNumbers} from '../../apps/web/damage-number-layout.mjs';

test('match choice survives lobby recreation, remains account-scoped and follows enabled modes cyclically',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const choice=createLobbyModePreference({storage,username:'first'});assert.equal(choice.read(),'2v2');choice.save('1v1');
  assert.equal(createLobbyModePreference({storage,username:'first'}).read(),'1v1');
  assert.equal(createLobbyModePreference({storage,username:'second'}).read(),'2v2');
  assert.equal(availableLobbyMode('1v1',{'1v1':false}),'2v2');
  assert.equal(availableLobbyMode('2v2',{'2v2':false}),'3v3');
  assert.equal(availableLobbyMode('3v3',{'3v3':false}),'1v1');
  const maps=[{enabled:true,modes:['3v3']},{enabled:false,modes:['1v1','2v2']}];
  assert.equal(availableLobbyMode('1v1',{},maps),'3v3');
  choice.save('invalid');assert.equal(choice.read(),'1v1');
  const inaccessible=createLobbyModePreference({storage:{getItem(){throw Error('privacy');},setItem(){throw Error('quota');}}});
  assert.equal(inaccessible.read(),'2v2');assert.doesNotThrow(()=>inaccessible.save('1v1'));
});

test('complete physical keyboard contains 104 unique keys, navigation and independent numeric keypad',()=>{
  const keys=[...KEYBOARD_MAIN_ROWS.flat(),...KEYBOARD_NAV_ROWS.flat(),...KEYBOARD_NUMPAD].map(k=>k.code).filter(Boolean);
  assert.equal(keys.length,104);assert.equal(new Set(keys).size,104);
  for(const code of ['Backquote','Backslash','MetaLeft','MetaRight','ContextMenu','ArrowUp','Delete','NumpadEnter','Numpad0'])assert.ok(keys.includes(code));
  for(let i=1;i<=12;i++)assert.ok(keys.includes('F'+i));
});

test('Add recovery numbers use actual amounts and recipient anchors, MP blue and DP red with the original D glyph',()=>{
  const original=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url))),
    manifest=withAddResourceNumberStyles(original),emitted=[],runtime={particles:new Map(),emitParticle(name,fields){emitted.push({name,...fields});return true;}};
  assert.equal(original.styles.dp,undefined);assert.equal(manifest.styles.dp.template,original.styles.red.template);
  for(const type of ['addFantasyTracerMpRecovered','addStasisMpRecovered','addOverlimitResourceRecovered','addMutationMpRecovered','addMindControlRefund']){
    emitted.length=0;const event={type,resource:'MP',amount:3.7,declaredAmount:99,position:[100,500,4]};
    assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,event),4);
    assert.equal(emitted.map(p=>p.digit).join(''),'MP+3');assert.ok(emitted.every(p=>p.style==='mp'&&p.position[1]===500));
    assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,{...event,amount:0}),0);
  }
  emitted.length=0;
  assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,{type:'addOverlimitResourceRecovered',resource:'DP',amount:5,rawAmount:100,position:[100,500,4]}),4);
  assert.equal(emitted.map(p=>p.digit).join(''),'DP+5');assert.ok(emitted.every(p=>p.style==='dp'&&p.position[1]===500));
  for(const event of [{type:'damage',resource:'DP',amount:5,position:[0,0,0]},
    {type:'addMindControlRefund',resource:'DP',amount:0,position:[0,0,0]},
    {type:'addMindControlRefund',resource:'DP',amount:5,position:[0,NaN,0]}])assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,event),0);
});
