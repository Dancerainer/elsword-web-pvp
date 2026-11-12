import {characterToonMaterial} from './character-toon-material.mjs';
import {authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';
import {scheduleRenderPreparation} from './render-preparation.mjs';
/** GUUser8938/12290/17524 and target XRenderer ADD_CARTOON. This is an
 * additive source-ramp shader selection, not another physical scene lamp. */
export function createHitLighting({scene,viewFor,mapFor=()=>null}){
  const rows=new Map();
  function reset(row){for(const p of row.materials)p.damage=false;row.active=false;}
  const makeRow=()=>({remaining:0,materials:new Set(),direction:[0,0,0],active:false,dirty:false});
  function bind(row,view){
    if(row.view===view&&row.root===view.root&&row.meshSource===view.meshes&&
      row.meshCount===(view.meshes?.length??0)&&row.costume===view.costume)return;
    reset(row);row.materials.clear();
    row.meshes=view.root?.getChildMeshes?.()??view.meshes??[];
    for(const mesh of row.meshes){const p=characterToonMaterial(mesh.material);if(p)row.materials.add(p);}
    Object.assign(row,{view,root:view.root,meshSource:view.meshes,meshCount:view.meshes?.length??0,costume:view.costume,dirty:true});
  }
  return {
    async prewarm(actors){
      const ids=new Set(actors.map(a=>a.id)),meshes=new Set();
      for(const [id,row]of rows)if(!ids.has(id)){reset(row);rows.delete(id);}
      for(const actor of actors){const view=viewFor(actor.id);if(!view)continue;
        let row=rows.get(actor.id);if(!row){row=makeRow();rows.set(actor.id,row);}bind(row,view);
        for(const mesh of row.meshes)if(mesh.material&&mesh.getTotalVertices()>0)meshes.add(mesh);}
      await Promise.all([...meshes].map(mesh=>scheduleRenderPreparation(()=>{
        if(mesh.isDisposed?.()||!mesh.material)return;
        return mesh.material.forceCompilationAsync(mesh);
      })));
    },
    event(event,state){
      if(!['hit','observedHit'].includes(event.type)||!(event.amount>0))return;
      // CEffect calls AttackResultByType; GUUser's implementation returns
      // immediately. Only the defender gets its DamageReact light there.
      const bodyHit=event.origin?.kind==null||event.origin.kind==='character';
      for(const id of bodyHit?[event.actorId,event.targetId]:[event.targetId]){
        const actor=state.actors.find(a=>a.id===id),other=state.actors.find(a=>a.id===(id===event.actorId?event.targetId:event.actorId));
        if(!actor||!other)continue;
        let row=rows.get(id);if(!row){row=makeRow();rows.set(id,row);}
        const dx=other.x-actor.x,dz=(other.z??0)-(actor.z??0),length=Math.hypot(dx,dz);
        let x=length>0?dx/length:actor.facing??1,z=length>0?-dz/length:0;
        row.directionEvidence='observed-planar-direction';
        const map=mapFor();if(map){const forward=authoredLineBasis(actor,map).dirVector;
          const side=id===event.targetId&&typeof actor.lastAttackerFront==='boolean'?
            (actor.lastAttackerFront?1:-1)*(actor.facing??1):Math.sign(forward[0]*dx+forward[2]*dz)||1;
          x=forward[0]*side;z=-forward[2]*side;row.directionEvidence='fixed-V5-line-direction-and-attacker-side';}
        // Renderer normalizes float4(lightPos.xyz,1); source hit vector is
        // planar with length1000. glTF flips original Z.
        const scale=1000/Math.hypot(x*1000,z*1000,1);row.direction=[x*scale,0,z*scale];row.remaining=.2;row.dirty=true;
      }
    },
    step(dt){for(const [id,row]of rows){const view=viewFor(id);row.remaining=Math.max(0,row.remaining-Math.max(0,Number.isFinite(dt)?dt:0));
      if(!view){reset(row);rows.delete(id);continue;}bind(row,view);
      if(row.remaining>0){if(!row.active||row.dirty)for(const p of row.materials){p.damage=true;p.direction=row.direction;}
        row.active=true;row.dirty=false;
      }else if(row.active)reset(row);}},
    clear(){for(const row of rows.values())reset(row);rows.clear();},
    reset(){for(const row of rows.values()){reset(row);row.remaining=0;}},
    proof(){return [...rows].map(([actorId,row])=>({actorId,remaining:row.remaining,activeMaterials:row.active?row.materials.size:0,
      direction:[...row.direction],directionEvidence:row.directionEvidence,shader:'original2016-ADD_CARTOON',sceneLightsAdded:0}));},
  };
}
