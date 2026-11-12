/** Execute only the recovered KL arithmetic required by target damage data.
 * Keep the raw declaration intact; unknown native/global values stay unsupported.
 */
export function resolveDamageValues(data,physics){
  const unsupported=[];
  function visit(value,path){
    if(value===null||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map((v,i)=>visit(v,`${path}[${i}]`));
    if('$symbol' in value){
      if(value.$symbol==='INIT_PHYSIC.WALK_SPEED'&&Number.isFinite(physics?.WALK_SPEED))return physics.WALK_SPEED;
      // Target2016's 66ZX declaration misspells METAL as METEL. Its enum
      // lookup returns nil, not 25. Fixed-V5 SetDamageDataFromLUA:77 supplies
      // HT_DEFAULT=0 on failed reads; retain the raw symbol in the profile.
      // This is that explicit reference-loader fallback, not an enum repair.
      if(path==='DAMAGE_DATA.HIT_TYPE'&&value.$symbol==='HIT_TYPE.HT_METEL_PUNCH_HIT'&&
        value.$unsupported==='target enum member absent')return 0;
      unsupported.push(path+': '+value.$symbol);return value;
    }
    if('$expression' in value){
      const left=visit(value.left,path+'.left'),right=visit(value.right,path+'.right');
      // ADDVN is the target KL82 arithmetic opcode, not a JavaScript expression.
      if(value.$expression==='ADDVN'&&Number.isFinite(left)&&Number.isFinite(right))return left+right;
      unsupported.push(path+': '+value.$expression);return value;
    }
    if(Object.keys(value).some(k=>k.startsWith('$'))){unsupported.push(path+': unresolved value');return value;}
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v,path+'.'+k)]));
  }
  return {data:visit(data,'DAMAGE_DATA'),unsupported,supported:unsupported.length===0};
}
