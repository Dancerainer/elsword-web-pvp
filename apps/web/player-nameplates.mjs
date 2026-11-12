/** Fixed V5 RenderName projects GetPos. Browser text rasterization is an adapter. */
export function createPlayerNameplates({host}){
  const root=host.ownerDocument.createElement('div');root.className='online-nameplates';host.append(root);
  const labels=new Map();
  const set=(target,key,value)=>{if(target[key]!==value)target[key]=value;};
  return {
    update(actors,{localId,players=[],projectFeet,visible}){
      if(!visible){set(root,'hidden',true);return;}
      const present=new Set(actors.map(a=>a.id));
      const byId=new Map(players.map(player=>[player.id,player]));
      // projectFeet reads the canvas layout. Complete all those reads before
      // changing any text or positioned label, so four players cannot force
      // four alternating layout flushes within one presentation frame.
      for(const actor of actors){
        let row=labels.get(actor.id);if(!row){row={label:host.ownerDocument.createElement('span'),attached:false};labels.set(actor.id,row);}
        const player=byId.get(actor.id),team=player?.team??actor.team;
        row.className='online-nameplate team-'+team+(actor.id===localId?' local-player':'');row.id=String(actor.id);
        row.name=String(player?.nickname??player?.name??actor.nickname??actor.name??actor.id);
        const point=actor.hidden||actor.pvpDisconnected||player?.connected===false?null:projectFeet?.(actor);
        row.hidden=!point||!Number.isFinite(point.x)||!Number.isFinite(point.y);
        if(!row.hidden){row.left=point.x+'px';row.top=point.y+'px';}
      }
      set(root,'hidden',false);
      for(const [id,row]of labels){
        if(!present.has(id)){row.label.remove();labels.delete(id);continue;}
        const {label}=row;
        if(!row.attached){root.append(label);row.attached=true;}
        set(label,'className',row.className);set(label.dataset,'playerId',row.id);set(label,'textContent',row.name);set(label,'title',row.name);
        set(label,'hidden',row.hidden);if(!row.hidden){set(label.style,'left',row.left);set(label.style,'top',row.top);}
      }
    },clear(){labels.clear();root.replaceChildren();root.hidden=true;},dispose(){this.clear();root.remove();}
  };
}
