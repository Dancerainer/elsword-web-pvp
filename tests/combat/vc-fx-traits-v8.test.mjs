// Explicit v8 equipment inputs isolate historical residual birth/sound timings.
import {beforeBalanceV3} from '../helpers/equipment-balance-before-v3.mjs';
/** Independent user v8 expectations executed on original converted poses,
 * native combat helpers and the authored Garpai map. No offensive hit or
 * collision shape is injected. These observations are current simulation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcProductionFixture,vcProductionPreset} from '../helpers/vc-production-fixture.mjs';
import {vcProfile} from '../helpers/vc-fixture.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {allowVeteranResidualChild,veteranResidualHitAudioMuted} from '../../packages/combat-core/vc-effect-policy-v8.mjs';
import {traitDescription,capabilityNotes} from '../../packages/localization/skills.mjs';
const near=(a,b,eps=.002)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const rows=[];
const silentNames=['RAVEN_BARRAGE_ATTACK_EXTRA_MEMO','DAMAGE_EFFECT_A_RWT_FLAME_SWORD_MEMO'];
function fixture(skillId,{branch='none',gap=160,awake=false,critical=false,multiple=false,invincible=false,facing=1,air=false}={}){
  const passives=air?[24412]:[];
  const f=vcProductionFixture({preset:{loadout:[{skillId,branchId:branch},...Array(7).fill(null)],passives,guildPassives:[],
    attributes:{...beforeBalanceV3(vcProductionPreset).attributes,criticalRate:critical?50:0}},
    actor:{position:[-600,3080,0],facing,passives,guildPassives:[]},gap:-600+gap*facing});
  f.b.facing=-facing;f.b.forceInvincible=invincible?60:0;
  if(multiple){const extra=structuredClone(f.b);extra.id='second-target';extra.x+=20*facing;f.sim.state.actors.push(extra);}
  if(awake){f.a.awakening.remaining=60;f.a.awakening.orbs=1;}
  if(air){f.a.y+=100;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','explicit-air-residual-fixture');}
  f.sim.rng=()=>critical?0:.99;
  const names=new Map(),lifetimes=new Map(),create=f.sim.createEffect.bind(f.sim);
  f.sim.createEffect=(...args)=>{const e=create(...args);names.set(e.id,e.name);lifetimes.set(e.id,e.lifeTimeSeconds);return e;};
  f.sim.drainEvents();return {...f,names,lifetimes};
}
function cast(f,{heat=false,frames=720}={}){
  const events=[];for(let i=0;i<frames;i++){
    const press=i===0||heat&&i<200&&i%2===0?['A']:f.sim.skill(f.a.skillId,f.a)?.skillId===24217&&i===15?['X']:[];
    f.sim.step(1/60,{pressed:press},{snapshot:false});events.push(...f.sim.drainEvents());
  }return events;
}
for(const skillId of[24221,24218])for(const air of[false,true])for(const awake of[false,true])for(const critical of[false,true])
  test(`v8 equipment VC residual ${skillId} air=${air} awake=${awake} critical=${critical} is silent while the initial hit retains sound`,()=>{
    const f=fixture(skillId,{awake,critical,air,multiple:true}),events=cast(f),hits=events.filter(e=>e.type==='hit');
    const residual=hits.filter(e=>silentNames.includes(f.names.get(e.origin?.id)));
    assert.ok(residual.length>=(air?2:10),'real lingering collision is required');
    assert.ok(new Set(residual.map(e=>e.targetId)).size>=2,'multiple enemies actually receive residual hits');
    assert.ok(residual.every(h=>h.critical===critical),'critical calculation is retained');
    const own=events.filter(e=>e.type==='sound'&&['original-critical','original-damage-hit'].includes(e.field));
    for(const h of residual)assert.equal(own.some(e=>e.actorId===h.targetId&&e.time===h.time&&e.origin?.id===h.origin?.id&&e.origin?.kind===h.origin?.kind),false,'both sound routes are silent at residual hit');
    const first=hits.find(h=>!silentNames.includes(f.names.get(h.origin?.id))&&h.amount>0);assert.ok(first);
    assert.ok(own.some(e=>e.actorId===first.targetId&&e.time===first.time&&e.field==='original-damage-hit'));
    assert.equal(own.some(e=>e.actorId===first.targetId&&e.time===first.time&&e.field==='original-critical'),critical);
    rows.push({kind:'silent-residual',skillId,air,awake,critical,residualHits:residual.length,targets:[...new Set(residual.map(e=>e.targetId))],
      materialHitSounds:own.filter(e=>e.field==='original-damage-hit').length,criticalSounds:own.filter(e=>e.field==='original-critical').length});
  });

for(const skillId of[24213,24217])for(const facing of[1,-1])for(const mode of['hit','miss','invincible','multiple'])
  test(`production bomb ${skillId} facing=${facing} ${mode}: only an expired missed projectile starts residual fire`,()=>{
    const f=fixture(skillId,{gap:mode==='miss'?20000:160,facing,invincible:mode==='invincible',multiple:mode==='multiple'}),events=cast(f);
    const prefix=skillId===24213?'DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_':'DAMAGE_EFFECT_SHADOW_BACK_SLIDE_BULLET_';
    const ids=[...f.names].filter(([,name])=>name.startsWith(prefix)).map(([id])=>id);assert.equal(ids.length,3,'actual cast emits three authored bombs');
    const contacts=events.filter(e=>e.type==='effectContact'&&ids.includes(e.origin?.id)),contactIds=new Set(contacts.map(e=>e.origin.id));
    const children=events.filter(e=>e.type==='damageSecondaryCreated'&&ids.includes(e.parentEffectId));
    const flameName=skillId===24213?'DamageEffect_RVC_Napalm_Grenade_Flame':'DAMAGE_EFFECT_SHADOW_BURSTER';
    for(const id of ids){
      const end=events.find(e=>e.type==='effectEnded'&&e.effectId===id);assert.ok(end,'bomb completed lifetime');
      const own=children.filter(e=>e.parentEffectId===id);
      if(contactIds.has(id)){assert.equal(end.reason,'hit-limit');assert.equal(own.length,0,'accepted hit cannot start residual chain');}
      else {assert.equal(end.reason,'template-life-time');assert.equal(own.length,1);assert.equal(own[0].name,flameName);}
    }
    if(['hit','multiple'].includes(mode)){assert.ok(contacts.length>0);assert.ok(events.some(e=>e.type==='reactionEffectCreated'&&ids.includes(e.parentEffectId)), 'on-hit explosion remains');}
    else {assert.equal(contacts.length,0);assert.equal(children.length,3);assert.ok(events.some(e=>e.type==='damageSecondaryCreated'&&/Flame_Damage/.test(e.name)), 'missed bombs reach native land and create authored fire');}
    rows.push({kind:'bomb-residual',skillId,facing,mode,acceptedContacts:contacts.length,hitProjectiles:contactIds.size,missResidualChains:children.length});
  });

for(const awake of[false,true])for(const heat of[false,true])
  test(`production Crow useful awake=${awake} heat=${heat}: every damage phase is70%, the shared fire group hits16 instead of8 at unchanged8.3s`,()=>{
    const base=fixture(24022,{awake}),useful=fixture(24022,{awake,branch:'memo-61'});
    const baseEvents=cast(base,{heat}),newEvents=cast(useful,{heat});
    const matching=(events,f,re)=>events.filter(e=>e.type==='hit'&&re.test(f.names.get(e.origin?.id)??''));
    const firstBase=matching(baseEvents,base,/^DAMAGE_EFFECT_IGNITION_CROW(?:_OVERHEAT)?$/),firstNew=matching(newEvents,useful,/^DAMAGE_EFFECT_IGNITION_CROW(?:_OVERHEAT)?$/);
    assert.equal(firstBase.length,1);assert.equal(firstNew.length,1);near(firstNew[0].amount/firstBase[0].amount,.7);
    assert.equal(firstNew[0].data.HIT_GAP,undefined,'first attack stays a single hit');
    const fireBase=matching(baseEvents,base,/^DAMAGE_EFFECT_IGNITION_CROW_GROUND(?:_OVERHEAT)?$/),fireNew=matching(newEvents,useful,/^DAMAGE_EFFECT_IGNITION_CROW_GROUND(?:_OVERHEAT)?$/);
    assert.equal(fireBase.length,8);assert.equal(fireNew.length,16,'overlapping ground-fire instances share the source GROUP_DAMAGE gate');
    near(fireNew[0].amount/fireBase[0].amount,.7);
    // Original target-delta binary32 subtraction remains positive after66/32
    // steps for1.1/.55; source shared records expire on callback67/33.
    for(let i=1;i<fireBase.length;i++)near(fireBase[i].time-fireBase[i-1].time,67/60);
    for(let i=1;i<fireNew.length;i++)near(fireNew[i].time-fireNew[i-1].time,33/60);
    near(base.lifetimes.get(fireBase[0].origin.id),8.3);near(useful.lifetimes.get(fireNew[0].origin.id),8.3);
    assert.ok(fireNew.every(h=>h.data.HIT_GAP===.55&&Math.abs(h.amount-fireNew[0].amount)<.02));
    rows.push({kind:'crow-useful',awake,heat,firstDamageBase:firstBase[0].amount,firstDamageUseful:firstNew[0].amount,
      groupedHitBase:8,groupedHitUseful:16,gapBase:1.1,gapUseful:.55,lifetime:8.3});
  });

test('residual policies are scoped to VC and require accepted contact and natural expiry, leaving ordinary deaths and shared RF sound intact',()=>{
  const profile={target:{unitClass:115}},rf={target:{unitClass:4}},name='DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_1',definition={DAMAGE_EFFECT_NAME:'DamageEffect_RVC_Napalm_Grenade_Flame'};
  assert.equal(allowVeteranResidualChild(profile,{name,hitCount:0,endReason:'template-life-time'},definition),true);
  assert.equal(allowVeteranResidualChild(profile,{name,hitCount:1,endReason:'template-life-time'},definition),false,'a hit cannot later expire into fire');
  for(const endReason of['hit-limit','template-land-crash','delete-state','delete-damage-react'])assert.equal(allowVeteranResidualChild(profile,{name,hitCount:0,endReason},definition),false);
  assert.equal(allowVeteranResidualChild(rf,{name,hitCount:1,endReason:'hit-limit'},definition),true);
  assert.equal(veteranResidualHitAudioMuted(profile,{name:silentNames[0]}),true);assert.equal(veteranResidualHitAudioMuted(rf,{name:silentNames[0]}),false);
  const skill=vcProfile.skillCatalog.find(s=>s.skillId===24022);
  assert.equal(createSkillTraitPolicy({...skill,unitClass:4},'memo-61').hitGapMultiplier,.5);
  const other=vcProfile.skillCatalog.find(s=>s.skillId===24028),otherUseful=other.branches.find(b=>b.memoTypeName==='MI_USEFUL');
  assert.equal(createSkillTraitPolicy(other,otherUseful.id).hitGapMultiplier,otherUseful.parameters[0],'target2016 public DD hook consumes every applicable USEFUL gap');
});

test('Crow useful metadata and Chinese display describe the complete requested effect without stale partial warning',()=>{
  const branch=vcProfile.skillCatalog.find(s=>s.skillId===24022).branches.find(b=>b.id==='memo-61');
  assert.equal(branch.supported,true);assert.deepEqual(branch.limitations,[]);assert.equal(branch.supportStatus,'target2016-static-public-DD-consumer-v53');
  const description=traitDescription(branch);assert.match(description,/initial hit and lingering flames/);assert.match(description,/70%/);assert.match(description,/twice as often/);assert.match(description,/same duration/);
  assert.deepEqual(capabilityNotes(branch),[]);assert.doesNotMatch(description,/not implemented/);
});

test('v8 rules retain original hashed damage/memo declarations and do not rewrite source hit gap or lifetime',()=>{
  for(const file of['damage','skill-note']){
    const doc=JSON.parse(readFileSync(new URL(`../../.cache/vc/${file}-declarations.json`,import.meta.url)));
    assert.equal(createHash('sha256').update(readFileSync(doc.source.path)).digest('hex'),doc.source.sha256);
    if(file==='damage')for(const name of['DAMAGE_EFFECT_IGNITION_CROW_GROUND','DAMAGE_EFFECT_IGNITION_CROW_GROUND_OVERHEAT',...silentNames])assert.deepEqual(vcProfile.damageEffects[name].raw,doc.globals[name]);
  }
  assert.equal(vcProfile.damageEffects.DAMAGE_EFFECT_IGNITION_CROW_GROUND.raw.DAMAGE_DATA.HIT_GAP,1.1);
  assert.equal(vcProfile.effectTemplates.RVC_IGNITION_CROW_ATTACKBOX.fields.LifeTime,8.3);
});

test.after(()=>{if(process.env.VC_FX_TRAITS_V8_REPORT==='1')writeFileSync(new URL('../../reports/vc-fx-traits-observations-v8.json',import.meta.url),JSON.stringify({schemaVersion:1,
  evidenceClass:'production-equipment-current-simulation-original-poses-native-map-not-original-client',dt:1/60,seed:2016,rows},null,2)+'\n');});
