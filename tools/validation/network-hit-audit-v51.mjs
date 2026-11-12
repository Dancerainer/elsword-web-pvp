/** Test observer only. Actual recordHit calls are associated with canonical
 * IDs only when their tuple identifies exactly one ID in the synchronous
 * upload being consumed. ACKs never substitute for real settlement calls. */
export const hitKey=(owner,epoch,id)=>JSON.stringify([owner,epoch,id]);
export function createCanonicalHitAudit({clock=()=>0}={}){
  const expected=new Map(),recorded=[],receipts=[],identityConflicts=[];let context=null;
  function canonical(owner,report){return (report?.hits??[]).map(hit=>({key:hitKey(owner,report.epoch,hit.id),
    owner,epoch:report.epoch,id:hit.id,attackerId:hit.attackerId,damage:hit.damage}));}
  return {
    expect(owner,report){for(const hit of canonical(owner,report)){
      const prior=expected.get(hit.key);
      if(prior&&(prior.attackerId!==hit.attackerId||prior.damage!==hit.damage))identityConflicts.push({prior,hit});
      else expected.set(hit.key,hit);
    }},
    begin(owner,report){if(context)throw Error('nested-canonical-hit-audit');
      context={owner,epoch:report?.epoch,frameSeq:report?.frameSeq,hits:canonical(owner,report)};return context;
    },
    record(hit){const candidates=[...new Set((context?.hits??[]).filter(row=>
      row.owner===hit.targetId&&row.attackerId===hit.attackerId&&row.damage===hit.damage).map(row=>row.key))];
      const row={...hit,at:clock(),uploadOwner:context?.owner??null,uploadFrame:context?.frameSeq??null,
        key:candidates.length===1?candidates[0]:null,mapping:candidates.length===1?'unique':candidates.length?'ambiguous':'unmatched',candidates};
      recorded.push(row);return row;
    },
    end(token,result){if(token!==context)throw Error('wrong-canonical-hit-audit-context');
      receipts.push({owner:token.owner,epoch:token.epoch??null,frameSeq:token.frameSeq??null,at:clock(),
        accepted:result?.accepted===true,consumedHitIds:[...(result?.consumedHitIds??[])],
        keys:(result?.consumedHitIds??[]).map(id=>hitKey(token.owner,token.epoch,id))});context=null;
    },
    report(){const counts=new Map();for(const hit of recorded)if(hit.key)counts.set(hit.key,(counts.get(hit.key)??0)+1);
      return {expected:[...expected.values()],recorded:[...recorded],receipts:[...receipts],identityConflicts:[...identityConflicts],
        duplicateIds:[...counts].filter(([,count])=>count>1).map(([key,count])=>({key,count})),
        missingIds:[...expected.keys()].filter(key=>!counts.has(key)),unexpectedIds:[...counts.keys()].filter(key=>!expected.has(key)),
        ambiguous:recorded.filter(hit=>hit.mapping==='ambiguous'),unmatched:recorded.filter(hit=>hit.mapping==='unmatched'),
        mappingComplete:recorded.every(hit=>hit.mapping==='unique'),
        limits:'Identity is proven only by a unique tuple within the actual synchronous upload. Ambiguous/unmatched calls cannot prove exactly-once. New local event IDs from erroneously re-executed attacks need independent hit-count/HP checks.'};
    },
  };
}

export function singleAttackAudit({kind,initialHp,endHp,hits}){
  if(kind!=='normal-hit')return null;
  const eventDamage=hits.reduce((sum,hit)=>sum+hit.damage,0),hpDelta=initialHp-endHp;
  return {fixture:'one synthetic TEST_ATTACK, no regeneration or other HP producer',hitCount:hits.length,eventDamage,hpDelta,
    atMostOneHit:hits.length<=1,hpMatchesEvents:Math.abs(hpDelta-eventDamage)<=1e-7};
}
