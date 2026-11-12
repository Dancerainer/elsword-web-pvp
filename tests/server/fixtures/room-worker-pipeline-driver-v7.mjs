// Authored transport fixture with the real owner driver and validation. Its
// straight map is not a real-map or original-client combat acceptance test.
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../../apps/server/local-owner-driver.mjs';
const profile=JSON.parse(readFileSync(new URL('../../../packages/combat-core/rf-profile.json',import.meta.url)));
export function createPipelineFixture(match,emit=()=>{}){
 const map={sceneId:'pipeline-owner-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:match.players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,
   position:[index*1000,0,0],lineId:0,facingRight:true}))};
 const simulation=createSimulation({profile,map,actors:match.players.map((player,index)=>({...player,position:[index*1000,0,0]})),
  seed:16,versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
 const pvp=new PvpMatch({mode:match.mode??'2v2',players:match.players,map,seed:16,versions:simulation.versions});
 const driver=createLocalOwnerBattleDriver({match,simulation,pvp,emit,finish:()=>{},manual:true,clock:()=>0});
 for(const player of match.players)driver.ready(player.id);driver.tick(10);
 const ready=driver.ready;driver.ready=id=>{const value=ready(id);driver.tick(0);return value;};
 return {simulation,driver};
}
export async function createBattleDriverFactory(){
 return options=>createPipelineFixture(options.match,options.emit).driver;
}
