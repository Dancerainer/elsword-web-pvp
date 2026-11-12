/** Consumption views from original enter. Never mutate original raw tables. */
import historical from '../../contracts/historical-cancel-consumers-v53.json' with {type:'json'};
const rows=new Map(historical.rows.filter(r=>r.status==='selected-local-post-control-contract').map(r=>[r.sourceState,r]));
const barrage=historical.rows.find(r=>r.sourceState==='RSI_A_RWT_BARRAGE_ATTACK');
const keys=['SKILL_CANCEL_AFTER','BWALK_CANCEL_AFTER','WALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER',
 'ATTACK_CANCEL_AFTER_EX','UPDOWN_CANCEL_AFTER','SKILL_CANCEL_AFTER_FLY'];
export function originalEnterCancelFields(raw){
 const result={...raw};for(const key of keys){const v=raw[key]??(key==='ATTACK_CANCEL_AFTER'?raw.WALK_CANCEL_AFTER??9999:9999);
  result[key]=Number.isFinite(v)?Math.fround(Math.max(Math.fround(v),.10000000149011612)):NaN;}
 return result;
}
export function historicalSourcePostRow(a,p){const def=p.states[a.state],n=def?.sourceState??a.state,row=rows.get(n);
 if(a.professionId==='VC'&&['RSI_A_RWT_BARRAGE_ATTACK_STAND','RSI_A_RWT_BARRAGE_ATTACK_AIR'].includes(n))return barrage;
 return row?.states.some(s=>s.profession===a.professionId)?row:null;}
export function sourceCancelFields(a,p){const def=p.states[a.state];return historicalSourcePostRow(a,p)?originalEnterCancelFields(def.raw):def.raw;}
export function sourceCancelProfile(a,p){const d=p.states[a.state];return {...p,states:{...p.states,[a.state]:{...d,raw:originalEnterCancelFields(d.raw)}}};}
export const historicalSourcePostRows=historical.rows;
