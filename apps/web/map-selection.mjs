/** Resource selection for the internal RF workbench; no public matchmaking. */
export const DEFAULT_MAP_ID = 'sander-garpai-rock-pvp';
export function validateMapId(id) {
  if(typeof id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new TypeError('Invalid scene ID');
  return id;
}
export function selectMap(catalog, requestedId) {
  if(catalog?.schemaVersion!==1||!Array.isArray(catalog.maps)||!catalog.maps.length||catalog.failures?.length)
    throw new TypeError('Map catalog missing. Run the map build tool.');
  const id=validateMapId(requestedId??catalog.defaultSceneId);
  const entry=catalog.maps.find(map=>map.sceneId===id);
  if(!entry)throw new RangeError('Map not found in the asset catalog: '+id);
  if(entry.manifestUrl!==id+'/manifest.json')throw new TypeError('Invalid map manifest path');
  return entry;
}
export function mapAssetRoot(id) { return '/assets/scene/'+validateMapId(id)+'/'; }
export function mapNavigationUrl(currentUrl,id) {
  const url=new URL(currentUrl);url.searchParams.set('map',validateMapId(id));return url.href;
}
// Use original adjacent spawn declarations for this two-actor inspection
// fixture, preserving previous Garpai placement. These are not team assignments
// for official PvP or four-player matchmaking.
export function mapFixtureActors(map) {
  const spawns=map.spawns.filter(s=>s.kind==='SetTeamStartPos');
  if(spawns.length<2)throw new TypeError('Map requires spawn points for two players');
  return spawns.slice(0,2).map((s,i)=>({id:`player-${i+1}`,team:i,position:s.position,lineId:s.lineId,
    facing:i===0?(s.facingRight?1:-1):(spawns[0].facingRight?-1:1)}));
}
