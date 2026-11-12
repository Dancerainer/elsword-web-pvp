import {createPvpHud} from '../../apps/web/pvp-hud.mjs';
import {createPlayerNameplates} from '../../apps/web/player-nameplates.mjs';
import source from '../../contracts/rf-pvp-hud-source-v1.json' with {type:'json'};

/** The same workload can run against pre-optimization constructors. It reports
 * mutations instead of requiring stable old nodes. Synchronous 720 updates
 * represent 12Hz UI work, not one minute of measured browser FPS. */
export async function measureHudUpdateWorkload({host=document.body,updates=720}={}){
  const document=host.ownerDocument,stage=document.createElement('div');host.append(stage);
  const players=['LK','RS','MM','CA'].map((professionId,index)=>({id:'p'+index,nickname:'Character '+index,professionId,team:index<2?0:1,kills:index,assists:0,deaths:0}));
  const pvp={phase:'fight',mode:'2v2',remaining:300,score:[1,2],players},actors=players.map(p=>({id:p.id,team:p.team,hp:100,maxHp:100,mp:100,maxMp:300}));
  const hud=createPvpHud({host:stage,localId:'p0',pvpAssets:{pieces:source.pixelAssets}}),names=createPlayerNameplates({host:stage});
  const observer=new MutationObserver(()=>{}),originalCreate=document.createElement,createDescriptor=Object.getOwnPropertyDescriptor(document,'createElement');let creates=0;
  const totals={records:0,childList:0,attributes:0,added:0,removed:0};
  const consume=()=>{for(const record of observer.takeRecords()){totals.records++;totals[record.type]=(totals[record.type]??0)+1;totals.added+=record.addedNodes.length;totals.removed+=record.removedNodes.length;}};
  const update=index=>{hud.update(pvp,{actors,localId:'p0'});names.update(actors,{players,localId:'p0',visible:true,projectFeet:()=>({x:220+index/10,y:300})});};
  try{
    update(0);hud.show(true);hud.toggle(true);observer.observe(stage,{subtree:true,childList:true,attributes:true,characterData:true});
    document.createElement=function(...args){creates++;return Reflect.apply(originalCreate,this,args);};
    const started=performance.now();
    for(let i=0;i<updates;i++){if(i%12===0)pvp.remaining--;actors[1].hp=100-i%90;update(i);consume();}
    const elapsedMs=performance.now()-started,board=stage.querySelector('.pvp-board');
    return {updates,elapsedMs,elementConstructions:creates,mutations:totals,finalBoardText:board.textContent,finalBoardRows:board.querySelectorAll('tbody tr').length,
      finalNameplates:[...stage.querySelectorAll('.online-nameplate')].map(node=>({id:node.dataset.playerId,name:node.textContent,left:node.style.left,top:node.style.top})),
      evidence:'Actual DOM synchronous paired workload; changing timer, one HP gauge and four moving nameplates; not FPS or original-client evidence'};
  }finally{if(createDescriptor)Object.defineProperty(document,'createElement',createDescriptor);else delete document.createElement;observer.disconnect();hud.dispose();names.dispose();stage.remove();}
}

/** Browser-only acceptance helper. Run from a user-triggered local harness;
 * the observer measures actual DOM operations, not a renderer's own counters.
 * Asset pixels and normal table semantics use the production constructors. */
