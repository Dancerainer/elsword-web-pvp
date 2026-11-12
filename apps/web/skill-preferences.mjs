import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
const endpoint='/api/skill-preferences';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const passive=skill=>skill?.passive===true||[1,8].includes(skill?.type)
  ||skill?.template?.m_eActiveSkillUseCondtion===0;
const skillId=value=>typeof value==='number'||typeof value==='string'?Number(value):NaN;

function rulesFor(definitions,supportFor) {
  if(!Array.isArray(definitions)||typeof supportFor!=='function')throw Error('Missing current skill definitions');
  const rules=new Map(),byId=new Map(definitions.map(skill=>[skillId(skill?.id??skill?.skillId),skill]));
  for(const [sourceId,source] of byId){
    if(!Number.isSafeInteger(sourceId)||sourceId<=0)continue;
    let definition=source;const seen=new Set();
    while(definition?.replacedAtMax&&!seen.has(definition)){
      seen.add(definition);definition=byId.get(skillId(definition.maxUpgradeId));
    }
    if(!definition||definition.replacedAtMax||passive(definition))continue;
    const id=skillId(definition.id??definition.skillId),support=supportFor(id);
    if(support?.supported!==true||support.pvpDisabled===true||definition.selectable===false)continue;
    const branches=support.branches??definition.branches??[];
    rules.set(sourceId,{id,branches:new Set(['none',...branches.filter(branch=>
      branch?.selectable!==false&&(branch?.branchId??branch?.id)!=null)
      .map(branch=>String(branch.branchId??branch.id))])});
  }
  return rules;
}

/** Restore only current known choices, retaining explicit empty slots and unequipped traits. */
function restore(config,rules) {
  if(!object(config)||(Object.hasOwn(config,'schemaVersion')&&config.schemaVersion!==1))
    throw Error('Incompatible skill setup version. Sign in and try again.');
  if(!Array.isArray(config.loadout)||config.loadout.length!==8||!object(config.branchChoices))
    throw Error('Invalid skill setup. Sign in and try again.');
  const branchChoices={};
  for(const [key,branch] of Object.entries(config.branchChoices)){
    const sourceId=skillId(key),rule=rules.get(sourceId);
    if(rule&&(!Object.hasOwn(branchChoices,rule.id)||sourceId===rule.id))
      branchChoices[rule.id]=typeof branch==='string'&&rule.branches.has(branch)?branch:'none';
  }
  const equipped=new Set(),loadout=config.loadout.map(slot=>{
    if(!object(slot))return null;
    const rule=rules.get(skillId(slot.skillId)),id=rule?.id;
    if(!rule||equipped.has(id))return null;
    equipped.add(id);
    const branchId=branchChoices[id]??(typeof slot.branchId==='string'&&rule.branches.has(slot.branchId)?slot.branchId:'none');
    branchChoices[id]=branchId;
    return {skillId:id,branchId};
  });
  return {loadout,branchChoices};
}

/** One client follows the current login. Call load again when the account changes. */
export function createSkillPreferencesClient({fetch:request=globalThis.fetch,storage}={}) {
  if(typeof request!=='function')throw Error('Skill setup requests unavailable');
  let generation=0,active=null;
  const owners=new WeakMap();
  const current=context=>{
    if(context.generation!==generation)throw Error('Account changed. Reload the skill setup.');
  };
  const owned=(config,context)=>{owners.set(config,context);return config;};
  async function exchange(method,context,config) {
    current(context);
    let response;
      try{response=await request(context.professionId?endpoint+'?professionId='+encodeURIComponent(context.professionId):endpoint,{method,credentials:'same-origin',cache:'no-store',
      ...(method==='PUT'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,...config,...(context.professionId?{professionId:context.professionId}:{})})}:{})});}
    catch(error){current(context);throw Error(`Skill setup ${method==='GET'?'load':'save'} failed. Check your connection and try again.`,{cause:error});}
    current(context);
    if(!response?.ok)throw Error(response?.status===401?'Session expired. Sign in and try again.':
      `Skill setup ${method==='GET'?'load':'save'} failed. Try again later.`);
    let payload;
    try{payload=await response.json();}
    catch(error){current(context);throw Error('Invalid skill setup response. Try again later.',{cause:error});}
    current(context);
    if(!object(payload)||!Object.hasOwn(payload,'preferences')||
      (payload.preferences===null&&method!=='GET'))throw Error('Invalid skill setup response. Try again later.');
    return payload.preferences===null?null:restore(payload.preferences,context.rules);
  }
  return {
    async load({username,professionId,defaults,definitions,supportFor,persistDefaults=true}) {
      const context={generation:++generation};active=null;
      if(typeof username!=='string'||!username)throw Error('Sign in to load your skill setup');
      if(professionId!==undefined&&!PROFESSION_IDS.includes(professionId))throw Error('Invalid class configuration');
      if(typeof persistDefaults!=='boolean')throw Error('Invalid default save option for skill setup');
      context.username=username;context.professionId=professionId;context.rules=rulesFor(definitions,supportFor);
      let config=await exchange('GET',context);
      if(config===null){
        const fallback=Array.isArray(defaults)?{loadout:defaults,branchChoices:{}}:defaults;
        let legacy={};
        try{const raw=(!professionId||professionId==='RF')?storage?.getItem(`rf-picker-branches-v12:${username}`):null;if(raw)legacy=JSON.parse(raw);}
        catch{/* Local preferences are optional; the server remains authoritative. */}
        config=restore({...fallback,branchChoices:{...(object(fallback?.branchChoices)?fallback.branchChoices:{}),
          ...(object(legacy)?legacy:{})}},context.rules);
        // Boot prepares every profession, including disabled choices and frozen
        // queue/match seats. Their GET is allowed but PUT is forbidden; retain
        // validated defaults locally until the player is allowed to edit.
        if(persistDefaults)config=await exchange('PUT',context,config);
      }
      current(context);active=context;
      return owned(config,context);
    },
    async save(config) {
      const context=active;
      if(!context)throw Error('Load the current account’s skill setup first');
      current(context);
      if(owners.has(config)&&owners.get(config)!==context)throw Error('Account changed. Reload the skill setup.');
      if(context.writing)throw Error('Skill setup is saving. Try again later.');
      const snapshot=restore(config,context.rules);context.writing=true;
      try{
        const confirmed=await exchange('PUT',context,snapshot);current(context);
        return owned(confirmed,context);
      }
      finally{context.writing=false;}
    },
  };
}
