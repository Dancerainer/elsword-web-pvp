/** Diagnostic-only API routing. Reject paths that could escape the private route. */
export function createPrivateApiResolver(origin,prefix){
 const base=new URL(origin);
 if(!['http:','https:'].includes(base.protocol)||base.origin!==origin||base.username||base.password
  ||!/^\/__rf_rooms_[a-f0-9]{24}$/.test(prefix))throw Error('Invalid private API origin or prefix');
 return relative=>{
  if(typeof relative!=='string'||!relative.startsWith('/api/')||/[\\#\u0000-\u0020]/.test(relative))throw Error('Invalid private API path');
  const pathname=relative.split('?')[0];
  if(/%(?:2e|2f|5c|25)/i.test(pathname)||pathname.split('/').some(p=>p==='.'||p==='..'))throw Error('Unsafe private API path');
  return origin+prefix+relative;
 };
}
export function routeSocketClass(Socket,resolve){
 return class PrivateApiSocket extends Socket{constructor(url,protocol){super(resolve(url),protocol);}};
}
/** A late failed peer still fails the run, but should not erase sibling diagnostics. */
export function peerFinishGrace({now,starts,players,seconds}){
 if(starts.length!==players||starts.some(v=>!Number.isFinite(v)))return null;
 const latest=Math.max(...starts),deadline=latest+(seconds+20)*1000;
 return now>=latest+Math.max(0,seconds-10)*1000&&now<deadline?deadline:null;
}
