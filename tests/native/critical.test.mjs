import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instantiateNativeCritical,createNativeCriticalBridge} from '../../packages/native-source/critical.mjs';

const bytes=readFileSync(new URL('../../artifacts/native/critical.wasm',import.meta.url));
const module=await WebAssembly.compile(bytes);
const create=()=>instantiateNativeCritical(module);

test('critical source fragments retain pinned input hashes and original byte ranges',()=>{
  const contract=JSON.parse(readFileSync(new URL('../../contracts/rf-critical-source-v11.json',import.meta.url)));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  for(const record of contract.files){
    const source=readFileSync(new URL('../../.cache/native-source-runtime/'+record.relativePath,import.meta.url));
    assert.equal(hash(source),record.sha256);
    for(const f of contract.fragments.filter(f=>f.path===record.relativePath)){
      const lines=source.toString('latin1').match(/[^\n]*\n|[^\n]+$/g);
      let fragment=Buffer.from(lines.slice(f.lineStart-1,f.lineEnd).join(''),'latin1');
      // Function extraction starts at its signature and ends at the final
      // brace, without the CRLF/indentation following that brace.
      if([23094,10487,22473,22501].includes(f.lineStart)){
        const signature=({23094:'float CX2GUUser::GetCriticalPercent(',10487:'const float CX2GameUnit::GetCriticalValueFromDefender()',22473:'void CX2GURaven::RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateStart(',22501:'void CX2GURaven::RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateEnd('})[f.lineStart];
        fragment=fragment.subarray(fragment.indexOf(signature));
        fragment=fragment.subarray(0,fragment.lastIndexOf('}')+1);
      }
      assert.equal(fragment.length,f.bytes);assert.equal(hash(fragment),f.sha256);
    }
  }
  assert.equal(contract.targetClientMeasured,false);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
});

test('original critical threshold includes equality and uses 1.5 base damage',async()=>{
  const r=await create();
  const normal=r.evaluate({amount:100,criticalRate:.5,roll:.5001,headX:2,headY:3,headZ:4});
  assert.equal(normal.critical,false);assert.equal(normal.amount,100);assert.equal(normal.soundCalls,0);
  const critical=r.evaluate({amount:100,criticalRate:.5,roll:.5,headX:2,headY:3,headZ:4});
  assert.equal(critical.amount,150);assert.equal(critical.critical,true);assert.equal(critical.red,true);
  assert.deepEqual(critical.effectPosition,[2,133,4],'original head+70, critical+40, effect+20');
  assert.equal(critical.soundCalls,1);
});

test('forced critical uses source extra-rate field; defence and magic modifiers stay distinct',async()=>{
  const r=await create();
  assert.equal(r.evaluate({amount:100,extraCriticalRate:1,roll:.999}).critical,true);
  assert.equal(r.evaluate({amount:100,criticalRate:.5,unitAntiCriticalRate:.25,roll:.5}).critical,false);
  assert.equal(r.evaluate({amount:100,criticalRate:.5,antiCriticalRate:.25,roll:.75}).critical,true,
    'literal original defender getter subtracts anti rate from roll');
  assert.equal(r.evaluate({amount:100,criticalRate:1,criticalAttack:.5,roll:.5,damageType:0}).amount,100,
    'original physical path does not multiply by critical attack below one');
  assert.equal(r.evaluate({amount:100,criticalRate:1,criticalAttack:.5,roll:.5,damageType:1}).amount,50,
    'original magic path has no physical >=1 guard');
  assert.equal(r.evaluate({amount:100,magicCriticalRate:.5,magicCriticalDamage:.5,roll:.25,damageType:1}).amount,200);
  assert.equal(r.evaluate({amount:100,magicCriticalRate:.5,roll:.25,damageType:0}).critical,false);
});

test('native critical bridge rejects malformed ABI and invalid numeric input, with isolated memories',async()=>{
  assert.throws(()=>createNativeCriticalBridge({}),/Missing critical export/);
  const first=await create(),second=await create();
  assert.throws(()=>first.evaluate({amount:100}),/Explicit critical defender roll/);
  for(const values of [{amount:NaN},{criticalRate:Infinity},{amount:1e99}])assert.throws(()=>first.evaluate({...values,roll:.5}),/Finite/);
  for(const values of [{roll:-1},{roll:1.001},{damageType:1.5},{damageType:6}])assert.throws(()=>first.evaluate({roll:.5,...values}),/Invalid critical/);
  const before=first.evaluate({amount:4,criticalRate:1,roll:.5});
  second.evaluate({amount:999,roll:.9});
  assert.deepEqual(first.evaluate({amount:4,criticalRate:1,roll:.5}),before);
});
test('original WildCharge state reduction uses integer percent, bypass flags and 100 cap',async()=>{
  const r=await create();
  assert.equal(r.reduceDamage(100,{percent:30}),70);
  assert.equal(r.reduceDamage(100,{percent:30,guard:true,guardPercent:20}),50);
  assert.equal(r.reduceDamage(100,{percent:130}),0);
  assert.equal(r.reduceDamage(100,{percent:-30}),100);
  assert.equal(r.reduceDamage(100,{percent:30,penetrate:true}),100);
  assert.equal(r.reduceDamage(100,{percent:30,ignoreStateDefence:true}),100);
  assert.throws(()=>r.reduceDamage(100,{percent:.3}),/integer/);
});
test('original LimitCrusher lifecycle and received-hit counter use literal state flags',async()=>{
  const r=await create();
  assert.equal(r.limitPhase('start',false),true);
  assert.equal(r.limitPhase('end',true),false);
  assert.equal(r.limitRevenge({charging:false,canRevenge:true}),null);
  assert.equal(r.limitRevenge({charging:true,canRevenge:true}),'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK');
  assert.equal(r.limitRevenge({charging:true,canRevenge:false}),'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK');
  assert.throws(()=>r.limitPhase('unknown',false),/Invalid Limit/);
});
