import {normalizeProfessionId} from './catalog.mjs';
import {isElswordProfession,isElesisProfession,isAddProfession} from './identity.mjs';

export const COSTUME_VERSION='costumes-2016-v1';
export const COSTUMES=Object.freeze({default:'Class costume (default)',officer:'El Search Party Officer',nasod:'Nasod Battle Suit',royal:'Royal Servant',solace:'Salvatore Solace',imperial:'Royal Iron Guard',denif:'Salvatore Denif',evilTracer1:'Evil Tracer 1'});
export function normalizeCostumeId(value='default') {
  if(typeof value!=='string'||!Object.hasOwn(COSTUMES,value))throw new RangeError('invalid-costume');
  return value;
}
export function costumeCharacter(professionId) {const id=normalizeProfessionId(professionId);return isAddProfession(id)?'add':isElesisProfession(id)?'elesis':isElswordProfession(id)?'elsword':'raven';}
export function normalizeCostumePreferences(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['elsword','raven','elesis','add'].includes(key)))throw new RangeError('invalid-costume-preferences');
  return {elsword:normalizeCostumeId(value.elsword),raven:normalizeCostumeId(value.raven),add:normalizeCostumeId(value.add),
    ...(Object.hasOwn(value,'elesis')?{elesis:normalizeCostumeId(value.elesis)}:{})};
}
export function selectedCostume(preferences,professionId) {return normalizeCostumeId(preferences?.[costumeCharacter(professionId)]);}
