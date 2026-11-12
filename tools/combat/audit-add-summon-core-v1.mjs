/** Real production/native core boundary QA. Direct contact injection tests
 * state ownership, not collision fidelity; original NPC spheres are sampled
 * independently. Outputs stay in this task root. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const own=fileURLToPath(new URL('../../',import.meta.url)),root=path.resolve(process.env.ADD_RUNTIME_ROOT??own),assets=path.resolve(process.env.ADD_ASSET_ROOT??path.join(root,'artifacts'));
const imp=p=>import(pathToFileURL(path.join(root,p))),read=p=>JSON.parse(readFileSync(p));
const [{addFixture},{createAddSummonSamplers},{loadAddSummonAssets},{npcHitTargets}]=await Promise.all([
 imp('tests/helpers/add-fixture.mjs'),imp('packages/combat-assets/add-summon-samplers.mjs'),imp('packages/combat-assets/add-summon-assets.mjs'),imp('packages/combat-core/add-summons.mjs')]);
const npc=await loadAddSummonAssets({base:path.join(assets,'mm/')+'/',data:read}),samplers=createAddSummonSamplers(npc);
const report={schemaVersion:1,evidence:'current Web/native core observation; direct contacts are explicit QA injections, not original-client trajectories',targetClientMeasured:false,
 hashes:Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/add-summons.mjs','packages/combat-core/add-summon-damage.mjs','packages/combat-core/mm-profile.json'].map(p=>[p,createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')])),checks:[],failures:0};
function check(name,fn){const row={name};report.checks.push(row);try{row.observed=fn();row.passed=true;}catch(error){row.error=error.stack;row.passed=false;report.failures++;}console.log(name,row.passed?'ok':'FAIL '+row.error);}
function fixture(){const f=addFixture('MM',{skillId:29604,samplers});f.a.mp=f.a.mpMax;
 for(let i=0;i<3;i++)f.sim.step(1/60,{add:{pressed:i===0?['A']:[],held:[]}},{snapshot:false});
 assert.ok(f.a.sourceAddSummon,'actual accepted HA cast must create independent NPC');return f;}
const resources=a=>structuredClone({hp:a.hp,mp:a.mp,add:a.sourceAdd,core:a.core,buffs:a.buffs,combat:a.sourceAddCombat,knockdown:a.knockdown,hitStop:a.hitStop});
check('NPC outgoing hit uses original HA damage and preserves all owner resource/reaction channels',()=>{
 const f=fixture(),{sim,a,b,profile}=f,def=profile.effectSets.EffectSet_SI_HA_AMM_Apocalypse_Start_Hit.raw.EFFECT0;
 const e=sim.createEffect(a,def,{setName:'EffectSet_SI_HA_AMM_Apocalypse_Start_Hit',clock:'custom'});
 e.sourceAddSummonSerial=a.sourceAddSummon.serial;e.sourceAddSummonStateSerial=1;e.powerMultiplier=1.2;e.skillId=29604;
 a.mp=123;b.mp=0;const before=resources(a),snapshot=sim.snapshot(),data=structuredClone(profile.damageEffects[e.name].raw.DAMAGE_DATA);
 const origin={kind:'effect',id:e.id,skillId:29604,powerMultiplier:1.2,attackPosition:[...a.sourceAddSummon.position]};
 const hit=sim.applyHit(a,b,data,origin);assert.equal(hit.accepted,true);assert.ok(hit.amount>0);assert.deepEqual(resources(a),before);assert.ok(b.mp>0);
 const amount=hit.amount;sim.restore(snapshot);const aa=sim.actor('add'),bb=sim.actor('target');
 aa.stats.physicalAttack*=100;aa.stats.finalDamageMultiplierRange=100;aa.equipmentAttributes.skillDamageBonus=100;aa.sourceAdd.formation=true;aa.awakening.remaining=99999;
 const again=sim.applyHit(aa,bb,data,origin);assert.equal(again.amount,amount,'owner active damage channels must not change frozen NPC attack');
 return {amount,defenderMp:b.mp,ownerResourcesUnchanged:true,ownerDamageBuffIgnored:true};
});
check('NPC incoming contact uses independent original sphere and HP pool, without owner score/resources',()=>{
 const {sim,a,b,profile}=fixture(),s=a.sourceAddSummon;s.state='APOCALYPSE_WAIT';s.animationTime=0;
 const target=npcHitTargets(sim)[0];assert.ok(target.spheres.length===1);assert.ok(target.spheres[0].radius>0);
 const data=structuredClone(profile.damageEffects.DamageEffect_AN_Combo_Z.raw.DAMAGE_DATA),before=resources(a),hp=s.hp;
 const hit=sim.applySummonHit(b,target.actor,data,{kind:'fixture',powerMultiplier:1});assert.equal(hit.accepted,true);assert.ok(s.hp<hp);assert.deepEqual(resources(a),before);
 sim.networkOwnerId='target';const beforeRemote=s.hp,result=sim.applySummonHit(b,npcHitTargets(sim)[0].actor,data,{kind:'fixture',powerMultiplier:1});
 assert.equal(result.accepted,false);assert.equal(s.hp,beforeRemote);
 return {amount:hit.amount,npcHp:s.hp,ownerHp:a.hp,radius:target.spheres[0].radius,remoteOwnerRejected:true};
});
check('NPC damage collision never runs the owner accepted-skill callback',()=>{
 const {sim,a,b,profile}=fixture();b.invincible=false;b.forceInvincible=0;
 const def=profile.effectSets.EffectSet_SI_HA_AMM_Apocalypse_Start_Hit.raw.EFFECT0,e=sim.createEffect(a,def,{clock:'custom'});
 e.sourceAddSummonSerial=a.sourceAddSummon.serial;e.sourceAddSummonStateSerial=1;e.skillId=29604;e.powerMultiplier=1.2;
 let calls=0;sim.acceptedSkillHit=()=>{calls++;};const data=structuredClone(profile.damageEffects[e.name].raw.DAMAGE_DATA);
 sim.checkHits(a,[{kind:'sphere',center:[b.x,b.y+100,b.z],radius:500}],data,e.hits,{kind:'effect',id:e.id,skillId:29604,powerMultiplier:1.2});
 assert.equal(calls,0);return {ownerAcceptedSkillCalls:calls};
});
const output=path.join(own,'reports/add-summon-core-observation-v1.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,failures:report.failures}));if(report.failures)process.exitCode=1;
