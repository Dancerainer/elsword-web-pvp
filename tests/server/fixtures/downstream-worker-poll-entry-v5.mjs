// Exercise production child IPC and relay encoding. Only the battle source is
// replaced with an authored lifecycle fixture; this is not combat evidence.
import {registerHooks} from 'node:module';
const entry=new URL('../../../apps/server/room-worker-entry.mjs',import.meta.url);
registerHooks({resolve(specifier,context,nextResolve){
  if(context.parentURL===entry.href&&specifier==='./battle-driver.mjs')return {
    url:new URL('./downstream-worker-poll-driver-v5.mjs',import.meta.url).href,shortCircuit:true,
  };
  return nextResolve(specifier,context);
}});
await import(entry.href);
