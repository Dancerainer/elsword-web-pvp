import metadata from '../../contracts/lobby-config-v45.json' with {type:'json'};
import {PROFESSIONS,normalizeProfessionId} from '../../packages/professions/catalog.mjs';
import {createSkillPreferencesClient} from './skill-preferences.mjs';

/** Pure configuration state: catalog JSON, account preferences and existing
 * selection validators. No Babylon, animation, native WASM or simulation. */
export function createLobbyConfiguration({username,fetch:request=globalThis.fetch,storage,loadData}={}){
 const rows=new Map(),jobs=new Map();
 loadData??=async url=>{const response=await request(url);if(!response.ok)throw Error('Failed to load skill catalog: HTTP '+response.status);return response.json();};
 async function loadProfession(professionId){
  const id=normalizeProfessionId(professionId);
  if(rows.has(id))return rows.get(id);if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
   const entry=metadata.professions[id],catalog=await loadData(PROFESSIONS[id].catalogUrl);
   if(!Array.isArray(catalog?.skills))throw Error('Invalid skill catalog');
   const supportFor=skillId=>entry.capabilities[Number(skillId)];
   const definitions=catalog.skills.map(skill=>({...skill,branches:supportFor(skill.id)?.branches??skill.branches,
    limitations:supportFor(skill.id)?.limitations}));
   const client=createSkillPreferencesClient({fetch:request,storage});
   const preferences=await client.load({username,professionId:id,persistDefaults:false,
    defaults:{loadout:entry.defaults,branchChoices:{}},definitions,supportFor});
   const row={id,catalog:{...catalog,skills:definitions},definitions,supportFor,client,
    skillKeys:entry.skillKeys,passives:entry.passives,...preferences};rows.set(id,row);return row;
  })();jobs.set(id,job);
  try{return await job;}finally{if(jobs.get(id)===job)jobs.delete(id);}
 }
 async function save(id,preferences){
  const row=await loadProfession(id),value=await row.client.save(preferences);
  row.loadout=value.loadout;row.branchChoices=value.branchChoices;return row;
 }
 return {loadProfession,save,async confirm(id){const row=await loadProfession(id);return save(id,{loadout:row.loadout,branchChoices:row.branchChoices});},
  get:id=>rows.get(id),proof:()=>({loadedProfessions:[...rows.keys()],pendingProfessions:[...jobs.keys()],modelLoads:0,nativeRuntimeLoads:0})};
}
