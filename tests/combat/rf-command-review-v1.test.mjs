/** Source conditions + real input/pose/map regression, never client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {comboStopFixture,comboStopFrame,comboStopProfile as profile} from '../../tools/combat/rf_combo_stop_v7.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {rfCommandFallbackEvent} from '../../packages/combat-core/rf-command-fallback.mjs';

const cases=[['66ZZ','RSI_DASH_COMBO_ZZ',1.2],['66X','RSI_DASH_COMBO_X',1.1],['XXX','RSI_COMBO_XXX',1]];
async function inputFixture(facing,{hit=false,corner=false}={}){
  const f=await comboStopFixture({facing,hit,corner}),input=createInputBuffer({sampledLevels:true});
  const step=()=>comboStopFrame(f,input.consume(f.s.state.time+1/60));
  const until=(condition,label,max=240)=>{for(let i=0;i<max&&!condition();i++)step();assert.ok(condition(),label+': '+f.a.state+' '+f.a.animationTime);};
  const down=key=>{input.down(key,f.s.state.time+.001);step();};
  const up=key=>{input.up(key,f.s.state.time+.001);step();};
  const tap=key=>{down(key);up(key);};
  const prefix=action=>{
    const forward=facing===1?'RIGHT':'LEFT';
    if(action.startsWith('66')){tap(forward);down(forward);assert.equal(f.a.state,'RSI_DASH');tap(action==='66X'?'X':'Z');up(forward);}
    else tap('X');
    if(action==='66ZZ'){tap('Z');until(()=>f.a.state==='RSI_DASH_COMBO_ZZ','66ZZ prefix');}
    if(action==='XXX'){tap('X');until(()=>f.a.state==='RSI_COMBO_XX','XX prefix');tap('X');until(()=>f.a.state==='RSI_COMBO_XXX','XXX prefix');}
  };
  return {...f,input,step,until,down,up,tap,prefix};
}

test('fixed V5 Raven callbacks retain their independent three held-skip thresholds',()=>{
  const bytes=readFileSync(new URL('../../.cache/native-source-runtime/X2Lib/X2GURaven.cpp',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237');
  const text=bytes.toString('latin1');
  for(const [,state,limit]of cases){
    const start=text.indexOf(`void CX2GURaven::${state}_EventProcess()`),end=text.indexOf('\n}',start)+2,method=text.slice(start,end);
    assert.ok(start>=0&&end>start);assert.ok(method.includes('ELSE_IF_KEY_PRESSED_AT_SKIP_POINT_ZXC'));
    assert.match(method,new RegExp(`GetNowAnimationTime\\(\\) > ${limit===1?'1.0':limit}f`));
    assert.ok(method.includes('StateChange( USI_WAIT )'));assert.equal(profile.states[state].raw.ATTACK_CANCEL_AFTER,limit);
  }
});
for(const [,state,limit]of cases)test(`fixed V5 ${state}: strict binary32 held-key boundary, released tap and unrelated states`,()=>{
  const definition=profile.states[state],a={state,animationTime:limit};
  assert.equal(rfCommandFallbackEvent(a,{held:new Set(['Z'])},definition),null);
  assert.equal(rfCommandFallbackEvent({...a,animationTime:limit+.0001},{held:new Set(['Z'])},definition)?.state,'RSI_WAIT');
  assert.equal(rfCommandFallbackEvent({...a,animationTime:limit+.0001},{held:new Set(),pressed:new Set(['Z'])},definition),null);
  assert.equal(rfCommandFallbackEvent({...a,state:'RSI_SA_MEGA_DRILL',animationTime:limit+.1},{held:new Set(['Z'])},definition),null);
});
for(const [action,state,limit]of cases.filter(([action])=>action!=='XXX'))for(const facing of [-1,1])for(const key of ['Z','X'])
test(`sampled ${action} ${facing} holds ${key} to source skip without waiting for full clip`,async()=>{
  const f=await inputFixture(facing);f.prefix(action);assert.equal(f.a.state,state);
  f.until(()=>f.a.animationTime>limit-.04,'approach source skip');f.down(key);
  for(let i=0;i<4&&f.a.state===state;i++)f.step();
  assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.facing,facing);
  const event=f.s.state.events.findLast(e=>e.type==='stateChanged'&&e.actorId==='rf');
  assert.equal(event.reason,'reference-rf-command-held-skip');
  f.step();assert.equal(f.a.state,'RSI_WAIT','held skip is not a second attack edge');
  f.up(key);f.down('Z');assert.equal(f.a.state,'RSI_COMBO_Z','a new real press can immediately start the next attack');
});

// Target2016 COMMON_CANCEL_TERMINAL_2016: Raven XXX post328978b0 checks
// S/A/B/W/D/T while its main model has not ended. Its T branch uses the
// strict ATTACK_CANCEL_AFTER gate, then held Z6452 -> native124 / X6456 ->133.
// Unlike the separately pinned fixed-V5 callback above, it requests the next
// attack directly; the normal outer apply consumes that pending request.
for(const facing of [-1,1])for(const key of ['Z','X'])
test(`sampled target2016 XXX ${facing} holds ${key} to its direct attack successor`,async()=>{
  const f=await inputFixture(facing);f.prefix('XXX');assert.equal(f.a.state,'RSI_COMBO_XXX');
  f.until(()=>f.a.animationTime>.96,'approach original attack gate');f.down(key);
  assert.equal(f.a.state,'RSI_COMBO_XXX','a held input before the strict gate cannot cancel yet');
  for(let i=0;i<4&&f.a.state==='RSI_COMBO_XXX';i++)f.step();
  const successor=`RSI_COMBO_${key}`;
  assert.equal(f.a.state,successor);assert.equal(f.a.facing,facing);
  const event=f.s.state.events.findLast(e=>e.type==='stateChanged'&&e.actorId==='rf');
  assert.equal(event.reason,`target2016-post-${key.toLowerCase()}`);
  const serial=f.a.stateSerial;
  f.step();assert.equal(f.a.state,successor);
  assert.equal(f.a.stateSerial,serial,'continuing the same hold cannot enter a second attack again');
});

for(const [action,state,limit]of cases)test(`sampled ${action} release before skip does not invent an attack queue`,async()=>{
  const f=await inputFixture(1);f.prefix(action);f.until(()=>f.a.animationTime>limit-.18,'before skip');f.tap('Z');
  f.until(()=>f.a.animationTime>limit+.03,'past skip');assert.equal(f.a.state,state);
  f.until(()=>f.a.state!==state,'natural command end');assert.equal(f.a.state,'RSI_WAIT');
  assert.ok(!f.s.state.events.some(e=>e.reason==='reference-rf-command-held-skip'));
});

test('successful skill input keeps its own state and is not replaced by held command skip',async()=>{
  const f=await inputFixture(1);f.prefix('66X');f.until(()=>f.a.animationTime>1.1,'skill cancel point');
  const slot=f.a.loadout.findIndex(entry=>entry?.skillId===24217);
  assert.ok(slot>=0,'production loadout contains Shadow Step');
  f.down(['A','S','D','C','Q','W','E','R'][slot]);
  assert.equal(f.a.skillId,24217);assert.equal(f.a.state,'RSI_SI_A_RF_SHADOW_STEP');
  assert.ok(f.s.state.events.some(e=>e.type==='skillStarted'&&e.skillId===24217));
});

test('source skip and fresh reattack remain identical after complete JSON restoration',async()=>{
  const f=await inputFixture(-1),g=await inputFixture(-1);f.prefix('66X');f.until(()=>f.a.animationTime>1,'restore near skip');
  f.s.drainEvents();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<90;i++){
    const packet={sampledDevice:true,held:i<9?['Z']:[],pressed:i===0||i===15?['Z']:[],released:i===9?['Z']:[]};
    comboStopFrame(f,packet);comboStopFrame(g,packet);
    assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),JSON.parse(JSON.stringify(g.s.snapshot())));
  }
});

for(const facing of [-1,1])test(`real Garpai edge ${facing}: 66X both stages hit, held skip, next Z really hits`,async()=>{
  const f=await inputFixture(facing,{hit:true,corner:true});f.prefix('66X');
  f.until(()=>f.a.animationTime>1.07,'past both direct hit windows');f.down('Z');
  f.until(()=>f.a.state==='RSI_WAIT','held skip');const skipTime=f.s.state.time;
  f.up('Z');f.tap('Z');for(let i=0;i<90;i++)f.step();
  const events=f.s.state.events,hits=events.filter(e=>e.type==='hit'&&e.actorId==='rf');
  assert.equal(hits.filter(e=>e.origin.kind==='character'&&e.origin.state==='RSI_DASH_COMBO_X').length,2);
  const nextEffect=events.find(e=>e.type==='effectStarted'&&e.time>skipTime&&e.name==='DamageEffect_RF_COMBO_Z');
  assert.ok(nextEffect,'next Z used its real original weapon-dummy effect');
  assert.ok(hits.some(e=>e.origin.kind==='effect'&&e.origin.id===nextEffect.effectId&&e.amount>0));
  assert.equal(f.a.facing,facing);assert.equal(f.a.state,'RSI_WAIT');
});
