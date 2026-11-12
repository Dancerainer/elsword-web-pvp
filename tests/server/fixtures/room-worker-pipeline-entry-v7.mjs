// Actual production child entry: only the battle factory is an authored
// fixture, and reply delivery has a deterministic barrier. Owner consumption,
// IPC event order, validation, action ledgers and lifecycle remain production.
import {registerHooks} from 'node:module';
const entry=new URL('../../../apps/server/room-worker-entry.mjs',import.meta.url);
registerHooks({resolve(specifier,context,nextResolve){
 if(context.parentURL===entry.href&&specifier==='./battle-driver.mjs')return {
  url:new URL('./room-worker-pipeline-driver-v7.mjs',import.meta.url).href,shortCircuit:true,
 };
 return nextResolve(specifier,context);
}});
const originalSend=process.send.bind(process),replies=[];let released=false;
process.send=(message,...args)=>{
 if(message.kind==='reply'&&!released){replies.push([message,...args]);return true;}
 return originalSend(message,...args);
};
process.on('message',message=>{
 if(message.kind!=='bind'||message.binding?.token!=='fixture-release-replies')return;
 released=true;for(const args of replies.splice(0))originalSend(...args);
});
await import(entry.href);
