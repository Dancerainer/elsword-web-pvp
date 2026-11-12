/** Original C++ value selection/rate calculation; bridge contains no formula. */
export const nativeSkillValuesContract = Object.freeze({
  schema:1, referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'reference-V5-not2016', targetClientMeasured:false, capacity:30,
});

function finite(value){
  if(typeof value!=='number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError('Skill value must be finite binary32');
  return value;
}
export function createNativeSkillValuesBridge(instanceOrExports){
  const e=instanceOrExports.exports??instanceOrExports;
  for(const name of ['sv_input_ptr','sv_input_capacity','sv_ability','sv_power','sv_increasing'])
    if(typeof e[name]!=='function')throw new TypeError('Missing native skill value export '+name);
  if(!(e.memory instanceof WebAssembly.Memory) || e.sv_input_capacity()!==30)
    throw new TypeError('Native skill value memory/capacity mismatch');
  function load(table){
    const keys=Object.keys(table??{}).map(Number).sort((a,b)=>a-b);
    if(keys.length>30 || keys.some((key,index)=>key!==index+1))throw new TypeError('Native value table must use contiguous Lua indexes 1..30');
    const ptr=e.sv_input_ptr();
    if(!Number.isInteger(ptr)||ptr<0||ptr%4||ptr+120>e.memory.buffer.byteLength)throw new RangeError('Native skill input out of bounds');
    const dest=new Float32Array(e.memory.buffer,ptr,30);
    keys.forEach((key,index)=>{dest[index]=finite(table[key]);});
    return keys.length;
  }
  function level(value){if(!Number.isInteger(value)||value < -2147483647 ||value > 2147483647)throw new TypeError('Level must be an int32');return value;}
  return Object.freeze({contract:nativeSkillValuesContract,
    abilityValue(table,value){return e.sv_ability(level(value),load(table));},
    powerRateValue(table,value){return e.sv_power(level(value),load(table));},
    increasingRate(rate){return e.sv_increasing(finite(rate));},
    buffFixed(value,resistance){if(typeof e.sv_buff_fixed!=='function')throw new TypeError('Original buff math export unavailable');return e.sv_buff_fixed(finite(value),finite(resistance));},
    buffRelation(attack,multiplier,resistance){if(typeof e.sv_buff_relation!=='function')throw new TypeError('Original buff math export unavailable');return e.sv_buff_relation(finite(attack),finite(multiplier),finite(resistance));},
    buffPercent(percent,resistance){if(typeof e.sv_buff_percent!=='function')throw new TypeError('Original buff math export unavailable');return e.sv_buff_percent(finite(percent),finite(resistance));},
    buffInterval(sum,target,dt){
      if(typeof e.sv_buff_interval!=='function')throw new TypeError('Original buff interval export unavailable');
      const triggered=e.sv_buff_interval(finite(sum),finite(target),finite(dt))!==0;
      return {triggered,sum:e.sv_buff_interval_sum()};
    },
  });
}
export async function instantiateNativeSkillValues(bytesOrModule){
  const result=await WebAssembly.instantiate(bytesOrModule,{});
  return createNativeSkillValuesBridge(result.instance??result);
}
