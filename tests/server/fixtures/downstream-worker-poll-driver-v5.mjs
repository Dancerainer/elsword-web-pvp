import {registerLocalOwnerInputConsumer} from '../../../packages/online/service.mjs';

// X advances the source life, Z creates one reliable action. Frame numbers are
// supplied independently so adjacent frames can straddle the life boundary.
export async function createBattleDriverFactory(){
  return ({match,emit})=>{
    const epochs=new Map(match.players.map(player=>[player.id,1]));
    const frames=new Map(match.players.map(player=>[player.id,0])),actions=new Map(),owners=new Map();
    let stopped=false;
    const actor=id=>({id,x:frames.get(id),y:0,z:0,hp:100,buffs:[],stats:{maxHp:100},loadout:[],pvpDead:false,pvpDisconnected:false});
    const state=()=>({matchId:match.id,ownership:{mode:'local-owner-v1',actors:Object.fromEntries(match.players.map(player=>
      [player.id,{epoch:epochs.get(player.id),frameSeq:frames.get(player.id)}]))},
      snapshot:{actors:match.players.map(player=>actor(player.id)),effects:[]},events:[],owners:Object.fromEntries(owners)});
    const driver={ownership:'local-owner-v1',snapshot:state,ready(){emit('state',state());return {ok:true};},disconnect(){},stop(){stopped=true;}};
    registerLocalOwnerInputConsumer(driver,(playerId,batch)=>{
      if(stopped)return {accepted:false};
      const frame=batch.frames.at(-1);frames.set(playerId,frame.frameSeq);
      if(frame.pressed.includes('X')){epochs.set(playerId,epochs.get(playerId)+1);actions.set(playerId,0);owners.delete(playerId);}
      const report={protocol:'local-owner-v1',epoch:epochs.get(playerId),frameSeq:frame.frameSeq,actor:actor(playerId),effects:[],hits:[]};
      owners.set(playerId,report);emit('owned-state',{matchId:match.id,playerId,report});
      if(frame.pressed.includes('Z')){
        const id=(actions.get(playerId)??0)+1;actions.set(playerId,id);
        emit('input',{matchId:match.id,playerId,epoch:report.epoch,frameSeq:report.frameSeq,
          actions:[{id,frameSeq:report.frameSeq,actor:{x:report.actor.x,buffs:[]},effects:[]}]});
      }
      emit('state',state());return {accepted:true,frameSeq:frame.frameSeq};
    });
    return driver;
  };
}
