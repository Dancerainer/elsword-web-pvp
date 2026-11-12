// Run the production IPC entry in a real child process with a deterministic
// lifecycle driver. This fixture asserts transport seeds, not combat rules.
import {registerHooks} from 'node:module';
const entry=new URL('../../../apps/server/room-worker-entry.mjs',import.meta.url);
registerHooks({resolve(specifier,context,nextResolve){
  if(context.parentURL===entry.href&&specifier==='./battle-driver.mjs')return {
    url:new URL('./room-worker-seed-driver.mjs',import.meta.url).href,shortCircuit:true,
  };
  return nextResolve(specifier,context);
}});
await import(entry.href);
