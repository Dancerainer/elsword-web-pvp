import {isAddProfession} from '../../packages/professions/identity.mjs';
import {ADD_DP_MAX,ADD_MUTATION_MAX,ADD_DP_DISPLAY_SCALE} from '../../packages/combat-core/add-systems.mjs';
import {assetUrl} from './asset-urls.mjs';
import layout from '../../contracts/status-hud-source-v33.json' with {type:'json'};

/** Reads the combat snapshot. Rendering never grants resources or advances clocks. */
export function addHudState(actor){
  const state=actor?.sourceAdd;
  if(!isAddProfession(actor?.professionId)||!state)return {visible:false};
  const ratio=Math.max(0,Math.min(1,state.dp/ADD_DP_MAX));
  const mutation=Math.max(0,Math.min(ADD_MUTATION_MAX,Math.trunc(state.mutation)));
  const status=state.formation?'Dynamo Configuration Mode':state.formationPending?'Switching':'Normal mode';
  const cooldown=Math.max(0,Math.ceil(state.switchCooldown));
  const generator=actor.professionId==='MM'?state.generator:null;
  const amount=`DP ${Math.floor(state.dp/ADD_DP_DISPLAY_SCALE)} / ${ADD_DP_MAX/ADD_DP_DISPLAY_SCALE}`;
  return {visible:true,ratio,mutation,active:state.formation,cooldown,status,amount,
    label:`${amount} · Mutation points ${mutation}/${ADD_MUTATION_MAX} · ${status}`,
    detail:[cooldown?`Switch in ${cooldown}s`:'Ctrl to switch',
      generator?`Dynamo Factory · ${{ready:'Ready',firing:'Fire'}[generator.phase]??'Standby'} ${Math.ceil(generator.remaining)}s`:''].filter(Boolean).join(' · ')};
}

export function addResourceFeedback(event){
  const amount=event.type==='addFantasyTracerMpRecovered'?event.amount:['addMaximumStrikeRefund'].includes(event.type)||event.type==='addForceFingerTransfer'&&event.resource==='DP'?event.restored:0;
  return ['MP','DP'].includes(event.resource)&&Number.isFinite(amount)&&amount>=1?{resource:event.resource,amount:Math.trunc(amount)}:null;
}
export function createAddHud({document,host,now=()=>performance.now()}){
  const root=document.createElement('div');root.className='add-resource-hud';root.hidden=true;
  const gauge=document.createElement('div');gauge.className='add-dp-gauge';gauge.setAttribute('role','progressbar');
  gauge.setAttribute('aria-valuemin','0');gauge.setAttribute('aria-valuemax','100');
  const back=document.createElement('img'),fill=document.createElement('img');back.alt='';fill.alt='';fill.className='add-dp-fill';
  back.hidden=true;fill.hidden=true;gauge.append(back,fill);
  const amount=document.createElement('span');amount.className='add-dp-amount';gauge.append(amount);
  const indicator=document.createElement('img');indicator.alt='';indicator.hidden=true;gauge.append(indicator);
  gauge.style.left=layout.dpOrigin[0]+'px';gauge.style.top=layout.dpOrigin[1]+'px';
  const points=document.createElement('div');points.className='add-mutation-points';
  points.style.left=layout.mutationOrigin[0]+'px';points.style.top=layout.mutationOrigin[1]+'px';
  const dots=Array.from({length:ADD_MUTATION_MAX},()=>{const dot=document.createElement('span');points.append(dot);return dot;});
  const detail=document.createElement('span');detail.className='add-resource-detail';root.append(gauge,points,detail);host.append(root);
  let indicatorPieces={};
  return {element:root,
    event(){/* Recovery now uses world-space resource numbers. */},
    setAssets(index){
      for(const [image,key]of [[back,'BG_DPSYSTEM_BACK'],[fill,'BG_DPSYSTEM_GAUGE']]){
        const piece=index?.pieces?.[key];image.hidden=!piece?.file;
        if(piece?.file){image.src=assetUrl('/assets/ui/add/'+piece.file);image.dataset.piece=key;
          image.style.width=piece.width+'px';image.style.height=piece.height+'px';}
      }
      fill.style.left=layout.dpFillOffset[0]+'px';fill.style.top=layout.dpFillOffset[1]+'px';
      const mutationBack=index?.pieces?.BG_MSYSTEM_BACK;
      if(mutationBack?.file)points.style.backgroundImage=`url("${assetUrl('/assets/ui/add/'+mutationBack.file)}")`;
      const mutation=index?.pieces?.BG_MSYSTEM_ACTIVE;
      if(mutation?.file)dots.forEach((dot,i)=>{dot.textContent='';dot.style.backgroundImage=`url("${assetUrl('/assets/ui/add/'+mutation.file)}")`;dot.dataset.original='true';
        dot.style.left=layout.mutationOffsets[i][0]+'px';dot.style.top=layout.mutationOffsets[i][1]+'px';});
      indicatorPieces=Object.fromEntries(['BG_DP',...Array.from({length:5},(_,i)=>'BG_DP_0'+(i+1))].map(key=>[key,index?.pieces?.[key]]));
    },
    update(actor){const next=addHudState(actor);root.hidden=!next.visible;if(!next.visible)return;
      root.dataset.active=String(next.active);root.dataset.professionId=actor.professionId;root.setAttribute('aria-label',next.label+' · '+next.detail);
      gauge.setAttribute('aria-valuenow',String(Math.round(next.ratio*100)));gauge.setAttribute('aria-valuetext',next.label);
      fill.style.clipPath=`inset(0 ${100-next.ratio*100}% 0 0)`;
      const indicatorKey=next.cooldown>0&&next.cooldown<=5?'BG_DP_0'+next.cooldown:'BG_DP',piece=indicatorPieces[indicatorKey];
      indicator.hidden=!piece?.file;
      if(piece?.file){indicator.src=assetUrl('/assets/ui/add/'+piece.file);indicator.dataset.piece=indicatorKey;
        const position=next.cooldown>0&&next.cooldown<=5?layout.dpCooldownOffset:layout.dpLabelOffset;
        indicator.style.left=position[0]+'px';indicator.style.top=position[1]+'px';indicator.style.width=piece.width+'px';indicator.style.height=piece.height+'px';}
      amount.textContent=next.amount.slice(3);points.setAttribute('aria-label',`Mutation points ${next.mutation}/${ADD_MUTATION_MAX}`);
      dots.forEach((dot,index)=>{dot.dataset.filled=String(index<next.mutation);});detail.textContent=next.detail;
    },dispose(){root.remove();}
  };
}
