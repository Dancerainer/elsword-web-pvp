import source from '../../contracts/rf-command-consumers-v53.json' with {type:'json'};
const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?
 Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
export function installRavenCommandSource(profile){
 if(profile.target?.unitClass!==107)return profile;
 for(const field of ['states','effectSets','damageEffects','effectTemplates'])for(const[name,row]of Object.entries(source[field])){
  if(profile[field][name]){
   if(canonical(profile[field][name])!==canonical(row))throw new TypeError('Conflicting target2016 Raven closure '+name);
   continue;
  }
  profile[field][name]=structuredClone(row);
 }
 return profile;
}
/** The raw134 HT_METEL typo is absent from original Enum; DD parser's
 * actual failure value is zero. Retain the raw unsupported symbol verbatim. */
export function ravenCommandDamageData(profile,actor,data){
 if(profile.target?.unitClass===107&&actor.state==='RSI_COMBO_XX'&&data?.HIT_TYPE?.$symbol==='HIT_TYPE.HT_METEL_PUNCH_HIT')
  return {...data,HIT_TYPE:0};
 return data;
}
export function ravenSourceCommandResult(profile,actor,input,result,previousFlags){
 if(profile.target?.unitClass!==107||actor.state!=='RSI_COMBO_ZZZ')return result;
 const time=Math.fround(actor.animationTime),next={...result};
 // Original126 captures X in[.166,.59), then consumes it in a later post
 // once M.E0>.333. Native reference used the final .59 gate for both arms.
 if(input.pressed.has('X')&&!(time>=Math.fround(.166)&&time<Math.fround(.59)))next.flags=(next.flags&~2)|(previousFlags&2);
 if((previousFlags&2)&&time>Math.fround(.333)&&
   (!next.state||['UNSUPPORTED_ZZZX','RSI_COMBO_ZZZZ'].includes(next.state))){next.state='RRF_COMBO_ZZZX';next.flags&=~2;}
 else if(next.state==='UNSUPPORTED_ZZZX')next.state=null;
 return next;
}
