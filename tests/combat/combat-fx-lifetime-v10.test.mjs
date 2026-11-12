/** Literal fixed-V5 LT_TIME consumer equations and target declaration routing.
 * This is a phase regression, not an original-client trace or hit-result gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),index=read('contracts/rf-fx-index.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const template=index.templates.RRF_DASHJUMP_X,entry=profile.effectSets.EffectSet_RRF_DashJumpX.raw.EFFECT0;
const pins={
  'X2Lib/X2Data.cpp':'cc8543f0d18ef5962a83e5459d19d25643e8ebd93a8f31f3d4b7f5cdec541f05',
  'X2Lib/X2Game.cpp':'7f7660945348ea32516f61339af0262517ed940471b5104919010cdce21f6ff4',
  'X2Lib/X2DamageEffect.cpp':'8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8',
  'KTDXLIB/KTDGXMeshPlayer.cpp':'0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d',
};
function source(path){const bytes=readFileSync(new URL('../../.cache/native-source-runtime/'+path,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pins[path]);return bytes.toString('latin1');}
function make(){
  // Load the shipped profile unchanged: fixture injection used to hide the
  // missing command FX closure and could pass while live 668XX never expired.
  const s=createSimulation({profile,map,preset:{passives:[],loadout:Array(8).fill(null)},
    actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6}]});
  const calls=[];
  s.moveEffect=()=>calls.push('move');
  s.checkHits=()=>{calls.push('damage');return 0;};
  s.checkGroundHits=()=>{calls.push('ground');return 0;};
  // Observe common dispatch eligibility only; no fake body geometry or hit gold.
  const effect=s.createEffect(s.actor('rf'),entry,{birthAnchor:{position:[2022.98,2840,0],facing:1}});
  s.drainEvents();return {s,effect,calls};
}

test('fixed V5 updates global mesh before DamageEffect and guards the dead main handle before damage checks',()=>{
  const data=source('X2Lib/X2Data.cpp'),game=source('X2Lib/X2Game.cpp'),damage=source('X2Lib/X2DamageEffect.cpp'),mesh=source('KTDXLIB/KTDGXMeshPlayer.cpp');
  const dataFrame=data.slice(data.indexOf('HRESULT CX2Data::OnFrameMove'),data.indexOf('HRESULT CX2Data::OnResetDevice'));
  assert.ok(dataFrame.indexOf('m_pGameMajorXMeshPlayer->OnFrameMove')<dataFrame.indexOf('m_GameEffectSet.OnFrameMove'));
  const gameFrame=game.slice(game.indexOf('HRESULT\tCX2Game::OnFrameMove'),game.indexOf('m_pDamageEffect->OnFrameMove')+70);
  assert.ok(gameFrame.includes('pCX2GameUnit->OnFrameMove( fTime, fElapsedTime )'));
  assert.ok(gameFrame.indexOf('pCX2GameUnit->OnFrameMove( fTime, fElapsedTime )')<gameFrame.indexOf('m_pDamageEffect->OnFrameMove'));
  const frame=damage.slice(damage.indexOf('void CX2DamageEffect::CEffect::OnFrameMove'),damage.indexOf('void CX2DamageEffect::CEffect::OnFrameMove')+25000);
  assert.ok(frame.indexOf('IsLiveInstanceHandle( m_hMeshInstHandle ) == false')<frame.indexOf('DamageCheck( &m_DamageData )'));
  assert.match(frame,/IsLiveInstanceHandle\( m_hMeshInstHandle \) == false[\s\S]*?m_bLive\s*=\s*false;[\s\S]*?else\s*\{/);
  const time=mesh.slice(mesh.indexOf('\t\tcase LT_TIME:'),mesh.indexOf('\t\tcase LT_MANUAL:'));
  assert.match(time,/if\( m_NowLifeTime >= m_MaxLifeTime \)\s*PlayEnd\(\)/);
  assert.ok(time.indexOf('m_NowLifeTime >= m_MaxLifeTime')<time.indexOf('m_NowLifeTime += m_fElapsedTime'));
  const destructor=damage.slice(damage.indexOf('CX2DamageEffect::CEffect::~CEffect'),damage.indexOf('void CX2DamageEffect::CEffect::OnFrameMove'));
  assert.match(destructor,/m_PassiveParticleDataList.size\(\)[\s\S]*?pParticleData->DestroyParticleSequence\(\)/);
});

test('actual target RRF mesh initializes an independent binary32 lifetime clock under native-v10',()=>{
  assert.equal(template.fields.LifeType,'LT_TIME');assert.equal(template.fields.LifeTime,.7);
  const {s,effect}=make();assert.equal(s.snapshot().versions.program,CORE_VERSION);
  assert.throws(()=>s.restore({...s.snapshot(),versions:{...s.versions,program:'incompatible-lifetime-fixture'}}),RangeError);
  assert.equal(effect.lifeTimeSeconds,.7);assert.equal(effect.meshLifetimeElapsed,0);
});

test('packet 42 remains eligible for damage; packet 43 old-time guard retires before movement or damage',()=>{
  const {s,effect,calls}=make();
  for(let packet=1;packet<=42;packet++){
    calls.length=0;s.tickEffects(1/60);
    assert.equal(s.state.effects.includes(effect),true,'alive at packet '+packet);
    assert.deepEqual(calls,['move','damage','ground']);
  }
  assert.equal(effect.meshLifetimeElapsed,0.699999988079071,'literal float32 accumulation of 42 packets');
  assert.equal(effect.meshLifetimeElapsed,Math.fround(.7));
  assert.ok(effect.elapsed>=.7,'existing event clock alone would retire a packet early');
  s.drainEvents();calls.length=0;const elapsed=effect.elapsed;
  s.tickEffects(1/60);assert.equal(s.state.effects.length,0);assert.deepEqual(calls,[]);
  assert.equal(effect.elapsed,elapsed,'dead source handle skips this damage/event interval');
  const ended=s.drainEvents().filter(e=>e.type==='effectEnded');assert.equal(ended.length,1);assert.equal(ended[0].reason,'template-life-time');
  s.tickEffects(1/60);assert.equal(s.drainEvents().filter(e=>e.type==='effectEnded').length,0);
});

test('an interval that crosses the lifetime remains alive until the next old-time check',()=>{
  const {s,effect,calls}=make();
  for(let packet=1;packet<=3;packet++){s.tickEffects(.25);assert.equal(s.state.effects.includes(effect),true);}
  assert.equal(effect.meshLifetimeElapsed,.75);calls.length=0;s.tickEffects(.25);
  assert.equal(s.state.effects.length,0);assert.deepEqual(calls,[]);
});

test('JSON snapshot restore preserves the native lifetime clock and packet 42/43 boundary',()=>{
  const a=make();for(let i=0;i<41;i++)a.s.tickEffects(1/60);
  const snapshot=JSON.parse(JSON.stringify(a.s.snapshot())),b=make();b.s.restore(snapshot);
  assert.equal(b.s.state.effects[0].meshLifetimeElapsed,a.effect.meshLifetimeElapsed);
  for(const item of [a,b]){item.calls.length=0;item.s.tickEffects(1/60);assert.equal(item.s.state.effects.length,1);assert.deepEqual(item.calls,['move','damage','ground']);}
  for(const item of [a,b]){item.calls.length=0;item.s.tickEffects(1/60);assert.equal(item.s.state.effects.length,0);assert.deepEqual(item.calls,[]);}
});

test('a clock field absent at birth is initialized without resetting the independent event clock',()=>{
  const {s,effect}=make();delete effect.meshLifetimeElapsed;
  s.tickEffects(.1);assert.equal(effect.meshLifetimeElapsed,Math.fround(.1));assert.equal(effect.elapsed,.1);
});
