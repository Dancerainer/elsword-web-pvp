import {registerLocalOwnerInputConsumer} from '../../../packages/online/service.mjs';
export async function createBattleDriverFactory(){
  return ({match,emit})=>{
    if(match.id==='health-initialize-failure')throw Error('fixture-private-initialize-detail');
    const driver={ownership:'local-owner-v1',snapshot:()=>({matchId:match.id,ownership:{mode:'local-owner-v1',actors:{}},snapshot:{actors:[]},events:[],owners:{}}),
      ready:()=>({ok:true}),disconnect(){},stop(){}};
    registerLocalOwnerInputConsumer(driver,(_id,batch)=>{
      if(batch.frames.at(-1).pressed?.includes('X'))emit('fixture-overflow',{payload:'x'.repeat(17*1024*1024)});
      return {accepted:true};
    });
    return driver;
  };
}
