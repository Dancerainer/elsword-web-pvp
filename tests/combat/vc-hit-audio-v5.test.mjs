/** Original sound declarations/table are independent expectations. Fixtures
 * execute native helpers and map collision; no injected offensive hits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {damageEffectSoundEntries} from '../../packages/combat-core/hit-audio.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {feedVcCommandInput,VC_COMMAND_INPUT_CASES} from '../../tools/combat/vc-command-input-cases-v5.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const source=read('contracts/vc-hit-audio-source-v5.json');
const manifest={files:{...read('artifacts/audio/manifest.json').files,
  ...read('artifacts/audio/pvp/manifest.json').files,...read('artifacts/vc/audio/manifest.json').files,
  ...Object.fromEntries(Object.entries(read('artifacts/rf/core-shield-audio/manifest.json').files)
    .map(([name,row])=>[name,{...row,file:'../rf/core-shield-audio/'+row.file}]))}};
const observations=[];
const expectedHit=(h,names)=>{const d=h.data;
  // Explicit user v8 override: residual smoke/flame hits are fully silent,
  // although the first cast hit keeps its original sound-table declaration.
  if(['RAVEN_BARRAGE_ATTACK_EXTRA_MEMO','DAMAGE_EFFECT_A_RWT_FLAME_SWORD_MEMO'].includes(names.get(h.origin?.id))||
    [0,10].includes(d.REACT_TYPE??0)||d.HIT_TYPE===-1)return null;
  const t=source.damageSoundTables[d.HIT_TYPE??0];return t?.[source.vcHittedType]||t?.[0]||source.damageSoundTables[0]?.[0]||null;};
function verify(events){
  const hits=events.filter(e=>e.type==='hit'),sounds=events.filter(e=>e.type==='sound');
  const names=new Map(events.filter(e=>e.type==='effectStarted').map(e=>[e.effectId,e.name]));
  assert.deepEqual(sounds.filter(e=>e.field==='original-damage-hit').map(e=>({name:e.name,time:e.time,actorId:e.actorId,attackerId:e.attackerId})),
    hits.flatMap(h=>{const name=expectedHit(h,names);return name?[{name,time:h.time,actorId:h.targetId,attackerId:h.actorId}]:[];}));
  const seen=new Set();
  for(const e of sounds.filter(e=>/^SOUND\d+$/.test(e.field))){
    const original=source.effectSounds[e.effectName]?.[e.field];assert.ok(original,e.effectName+'/'+e.field);
    assert.equal(e.name,original.FILE_NAME);assert.equal(e.eventTime,original.EVENT_TIME??0);
    const key=e.effectId+':'+e.field;assert.ok(!seen.has(key),'duplicate mesh record '+key);seen.add(key);
  }
  const errors=[],requests=[];
  const player=createBattleAudio({storage:null,onError:e=>errors.push(e),createAudio:url=>({play(){requests.push(url);return Promise.resolve();},pause(){}})});
  player.configure({manifest,criticalSoundFile:'critical-fx/Critical_Hit.wav'});
  for(const e of sounds)assert.equal(player.play(e.name),true,'actual event resource '+e.name);
  assert.deepEqual(errors,[]);assert.equal(requests.length,sounds.length);player.dispose();
  return {hits:hits.length,hitSounds:sounds.filter(e=>e.field==='original-damage-hit').length,
    effectSounds:sounds.filter(e=>/^SOUND\d+$/.test(e.field)).map(e=>({effect:e.effectName,field:e.field,name:e.name,time:e.time})),
    uniqueSounds:[...new Set(sounds.map(e=>e.name))],mockPlaybackRequests:requests.length};
}
const tick=(f,input,events)=>{f.sim.step(1/60,input,{snapshot:false});events.push(...f.sim.drainEvents());};
const skills=vcProfile.skillCatalog.filter(s=>s.selectable&&s.state&&s.skillId!==900),heatIds=new Set([24020,24021,24022,24023,24024,24031,24034]);
test('all 19 allowed skills and 62 ordinary/awake/overheat/air/followup branches produce source-backed playable sounds',()=>{
  let cases=0,realHitCases=0;
  for(const skill of skills){
    const modes=skill.skillId===24217?['default','follow-z','follow-x','return']:[24218,24221].includes(skill.skillId)?['default','air']:['default'];
    for(const mode of modes)for(const awake of [false,true])for(const heat of heatIds.has(skill.skillId)?[false,true]:[false]){
      const f=vcFixture({skillId:skill.skillId,position:[-600,3080,0],gap:skill.skillId===24031?800:skill.skillId===24217?250:160});
      if(skill.skillId===24031||mode==='air'){f.a.y+=450;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','explicit-audio-air-fixture');}
      if(awake){f.a.awakening.remaining=60;f.a.awakening.full=true;}
      f.sim.drainEvents();const events=[];
      for(let i=0;i<720;i++)tick(f,{pressed:i===0||heat&&i<240&&i%2===0?['A']:i===15&&mode!=='default'&&mode!=='air'?[mode==='follow-z'?'Z':mode==='follow-x'?'X':'A']:[]},events);
      assert.equal(events.filter(e=>e.type==='skillStarted').length,1,skill.skillId+'/'+mode+'/'+awake+'/'+heat);
      const result=verify(events);if(result.hits)realHitCases++;
      if(mode==='default'&&skill.skillId!==24217||skill.skillId===24217&&mode==='follow-z')assert.ok(result.hits>0,skill.skillId+'/'+mode+' actual helper hit required');
      observations.push({kind:'skill',skillId:skill.skillId,mode,awake,heat,gap:skill.skillId===24031?800:skill.skillId===24217?250:160,...result});cases++;
    }
  }
  assert.equal(cases,62);assert.ok(realHitCases>=52);assert.equal(skills.length,19);
});

test('Crow and Deadly sound meshes still play their own records on misses; misses emit no material-hit sound',()=>{
  for(const skillId of [24022,24023,24024])for(const heat of [false,true]){
    const f=vcFixture({skillId,passives:[],position:[-600,3080,0],gap:20000}),events=[];f.sim.drainEvents();
    for(let i=0;i<720;i++)tick(f,{pressed:i===0||heat&&i<240&&i%2===0?['A']:[]},events);
    const result=verify(events);assert.equal(result.hits,0);assert.equal(result.hitSounds,0);
    // Deadly requires a connected initial hit to create its later damage
    // sequence. Crow projectiles create SOUNDn regardless of a target hit.
    if(skillId!==24024)assert.ok(result.effectSounds.length>0);
    observations.push({kind:'miss',skillId,heat,...result});
  }
});

test('all 34 frozen mesh SOUND owners consume all 37 source records once, including deliberate same-file dual records',()=>{
  let count=0;
  for(const [name,records]of Object.entries(source.effectSounds)){
    const f=vcFixture({gap:20000,passives:[]}),events=[];f.sim.drainEvents();
    const effect=f.sim.createEffect(f.a,{NAME:name},{birthAnchor:{position:[f.a.x,f.a.y+250,f.a.z],facing:f.a.facing}});
    for(let i=0;i<180;i++)tick(f,{},events);
    const own=events.filter(e=>e.type==='sound'&&e.effectId===effect.id&&/^SOUND\d+$/.test(e.field));
    assert.deepEqual(own.map(e=>({field:e.field,name:e.name})),Object.entries(records).map(([field,r])=>({field,name:r.FILE_NAME})),name);
    verify(events);count+=own.length;
  }
  assert.equal(count,37);
});

test('source mesh sound boundary/stop does not skip or replay a record and preserves two distinct source records',()=>{
  const raw=source.effectSounds.DAMAGE_EFFECT_IGNITION_CROW_SOUND,t=Math.fround(.01);
  assert.deepEqual(damageEffectSoundEntries(raw,[],{afterGlobal:0,beforeAnimation:0,afterAnimation:0}),[]);
  assert.deepEqual(damageEffectSoundEntries(raw,[],{afterGlobal:t,beforeAnimation:0,afterAnimation:t}).map(e=>e.key),['SOUND0','SOUND1']);
  assert.deepEqual(damageEffectSoundEntries(raw,['SOUND0','SOUND1'],{afterGlobal:1,beforeAnimation:0,afterAnimation:1}),[]);
  assert.deepEqual(damageEffectSoundEntries(raw,[],{afterGlobal:t,beforeAnimation:t,afterAnimation:t}),[]);
  assert.deepEqual(damageEffectSoundEntries({SOUND0:{...raw.SOUND0,USE_GLOBAL_TIME:1}},[],{afterGlobal:t,beforeAnimation:0,afterAnimation:1}),[]);
  assert.equal(damageEffectSoundEntries({SOUND0:{...raw.SOUND0,USE_GLOBAL_TIME:1}},[],{afterGlobal:t+.001,beforeAnimation:0,afterAnimation:1}).length,1);
});

test('actual Z chain hit-stop and cannon/668 input retain material hit sounds and mesh-impact audio without duplicate source records',()=>{
  for(const gap of [5,20000]){
    const f=vcFixture({gap,passives:[],position:[-600,3080,0]}),events=[],buffered=new Set();f.sim.drainEvents();let stopped=false;
    for(let i=0;i<240;i++){
      const press=i===0||/^RSI_COMBO_Z{1,3}$/.test(f.a.state)&&f.a.animationTime>=.1&&!buffered.has(f.a.state);
      if(press)buffered.add(f.a.state);tick(f,press?{pressed:['Z']}: {},events);stopped||=f.a.hitStop>0||f.b.hitStop>0;
    }
    const result=verify(events);assert.equal(result.hits,gap===5?4:0);if(gap===5)assert.ok(stopped,'real collision causes native hit-stop');
    observations.push({kind:'input-command',command:'ZZZZ',gap,...result});
  }
  for(const {id:mode,frames} of VC_COMMAND_INPUT_CASES)for(const gap of [160,20000]){
    const f=vcFixture({gap,position:[-600,3080,0],passives:[]}),events=[],input=createInputBuffer({sampledLevels:true});f.sim.drainEvents();
    for(let frame=0;frame<frames;frame++){feedVcCommandInput(input,f.sim,f.a,mode,frame);tick(f,{vc:input.consume(f.sim.state.time+1/60)},events);}
    const result=verify(events);if(gap===20000)assert.equal(result.hits,0);
    if(['xxxx','airzxx','airxxxx'].includes(mode))assert.ok(events.some(e=>e.type==='effectStarted'),'actual projectile emission');
    observations.push({kind:'input-command',command:mode,gap,...result});
  }
});

test('actual ZZZ2XX input creates the original impact SOUND on hit and on ground-impact miss',()=>{
  for(const gap of [160,20000]){
    const f=vcFixture({gap,position:[-600,3080,0],passives:[]}),events=[],states=new Set();f.sim.drainEvents();
    for(let i=0;i<300;i++){
      const z=['RSI_WAIT','RSI_COMBO_Z','RSI_COMBO_ZZ'].includes(f.a.state);
      tick(f,{pressed:i<100&&i%2===0?[z?'Z':'X']:[],held:z?[]:['DOWN']},events);states.add(f.a.state);
    }
    assert.ok(states.has('RSI_WEAPON_TAKER_COMBO_ZZZdownXX'),'full input route, not direct effect injection');
    const result=verify(events);assert.equal(result.hits>0,gap===160);
    const births=events.filter(e=>e.type==='effectStarted'&&e.name==='RWT_COMBO_ZZZ_DOWN_XX_SHELL_IMPACT');
    assert.ok(births.length>0);
    assert.equal(result.effectSounds.filter(e=>e.name==='RWT_COMBO_ZZZ_DOWN_XX_SHELL_IMPACT.ogg').length,births.length,
      'each original impact instance consumes SOUND0 once; target hit and subsequent ground impact may create separate instances');
    observations.push({kind:'input-command',command:'ZZZ2XX',gap,...result});
  }
});

test.after(()=>{if(process.env.VC_HIT_AUDIO_REPORT==='1')writeFileSync(new URL('../../reports/vc-hit-audio-observations-v5.json',import.meta.url),JSON.stringify({
  schemaVersion:1,targetClientMeasured:false,classification:'current simulation/native collision and mock browser player; not original-client timing or audible-output proof',
  sourceContract:'contracts/vc-hit-audio-source-v5.json',dt:1/60,seed:2016,rows:observations},null,2)+'\n');});
