/** Target2016 321f4610 selected GUEL self-user / ATTACK_TYPE1 arithmetic.
 * Each supplied attribute is an instance argument. The caller's current Web
 * attribute production is not evidence of an original battle stat/seed. */
const f=Math.fround;
export function evaluateTargetSelfDamage2016({data,physicalAttack,magicAttack,physicalDefence,magicDefence,
 ownerLevel,mode,ownerDamageDelta,receiverDamageDelta,swordMultiplier,attackTypeMultiplier,
 percentReduction,receiverMultiplier,ownerMultiplier}={}){
 if(!data||data.ATTACK_TYPE!==1||![0,1].includes(data.DAMAGE_TYPE))return {supported:false,reason:'outside-selected-GUEL-self-type1'};
 const required={physicalAttack,magicAttack,physicalDefence,magicDefence,ownerLevel,mode,ownerDamageDelta,
  receiverDamageDelta,swordMultiplier,attackTypeMultiplier,percentReduction,receiverMultiplier,ownerMultiplier};
 if(Object.values(required).some(v=>!Number.isFinite(v))||mode!==1)return {supported:false,reason:'missing-selected-self-instance-input'};
 const kind=data.DAMAGE_TYPE,attack=kind===0?physicalAttack:magicAttack,defence=kind===0?physicalDefence:magicDefence,
  coefficient=kind===0?data.DAMAGE?.PHYSIC:data.DAMAGE?.MAGIC;
 if(!Number.isFinite(coefficient)||!Number.isFinite(data.PVP_RATE))return {supported:false,reason:'missing-self-DD-coefficient'};
 const denominator=(348+62*ownerLevel-348)*.10000000149011612+348;
 const ignore=data.IGNORE_DEFEN===1||data.IGNORE_DEFEN===true||data.IGNORE_DEFENCE_ON_PVP===1||data.IGNORE_DEFENCE_ON_PVP===true;
 const defenceMultiplier=ignore?1:Math.max(0,1-defence/denominator);
 let amount=f(attack*coefficient*defenceMultiplier);
 amount=f(amount*f(data.PVP_RATE));
 amount=f(amount*swordMultiplier);
 // Original owner and receiver delta channels add around the same amount.
 const initial=amount;amount=f(initial+initial*receiverDamageDelta+initial*ownerDamageDelta);
 amount=f(amount*Math.max(0,1-percentReduction/100));
 amount=f(amount*receiverMultiplier);
 amount=f(amount*attackTypeMultiplier);
 amount=f(amount*ownerMultiplier);
 return {supported:true,amount:Math.max(0,amount),denominator,defenceMultiplier,
  evidence:'target2016 selected self-user/type1 phases; current simulation attribute inputs; no original match measurement'};
}
/** Original327fa520 outer wrapper; evaluator calls remain distinct so a
 * changing F2 is not silently recapped after the first check. */
export function calculateBrandishSelfCost({hp,hpMax,data,coefficient=.03333333507180214,multiplicity=1,
 swordCoefficient=1,buff666=false,evaluate}={}){
 const ratio=f(f(hp)/f(hpMax));
 if(ratio<.20000000298023224)return {supported:true,cost:0,exempt:true};
 if(typeof evaluate!=='function'||!data)return {supported:false,reason:'missing-self-damage-evaluator'};
 const c=f(f(coefficient)*swordCoefficient),copy={...data,CRITICAL_RATE:0,DAMAGE:{...data.DAMAGE,
  PHYSIC:f(f(data.DAMAGE?.PHYSIC??0)*c),MAGIC:f(f(data.DAMAGE?.MAGIC??0)*c)}};
 const first=evaluate(copy);if(!first?.supported)return first??{supported:false,reason:'self-evaluation-failed'};
 const count=multiplicity&65535,available=f(hp)-f(hpMax)*.10000000149011612;
 let amount=count*first.amount,calls=1;
 if(amount>available)amount=available;
 else{const second=evaluate(copy);calls++;if(!second?.supported)return second??{supported:false,reason:'second-self-evaluation-failed'};amount=count*second.amount;}
 if(buff666)amount*=.666700005531311;
 return {supported:true,cost:f(Math.max(0,amount)),exempt:false,coefficient:c,evaluations:calls,
  evidence:'target2016 327fa520 F1 gate / independent F2 / BF666 / HP lower0'};
}
