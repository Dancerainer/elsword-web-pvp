// Real owner validation and FIFO action/pose emission with an isolated authored
// map. No render, source input or original-client latency claim is made here.
import {createSimulation} from '../../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../../apps/server/local-owner-driver.mjs';
import profile from '../../../packages/combat-core/rf-profile.json' with {type:'json'};

export async function createBattleDriverFactory(){
  return ({match,emit,finish})=>{
    const map={sceneId:match.sceneId,lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
      starts:match.players.map((player,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:player.team===0,
        position:[i*200,0,0],lineId:0,facingRight:true}))};
    const simulation=createSimulation({profile,map,seed:match.seed,
      actors:match.players.map((player,i)=>({...player,position:[i*200,0,0],lineId:0})),
      versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
    const pvp=new PvpMatch({mode:match.mode,players:match.players,map,seed:match.seed,versions:simulation.versions});
    const driver=createLocalOwnerBattleDriver({match,simulation,pvp,emit,finish,manual:true});
    const ready=driver.ready.bind(driver),entered=new Set();
    driver.ready=id=>{const value=ready(id);entered.add(id);if(entered.size===match.players.length)driver.tick(10);return value;};
    return driver;
  };
}
