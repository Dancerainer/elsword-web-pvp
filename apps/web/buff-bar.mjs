import {pvpBuffText} from '../../packages/pvp/buff-text.mjs';
import {assetUrl} from './asset-urls.mjs';
import {isBuffActive} from '../../packages/combat-core/buffs.mjs';
import translatedBuffs from '../../packages/localization/buff-display-v26.json' with {type:'json'};
import {isAddProfession,professionIdForProfile} from '../../packages/professions/identity.mjs';
import {addBuffIcon,ADD_BUFF_ICON_KEYS} from './add-buff-display.mjs';
/** Presentation of active identities only. Never creates or modifies effects. */
const names={2:'Veteran',18:'Iron Body',19:'Tenacious Hit',29:'Phantom Sword',31:'Wound',37:'Burn',48:'Weapon Break',52:'Faint',57:'A Chance to Turn the Tables',87:'Fog',94:'Nimble Movement',99:'Bleed',103:'Overheat',104:'Mercenary Survival',208:'Extreme Heavenly Love',240:'Knight of Gale',247:'Knight of Annihilation',250:'Overheat',319:'Faint',408:'Exploding Nasod Hand',539:'Critical Counter',540:'Critical Counter',543:'Enchant Hand',545:'Mind Crash'};
const stats={physicalAttack:'Physical Attack',magicAttack:'Magical Attack',criticalRate:'Critical Chance',criticalAttack:'Critical Damage',additionalAttackPercent:'Additional Damage',physicalDefence:'Physical Defense',magicDefence:'Magical Defense',everyAttributeDefence:'All Elemental Resistances',hitMeleeMpMultiplier:'MP Gain on Melee Hit',hitRangeMpMultiplier:'MP Gain on Ranged Hit',receivedMpMultiplier:'MP Gain When Hit',animationSpeedMultiplier:'Action Speed',moveSpeedMultiplier:'Movement Speed',jumpSpeedMultiplier:'Jump Power'};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const stacks=value=>finite(value)&&value>1?Math.trunc(value):1;
function counterLabel(buff){
  const counters=(buff.finalizers??[]).filter(row=>['hit','received'].includes(row.kind)&&finite(row.remaining)&&row.remaining>0);
  if(!counters.length)return '';
  return Math.ceil(Math.min(...counters.map(row=>row.remaining)))+' uses';
}
export function buffRemainingSeconds(buff){
  const time=(buff.finalizers??[]).filter(row=>row.kind==='time'&&finite(row.remaining)).map(row=>row.remaining);
  return time.length?Math.max(0,Math.min(...time)):finite(buff.remaining)?Math.max(0,buff.remaining):null;
}
/** The acquired V5 UI accepts an integer and suppresses <=0 and >=999.
 * Ceil from fractional simulation time is an explicit web presentation choice. */
