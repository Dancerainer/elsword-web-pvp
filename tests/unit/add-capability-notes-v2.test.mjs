import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {capabilityNotes} from '../../packages/localization/skills.mjs';

// A private review tree may read the integration tree's frozen profile bytes
// without overwriting either tree's generated profiles.
const root=process.env.ADD_REVIEW_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const profiles=['lp','mm','de'].map(id=>JSON.parse(readFileSync(resolve(root,`packages/combat-core/${id}-profile.json`),'utf8')));
const skill=(id)=>profiles.flatMap(p=>p.skillCatalog).find(s=>s.skillId===id);
const note=(id)=>capabilityNotes(skill(id)).join('\n');

test('every current Add profile limitation has a specific English explanation',()=>{
  const keys=new Set();
  for(const profile of profiles)for(const row of profile.skillCatalog){
    const limitations=row.limitations??[];
    for(const item of limitations)keys.add(item.key);
    const notes=capabilityNotes(row);
    assert.equal(notes.length,new Set(limitations.map(item=>item.key)).size,`${profile.professionId}/${row.skillId}`);
    for(const text of notes){
      assert.notEqual(text,'Part of this effect is not implemented.',`${profile.professionId}/${row.skillId}`);
      assert.doesNotMatch(text,/\[object Object\]|undefined/);
    }
  }
  for(const key of ['particle-shot-original-lot0','pulse-cannon-native-inputs','stardust-instance-inputs'])assert.ok(keys.has(key));
});

test('recovered native Add attacks retain their selection limits and the selected Stardust main-exit producer is available',()=>{
  assert.equal(skill(29021).supported,true);
  for(const id of [29016,29018]){assert.equal(skill(id).supported,true);assert.match(note(id),/[A-Z]/);assert.match(note(id),/original-client verification/);}
  assert.match(note(29016),/Bombardment.*range, duration and intervals/);
  assert.match(note(29018),/Contact connects the beam.*four hits/);
  assert.match(note(29021),/After startup.*rain.*landing positions.*original-client verification/);
  assert.equal(skill(29038),undefined);
  assert.equal(skill(29040),undefined);
});

test('follow-up explanations retain closed work, adapter limits and legacy exclusion',()=>{
  assert.match(note(29035),/marks it and lowers its defense.*reset cooldown.*half MP/);
  assert.match(note(29011),/return hits, mutation stun.*connecting effects.*original-client verification/);
  assert.match(note(29215),/one target.*drains 15 MP.*45 MP or 900 DP/);
  assert.match(note(29025),/return requires at least 20 MP.*saves the return position.*original-client verification/);
  assert.match(note(29217),/does not home.*older Charged Impulsar/);
  assert.equal(skill(9400),undefined);
  assert.deepEqual(capabilityNotes(skill(29404)),[]);
  assert.match(note(29022),/within 2 seconds.*tracking invulnerable targets until expiry.*each unused orb restores 25 MP or DP/);
});

test('Pulse mode limits and Particle original straight-flight behavior remain explicit to players',()=>{
  for(const id of [29006,29034]){assert.match(note(id),/Fires four shots.*normal mode.*eight.*25 MP.*Awakening currently supports four shots/);assert.doesNotMatch(note(id),/local10|typed|seed/);}
  for(const id of [29202,29217]){assert.match(note(id),/firing direction and does not home/);assert.doesNotMatch(note(id),/unverified/);}
});

test('capability notes preserve string contracts and deduplicate object keys',()=>{
  assert.deepEqual(capabilityNotes({limitations:['hold-extension: source detail']}),['Base duration only. Holding the key for extra duration and MP cost is not implemented.']);
  assert.equal(capabilityNotes({limitations:[{key:'starfall-attack-driver'},{key:'starfall-attack-driver'}]}).length,1);
  assert.deepEqual(capabilityNotes({limitations:[{key:'unknown-future-limitation'}]}),['Part of this effect is not implemented.']);
});
