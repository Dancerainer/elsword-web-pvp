/** Only independent JSON reads overlap. GPU objects and source validation stay
 * with their existing owner, in the existing publication order. This short
 * lived cache is released when battle preparation finishes or fails. */
export function createBattleResourcePrefetch({load,urls=[],concurrency=4}={}) {
  if(typeof load!=='function'||!Number.isInteger(concurrency)||concurrency<1)throw Error('Invalid battle resource loader');
  const controller=new AbortController(),pending=new Map(),queue=[];
  let active=0,closed=false;
  function pump(){
    while(!closed&&active<concurrency&&queue.length){
      const row=queue.shift();active++;
      Promise.resolve().then(()=>load(row.url,controller.signal)).then(row.resolve,row.reject).finally(()=>{active--;pump();});
    }
  }
  function read(url){
    if(closed)return Promise.reject(Error('Battle resource preparation closed'));
    if(pending.has(url))return pending.get(url);
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    // A later consumer still receives the original rejection. Eager work must
    // not emit unhandled errors while another resource is being awaited.
    promise.catch(()=>{});pending.set(url,promise);queue.push({url,resolve,reject});pump();return promise;
  }
  for(const url of urls)read(url);
  return {read,close(){
    if(closed)return;closed=true;controller.abort();pending.clear();
    for(const row of queue.splice(0))row.reject(Error('Battle resource preparation closed'));
  }};
}

export function battleBootstrapUrls(files={}) {
  const urls=['ui/manifest.json','audio/manifest.json','audio/pose-v25/manifest.json',
    'audio/feedback-v26/manifest.json','audio/lobby/manifest.json','audio/pvp/manifest.json',
    'native/manifest.json','ui/way-of-sword/index.json','ui/elesis-way-of-sword/index.json',
    'ui/skill-sword/index.json','costumes/particles.json','ui/damage-numbers/manifest.json'];
  for(const file of ['common-buffs/manifest.json','battle-life/manifest.json','cast-display/manifest.json'])
    if(files[file])urls.push(file);
  return urls.map(file=>'/assets/'+file);
}
