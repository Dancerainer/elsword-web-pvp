let inventory=Object.create(null);
const digest=/^[a-f0-9]{64}$/;

/** Content-addressed browser caching: code-only releases keep identical URLs. */
export function configureAssetUrls(files){
  if(!files||typeof files!=='object'||Array.isArray(files))throw Error('invalid-asset-versions');
  const next=Object.create(null);
  for(const [file,sha]of Object.entries(files)){
    if(file.startsWith('/')||file.includes('\\')||file.split('/').some(p=>!p||p==='.'||p==='..')||!digest.test(sha))throw Error('invalid-asset-version');
    next['/assets/'+file]=sha;
  }
  inventory=next;
}
export function assetUrl(value){
  if(typeof value!=='string')return value;
  const origin=globalThis.location?.origin??'http://asset.local';
  let url;try{url=new URL(value,origin);}catch{return value;}
  if(url.origin!==origin||!Object.hasOwn(inventory,url.pathname))return value;
  url.searchParams.set('v',inventory[url.pathname]);
  return url.pathname+url.search+url.hash;
}
export async function initializeAssetUrls(request=globalThis.fetch){
  const response=await request('/api/asset-versions',{cache:'no-store'});
  if(!response.ok){let value;try{value=await response.json();}catch{}throw Error(value?.message??'Resource versions: HTTP '+response.status);}
  const value=await response.json();if(value.schemaVersion!==1)throw Error('invalid-asset-versions');
  configureAssetUrls(value.files);return value;
}
export function versionStyleSheetAssets(document){
  function rules(items){for(const rule of items??[]){
    if(rule.style)for(const property of [...rule.style]){
      const before=rule.style.getPropertyValue(property),after=before.replace(/url\((["']?)(\/assets\/[^)'"\s]+)\1\)/g,(_,quote,url)=>'url("'+assetUrl(url)+'")');
      if(after!==before)rule.style.setProperty(property,after,rule.style.getPropertyPriority(property));
    }
    if(rule.cssRules)rules(rule.cssRules);
  }}
  for(const sheet of document.styleSheets){try{rules(sheet.cssRules);}catch{/* unrelated cross-origin styles */}}
}
