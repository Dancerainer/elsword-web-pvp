import {assetUrl} from './asset-urls.mjs';
import {PROFESSIONS} from '../../packages/professions/catalog.mjs';
const el=(document,tag,text,className)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(className)e.className=className;return e;};
const nameOf=player=>String(player?.nickname??player?.name??player?.id??'');
const count=value=>Number.isFinite(value)?Math.max(0,Math.trunc(value)):0;
const clamp=value=>Math.max(0,Math.min(1,value));
const MEMBER_ROW_STRIDE=44;
const setValue=(target,key,value)=>{if(target[key]!==value)target[key]=value;};
const setAttribute=(node,key,value)=>{if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
const syncChildren=(node,children)=>{
  if(node.children.length!==children.length||children.some((child,index)=>node.children[index]!==child))node.replaceChildren(...children);
};
/** Frozen roster profession is primary; the actor can arrive after the row.
 * Portrait keys are presentation hints, never a cross-profession override. */
export function pvpMemberProfession(player){
  return PROFESSIONS[player?.professionId??player?.actor?.professionId]??PROFESSIONS.RF;
}
/** Fixed V5 prints int(GetRemainPlayTime()), rather than a minutes clock. */
export function pvpCountdown(remaining){return String(Number.isFinite(remaining)?Math.max(0,Math.trunc(remaining)):0);}
export function pvpRoster(pvp,actors=[],localId){
  const byId=new Map(actors.map(actor=>[actor.id,actor]));
  const players=(pvp?.players??actors).map(player=>({...player,actor:byId.get(player.id)}));
  const local=players.find(player=>player.id===localId),team=local?.team??local?.actor?.team;
  return {players,local,allies:team==null?[]:players.filter(player=>player.id!==localId&&(player.team??player.actor?.team)===team),
    opponents:team==null?[]:players.filter(player=>(player.team??player.actor?.team)!==team)};
}
/** Unknown maxima stay unknown. Enemy MP follows the explicit UI permission. */
export function pvpMemberGauges(local,player){
  const actor=player?.actor,connected=player?.connected!==false&&actor?.pvpDisconnected!==true;
  const team=local?.team??local?.actor?.team,ownTeam=team!=null&&(player?.team??actor?.team)===team;
  const showMp=ownTeam||local?.actor?.uiAbilities?.showOpponentMp===true;
  const read=kind=>{const value=actor?.[kind],maximum=actor?.[kind==='hp'?'maxHp':'maxMp']??actor?.[kind==='hp'?'hpMax':'mpMax'];
    return connected&&Number.isFinite(value)&&Number.isFinite(maximum)&&maximum>0?{fraction:clamp(value/maximum),text:Math.max(0,Math.round(value))+' / '+maximum}:{fraction:0,text:connected?'—':''};};
  return {hp:read('hp'),mp:showMp?read('mp'):{fraction:0,text:''},showMp,connected};
}
export function createPvpHud({host,document=host.ownerDocument,localId,onReturn=()=>{},assets=null,pvpAssets=null,hudAssets=null,timers=globalThis,scoreLimit=4}){
  const root=el(document,'section',null,'pvp-hud'),scoreboard=el(document,'section',null,'pvp-scoreboard'),score=el(document,'div',null,'pvp-score'),time=el(document,'div',null,'pvp-time'),goal=el(document,'div',null,'pvp-goal');
  scoreboard.setAttribute('aria-label','Match score and time remaining');
  const banner=el(document,'div',null,'pvp-banner'),respawn=el(document,'div',null,'pvp-respawn');
  const allies=el(document,'section',null,'pvp-allies'),opponents=el(document,'section',null,'pvp-opponents');
  allies.setAttribute('aria-label','Allies');opponents.setAttribute('aria-label','Opponents');time.setAttribute('role','timer');
  const board=el(document,'section',null,'pvp-board');board.setAttribute('aria-label','Kills, assists and deaths');
  const result=el(document,'section',null,'pvp-result');result.hidden=true;
  const clockFrame=el(document,'div',null,'pvp-clock-frame');
  scoreboard.append(clockFrame,score,time,goal);root.append(scoreboard,allies,opponents,banner,respawn,board,result);host.append(root);root.hidden=true;
  let expanded=false,lastPhase=null,bannerTimer=null,activeLocalId=localId,roster={players:[],local:null,allies:[],opponents:[]};
  let activeMode='2v2',lastScoreKey=null,resultAnnounced=false;
  const memberNodes=new Map(),boardRows=new Map();let boardView=null;
  function image(key,{status=false,className}={}){
    let piece=pvpAssets?.pieces?.[key],base='/assets/ui/pvp-hud/';
    if(status&&hudAssets?.pieces?.[key]){piece=hudAssets.pieces[key];base='/assets/ui/';}
    if(!piece?.file){piece=assets?.pieces?.['pvp:'+key];base='/assets/ui/online/';}
    if(!piece?.file)return null;const img=el(document,'img',null,className);img.src=assetUrl(base+piece.file);img.alt='';img.width=piece.width;img.height=piece.height;return img;
  }
  const piece=(key,className,text)=>image(key,{className})??el(document,'span',text,className);
  const cancelBanner=()=>{if(bannerTimer!=null)timers.clearTimeout(bannerTimer);bannerTimer=null;};
  function showBanner(text,key){cancelBanner();banner.dataset.piece=key;banner.replaceChildren(image(key)??el(document,'span',text));}
  function numberPieces(value,prefix,minimum,className){
    return [...String(value).padStart(minimum,'0')].map(digit=>piece(prefix+'_'+digit,className,digit));
  }
  function renderScore(pvp){
    activeMode=pvp.mode??'2v2';setValue(root.dataset,'mode',activeMode);
    const duel=activeMode==='1v1';setValue(score,'hidden',duel);setValue(goal,'hidden',duel);setValue(clockFrame,'hidden',!duel);
    const seconds=pvpCountdown(pvp.remaining??pvp.remainingSeconds??0);
    const values=pvp.score??pvp.scores??[0,0],team=roster.local?.team??roster.local?.actor?.team??0,blue=team===1;
    const own=count(values[team]),other=count(values[team===1?0:1]),limit=count(pvp.scoreLimit??(activeMode==='3v3'?6:scoreLimit));
    const key=JSON.stringify([activeMode,team,own,other,seconds,limit]);if(key===lastScoreKey)return;lastScoreKey=key;
    time.replaceChildren(el(document,'span',seconds,'pvp-sr-text'),...numberPieces(seconds,'TIMENUM',4,'pvp-time-digit'));
    time.setAttribute('aria-label','Remaining: '+seconds+' s');time.dataset.seconds=seconds;
    if(duel){clockFrame.replaceChildren(piece('BG_PVP','pvp-clock-background','TIME'));score.replaceChildren();goal.replaceChildren();return;}
    clockFrame.replaceChildren();
    const left=el(document,'div',null,'pvp-score-left'),right=el(document,'div',null,'pvp-score-right');
    left.append(...numberPieces(own,'LSCORE',2,'pvp-score-digit'));right.append(...numberPieces(other,'RSCORE',2,'pvp-score-digit'));
    score.replaceChildren(piece(blue?'BG_PVPSCORE_BLUE':'BG_PVPSCORE_RED','pvp-score-background',''),left,right);
    score.setAttribute('aria-label','Allies '+own+', opponents '+other);score.dataset.localTeam=String(team);
    const target=el(document,'div',null,'pvp-goal-number');target.append(...numberPieces(limit,'KILLNUM',2,'pvp-goal-digit'));
    goal.replaceChildren(el(document,'span',limit+' points to win','pvp-sr-text'),piece('TEXT_KILL','pvp-goal-label','KILL'),target);
    goal.setAttribute('aria-label',limit+' points to win');
  }
  function member(player,index,ownTeam){
    let widget=memberNodes.get(player.id);
    if(!widget){
      const node=el(document,'div',null,'pvp-member'),name=el(document,'span',null,'pvp-member-name'),level=el(document,'span',null,'pvp-member-level'),heading=el(document,'div',null,'pvp-member-heading');
      const frame=image('PARTY_GAGE_BG',{status:true,className:'pvp-member-frame'}),face=el(document,'img',null,'pvp-member-face');
      face.width=52;face.height=37;face.draggable=false;
      const hp=el(document,'div',null,'pvp-member-hp'),mp=el(document,'div',null,'pvp-member-mp'),hpNumber=el(document,'span',null,'pvp-member-hp-number'),mpNumber=el(document,'span',null,'pvp-member-mp-number');
      const hpImage=image('PARTY_HP',{status:true}),mpImage=image('PARTY_MP',{status:true});if(hpImage)hp.append(hpImage);if(mpImage)mp.append(mpImage);
      heading.append(level,name);node.append(...[frame,face,heading,hp,mp,hpNumber,mpNumber].filter(Boolean));widget={node,face,name,level,hp,mp,hpNumber,mpNumber,professionId:null};memberNodes.set(player.id,widget);
    }
    const profession=pvpMemberProfession(player);
    if(widget.professionId!==profession.id){widget.face.src=assetUrl(profession.portraitUrl);widget.face.alt=profession.name;widget.professionId=profession.id;}
    const gauge=pvpMemberGauges(roster.local,player),team=player.team??player.actor?.team;
    setValue(widget.node,'className','pvp-member team-'+team+(gauge.connected?'':' disconnected'));setValue(widget.node.dataset,'playerId',String(player.id));setValue(widget.node.dataset,'relationship',ownTeam?'ally':'enemy');
    setValue(widget.node.dataset,'professionId',profession.id);setValue(widget.node.style,'top',index*MEMBER_ROW_STRIDE+'px');setAttribute(widget.node,'aria-label',nameOf(player)+(gauge.connected?'':', disconnected'));
    setValue(widget.name,'textContent',nameOf(player)+(gauge.connected?'':' · Offline'));setValue(widget.name,'title',nameOf(player));
    const level=player.actor?.formulaRules?.combatLevel??player.actor?.level??player.level;setValue(widget.level,'hidden',!Number.isFinite(level)||level<=0);
    setValue(widget.level,'textContent',widget.level.hidden?'':'Lv '+Math.trunc(level));
    setValue(widget.hp.style,'width',(95*gauge.hp.fraction)+'px');setValue(widget.mp.style,'width',(93*gauge.mp.fraction)+'px');
    setValue(widget.hpNumber,'textContent',gauge.hp.text);setValue(widget.mpNumber,'textContent',gauge.mp.text);setValue(widget.node.dataset,'opponentMpVisible',String(gauge.showMp));
    return widget.node;
  }
  function renderMembers(){
    const keep=new Set([...roster.allies,...roster.opponents].map(player=>player.id));
    for(const [id,widget]of memberNodes)if(!keep.has(id)){widget.node.remove();memberNodes.delete(id);}
    syncChildren(allies,roster.allies.map((player,index)=>member(player,index,true)));syncChildren(opponents,roster.opponents.map((player,index)=>member(player,index,false)));
    setValue(allies.style,'height',roster.allies.length*MEMBER_ROW_STRIDE+'px');setValue(opponents.style,'height',roster.opponents.length*MEMBER_ROW_STRIDE+'px');
    setValue(allies,'hidden',!roster.allies.length);setValue(opponents,'hidden',!roster.opponents.length);
  }
  function rowsTable(players,{headers=true,rowAssets=false}={}){
    const table=el(document,'table');table.setAttribute('aria-label','Nickname, kills, assists, deaths');
    if(headers){const head=el(document,'thead'),tr=el(document,'tr');for(const label of ['Nickname','K','A','D']){const th=el(document,'th',label);th.setAttribute('scope','col');tr.append(th);}head.append(tr);table.append(head);}
    const body=el(document,'tbody');for(const player of players){const tr=el(document,'tr');tr.className='team-'+player.team+(player.id===activeLocalId?' local-player':'')+(player.connected===false?' disconnected':'');tr.dataset.playerId=String(player.id);
      const rowPiece=pvpAssets?.pieces?.[player.team===1?'PVP_SCORE_BLUE':'PVP_SCORE_RED'];if(rowAssets&&rowPiece?.file)tr.style.backgroundImage='url('+assetUrl('/assets/ui/pvp-hud/'+rowPiece.file)+')';
      for(const text of [nameOf(player)+(player.connected===false?' · Offline':''),count(player.kills),count(player.assists),count(player.deaths)]){const td=el(document,'td',text);td.title=String(text);tr.append(td);}body.append(tr);}
    table.append(body);return table;
  }
  function renderBoard(){
    const players=expanded?roster.players:roster.local?[roster.local]:[],height=expanded?40+players.length*21:40;
    setValue(board,'className','pvp-board'+(expanded?' expanded':''));setValue(board.dataset,'expanded',String(expanded));setAttribute(board,'aria-expanded',String(expanded));setValue(board.style,'height',height+'px');
    if(!boardView){
      const top=image('PVP_SCORE_TOP',{className:'pvp-board-top'}),middle=image('PVP_SCORE_MIDDLE',{className:'pvp-board-middle'}),bottom=image('PVP_SCORE_BOTTOM',{className:'pvp-board-bottom'}),tab=image('PVP_SCORE_TAB',{className:'pvp-board-tab'}),divider=image('PVP_SCORE_LINE',{className:'pvp-board-divider'});
      const table=el(document,'table'),head=el(document,'thead'),header=el(document,'tr'),body=el(document,'tbody');table.setAttribute('aria-label','Nickname, kills, assists, deaths');
      for(const label of ['Nickname','K','A','D']){const th=el(document,'th',label);th.setAttribute('scope','col');header.append(th);}head.append(header);
      if(tab)tab.title='Tab: toggle scoreboard';
      boardView={middle,divider,table,head,body};board.replaceChildren(...[top,middle,bottom,tab,divider,table].filter(Boolean));
    }
    const {middle,divider,table,head,body}=boardView;
    for(const image of [middle,divider])if(image){setValue(image,'hidden',!expanded);setValue(image.style,'height',players.length*21+'px');}
    const keep=new Set(roster.players.map(player=>player.id));
    for(const [id,row]of boardRows)if(!keep.has(id)){row.node.remove();boardRows.delete(id);}
    const nodes=players.map(player=>{
      let row=boardRows.get(player.id);
      if(!row){const node=el(document,'tr'),cells=Array.from({length:4},()=>el(document,'td'));node.dataset.playerId=String(player.id);node.append(...cells);row={node,cells};boardRows.set(player.id,row);}
      setValue(row.node,'className','team-'+player.team+(player.id===activeLocalId?' local-player':'')+(player.connected===false?' disconnected':''));
      const rowPiece=pvpAssets?.pieces?.[player.team===1?'PVP_SCORE_BLUE':'PVP_SCORE_RED'];
      setValue(row.node.style,'backgroundImage',rowPiece?.file?'url("'+assetUrl('/assets/ui/pvp-hud/'+rowPiece.file)+'")':'');
      [nameOf(player)+(player.connected===false?' · Offline':''),count(player.kills),count(player.assists),count(player.deaths)].forEach((value,index)=>{
        const text=String(value);setValue(row.cells[index],'textContent',text);setValue(row.cells[index],'title',text);
      });return row.node;
    });
    syncChildren(body,nodes);syncChildren(table,expanded?[head,body]:[body]);
  }
  return {root,show(value){root.hidden=!value;if(!value)cancelBanner();},toggle(value){expanded=typeof value==='boolean'?value:!expanded;renderBoard();return expanded;},
    update(pvp,{actors=[],localId:nextLocalId=localId}={}){if(!pvp)return;activeLocalId=nextLocalId;roster=pvpRoster(pvp,actors,activeLocalId);renderScore(pvp);renderMembers();renderBoard();
      const phase=pvp.phase??pvp.status;if(phase==='intro'){cancelBanner();if(banner.children.length)banner.replaceChildren();}
      else if(phase==='fight'&&lastPhase==='intro'){showBanner('Fight!','FIGHT');bannerTimer=timers.setTimeout(()=>{bannerTimer=null;banner.replaceChildren();},1500);}
      else if(phase!=='fight'&&!resultAnnounced){cancelBanner();if(banner.children.length)banner.replaceChildren();}
      const local=roster.local,wait=local?.respawnRemaining??(local?.respawnAt!=null?Math.max(0,local.respawnAt-(pvp.fightTime??0)):0);
      setValue(respawn,'textContent',wait>0?'Respawn in '+Math.ceil(wait)+' s':'');lastPhase=phase;},
    announceResult(value){
      const team=value.players?.find(player=>player.id===activeLocalId)?.team,winner=value.winnerTeam??value.winner;
      const outcome=winner==null?'draw':winner===team?'win':'loss';resultAnnounced=true;result.hidden=true;
      showBanner(outcome==='draw'?'Draw':outcome==='win'?'Victory':'Defeat',outcome==='draw'?'DRAWING':outcome==='win'?'WIN':'LOSE');return outcome;
    },
    result(value){cancelBanner();banner.replaceChildren();result.hidden=false;const player=value.players?.find(player=>player.id===activeLocalId),team=player?.team;
      const winner=value.winnerTeam??value.winner,text=winner==null?'Draw':winner===team?'Victory':'Defeat',title=el(document,'strong');title.append(image(winner==null?'DRAWING':winner===team?'WIN':'LOSE')??el(document,'span',text));title.setAttribute('aria-label',text);
      const exit=el(document,'button','Return to matchmaking');exit.onclick=()=>{result.hidden=true;onReturn();};
      const scores=(value.mode??activeMode)==='1v1'?[]:[el(document,'p',(value.score??[]).join(' : '))];result.replaceChildren(title,...scores,rowsTable(value.players??[]),exit);},
    clear(){cancelBanner();resultAnnounced=false;result.hidden=true;root.hidden=true;lastPhase=null;lastScoreKey=null;expanded=false;roster={players:[],local:null,allies:[],opponents:[]};memberNodes.clear();boardRows.clear();boardView=null;allies.replaceChildren();opponents.replaceChildren();board.replaceChildren();result.replaceChildren();score.replaceChildren();clockFrame.replaceChildren();time.textContent='';goal.textContent='';banner.replaceChildren();respawn.textContent='';},
    dispose(){this.clear();root.remove();},
  };
}
