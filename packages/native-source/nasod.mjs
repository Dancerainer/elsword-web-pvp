/** Byte-preserved V5 guard predicates/state callbacks, explicit bounded host ABI. */
export const nativeNasodContract=Object.freeze({schema:1,abi:1,
  referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'reference-V5-not2016',targetClientMeasured:false,
  groups:Object.freeze({guard:0,start:1,timer:2,end:3}),
  hostBoundaries:Object.freeze(['symbolic state IDs','unit scale 1 / authored line +X basis',
    'mesh and sound dispatch','RestoreNasodBall recreation','host supplied random value'])});
const fields=['stateId','footOnLineNow','attackerFrontFuture','hyperRemaining','level','gauge',
  'parrying','canParry','guardRemaining','attacking','superArmor','held','grappled','riding',
  'elapsed','helperLive','right','random','damageFlags','extraType'];
const boolFields=new Set([1,2,6,7,9,10,11,12,13,15,16]);
const intFields=new Set([0,4,17,18,19]);
function ptr(e,name,count){const p=e[name]();if(!Number.isInteger(p)||p<0||p%4||p+count*4>e.memory.buffer.byteLength)
  throw new RangeError('Nasod '+name+' pointer out of bounds');return new Float32Array(e.memory.buffer,p,count);}
export function createNativeNasodBridge(instanceOrExports){
  const e=instanceOrExports.exports??instanceOrExports;
  for(const name of ['ns_abi','ns_input','ns_output','ns_eval'])if(typeof e[name]!=='function')throw new TypeError('Missing Nasod '+name);
  if(!(e.memory instanceof WebAssembly.Memory)||e.ns_abi()!==1)throw new TypeError('Nasod ABI mismatch');
  return Object.freeze({contract:nativeNasodContract,evaluate(kind,snapshot){
    const id=nativeNasodContract.groups[kind];if(id===undefined)throw new TypeError('Unknown Nasod callback '+kind);
    const input=ptr(e,'ns_input',20);
    fields.forEach((name,i)=>{const v=snapshot?.[name];
      if(boolFields.has(i)){if(typeof v!=='boolean')throw new TypeError('Explicit Nasod '+name+' boolean required');input[i]=v?1:0;}
      else {if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||intFields.has(i)&&!Number.isInteger(v))
        throw new TypeError('Explicit finite Nasod '+name+' required');input[i]=v;}});
    if(snapshot.stateId<0||snapshot.stateId>202||snapshot.random<0||snapshot.random>32767||snapshot.level<0||snapshot.level>5||snapshot.gauge<0||snapshot.gauge>100||snapshot.elapsed<0||snapshot.guardRemaining<0||snapshot.damageFlags<0||snapshot.damageFlags>63||snapshot.extraType<0||snapshot.extraType>4)
      throw new RangeError('Nasod snapshot outside bounded host ABI');
    e.ns_eval(id);const out=ptr(e,'ns_output',24);
    return {guarded:!!out[0],stateEligible:!!out[1],parrying:!!out[2],canParry:!!out[3],
      guardRemaining:out[4],gauge:out[5],level:out[6],attacking:!!out[7],delayedAttack:!!out[8],
      delayAttackTime:out[9],attackTime:out[10],
      helper:{scale:out[11],guardAnimation:!!out[12],offset:[out[13],out[14],0],outlineColor:[out[18],out[19],out[20],1]},
      smallCharacterAnimation:!!out[15],soundCalls:out[16],restored:!!out[17],evidenceClass:nativeNasodContract.evidenceClass};
  }});
}
export async function instantiateNativeNasod(bytesOrModule){const r=await WebAssembly.instantiate(bytesOrModule,{});return createNativeNasodBridge(r.instance??r);}
