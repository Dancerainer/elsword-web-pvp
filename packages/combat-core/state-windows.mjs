// These are the four authored declaration families queried by the executor.
// Cache patterns, never raw objects: instance damage/state data can change.
const patterns=new Map(['CAN_PASS_UNIT_TIME','CAN_PUSH_UNIT_TIME','ATTACK_TIME','CREATE_DAMAGE_EFFECT']
  .map(prefix=>[prefix,new RegExp(`^${prefix}\\d+$`)]));

export function stateWindows(raw,prefix){
  let pattern=patterns.get(prefix);
  const result=[];
  // Object.entries preserves the existing own/enumerable order and value-read
  // semantics; avoid the filter/map arrays and a RegExp per unrelated field.
  for(const [key,value]of Object.entries(raw??{})){
    if(key===prefix)result.push(value);
    else {
      pattern??=new RegExp(`^${prefix}\\d+$`);
      if(pattern.test(key))result.push(value);
    }
  }
  return result;
}
