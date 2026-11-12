// Execute the production IPC safety and startup failure paths with an authored
// driver; this fixture is transport evidence, not original combat behavior.
import {registerHooks} from 'node:module';
const entry=new URL('../../../apps/server/room-worker-entry.mjs',import.meta.url);
registerHooks({resolve(specifier,context,nextResolve){
  if(context.parentURL===entry.href&&specifier==='./battle-driver.mjs')return {
    url:new URL('./room-worker-health-driver-v7.mjs',import.meta.url).href,shortCircuit:true,
  };
  return nextResolve(specifier,context);
}});
await import(entry.href);
