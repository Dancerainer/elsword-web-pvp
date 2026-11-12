/** One independent Apocalypse model per owner; disposal never owns sources. */
import {Quaternion} from '@babylonjs/core';
import {createActorView,sampleAnimation} from './actor-presentation.mjs';
import {setNativeTransparentLayer} from './native-effect-draw-order-v3.mjs';
import {addSummonAnimation,addSummonWorldQuaternion} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {scheduleRenderPreparation,createRenderPreparationCache} from './render-preparation.mjs';

export function createAddSummonView({scene,assets,scale=.01,onUnsupported=()=>{},styleView=()=>{}}){
  const entries=new Map(),prepared=new Map(),prepareMesh=createRenderPreparationCache();let disposed=false,preparedSerial=0;
  const counts={preparationCreates:0,runtimeCreates:0,preparedActivations:0,unpreparedActivations:0};
  const resource=assets?.apocalypse??assets;
  if(!resource?.bodyContainer||resource.manifest?.npcId!==1604||!(scale>0))throw new TypeError('Loaded Apocalypse container required');
  function makeView(id){
    const view=createActorView(resource.bodyContainer,scene,id,scale*resource.manifest.unitScale,resource.pose);
    try{styleView(view);setNativeTransparentLayer(view.meshes,resource.manifest.rawSystem.UNIT_LAYER);}
    catch(error){view.dispose();throw error;}
    return view;
  }
  function resetPose(view){view.group?.stop();view.group=null;view.sample=null;view.resetBindPose();view.missing.clear();}
  function release(id){const entry=entries.get(id);if(!entry)return;
    entries.delete(id);
    if(prepared.get(id)?.view===entry.view)entry.view.root.setEnabled(false);
    else entry.view.dispose();
  }
  function clear(){
    // Invalidating ownership first makes queued work and late compilation
    // completions unable to publish a view after a lobby return/disposal.
    const views=new Set([...entries.values(),...prepared.values()].map(row=>row.view).filter(Boolean));
    entries.clear();prepared.clear();for(const view of views)view.dispose();
  }
  async function prewarmActors(actors){
    if(disposed)return;
    // One summon per actual MM owner, regardless of hypothetical profession
    // combinations or summon serials. A practice loadout can change later.
    const ids=new Set(actors.filter(a=>a.professionId==='MM'&&!a.pvpDisconnected).map(a=>a.id));
    for(const [id,row]of prepared)if(!ids.has(id)){
      prepared.delete(id);if(row.view&&entries.get(id)?.view!==row.view)row.view.dispose();
    }
    const jobs=[];
    for(const id of ids){
      let row=prepared.get(id);
      if(!row){
        row={view:entries.get(id)?.view??null,ready:false,job:null};prepared.set(id,row);
        const current=()=>!disposed&&prepared.get(id)===row;
        row.job=(async()=>{
          try{
            if(!row.view)await scheduleRenderPreparation(()=>{
              if(!current())return;
              const live=entries.get(id)?.view;
              row.view=live??makeView(id+'-apocalypse-prepared-'+(++preparedSerial));
              if(!live){counts.preparationCreates++;row.view.root.setEnabled(false);}
            });
            if(!current()||!row.view)return;
            const view=row.view;
            // Fill every original state binding before input. Do not sample
            // over a currently visible summon when adopting a cold live view.
            if(entries.get(id)?.view!==view){
              await scheduleRenderPreparation(()=>{
                if(!current()||entries.get(id)?.view===view)return;
                for(const binding of new Map(Object.values(resource.manifest.stateBindings).map(value=>[value.animationName,value])).values())
                  if(!sampleAnimation(view,binding.animationName,0,binding.rawPlayType===0))throw Error('Missing Apocalypse preparation animation: '+binding.animationName);
                resetPose(view);
              });
            }
            if(!current())return;
            await Promise.all(view.root.getChildMeshes().filter(mesh=>mesh.material&&mesh.getTotalVertices()>0)
              .map(mesh=>scheduleRenderPreparation(()=>current()&&!mesh.isDisposed()?prepareMesh(mesh):undefined)));
            if(current())row.ready=true;
          }catch(error){
            if(!current())return;
            prepared.delete(id);if(row.view&&entries.get(id)?.view!==row.view)row.view.dispose();throw error;
          }
        })();
      }
      jobs.push(row.job);
    }
    await Promise.all(jobs);
  }
  function update(actors){
    if(disposed)return;
    const active=new Set();
    for(const actor of actors){
      if(actor.pvpDisconnected)continue;
      const npc=actor.sourceAddSummon;if(!npc||npc.kind!=='apocalypse')continue;
      active.add(actor.id);let entry=entries.get(actor.id);
      if(entry&&entry.serial!==npc.serial){release(actor.id);entry=null;}
      if(!entry){
        const reserve=prepared.get(actor.id),view=reserve?.view??makeView(actor.id+'-apocalypse-'+npc.serial);
        if(reserve?.view){resetPose(view);counts.preparedActivations++;if(!reserve.ready)counts.unpreparedActivations++;}else counts.runtimeCreates++;
        entry={serial:npc.serial,view};entries.set(actor.id,entry);
      }
      const a=addSummonAnimation(resource.manifest,npc),view=entry.view;
      if(!a||!sampleAnimation(view,a.name,a.time,a.loop)){
        view.root.setEnabled(false);if(!view.missing.has(npc.state)){view.missing.add(npc.state);onUnsupported({type:'unsupported-summon-animation',state:npc.state});}continue;
      }
      view.root.position.set(npc.position[0]*scale,npc.position[1]*scale,-npc.position[2]*scale);
      const [x,y,z,w]=addSummonWorldQuaternion(npc);view.root.rotationQuaternion??=new Quaternion();
      view.root.rotationQuaternion.set(-x,-y,z,w);view.root.setEnabled(actor.hidden!==true);
    }
    for(const id of entries.keys())if(!active.has(id))release(id);
  }
  return {update,prewarmActors,reset(){for(const id of entries.keys())release(id);},clear,
    proof(){return {instances:entries.size,owners:[...entries.keys()],meshes:[...entries.values()].reduce((n,e)=>n+e.view.meshes.filter(m=>m.getTotalVertices()).length,0),
      preparation:{...counts,owners:[...prepared.keys()],ready:[...prepared].filter(([,row])=>row.ready).map(([id])=>id),
        residentViews:new Set([...entries.values(),...prepared.values()].map(row=>row.view).filter(Boolean)).size}};},
    dispose(){if(disposed)return;disposed=true;clear();}};
}
