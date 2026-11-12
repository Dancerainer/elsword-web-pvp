import {assetUrl} from './asset-urls.mjs';
const characterForProfession={LK:'elsword',IS:'elsword',RS:'elsword',RF:'raven',BM:'raven',VC:'raven',GM:'elesis',BH:'elesis',CA:'elesis',LP:'add',MM:'add',DE:'add'};
/** Presentation admission uses actual preparation, its server acknowledgement,
 * and an applied room state. It never starts a room or waits for optional RTC. */
export function createMatchEntry({host,onReturn}) {
  const document=host.ownerDocument,root=document.createElement('section');
  root.id='match-loading';root.className='match-loading-screen';root.hidden=true;
  root.setAttribute('aria-label','Match loading');
  const content=document.createElement('div'),title=document.createElement('strong'),message=document.createElement('p'),hint=document.createElement('p'),back=document.createElement('button');
  message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  hint.className='match-loading-hint';hint.textContent='The match starts when all players are ready';
  back.type='button';back.textContent='Return to matchmaking';back.hidden=true;back.onclick=()=>onReturn?.();
  const poster=document.createElement('div');poster.className='match-loading-poster';
  const top=document.createElement('div'),bottom=document.createElement('div');top.className='match-loading-team match-loading-red';bottom.className='match-loading-team match-loading-blue';
  content.className='match-loading-content';content.append(title,message,hint,back);poster.append(top,content,bottom);root.append(poster);host.append(root);
  const nodes=new Map();let localId=null;
  let match=null,localReady=false,entered=false,ended=false;
  const current=value=>match!==null&&match===value;
  function players(value){
    if(!current(value)||ended)return false;
    for(const [team,line]of [[0,top],[1,bottom]]){
      const rows=(value.players??[]).filter(p=>Number(p.team)===team),cards=[];
      for(const player of rows){
        const id=player.id??player.username,key=id;
        let card=nodes.get(key);
        if(!card){card=document.createElement('div');card.className='match-loading-player';const image=document.createElement('img'),name=document.createElement('span'),progress=document.createElement('strong');image.alt='';name.className='match-loading-name';progress.className='match-loading-percent';card.append(image,name,progress);nodes.set(key,card);}
        const [image,name,progress]=card.children;card.dataset.playerId=id;card.classList.toggle('local-player',id===localId);
        image.src=assetUrl('/assets/ui/loading/'+(characterForProfession[String(player.professionId??'RF').toUpperCase()]??'raven')+'-avatar.png');
        name.textContent=player.nickname??player.username??id;
        const amount=Math.max(0,Math.min(100,Number(player.loadingProgress)||0));progress.textContent=amount+'%';
        card.setAttribute('aria-label',`${name.textContent}, loading ${amount}%`);cards.push(card);
      }
      line.replaceChildren(...cards);
    }
    return true;
  }
  function reset(){match=null;localReady=false;entered=false;ended=false;root.hidden=true;back.hidden=true;root.setAttribute('aria-busy','false');root.dataset.phase='idle';}
  return {
    root,
    begin(value,{playerId=null}={}){match=value;localId=playerId;localReady=false;entered=false;ended=false;root.hidden=false;back.hidden=true;hint.hidden=false;root.dataset.phase='loading';root.setAttribute('aria-busy','true');title.textContent='Loading…';message.textContent='Loading battle map…';poster.style.backgroundImage='url("'+assetUrl('/assets/ui/loading/elsword.png')+'")';players(value);},
    players,
    progress(value,playerId,percent){if(!current(value)||ended)return false;const player=value.players?.find(p=>(p.id??p.username)===playerId);if(!player||!Number.isFinite(percent))return false;player.loadingProgress=Math.max(player.loadingProgress??0,Math.min(100,Math.max(0,Math.floor(percent))));players(value);return true;},
    stage(value,text){if(!current(value)||entered||ended)return false;message.textContent=text;return true;},
    prepared(value){if(!current(value)||ended)return false;localReady=true;root.dataset.phase='waiting';message.textContent='Waiting for other players to load…';return true;},
    admit(value,phase){
      if(!current(value)||!localReady||ended||!['intro','fight','slow'].includes(phase))return false;
      entered=true;root.hidden=true;root.dataset.phase='ready';root.setAttribute('aria-busy','false');return true;
    },
    end(value){if(!current(value)||entered)return false;ended=true;root.hidden=false;root.dataset.phase='ended';root.setAttribute('aria-busy','false');title.textContent='Match ended';message.textContent='This match has ended. Return to the lobby to queue again.';hint.hidden=true;back.hidden=false;return true;},
    waiting(value){return current(value)&&!entered;},
    clear:reset,
  };
}
