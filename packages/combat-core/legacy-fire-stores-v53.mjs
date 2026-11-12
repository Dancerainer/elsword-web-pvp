/** Original EDT_FIRE3 / EDT_ENCHANT_BLAZE100 records. These entries retain
 * the source effective-value field, not an invented countdown. Acquisition
 * and expiry must be supplied by an independently supported producer. */
const f=Math.fround;
export function validateLegacyFireStores(rows){
 if(rows===undefined)return true;
 if(!Array.isArray(rows)||rows.length>2||new Set(rows.map(r=>r?.type)).size!==rows.length||rows.some(r=>
  !r||Object.keys(r).length!==4||![3,100].includes(r.type)||!Number.isFinite(r.effectiveValue)||
  !Number.isFinite(r.power)||!(typeof r.sourceActorId==='string'||r.sourceActorId===null)))throw new TypeError('Invalid original legacy fire records');
 return true;
}
export function acceptLegacyFireRecord(actor,record,{immune,allowEnchant}={}){
 validateLegacyFireStores([record]);validateLegacyFireStores(actor.sourceLegacyFireStores);
 if(typeof immune!=='boolean'||typeof allowEnchant!=='boolean')throw new TypeError('Explicit legacy fire receiver gates required');
 if(immune||record.type===100&&!allowEnchant)return false;
 const rows=actor.sourceLegacyFireStores??=[],old=rows.find(r=>r.type===record.type);
 if(record.type===3&&old?.effectiveValue>0&&(record.power<old.power||record.power===old.power&&record.effectiveValue<old.effectiveValue))return false;
 // Replace the whole represented record; never merge stale source identity.
 if(old)rows.splice(rows.indexOf(old),1);
 rows.push({...record,effectiveValue:f(record.effectiveValue),power:f(record.power)});return true;
}
export function absorbLegacyFireRecords(actor){
 const rows=actor.sourceLegacyFireStores;validateLegacyFireStores(rows);
 const types=(rows??[]).filter(r=>r.effectiveValue>0).map(r=>r.type).sort((a,b)=>a-b);
 if(types.length){actor.sourceLegacyFireStores=rows.filter(r=>!types.includes(r.type));
  if(!actor.sourceLegacyFireStores.length)delete actor.sourceLegacyFireStores;}
 return types;
}
