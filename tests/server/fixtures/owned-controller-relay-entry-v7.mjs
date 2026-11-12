// Substitute only the small authored battle fixture. IPC, child-side encoding,
// relay bindings and the coordinator remain their production implementations.
import {registerHooks} from 'node:module';
const entry=new URL('../../../apps/server/room-worker-entry.mjs',import.meta.url);
registerHooks({resolve(specifier,context,nextResolve){
  if(context.parentURL===entry.href&&specifier==='./battle-driver.mjs')return {
    url:new URL('./owned-controller-relay-driver-v7.mjs',import.meta.url).href,shortCircuit:true,
  };
  return nextResolve(specifier,context);
}});
await import(entry.href);
