/** Display-only fixture: production HUD/nameplates and actual converted UI pieces. */
import {createPvpHud} from '../../apps/web/pvp-hud.mjs';
import {createPlayerNameplates} from '../../apps/web/player-nameplates.mjs';

const frame=document.querySelector('#hud-frame');
if(frame){
  let expanded=true;
  function renderFrame(){
    const mode=document.querySelector('[name=mode]:checked').value,width=Number(document.querySelector('[name=width]:checked').value);
    frame.style.width=width+'px';frame.src='/stage.html?mode='+mode+'&expanded='+String(expanded);
  }
  for(const input of document.querySelectorAll('input[type=radio]'))input.addEventListener('change',renderFrame);
  document.querySelector('#toggle').addEventListener('click',()=>{expanded=!expanded;renderFrame();});
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='pvp-font-metrics')return;
    const output=document.querySelector('#measurements');output.textContent=JSON.stringify(event.data.value,null,2);output.dataset.metrics=JSON.stringify(event.data.value);
    document.querySelector('#ready').textContent='Source UI assets and production HUD loaded. Measurements below use the DOM layout.';
  });
  renderFrame();
}else{
const host=document.querySelector('#stage'),parameters=new URLSearchParams(location.search),mode=parameters.get('mode')??'2v2';
const [pvpAssets,hudAssets]=await Promise.all(['/assets/ui/pvp-hud/manifest.json','/assets/ui/manifest.json'].map(async url=>{
  const response=await fetch(url);if(!response.ok)throw Error('UI fixture: '+response.status+' '+url);return response.json();
}));
const names=['ABCDEFGHIJKLMNOP','RecklessFistAlpha','Raven012345678901','NasodCoreShield','ArchenemyBurst','SixPlayerScore'];
const allPlayers=names.map((nickname,index)=>({id:'font-player-'+index,nickname,team:index%2,kills:index===0?99:index,assists:index+2,deaths:index+1,connected:true}));
const allActors=allPlayers.map(player=>({id:player.id,team:player.team,hp:800000,maxHp:800000,mp:150,maxMp:300}));
const hud=createPvpHud({host,localId:allPlayers[0].id,pvpAssets,hudAssets}),nameplates=createPlayerNameplates({host});
const expanded=parameters.get('expanded')!=='false';
function rect(node){const value=node.getBoundingClientRect();return {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height};}
function measure(){
  const board=host.querySelector('.pvp-board'),bounds=rect(host),boardBounds=rect(board);
  const cells=[...board.querySelectorAll('tbody tr')].map(row=>({id:row.dataset.playerId,
    nickname:row.cells[0].textContent,nicknameFont:getComputedStyle(row.cells[0]).fontSize,
    nicknameWidth:row.cells[0].clientWidth,nicknameClipped:row.cells[0].scrollWidth>row.cells[0].clientWidth,
    stats:[...row.cells].slice(1).map(cell=>({value:cell.textContent,width:cell.clientWidth,clipped:cell.scrollWidth>cell.clientWidth})),
    color:getComputedStyle(row.cells[0]).color,height:rect(row).height}));
  const labels=[...host.querySelectorAll('.online-nameplate')].map(label=>({id:label.dataset.playerId,text:label.textContent,
    font:getComputedStyle(label).fontSize,color:getComputedStyle(label).color,maxWidth:getComputedStyle(label).maxWidth,
    clipped:label.scrollWidth>label.clientWidth}));
  const value={evidenceClass:'simulation-browser-display-fixture',originalClientMeasured:false,
    viewport:{width:innerWidth,height:innerHeight},stage:bounds,board:boardBounds,
    boardWithinStage:boardBounds.left>=bounds.left&&boardBounds.right<=bounds.right,
    stageHorizontalOverflow:host.scrollWidth>host.clientWidth,
    mode,expanded,cells,labels,
    headerFont:getComputedStyle(board.querySelector('th')??board).fontSize,
    memberNameFont:getComputedStyle(host.querySelector('.pvp-member-name')).fontSize,
    readyImages:[...host.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth>0).length,
    imageCount:host.querySelectorAll('img').length};
  parent.postMessage({type:'pvp-font-metrics',value},location.origin);
}
function render(){
  const players=allPlayers.slice(0,Number(mode[0])*2),actors=allActors.slice(0,players.length);
  hud.show(true);hud.update({mode,players,phase:'fight',score:[2,1],remaining:330,scoreLimit:mode==='3v3'?6:4},{actors});hud.toggle(expanded);
  nameplates.update(actors,{localId:allPlayers[0].id,players,visible:true,projectFeet:actor=>{
    const index=actors.indexOf(actor),columns=host.clientWidth<700?2:3;
    return {x:(index%columns+.5)*host.clientWidth/columns,y:250+Math.floor(index/columns)*62};
  }});
  requestAnimationFrame(measure);
}
addEventListener('resize',render);
render();await document.fonts.ready;
await Promise.all([...host.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));measure();
}
