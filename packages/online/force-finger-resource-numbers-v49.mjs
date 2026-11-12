/** A bounded Web presentation receipt for already committed Force Finger MP.
 * These records never run resource transfer, target selection, or damage. */
const LIMIT=4,MAX_AGE_FRAMES=120;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const finite=n=>Number.isFinite(n)&&Number.isFinite(Math.fround(n));
const position=p=>Array.isArray(p)&&p.length===3&&p.every(n=>finite(n)&&Math.abs(n)<=1e7);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const own=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const alive=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
const epochFor=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);
const profileFor=(sim,a)=>sim.profileFor?.(a)??sim.profiles?.[a.professionId]??sim.profile;
function sourceSkill(profile){
 const s=profile?.skillCatalog?.find(row=>row.skillId===29215);
 return profile?.target?.unitClass===126&&s?.raw?.SA_MP_INTAKE_ABS?.[s.maxLevel]===15
  &&s.raw.SA_MP_RETAKE_ABS?.[s.maxLevel]===45?s:null;
}
export function validateForceFingerResourceNumbers(notice,{owner,profile,actors,profiles,epoch,frameSeq}={}){
 if(!exact(notice,['epoch','serial','receipts'])||!integer(notice.epoch)||!integer(notice.serial)||notice.serial<1
  ||epoch!==undefined&&notice.epoch!==epoch||!Array.isArray(notice.receipts)||!notice.receipts.length||notice.receipts.length>LIMIT)
  throw new TypeError('Invalid Force Finger resource number notice');
 let serial=0,frame=0;
 for(const r of notice.receipts){
  if(!exact(r,['serial','frame','kind','amount','casterId','casterEpoch','position'])||!integer(r.serial)||r.serial<=serial||r.serial>notice.serial
   ||!integer(r.frame)||r.frame<frame||frameSeq!==undefined&&r.frame>frameSeq||!['drain','recover'].includes(r.kind)
   ||!finite(r.amount)||r.amount<=0||r.amount>(r.kind==='drain'?15:45)||!id(r.casterId)||!integer(r.casterEpoch)||!position(r.position))
   throw new TypeError('Invalid Force Finger resource number receipt');
  serial=r.serial;frame=r.frame;
  if(owner){
   const caster=r.casterId===owner.id?owner:actors?.find(a=>a.id===r.casterId);
   const casterProfile=caster===owner?profile:caster&&profiles?.[caster.professionId];
   if(!caster||!sourceSkill(casterProfile)||!caster.loadout?.some(slot=>slot?.skillId===29215)
    ||(r.kind==='recover'?(caster!==owner||r.casterEpoch!==notice.epoch):(caster===owner||caster.team===owner.team)))
    throw new TypeError('Invalid Force Finger resource number source');
  }
 }
 if(serial!==notice.serial)throw new TypeError('Invalid Force Finger resource number serial');return true;
}
/** The negotiated producer calls once with the actual post-step event list.
 * Only this actor's already applied MP delta enters its own reliable lane. */
export function captureForceFingerResourceNumbers(sim,actor,{epoch,frameSeq,events=[]}={}){
 if(!own(sim,actor)||!integer(epoch)||!integer(frameSeq))return false;
 const old=actor.sourceForceFingerResourceNumbers;
 if(old?.epoch===epoch&&old.receipts.at(-1)?.frame===frameSeq)return false;
 let serial=old?.epoch===epoch?old.serial:0;
 const receipts=old?.epoch===epoch?old.receipts.filter(r=>frameSeq-r.frame<=MAX_AGE_FRAMES):[];
 let changed=false;
 for(const event of events){
  if(event.actorId!==actor.id||event.networkArrival)continue;
  const drain=event.type==='addForceFingerRecipient',recover=event.type==='addForceFingerTransfer'&&event.resource==='MP';
  if(!drain&&!recover)continue;
  const amount=drain?event.drain:event.restored;if(!(amount>0)||!position(event.position))continue;
  const caster=drain?sim.state.actors.find(a=>a.id===event.sourceActorId):actor,casterEpoch=caster===actor?epoch:caster&&epochFor(sim,caster);
  if(!caster||!integer(casterEpoch))continue;
  receipts.push({serial:++serial,frame:frameSeq,kind:drain?'drain':'recover',amount,casterId:caster.id,casterEpoch,position:[...event.position]});changed=true;
 }
 if(!changed)return false;
 const notice={epoch,serial,receipts:receipts.slice(-LIMIT)};
 validateForceFingerResourceNumbers(notice,{owner:actor,profile:profileFor(sim,actor),actors:sim.state.actors,profiles:sim.profiles,epoch,frameSeq});
 actor.sourceForceFingerResourceNumbers=notice;return true;
}
/** A full owner report never keeps an old-life or permanently stale display. */
export function encodeForceFingerResourceNumbers(actor,{epoch,frameSeq}={}){
 const notice=actor.sourceForceFingerResourceNumbers;if(!notice||notice.epoch!==epoch)return undefined;
 const receipts=notice.receipts.filter(r=>frameSeq-r.frame<=MAX_AGE_FRAMES);
 return receipts.length?{epoch:notice.epoch,serial:notice.serial,receipts}:undefined;
}
export function receiveForceFingerResourceNumbers(sim,owner,epoch,notice,{frameSeq,presentationAge=0}={}){
 if(!notice||sim.networkOwnerId==null||own(sim,owner)||sim.observationOnly)return false;
 if(!integer(epoch)||!integer(frameSeq)||!finite(presentationAge)||presentationAge<0)throw new TypeError('Invalid Force Finger resource number clock');
 validateForceFingerResourceNumbers(notice,{owner,profile:profileFor(sim,owner),actors:sim.state.actors,profiles:sim.profiles,epoch,frameSeq});
 const ledger=sim.state.localOwnerForceFingerResourceNumberReceipts??=[],old=ledger.find(r=>r.id===owner.id);
 if(old&&(old.epoch>epoch||old.epoch===epoch&&old.serial>=notice.serial))return false;
 const seen=old?.epoch===epoch?old.serial:0;let displayed=false;
 for(const r of notice.receipts){
  if(r.serial<=seen||frameSeq-r.frame+presentationAge*60>MAX_AGE_FRAMES||!alive(owner))continue;
  const caster=sim.state.actors.find(a=>a.id===r.casterId);
  if(!caster||epochFor(sim,caster)!==r.casterEpoch||epochFor(sim,owner)!==epoch)continue;
  if(r.kind==='drain')sim.emit?.('addForceFingerRecipient',owner.id,{sourceActorId:r.casterId,drain:r.amount,requestedDrain:15,position:[...r.position],networkArrival:true});
  else sim.emit?.('addForceFingerTransfer',owner.id,{restored:r.amount,resource:'MP',position:[...r.position],networkArrival:true});
  displayed=true;
 }
 if(old)Object.assign(old,{epoch,serial:notice.serial});else ledger.push({id:owner.id,epoch,serial:notice.serial});
 // Roster membership was validated above; retain at most one row per actor.
 sim.state.localOwnerForceFingerResourceNumberReceipts=ledger.filter(r=>sim.state.actors.some(a=>a.id===r.id));
 return displayed;
}