export async function runHudStabilityAudit({host=document.body,updates=720}={}){
  const document=host.ownerDocument,stage=document.createElement('div');stage.className='hud-stability-v47';host.append(stage);
  const pvp={phase:'fight',mode:'2v2',remaining:300,score:[1,2],players:[
    {id:'a',nickname:'Alpha <safe text>',team:0,kills:1,assists:0,deaths:0,professionId:'LK'},
    {id:'b',nickname:'Bravo',team:0,kills:0,assists:1,deaths:1,professionId:'RS'},
    {id:'c',nickname:'Charlie',team:1,kills:0,assists:0,deaths:1,professionId:'MM'},
    {id:'d',nickname:'Delta',team:1,kills:2,assists:0,deaths:0,professionId:'CA'},
  ]};
  const actors=pvp.players.map(player=>({id:player.id,team:player.team,hp:100,maxHp:100,mp:100,maxMp:300}));
  const hud=createPvpHud({host:stage,localId:'a',pvpAssets:{pieces:source.pixelAssets}}),names=createPlayerNameplates({host:stage});
  const feet=()=>({x:220,y:300});
  const update=()=>{hud.update(pvp,{actors,localId:'a'});names.update(actors,{players:pvp.players,localId:'a',visible:true,projectFeet:feet});};
  const observer=new MutationObserver(()=>{});observer.observe(stage,{subtree:true,childList:true,attributes:true,characterData:true});
  const take=()=>{const records=observer.takeRecords();return {records:records.length,childList:records.filter(r=>r.type==='childList').length,
    attributes:records.filter(r=>r.type==='attributes').length,added:[...records].reduce((n,r)=>n+r.addedNodes.length,0),removed:[...records].reduce((n,r)=>n+r.removedNodes.length,0)};};
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  try{
    update();hud.show(true);hud.toggle(true);take();
    const board=stage.querySelector('.pvp-board'),body=board.querySelector('tbody'),before=[...board.querySelectorAll('*')];
    const rows=new Map([...body.rows].map(row=>[row.dataset.playerId,row]));
    const started=performance.now();for(let i=0;i<updates;i++)update();const elapsedMs=performance.now()-started,stable=take();
    assert(stable.records===0,'Unchanged HUD/nameplate update mutated actual DOM: '+JSON.stringify(stable));
    assert([...board.querySelectorAll('*')].every((node,index)=>node===before[index]),'Board node identity changed');
    pvp.players[0].kills=7;pvp.players[0].nickname='<renamed>';pvp.players[0].connected=false;update();const changed=take();
    assert(rows.get('a').cells[0].textContent==='<renamed> · Offline'&&rows.get('a').cells[1].textContent==='7','Nickname/KAD did not update');
    assert(rows.get('a').classList.contains('disconnected'),'Disconnect did not update');
    pvp.players.reverse();update();assert([...body.rows].every((row,index)=>row===rows.get(pvp.players[index].id)),'Reordered identities were lost');
    const order=take();hud.toggle(false);hud.toggle(true);assert([...body.rows].every(row=>row===rows.get(row.dataset.playerId)),'Toggle recreated player rows');take();
    const labels=[...stage.querySelectorAll('.online-nameplate')],events=[];
    const nameObserver=new MutationObserver(()=>{});nameObserver.observe(stage.querySelector('.online-nameplates'),{subtree:true,childList:true,attributes:true});
    for(const player of pvp.players)player.connected=true;pvp.players[0].nickname='Moved and renamed';
    names.update(actors,{players:pvp.players,localId:'a',visible:true,projectFeet:()=>{events.push(nameObserver.takeRecords().length);return{x:225,y:305};}});
    assert(events.length===actors.length&&events.every(n=>n===0),'Label DOM write occurred between canvas projection reads');nameObserver.disconnect();
    assert(labels.every(label=>label.style.left==='225px'&&label.style.top==='305px'),'Nameplate motion was not applied');
    hud.clear();names.clear();assert(board.children.length===0&&stage.querySelectorAll('.online-nameplate').length===0,'Clear retained match DOM');
    return {status:'passed',updates,elapsedMs,stable,changed,order,nodeCount:before.length,projectionReadCount:events.length,
      guarantees:['unchanged real DOM has zero mutations','KAD and safe nickname update','disconnect and roster order update','toggle retains rows','projections precede label writes','clear releases match nodes']};
  }finally{observer.disconnect();hud.dispose();names.dispose();stage.remove();}
}
