/** Pure guards for sealed deployment inventories; no filesystem or Git writes. */
const digest=/^[a-f0-9]{64}$/;
const proof=/^(?:source|sources|proof|proofs|evidence|receipt|receipts|superseded|generated)(?:$|[-_])/i;
export const RELEASE_PROFESSION_IDS=Object.freeze(['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']);
export function requiredProfessionManifests(assets){
  const names=new Set(assets.map(row=>row.path));
  const present=RELEASE_PROFESSION_IDS.filter(id=>assets.some(row=>row.path.startsWith('artifacts/'+id.toLowerCase()+'/')));
  if(!present.includes('RF')||present.some(id=>!names.has('artifacts/'+id.toLowerCase()+'/manifest.json')))
    throw Error('Every candidate profession requires a manifest and activation validation');
  return present;
}
export function snapshotAssets(snapshot,expectedBuild){
  if(snapshot?.bundleSha256!==expectedBuild||!snapshot.files||Array.isArray(snapshot.files)||typeof snapshot.files!=='object')
    throw Error('Sealed snapshot and browser build differ');
  const entries=Object.entries(snapshot.files);
  if(!entries.length||entries.length>20000)throw Error('Bounded nonempty snapshot inventory required');
  return entries.map(([file,sha256])=>{
    if(!file||file.startsWith('/')||file.includes('\\')||file.includes(':')||file.split('/').some(part=>!part||part==='.'||part==='..'||proof.test(part))||!digest.test(sha256))
      throw Error('Invalid runtime asset snapshot entry: '+file);
    return {path:'artifacts/'+file,sha256};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function changedAssetFiles(baselineAssets,assets){
  const before=new Map(baselineAssets.map(row=>[row.path,row.sha256]));
  return assets.filter(row=>before.get(row.path)!==row.sha256).map(row=>({
    ...row,baselineSha256:before.get(row.path)??null,baselineCanonicalSha256:null,
  }));
}
export function removedAssetFiles(baselineAssets,assets){
  const targets=new Set(assets.map(row=>row.path));
  return baselineAssets.filter(row=>!targets.has(row.path)).map(row=>({...row}));
}
export function isProgramSource(file){
  return /^(?:apps|packages|config|contracts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|css|json)$/.test(file)&&
    file.split('/').every(part=>part&&part!=='.'&&part!=='..')||
    ['package.json','package-lock.json','tools/assets/character/sample_pose.mjs','apps/web/index.html'].includes(file);
}