export function buffDurationLabel(remaining){const n=finite(remaining)?Math.ceil(remaining):0;return n>0&&n<999?`${n}s`:'';}
function describe(buff){
  const lines=[];
  for(const row of buff.behaviors??[]){
    if(row.kind==='stun')lines.push('Cannot act');
    else if(row.kind==='dashBlock')lines.push('Cannot dash');
    else if(row.kind==='manaBreakBlock')lines.push('Cannot mana break');
    else if(row.kind==='ignoreDefence')lines.push('Ignores defense');
    else if(row.kind==='stat'&&finite(row.value))lines.push(`${stats[row.stat]??row.stat}${row.changeType===3?` set to ${Math.round(row.value*100)}%`:row.changeType===0?` set to ${row.value}`:`${row.value<0?' reduced by':' increased by'} ${Math.abs(row.value)}`}`);
    else if((row.kind==='hpInterval'||row.kind==='mpInterval')&&finite(row.value)&&finite(row.interval))lines.push(`Every ${row.interval} s, ${row.kind==='hpInterval'?'HP':'MP'} ${row.value<0?' reduced by':'restores'} ${Math.abs(row.value)}${row.changeType===3?' (fraction of maximum)':''}`);
  }
  for(const row of buff.finalizers??[])if(['hit','received'].includes(row.kind)&&finite(row.remaining))lines.push(`${row.kind==='hit'?'Hits dealt:':'Hits taken:'} ${Math.max(0,Math.trunc(row.remaining))} until this effect ends`);
  return lines.join('. ');
}
export function buildBuffRows(actor,{profile,profileForBuff,assets=null,addAssets=null,addAssetBase='/assets/ui/add/',onlineBuffs=actor?.onlineBuffs??[]}={}){
  if(!actor)return [];
  const rows=[],seen=new Set();
  const addStatus=(id,name,description,remaining,isDebuff=false,templateId=null)=>{
    const iconKey=ADD_BUFF_ICON_KEYS[templateId],piece=addBuffIcon(addAssets,{templateId},addAssetBase)??assets?.buffIcons?.[String(templateId)];
    seen.add(String(templateId));seen.add(id);
    rows.push({id,name,description,remaining,isDebuff,templateId,iconKey,icon:piece?.file??null,iconBase:piece?.iconBase,
      durationLabel:buffDurationLabel(remaining),counterLabel:'',stackCount:1,flashing:remaining!==null&&remaining<=5,originalIcon:!!piece});
  };
  if(actor.sourceAdd?.formation)addStatus('add-formation','Dynamo Configuration Mode','Skills use MP or DP as specified. Hits consume DP according to their rules.',null,false,320);
  if(actor.sourceTimeRing?.remaining>0)addStatus('add-time-ring','Seal of Time','On a lethal hit, restore the recorded HP and resources. In PvP, the recorded HP is capped at 50% of maximum HP.',actor.sourceTimeRing.remaining,false,436);
  if(actor.sourceTimeSickness>0)addStatus('add-time-sickness','Time Sickness','Temporarily prevents another Seal of Time.',actor.sourceTimeSickness,true,673);
  if(!isAddProfession(actor.professionId)&&finite(actor.awakening?.remaining)&&actor.awakening.remaining>0){
    const remaining=actor.awakening.remaining,multiplier=profile?.referenceSemantics?.awakening?.powerMultiplier;
    rows.push({id:'awakening',name:'Awakening',description:[finite(multiplier)?`Attack damage increases by ${Number(((multiplier-1)*100).toFixed(2))}%.`:'Boosts attack damage.',actor.professionId==='RF'||actor.professionId==='VC'||actor.professionId==='BM'?'Activates the Nasod Core.':''].filter(Boolean).join(' '),
      isDebuff:false,icon:assets?.pieces?.['buff:awakening']?.file??null,remaining,durationLabel:buffDurationLabel(remaining),counterLabel:'',stackCount:1,flashing:remaining<=5,originalIcon:!!assets?.pieces?.['buff:awakening']});
  }
  for(const buff of actor.buffs??[]){
    if(!isBuffActive(buff))continue;
    const sourceProfile=profileForBuff?.(buff)??profile,raw=sourceProfile?.buffTemplates?.[buff.templateId]?.raw;
    if(!raw||!raw.BUFF_ICON_TEXTURE_NAME||!raw.BUFF_ICON_TEXTURE_KEY||raw.USE_BUFF_ICON===0||raw.USE_BUFF_ICON===false)continue;
    const identity=String(buff.templateId);if(seen.has(identity))continue;seen.add(identity);
    const remaining=buffRemainingSeconds(buff);if(remaining!==null&&remaining<=0)continue;
    // Target guild Template57 declares the same atlas/key as Template408. The
    // existing atlas crop is reusable even when a manifest has only ID keys.
    const piece=addBuffIcon(addAssets,{templateId:buff.templateId,iconKey:raw.BUFF_ICON_TEXTURE_KEY},addAssetBase)??assets?.buffIcons?.[identity]??assets?.pieces?.[`buff:${raw.BUFF_ICON_TEXTURE_KEY}`]
      ??(raw.BUFF_ICON_TEXTURE_KEY==='Buff_Icon_Vital_Point_Stab'?assets?.buffIcons?.['408']:null);
    const profession=String(sourceProfile?.professionId??(sourceProfile?professionIdForProfile(sourceProfile):'')).toUpperCase();
    const translated=translatedBuffs.profiles[profession]?.[identity];
    rows.push({id:identity,templateId:buff.templateId,name:translated?.name??names[buff.templateId]??`Status ${buff.templateId}`,description:translated?.description??describe(buff),isDebuff:raw.IS_DEBUF===1||raw.IS_DEBUF===true,iconKey:raw.BUFF_ICON_TEXTURE_KEY,icon:piece?.file??null,iconBase:piece?.iconBase,remaining,durationLabel:buffDurationLabel(remaining),counterLabel:counterLabel(buff),stackCount:stacks(buff.accumulationCount??buff.stackCount),flashing:remaining!==null&&remaining<=5,originalIcon:!!piece});
  }
  for(const buff of onlineBuffs??[]){
    if(!buff||typeof buff.id!=='string'||buff.hidden===true||seen.has(buff.id)||buff.templateId!=null&&seen.has(String(buff.templateId)))continue;
    const remaining=buffRemainingSeconds(buff);if(remaining!==null&&remaining<=0)continue;seen.add(buff.id);
    const piece=addBuffIcon(addAssets,{templateId:buff.templateId,iconKey:buff.iconKey},addAssetBase)??assets?.pieces?.[`buff:${buff.iconKey}`]??assets?.buffIcons?.[String(buff.templateId)];
    const hasEnglishName=typeof buff.name==='string'&&buff.name&&!/\p{Script=Han}/u.test(buff.name);
    const localizedDescription=/\p{Script=Han}/u.test(buff.description??'');
    const fallback=(!hasEnglishName||localizedDescription)?pvpBuffText(buff.templateId??buff.id,actor.pvpModifiers??{}):null;
    const name=hasEnglishName?buff.name:fallback.name,description=localizedDescription?fallback.description:(buff.description??'');
    rows.push({id:buff.id,templateId:buff.templateId??null,name,description,isDebuff:buff.isDebuff===true,iconKey:buff.iconKey??null,icon:piece?.file??null,iconBase:piece?.iconBase,remaining,durationLabel:buffDurationLabel(remaining),counterLabel:counterLabel(buff),stackCount:stacks(buff.stackCount),flashing:remaining!==null&&remaining<=5,originalIcon:!!piece});
  }
  return rows;
}
export function createBuffBar({host,profile,profileForBuff,assets=null,assetBase='/assets/ui/online/',addAssets=null,addAssetBase='/assets/ui/add/'}={}){
  if(!host?.ownerDocument)throw new TypeError('Buff bar host required');const doc=host.ownerDocument,bar=doc.createElement('div');bar.className='rf-buff-bar';bar.hidden=true;bar.setAttribute('aria-label','Your buffs and debuffs');
  const positive=doc.createElement('div'),negative=doc.createElement('div');positive.className='rf-buff-line rf-buff-positive';negative.className='rf-buff-line rf-buff-negative';positive.setAttribute('aria-label','Buffs');negative.setAttribute('aria-label','Debuffs');bar.append(positive,negative);host.append(bar);const nodes=new Map();
  const tooltip=doc.createElement('div');tooltip.className='rf-buff-tooltip';tooltip.id='buff-hover-detail';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;host.append(tooltip);
  let inspected=null;
  function hide(){tooltip.hidden=true;inspected?.removeAttribute('aria-describedby');inspected=null;}
  function show(node){
    const row=node.buffRow;if(!row)return;hide();inspected=node;
    const name=doc.createElement('span'),description=doc.createElement('span');name.textContent=row.name;description.textContent=row.description||'Effect active.';tooltip.replaceChildren(name,description);tooltip.hidden=false;node.setAttribute('aria-describedby',tooltip.id);
    const bounds=host.getBoundingClientRect(),anchor=node.getBoundingClientRect();
    tooltip.style.left=Math.max(4,Math.min(anchor.right-bounds.left-tooltip.offsetWidth,bounds.width-tooltip.offsetWidth-4))+'px';
    tooltip.style.top=Math.min(bounds.height-tooltip.offsetHeight-4,anchor.bottom-bounds.top+10)+'px';
  }
  return {
    update(actor,options={}){
      const visible=options.visible!==false&&options.mode!=='lobby';bar.hidden=!visible;if(!visible){hide();return;}
      const rows=buildBuffRows(actor,{profile,profileForBuff,assets,addAssets,addAssetBase,...options}),active=new Set(rows.map(row=>row.id));
      for(const [id,node]of nodes)if(!active.has(id)){if(inspected===node)hide();node.remove();nodes.delete(id);}
      const positiveNodes=[],negativeNodes=[];
      for(const row of rows){let node=nodes.get(row.id);if(!node){node=doc.createElement('div');node.className='rf-buff-item';node.dataset.buffId=row.id;node.setAttribute('role','img');node.tabIndex=0;const icon=doc.createElement('img');icon.alt='';const fallback=doc.createElement('span');fallback.className='rf-buff-fallback';
          icon.onerror=()=>{icon.dataset.failedFile=icon.dataset.file;icon.hidden=true;fallback.hidden=false;};
          const duration=doc.createElement('span');duration.className='rf-buff-time';const stack=doc.createElement('span');stack.className='rf-buff-stack';node.append(icon,fallback,duration,stack);nodes.set(row.id,node);}
        node.buffRow=row;node.onmouseenter=node.onfocus=()=>show(node);node.onmouseleave=node.onblur=hide;
        const [image,fallback,duration,stack]=node.children;
        const iconUrl=row.icon?assetUrl((row.iconBase??assetBase)+row.icon):null;
        if(iconUrl&&image.dataset.file!==iconUrl){delete image.dataset.failedFile;image.dataset.file=iconUrl;image.src=iconUrl;}
        const failed=!!iconUrl&&image.dataset.failedFile===iconUrl;image.hidden=!row.icon||failed;fallback.hidden=!!row.icon&&!failed;fallback.textContent=row.name.slice(0,2);
        duration.textContent=row.durationLabel?row.durationLabel.replace(/s$/,''):row.counterLabel;
        stack.textContent=row.stackCount>1?'x'+row.stackCount:'';node.dataset.isDebuff=String(row.isDebuff);node.dataset.stackCount=String(row.stackCount);
        node.classList.toggle('rf-buff-expiring',row.flashing);const text=[row.name,row.description,row.durationLabel||row.counterLabel,row.stackCount>1?`Stacks: ${row.stackCount}`:''].filter(Boolean).join('\n');node.setAttribute('aria-label',text);
        (row.isDebuff?negativeNodes:positiveNodes).push(node);
      }
      // Snapshots may reorder or reacquire identities. Preserve that order,
      // while leaving an unchanged live row attached across render frames.
      for(const [line,items]of [[positive,positiveNodes],[negative,negativeNodes]])
        if(line.children.length!==items.length||items.some((node,index)=>line.children[index]!==node))line.replaceChildren(...items);
    },
    setAssets(next){assets=next;},setAddAssets(next,base='/assets/ui/add/'){addAssets=next;addAssetBase=base;},element:bar,destroy(){hide();nodes.clear();bar.remove();tooltip.remove();},
  };
}
