import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consumePvpResourceFrame,pvpMpGain,pvpAwakeningGain,pvpAwakeningEligible,naturalMpGain} from '../../packages/combat-core/pvp-resource-formulas.mjs';

const hit={DAMAGE_TYPE:0,REACT_TYPE:1,HIT_ADD_MP:5};
const actor=()=>({stats:{awakeningChargeBonus:0},awakening:{orbs:0,gauge:0}});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} != ${expected}`);

test('source PvP bases use full rate and asymmetric equipment/roster order',()=>{
  assert.equal(pvpMpGain({kind:'hit',hitAddMp:5}),5);
  assert.equal(pvpMpGain({kind:'received'}),3);
  assert.equal(pvpMpGain({kind:'hit',hitAddMp:5,outnumbered:1}),8);
  assert.equal(pvpMpGain({kind:'received',outnumbered:1}),5);
  assert.equal(pvpMpGain({kind:'hit',hitAddMp:5,outnumbered:1,equipmentMpGainBonus:1,gainMultiplier:2}),26);
  assert.equal(pvpMpGain({kind:'received',outnumbered:1,equipmentMpGainBonus:1,gainMultiplier:2}),20);
});

test('one owner frame shares MP/soul gate between commands, effects, received hits and multiple targets',()=>{
  const a=actor(),b=actor();
  assert.equal(consumePvpResourceFrame(a,hit,9,{kind:'hit'}),true);
  assert.equal(consumePvpResourceFrame(a,hit,9,{kind:'hit',originKind:'effect'}),false);
  assert.equal(consumePvpResourceFrame(a,hit,9,{kind:'received'}),false);
  assert.equal(consumePvpResourceFrame(b,hit,9,{kind:'received'}),true,'different actor has its own gate');
  assert.equal(consumePvpResourceFrame(b,hit,9,{kind:'hit'}),false);
  assert.equal(consumePvpResourceFrame(a,hit,10,{kind:'received'}),true);
  assert.equal(consumePvpResourceFrame(a,hit,10,{kind:'hit'}),false);
});

test('zero gain and full resources still consume source frame; excluded callbacks do not',()=>{
  const a=actor();a.mp=a.mpMax=300;a.awakening.orbs=3;
  assert.equal(consumePvpResourceFrame(a,{...hit,DAMAGE_TYPE:6},0,{kind:'hit'}),false);
  assert.equal(consumePvpResourceFrame(a,{...hit,REACT_TYPE:0},0,{kind:'hit'}),false);
  assert.equal(consumePvpResourceFrame(a,{...hit,REACT_TYPE:10},0,{kind:'hit'}),false);
  assert.equal(consumePvpResourceFrame(a,{...hit,HIT_ADD_MP:0},0,{kind:'hit'}),true);
  assert.equal(consumePvpResourceFrame(a,hit,0,{kind:'received'}),false);
  const b=actor();
  for(const REACT_TYPE of [0,6,10,11,14,17])assert.equal(consumePvpResourceFrame(b,{...hit,REACT_TYPE},0,{kind:'received'}),false);
  assert.equal(consumePvpResourceFrame(b,{...hit,NO_DAMAGE:1},0,{kind:'received'}),false);
  assert.equal(consumePvpResourceFrame(b,{...hit,REACT_TYPE:7},0,{kind:'received'}),true,'dummy damage remains a damaged reaction');
});

test('local-owner disposable remote clone cannot consume owner actor frame',()=>{
  const local=actor(),remote=actor(),remoteObservation=structuredClone(remote);
  assert.equal(consumePvpResourceFrame(remoteObservation,hit,23,{kind:'hit'}),true);
  assert.equal(remote.lastCombatResourceStep,undefined);
  assert.equal(consumePvpResourceFrame(local,hit,23,{kind:'received'}),true);
  const restored=JSON.parse(JSON.stringify(local));
  assert.equal(consumePvpResourceFrame(restored,hit,23,{kind:'hit'}),false,'trusted full simulation restore preserves gate');
  assert.equal(consumePvpResourceFrame(restored,hit,24,{kind:'hit'}),true);
});

test('source awakening adds roster compensation outside equipment multiplier',()=>{
  const a=actor();a.stats.awakeningChargeBonus=.5;
  assert.equal(pvpAwakeningGain(a,'hit',1,{},{}),1.5);
  assert.equal(pvpAwakeningGain(a,'hit',1,{},{outnumbered:1}),3.5);
  assert.equal(pvpAwakeningGain(a,'received',2,{},{outnumbered:1}),5);
  a.passivePolicy={soul:{onHitAdd:.2,receivedAdd:.2},skillLevels:{24404:1},received:{unresolvedSoulField:.09}};
  near(pvpAwakeningGain(a,'hit',1,{onHitSoulAdd:.3},{outnumbered:1}),5.25);
  near(pvpAwakeningGain(a,'received',2,{receivedSoulAdd:.21},{outnumbered:1}),7.5);
});

test('source healing flags suppress soul without inventing an MP gate exclusion',()=>{
  assert.equal(pvpAwakeningEligible(hit,'hit'),true);
  for(const key of ['HP_PERCENT_UP','MP_PERCENT_UP','INCREASE_MP'])assert.equal(pvpAwakeningEligible({...hit,[key]:1},'hit'),false);
  assert.equal(pvpAwakeningEligible({...hit,HP_PERCENT_UP:1},'received'),false);
  assert.equal(pvpAwakeningEligible({...hit,MP_PERCENT_UP:1},'received'),true);
});

test('target RF/LK rates restore one MP per unfrozen second in normal PvP; play channel is explicit',()=>{
  for(const id of ['rf','lk']){
    const profile=JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id}-profile.json`,import.meta.url)));
    assert.equal(profile.components.MP_CHANGE_RATE,1,'target declaration, not generated expected output');
    assert.equal(naturalMpGain({baseRate:profile.components.MP_CHANGE_RATE,elapsed:1}),1);
  }
  assert.equal(naturalMpGain({baseRate:1,elapsed:0}),0);
  assert.equal(naturalMpGain({baseRate:1,elapsed:0,equipmentRate:2,equipmentElapsed:.5}),1,'socket flat rate has a separate CommonFrameMove clock');
  assert.equal(naturalMpGain({baseRate:1,elapsed:.25,equipmentRate:2,itemRate:1}),1);
  assert.equal(naturalMpGain({baseRate:1,elapsed:1,channel:'play'}),7);
  assert.equal(naturalMpGain({baseRate:1,elapsed:1,channel:'play',itemRate:2,equipmentRate:3}),12,'item/socket flat recovery is outside channel scale');
  assert.equal(naturalMpGain({elapsed:1}),null,'missing raw rate remains unsupported');
});

test('malformed resource inputs fail before becoming gain values',()=>{
  assert.throws(()=>consumePvpResourceFrame(actor(),hit,-1,{kind:'hit'}),/step/);
  assert.throws(()=>pvpMpGain({kind:'hit',outnumbered:.5}),/integer/);
  assert.throws(()=>pvpMpGain({kind:'received',equipmentMpGainBonus:NaN}),/finite/);
  assert.throws(()=>pvpMpGain({kind:'other'}),/kind/);
  assert.throws(()=>naturalMpGain({baseRate:1,elapsed:-1}),/nonnegative/);
  assert.throws(()=>naturalMpGain({baseRate:1,elapsed:1,channel:'all-pvp-seven'}),/channel/);
});
