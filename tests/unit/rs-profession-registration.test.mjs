import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {normalizeProfessionFlags,effectiveProfessionFlags,selectEnabledProfession,PROFESSIONS} from '../../packages/professions/catalog.mjs';
import {pvpMemberProfession,pvpRoster} from '../../apps/web/pvp-hud.mjs';
import {awakeningActorEligible,awakeningAttachmentsFor} from '../../apps/web/awakening-effects.mjs';
import {swordHudState} from '../../apps/web/way-of-sword-hud.mjs';
import {skillSwordCueState} from '../../apps/web/skill-sword-cues.mjs';
import {wayOfSwordHitPolicy,wayOfSwordMpCost} from '../../packages/combat-core/lk-way-of-sword.mjs';
import {createLordKnightResourcePools} from '../../packages/combat-core/lord-knight.mjs';

test('legacy profession settings keep RS disabled without rewriting; an explicit RS choice survives restart',async t=>{
 const accountRoot=await mkdtemp(path.join(os.tmpdir(),'rs-accounts-'));
 t.after(async()=>{assert.ok(accountRoot.startsWith(os.tmpdir()+path.sep));await rm(accountRoot,{recursive:true,force:true});});
 const file=path.join(accountRoot,'online-professions.json'),bytes=JSON.stringify({schemaVersion:1,professions:{RF:true,LK:true,VC:true}});
 await writeFile(file,bytes);
 const accounts=[{username:'fixture_admin',role:'gm'},{username:'rs-player',role:'player'}];
 let store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
 assert.equal(store.professionFlags().RS,false);assert.equal(await readFile(file,'utf8'),bytes);
 await store.saveProfessions({RF:false,LK:false,VC:false,RS:true});await store.saveProfession('rs-player','RS');
 store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
 assert.equal(store.selectedProfession('rs-player'),'RS');assert.equal(selectEnabledProfession('LK',store.professionFlags()),'RS');
 assert.deepEqual(effectiveProfessionFlags({RF:false,LK:false,VC:false,RS:false}),{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
 assert.throws(()=>normalizeProfessionFlags({RF:true,LK:true,RS:'true'}),TypeError);
});

test('mixed teams and late actor packets select RS original portrait from the frozen roster',()=>{
 const players=[{id:'me',team:0,professionId:'LK'},{id:'ally',team:0,professionId:'RS'},{id:'enemy',team:1,professionId:'RS'}];
 const roster=pvpRoster({players},[{id:'enemy',professionId:'RF'}],'me');
 for(const player of [...roster.allies,...roster.opponents]){
  assert.equal(pvpMemberProfession(player).unitClass,101);
  assert.equal(pvpMemberProfession(player).portraitUrl,'/assets/rs/ui/portrait-party.png');
 }
 assert.notEqual(PROFESSIONS.RS.portraitUrl,PROFESSIONS.LK.portraitUrl);
});

test('RS awakening routes only its actor and shares Elsword aura instead of Raven black aura',()=>{
 const rs={target:{unitClass:101}},lk={target:{unitClass:100}},rf={target:{unitClass:107}};
 assert.deepEqual(awakeningAttachmentsFor(rs),awakeningAttachmentsFor(lk));
 assert.ok(awakeningAttachmentsFor(rs).every(row=>!row.template.endsWith('Black')));
 assert.equal(awakeningActorEligible(rs,{professionId:'RS'}),true);
 for(const id of ['LK','RF','VC'])assert.equal(awakeningActorEligible(rs,{professionId:id}),false);
 assert.equal(awakeningActorEligible(rf,{professionId:'RS'}),false);
});

test('RS shares the verified Elsword sword consumer, HUD cues and score-penalty resource pool',()=>{
 const a={professionId:'RS',wayOfSword:{point:4800,state:2},wayOfSwordLimits:{vigor:4800,destruction:-4800}};
 assert.equal(swordHudState(a).ratio,1);assert.equal(swordHudState(a).visible,true);
 assert.equal(skillSwordCueState(a,{raw:{m_usWOSType:2}}),'blue');
 assert.equal(wayOfSwordMpCost(a,{raw:{m_usWOSType:2}},100),70);
 assert.deepEqual(wayOfSwordHitPolicy(a,{WAY_OF_SWORD_TYPE:1}),{damage:1,mp:3});
 const [vigor,destruction]=createLordKnightResourcePools();assert.equal(vigor.read(a),4800);assert.equal(destruction.read(a),0);
 vigor.write(a,2400);assert.deepEqual(a.wayOfSword,{point:2400,state:1});
 vigor.write(a,0);assert.deepEqual(a.wayOfSword,{point:0,state:0});
 destruction.write(a,2400);assert.deepEqual(a.wayOfSword,{point:-2400,state:-1});
 a.wayOfSword.state=-2;assert.equal(skillSwordCueState(a,{raw:{m_usWOSType:1}}),'red');
 assert.deepEqual(wayOfSwordHitPolicy(a,{WAY_OF_SWORD_TYPE:4}),{damage:2,mp:1});
});
