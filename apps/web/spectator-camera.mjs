/** User-selected death camera policy. This reads roster/actor state only;
 * random enemy selection belongs to presentation, never the combat RNG. */
export function createSpectatorCamera({random=Math.random}={}){
  let targetId=null,kind='self',allies=[],players=[],localId=null;
  const result=()=>({targetId,kind,tracking:kind!=='hold',spectating:!['self','death'].includes(kind),canCycle:kind==='ally'&&allies.length>1,
    name:String(players.find(p=>p.id===targetId)?.nickname??players.find(p=>p.id===targetId)?.name??targetId??'')});
  return {
    update({actors=[],players:roster=actors,localId:id=actors[0]?.id,enabled=true}={}){
      players=roster;localId=id;
      const byId=new Map(actors.map(a=>[a.id,a])),local=players.find(p=>p.id===localId),actor=byId.get(localId);
      const alive=p=>{const a=byId.get(p.id);return p.connected!==false&&p.alive!==false&&a?.pvpDisconnected!==true&&a?.pvpDead!==true&&a?.hp>0;};
      if(!enabled||local&&alive(local)){targetId=localId;kind='self';allies=[];return result();}
      // Keep the complete local death pose and fade on screen before choosing
      // a spectator. Room alive=false alone does not mean the model vanished.
      if(actor&&!actor.pvpDisconnected&&!actor.hidden&&!actor.deathComplete){targetId=localId;kind='death';allies=[];return result();}
      const team=local?.team??actor?.team;
      const live=team==null?[]:players.filter(alive);
      allies=live.filter(p=>p.id!==localId&&(p.team??byId.get(p.id)?.team)===team);
      if(allies.length){
        if(kind!=='ally'||!allies.some(p=>p.id===targetId))targetId=allies[0].id;
        kind='ally';return result();
      }
      const enemies=live.filter(p=>(p.team??byId.get(p.id)?.team)!==team);
      if(enemies.length){
        if(kind!=='enemy'||!enemies.some(p=>p.id===targetId)){
          const draw=random();targetId=enemies[Math.min(enemies.length-1,Math.max(0,Math.floor((Number.isFinite(draw)?draw:0)*enemies.length)))].id;
        }
        kind='enemy';return result();
      }
      // Keep the last rendered camera. Following the dead actor would move it
      // with a death animation, so tracking is suspended until someone revives.
      targetId??=localId;kind='hold';return result();
    },
    cycle(direction){
      if(kind!=='ally'||allies.length<2)return false;
      const index=allies.findIndex(p=>p.id===targetId);
      targetId=allies[(index+(direction<0?-1:1)+allies.length)%allies.length].id;return true;
    },
    view:result,
    reset(){targetId=null;kind='self';allies=[];players=[];localId=null;},
  };
}

export function spectatorText(view){
  if(!view?.spectating)return '';
  if(view.kind==='hold')return 'Awaiting respawn · Holding camera position';
  return 'Spectating '+view.name+(view.kind==='ally'?(view.canCycle?' · Z / X to switch allies':' · Surviving ally'):' · Opponent view');
}
