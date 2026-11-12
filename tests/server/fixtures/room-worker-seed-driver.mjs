// Authored lifecycle clock fixture: X advances a life before its next action,
// C advances a life with only a state, Z emits a reliable action. Source frames
// deliberately remain adjacent across lives, as after a stalled browser.
import {registerLocalOwnerInputConsumer} from '../../../packages/online/service.mjs';
export async function createBattleDriverFactory(){
  return ({match,emit})=>{
    let epoch=1,frameSeq=100,actionId=0,stopped=false;
    const state=()=>({matchId:match.id,ownership:{mode:'local-owner-v1',actors:Object.fromEntries(match.players.map(player=>
      [player.id,{epoch,frameSeq}]))},snapshot:{actors:match.players.map(player=>({id:player.id,x:0,buffs:[],stats:{},pvpDead:false,pvpDisconnected:false}))},events:[],owners:{}});
    const driver={ownership:'local-owner-v1',snapshot:state,ready(){return {ok:true};},disconnect(){},stop(){stopped=true;}};
    registerLocalOwnerInputConsumer(driver,(playerId,batch)=>{
      if(stopped)return {accepted:false};
      const frame=batch.frames.at(-1);frameSeq=frame.frameSeq;
      if(frame.pressed.includes('X')||frame.pressed.includes('C')){epoch++;actionId=0;}
      if(frame.pressed.includes('Z'))emit('input',{matchId:match.id,playerId,epoch,frameSeq,
        actions:[{id:++actionId,frameSeq,actor:{x:frameSeq,buffs:[]},effects:[]}]});
      emit('state',state());return {accepted:true,frameSeq};
    });
    return driver;
  };
}
