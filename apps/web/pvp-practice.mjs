/** Offline 2v2 uses the same authored starts and match lifecycle as online play.
 * The other three slots are idle training models, not AI or network accounts.
 * No result is submitted to the account history service.
 */
import {PvpMatch,chooseTeamSpawns} from '../../packages/pvp/index.mjs';

export function createPvpPractice({localId,nickname=localId,loadout,map,createSimulation,seed=2016,professionId='RF',specialResourcePools=[]}){
  if(typeof localId!=='string'||!localId)throw new TypeError('Practice player ID required');
  const used=new Set([localId]);
  const modelId=index=>{let id=`practice-model-${index}`;while(used.has(id))id+='-model';used.add(id);return id;};
  const players=[{id:localId,team:0,name:nickname,nickname},
    {id:modelId(1),team:0,name:'Practice ally',nickname:'Practice ally',model:true},
    {id:modelId(2),team:1,name:'Practice opponent 1',nickname:'Practice opponent 1',model:true},
    {id:modelId(3),team:1,name:'Practice opponent 2',nickname:'Practice opponent 2',model:true}]
    .map(p=>({...p,professionId,loadout:structuredClone(loadout)}));
  const spawns=chooseTeamSpawns(map,players);
  const simulation=createSimulation({players:players.map((p,i)=>({...p,...spawns[i]})),seed});
  const templates=structuredClone(simulation.state.actors);
  const match=new PvpMatch({players,map,seed,versions:simulation.versions,specialResourcePools,
    rules:{initialHaCooldown:0},
    onRespawn(id,spawn){
      const index=simulation.state.actors.findIndex(a=>a.id===id),actor=structuredClone(templates.find(a=>a.id===id));
      [actor.x,actor.y,actor.z]=spawn.position;actor.landPosition=[...spawn.position];
      simulation.state.actors[index]=actor;simulation.state.effects=simulation.state.effects.filter(effect=>effect.ownerId!==id);
      simulation.enter(actor,'RSI_WAIT','pvp-respawn');return actor;
    }});
  match.start(simulation);
  let ended=false;
  return {simulation,players,seed,
    get state(){return match.snapshot();},
    step(dt,input){
      if(ended)return {pvp:match.snapshot(),events:[],result:null};
      const phase=match.state.phase;
      if(phase==='fight'||phase==='slow')simulation.step(dt*match.timeScale,
        phase==='fight'?{[localId]:input}:{},{snapshot:false});
      const events=simulation.drainEvents();
      for(const event of events)if(event.type==='hit')match.recordHit({attackerId:event.actorId,targetId:event.targetId,damage:event.amount});
      match.advance(dt,simulation);events.push(...match.drainEvents());
      const pvp=match.snapshot(),result=pvp.phase==='result'?pvp.result:null;
      if(result)ended=true;
      return {pvp,events,result};
    },
    stop(){ended=true;},
  };
}
