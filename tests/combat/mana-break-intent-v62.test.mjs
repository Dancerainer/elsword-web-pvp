import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleManaBreakIntent,manaBreakIntentHeld,MANA_BREAK_HOLD_SECONDS} from '../../packages/combat-core/mana-break-intent-v62.mjs';
import {createManaBreak,manaBreakEvent} from '../../packages/combat-core/mana-break.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
const actor=()=>({hp:100,mp:300,mpMax:300,buffs:[],manaBreak:createManaBreak()});
const keys=(held=[],released=[],edges=[])=>({held:new Set(held),released:new Set(released),edges});
for(const key of ['Z','X'])test(`${key}: project .5 continuous hold opens Event only, not100-MP break or retrospective charge`,()=>{
 const a=actor();for(let i=0;i<29;i++)assert.equal(sampleManaBreakIntent(a,keys([key]),1/60),false);
 assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,false);
 assert.equal(sampleManaBreakIntent(a,keys([key]),1/60),true);
 assert.equal(a.manaBreak.holdIntent[key.toLowerCase()],MANA_BREAK_HOLD_SECONDS);
 const calls=[],native={evaluate(op,input){calls.push({op,input});return {...a.manaBreak,...input};}};
 manaBreakEvent(native,a,{heldZ:key==='Z',heldX:key==='X'});
 assert.equal(calls[0].input['held'+key],true);assert.equal(a.manaBreak.charge,0);
 assert.equal(a.manaBreak.minimumCharge,100);
});
test('short repeated or alternating taps cannot accumulate an intent',()=>{
 const a=actor();for(let cycle=0;cycle<40;cycle++){
  const key=cycle%2?'Z':'X';for(let n=0;n<10;n++)assert.equal(sampleManaBreakIntent(a,keys([key]),1/60),false);
  assert.equal(sampleManaBreakIntent(a,keys([], [key]),1/60),false);
 }assert.equal(a.manaBreak.charge,0);
});
test('overlapping short Z/X periods keep independent clocks rather than a shared attack-key clock',()=>{
 const a=actor();for(let n=0;n<12;n++)sampleManaBreakIntent(a,keys(['Z']),1/60);
 for(let n=0;n<6;n++)assert.equal(sampleManaBreakIntent(a,keys(['Z','X']),1/60),false);
 assert.equal(sampleManaBreakIntent(a,keys(['X'],['Z']),1/60),false);
 assert.ok(a.manaBreak.holdIntent.x<.13);
});
test('same sampled packet up/down resets its key even when final level and one-lock remain held',()=>{
 const a=actor(),buffer=createSampledKeyboardBuffer();buffer.down('Z',0);
 for(let n=1;n<=40;n++){const input=buffer.consume(n/60);sampleManaBreakIntent(a,keys(input.held,input.released,input.edges),1/60);}
 assert.equal(manaBreakIntentHeld(a,{heldZ:true}).heldZ,true);
 a.manaBreak.charge=42;a.manaBreak.canCharge=true;buffer.up('Z',.668);buffer.down('Z',.669);
 const input=buffer.consume(41/60);assert.deepEqual(input.released,[]);assert.deepEqual(input.held,['Z']);
 assert.equal(sampleManaBreakIntent(a,keys(input.held,input.released,input.edges),1/60),false);
 assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,false);
});
test('repeat down events cannot manufacture a release or postpone a deliberate hold',()=>{
 const a=actor();for(let n=0;n<40;n++)sampleManaBreakIntent(a,keys(['Z'],[],[{key:'Z',down:true}]),1/60);
 assert.equal(manaBreakIntentHeld(a,{heldZ:true}).heldZ,true);
});
test('release clears a previous Event latch before a frozen actor can show a stale bar, preserving reserved cost',()=>{
 const a=actor();a.manaBreak={...a.manaBreak,charge:140,canCharge:true,pendingCost:140,active:true,pendingDown:{state:'RSI_DAMAGE_DOWN_FRONT',vy:0}};
 sampleManaBreakIntent(a,keys([],['Z']),1/60);
 assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,false);
 assert.equal(a.manaBreak.pendingCost,140);assert.equal(a.manaBreak.active,true);
});
test('binary32 JSON replay of an in-flight intent reaches precisely the same eligibility boundary',()=>{
 const a=actor();for(let n=0;n<13;n++)sampleManaBreakIntent(a,keys(['X']),1/60);
 const b=JSON.parse(JSON.stringify(a));for(let n=0;n<30;n++){
  assert.equal(sampleManaBreakIntent(a,keys(['X']),1/60),sampleManaBreakIntent(b,keys(['X']),1/60));
  assert.deepEqual(a.manaBreak,b.manaBreak);
 }
});
test('death drops both clocks; direction/skill keys alone do not qualify',()=>{
 const a=actor();for(let n=0;n<40;n++)sampleManaBreakIntent(a,keys(['Z','X']),1/60);
 a.hp=0;assert.equal(sampleManaBreakIntent(a,keys(['Z','X']),1/60),false);assert.deepEqual(a.manaBreak.holdIntent,{z:0,x:0});
 a.hp=100;for(let n=0;n<120;n++)assert.equal(sampleManaBreakIntent(a,keys(['A','UP']),1/60),false);
});
