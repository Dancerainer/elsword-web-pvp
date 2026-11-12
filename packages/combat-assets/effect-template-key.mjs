/** EffectSet's ET_* values choose separate native registries (fixed V5
 * X2EffectSet.cpp). A shared spelling does not make mesh and particle aliases.
 * Builders preserve the second declaration under a typed internal key while
 * original NAME fields and source hashes stay unchanged. */
export function resolveEffectTemplateKey(templates,name,effectType){
  const kind=Number.isInteger(effectType)&&effectType>=2&&effectType<=5?'mesh':
    Number.isInteger(effectType)&&effectType>=6&&effectType<=9?'particle':null;
  if(!kind)return name;
  if(templates?.[name]?.kind===kind)return name;
  const typed=kind+'::'+name;
  if(templates?.[typed]?.kind===kind&&templates[typed].sourceName===name)return typed;
  // An absent declaration remains an unsupported name. An explicitly wrong
  // registry must not be instantiated as a substitute.
  return templates?.[name]?.kind?null:name;
}
