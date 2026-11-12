/** Byte-preserved original C++ RandomNumber. The host chooses the rand output. */
export const nativeEffectRandomContract=Object.freeze({
  schema:1,abi:1,referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'reference-V5-not2016',targetClientMeasured:false,windowsRandMax:32767,
});
function finite(value){
  if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))
    throw new TypeError('Random bound must be finite binary32');
  return Math.fround(value);
}
function integer(value){
  if(!Number.isInteger(value)||value<-2147483648||value>2147483647)
    throw new TypeError('Random bound must be int32');
  return value;
}
function rand(value){
  if(!Number.isInteger(value)||value<0||value>32767)throw new RangeError('Host Windows rand value must be 0..32767');
  return value;
}
export function createNativeEffectRandomBridge(instanceOrExports){
  const e=instanceOrExports.exports??instanceOrExports;
  for(const name of ['er_abi','er_rand_max','er_draws','er_float','er_int'])
    if(typeof e[name]!=='function')throw new TypeError('Missing native effect random export '+name);
  if(e.er_abi()!==1||e.er_rand_max()!==32767)throw new TypeError('Native effect random ABI mismatch');
  return Object.freeze({contract:nativeEffectRandomContract,
    randomFloat(min,max,randValue){
      min=finite(min);max=finite(max);
      if(!Number.isFinite(Math.fround(max-min))||!Number.isFinite(Math.fround(min+Math.abs(Math.fround(max-min)))))
        throw new RangeError('Original float RandomNumber would overflow');
      return e.er_float(min,max,rand(randValue));
    },
    randomInt(min,max,randValue){
      min=integer(min);max=integer(max);
      const width=Math.abs(max-min);
      if(width>2147483646||min+width>2147483647)throw new RangeError('Original int RandomNumber would overflow');
      return e.er_int(min,max,rand(randValue));
    },
    get drawsUsed(){return e.er_draws();},
  });
}
export async function instantiateNativeEffectRandom(bytesOrModule){
  const result=await WebAssembly.instantiate(bytesOrModule,{});
  return createNativeEffectRandomBridge(result.instance??result);
}
