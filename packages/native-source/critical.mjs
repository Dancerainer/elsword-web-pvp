const names=['amount','criticalRate','criticalAttack','passiveCriticalRate','magicCriticalRate','magicCriticalDamage',
  'shadowCriticalRate','roll','antiCriticalRate','unitAntiCriticalRate','criticalDefence','panicTime','panicRate','damageType','extraCriticalRate',
  'headX','headY','headZ','extraCriticalDamage'];
const defaults={criticalAttack:1.5,criticalDefence:1};
export function createNativeCriticalBridge(instance){
  const e=instance.exports??instance;
  for(const key of ['nc_abi','nc_input_count','nc_output_count','nc_input_ptr','nc_output_ptr','nc_evaluate'])
    if(typeof e[key]!=='function')throw new TypeError('Missing critical export '+key);
  if(e.nc_abi()!==1||e.nc_input_count()!==19||e.nc_output_count()!==10)throw new TypeError('Critical ABI mismatch');
  if(typeof e.nr_evaluate!=='function')throw new TypeError('Missing original state reduction export');
  if(typeof e.nl_phase!=='function'||typeof e.nl_revenge!=='function')throw new TypeError('Missing original Limit charge export');
  return Object.freeze({limitPhase(phase,charging=false){
    if(!['start','end'].includes(phase)||typeof charging!=='boolean')throw new TypeError('Invalid Limit phase');
    return e.nl_phase(charging?1:0,phase==='start'?1:2)===1;
  },limitRevenge({charging,canRevenge=true}){
    if(typeof charging!=='boolean'||typeof canRevenge!=='boolean')throw new TypeError('Invalid Limit reaction flags');
    return [null,'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK','RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK'][e.nl_revenge(charging?1:0,canRevenge?1:0)];
  },reduceDamage(amount,{percent=0,penetrate=false,ignoreStateDefence=false,guard=false,guardPercent=0}={}){
    if(!Number.isFinite(amount)||!Number.isFinite(Math.fround(amount)))throw new TypeError('Finite damage required');
    for(const value of [percent,guardPercent])if(!Number.isInteger(value)||value<-2147483648||value>2147483647)throw new TypeError('Original integer reduction percent required');
    const result=e.nr_evaluate(amount,percent,penetrate?1:0,ignoreStateDefence?1:0,guard?1:0,guardPercent);
    if(!Number.isFinite(result))throw new RangeError('Damage reduction overflow');return result;
  },evaluate(values){
    if(values?.roll===undefined)throw new TypeError('Explicit critical defender roll required');
    const parameters=names.map(name=>values[name]??defaults[name]??0);
    for(let i=0;i<parameters.length;i++)if(typeof parameters[i]!=='number'||!Number.isFinite(parameters[i])||!Number.isFinite(Math.fround(parameters[i])))throw new TypeError('Finite critical input required: '+names[i]);
    if(parameters[7]<0||parameters[7]>1||!Number.isInteger(parameters[13])||parameters[13]<0||parameters[13]>5)throw new RangeError('Invalid critical roll or damage type');
    new Float32Array(e.memory.buffer,e.nc_input_ptr(),19).set(parameters);e.nc_evaluate();
    const o=new Float32Array(e.memory.buffer,e.nc_output_ptr(),10);
    if(!Number.isFinite(o[0]))throw new RangeError('Critical output overflow');
    return {amount:o[0],critical:o[1]===1,red:o[2]===1,effectPosition:[o[3],o[4],o[5]],soundCalls:o[6],effectiveRate:o[7],defenderRoll:o[8],criticalAttack:o[9]};
  }});
}
export async function instantiateNativeCritical(module){const r=await WebAssembly.instantiate(module,{});return createNativeCriticalBridge(r.instance??r);}
