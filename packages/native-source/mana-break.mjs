const fields=['mp','mpMax','charge','availableMax','chargeRate','canCharge','active','pendingCost','elapsed',
  'noDetonation','blockedByBuff','heldZ','heldX','grounded','fromFront','backY','damageType'];
const defaults={mpMax:300,availableMax:300,chargeRate:130,fromFront:true};
const flags=new Set(['canCharge','active','noDetonation','blockedByBuff','heldZ','heldX','grounded','fromFront']);
const operations={frame:0,event:1,request:2,consume:3,down:4};
const states=[null,'RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE'];
export function createNativeManaBreakBridge(instance){
  const e=instance.exports??instance;
  for(const name of ['mb_abi','mb_input_count','mb_output_count','mb_input_ptr','mb_output_ptr','mb_evaluate'])
    if(typeof e[name]!=='function')throw new TypeError('Missing Mana Break export '+name);
  if(e.mb_abi()!==1||e.mb_input_count()!==17||e.mb_output_count()!==13)throw new TypeError('Mana Break ABI mismatch');
  return Object.freeze({evaluate(phase,values={}){
    if(!Object.hasOwn(operations,phase))throw new TypeError('Unknown Mana Break phase');
    const input=fields.map(name=>{
      const value=values[name]??defaults[name]??(flags.has(name)?false:0);
      if(flags.has(name)){if(typeof value!=='boolean')throw new TypeError('Boolean Mana Break input: '+name);return value?1:0;}
      if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new TypeError('Finite Mana Break input: '+name);
      return value;
    });
    if(input[0]<0||input[1]<0||input[0]>input[1]||input[2]<0||input[2]>300||input[3]<0||input[4]<0||input[7]<0||input[8]<0)
      throw new RangeError('Invalid Mana Break gauge/time');
    if(!Number.isInteger(input[16])||input[16]<0||input[16]>6)throw new RangeError('Invalid Mana Break damage type');
    new Float32Array(e.memory.buffer,e.mb_input_ptr(),17).set(input);e.mb_evaluate(operations[phase]);
    const o=[...new Float32Array(e.memory.buffer,e.mb_output_ptr(),13)];
    if(o.some(v=>!Number.isFinite(v)))throw new RangeError('Mana Break output overflow');
    return {mp:o[0],charge:o[1],availableMax:o[2],canCharge:o[3]===1,active:o[4]===1,pendingCost:o[5],
      triggered:o[6]===1,state:states[o[7]]??null,vy:o[8],hitStop:o[9],impactEffect:o[10]===1,
      maxCharge:o[11],minimumCharge:o[12]};
  }});
}
export async function instantiateNativeManaBreak(module){const r=await WebAssembly.instantiate(module,{});return createNativeManaBreakBridge(r.instance??r);}
