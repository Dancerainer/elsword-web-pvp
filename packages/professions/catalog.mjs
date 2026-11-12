/** Product profession IDs are separate from target2016 native class IDs. */
export const DEFAULT_PROFESSION_ID = 'RF';
export const PROFESSION_IDS = Object.freeze(['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']);
export const PROFESSION_DISPLAY_ORDER = Object.freeze(['LK','RF','GM','LP','RS','VC','BH','MM','IS','BM','CA','DE']);
export const PROFESSIONS = Object.freeze({
  RF: Object.freeze({id:'RF',name:'Reckless Fist',label:'RF · Reckless Fist',unitClass:107,
    assetBase:'/assets/rf/',catalogUrl:'/assets/ui/skills/catalog.json',portraitUrl:'/assets/ui/r_fist_party.png'}),
  LK: Object.freeze({id:'LK',name:'Lord Knight',label:'LK · Lord Knight',unitClass:100,
    assetBase:'/assets/lk/',catalogUrl:'/assets/ui/skills/lk/catalog.json',portraitUrl:'/assets/lk/ui/portrait-party.png'}),
  VC: Object.freeze({id:'VC',name:'Veteran Commander',label:'VC · Veteran Commander',unitClass:115,
    assetBase:'/assets/vc/',catalogUrl:'/assets/ui/skills/vc/catalog.json',portraitUrl:'/assets/vc/ui/portrait-party.png'}),
  IS: Object.freeze({id:'IS',name:'Infinity Sword',label:'IS · Infinity Sword',unitClass:112,
    assetBase:'/assets/is/',catalogUrl:'/assets/ui/skills/is/catalog.json',portraitUrl:'/assets/is/ui/portrait-party.png'}),
  RS: Object.freeze({id:'RS',name:'Rune Slayer',label:'RS · Rune Slayer',unitClass:101,
    assetBase:'/assets/rs/',catalogUrl:'/assets/ui/skills/rs/catalog.json',portraitUrl:'/assets/rs/ui/portrait-party.png'}),
  BM: Object.freeze({id:'BM',name:'Blade Master',label:'BM · Blade Master',unitClass:106,
    assetBase:'/assets/bm/',catalogUrl:'/assets/ui/skills/bm/catalog.json',portraitUrl:'/assets/bm/ui/portrait-party.png'}),
  GM: Object.freeze({id:'GM',name:'Grand Master',label:'GM · Grand Master',unitClass:120,
    assetBase:'/assets/gm/',catalogUrl:'/assets/ui/skills/gm/catalog.json',portraitUrl:'/assets/gm/ui/portrait-party.png'}),
  BH: Object.freeze({id:'BH',name:'Blazing Heart',label:'BH · Blazing Heart',unitClass:121,
    assetBase:'/assets/bh/',catalogUrl:'/assets/ui/skills/bh/catalog.json',portraitUrl:'/assets/bh/ui/portrait-party.png'}),
  CA: Object.freeze({id:'CA',name:'Crimson Avenger',label:'CA · Crimson Avenger',unitClass:125,
    assetBase:'/assets/ca/',catalogUrl:'/assets/ui/skills/ca/catalog.json',portraitUrl:'/assets/ca/ui/portrait-party.png'}),
  LP: Object.freeze({id:'LP',name:'Lunatic Psyker',label:'LP · Lunatic Psyker',unitClass:122,
    assetBase:'/assets/lp/',catalogUrl:'/assets/ui/skills/lp/catalog.json',portraitUrl:'/assets/lp/ui/portrait-party.png'}),
  MM: Object.freeze({id:'MM',name:'Mastermind',label:'MM · Mastermind',unitClass:123,
    assetBase:'/assets/mm/',catalogUrl:'/assets/ui/skills/mm/catalog.json',portraitUrl:'/assets/mm/ui/portrait-party.png'}),
  DE: Object.freeze({id:'DE',name:'Diabolic Esper',label:'DE · Diabolic Esper',unitClass:126,
    assetBase:'/assets/de/',catalogUrl:'/assets/ui/skills/de/catalog.json',portraitUrl:'/assets/de/ui/portrait-party.png'}),
});
export const isRavenProfession = id => ['RF','VC','BM'].includes(id);
/** Old RF/LK settings stay valid; later professions are opt-in for that saved
 * snapshot. Loading does not rewrite the account file. Fresh stores have all
 * registered professions enabled, subject to complete resource availability. */
export function normalizeProfessionFlags(flags){
  if(!flags||typeof flags!=='object'||Array.isArray(flags)
    ||Object.keys(flags).some(id=>!PROFESSION_IDS.includes(id))
    ||['RF','LK'].some(id=>typeof flags[id]!=='boolean')
    ||PROFESSION_IDS.some(id=>id in flags&&typeof flags[id]!=='boolean'))throw new TypeError('Invalid profession flags');
  return Object.fromEntries(PROFESSION_IDS.map(id=>[id,flags[id]??false]));
}
export function normalizeProfessionId(id, {fallback=false} = {}) {
  if(typeof id==='string'&&Object.hasOwn(PROFESSIONS,id))return id;
  if(fallback)return DEFAULT_PROFESSION_ID;
  throw new RangeError('Unknown profession');
}
export function effectiveProfessionFlags(flags={}) {
  const result=Object.fromEntries(PROFESSION_IDS.map(id=>[id,['RF','LK'].includes(id)?flags[id]!==false:flags[id]===true]));
  if(!PROFESSION_IDS.some(id=>result[id]))result.RF=true;
  return result;
}
export function selectEnabledProfession(id, flags={}) {
  const enabled=effectiveProfessionFlags(flags),selected=normalizeProfessionId(id,{fallback:true});
  return enabled[selected]?selected:PROFESSION_IDS.find(key=>enabled[key]);
}
