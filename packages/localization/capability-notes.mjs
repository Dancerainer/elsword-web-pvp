const notes = {
  'hold-extension': 'Base duration only. Holding the key for extra duration and MP cost is not implemented.',
  'additional-hit-count': 'The per-hit damage adjustment is available. Extra hits are not implemented.',
  'defensive-effect-bypass': 'MP cost is adjusted and the skill ignores 25% of enemy defense. Bypassing guarding and defensive passives is not implemented.',
  'rf-charge-target': 'A full charge deals 1.5× damage. Hold for up to 3 more seconds before automatic release. The extra critical effect still needs verification.',
  'mutation-range': 'The base projectile is available. Mutation Points do not yet increase its range.',
  'particle-shot-original-lot0': 'The projectile travels in the firing direction and does not home. The older Charged Impulsar passive is unavailable in this skill tree.',
  'pulse-cannon-native-inputs': 'Fires four shots. In normal mode, hold to fire up to eight, paying 25 MP per extra shot. Awakening currently supports four shots. The extra DP cost is unverified. Projectiles can curve toward targets ahead within their original range.',
  'magnetron-orbit': 'Three magnetrons orbit the caster and launch one at a time when a normal attack hits.',
  'stasis-accumulation-formula': 'Store the attack for up to 15 seconds. Press the key again to release the 5250% base attack without another charge. Expiry restores at least 100 MP. Scaling to 10500% damage, 150% range and 300 MP is unverified.',
  'quicksilver-reference-timing': 'The forward and return hits, paid return, mutation stun and hand attachment are supported. Their timing comes from the reference code and still needs original-client verification.',
  'rushing-drone-homing': 'Drones home in on a marked target and deal 1.2× damage. Without a mark they travel in the firing direction.',
  'drone-activator-lock': 'A hit marks the target and lowers its physical and magical defense. Automatic fire, cooldown reset, half-cost fire and target reselection are unavailable.',
  'fission-lock': 'On expiry, the projectile splits into four shots, or eight with a Mutation Point. The first projectile can track the marked target. The split shots inherit that target using the web tracking implementation.',
  'flick-disc-homing': 'The rolling projectile homes in on targets. Full retargeting behavior still needs original-client verification.',
  'phantom-seeker-homing': 'The main projectile and its fragments can home and deal damage. Retargeting uses the original candidate order and random rules. The random state still needs original-client verification.',
  'starfall-attack-driver': 'Unavailable. The startup effect deals no damage and the targeting, missile spawn point and attack loop remain unverified.',
  'starfall-selection-fidelity': 'Bombardment uses the original range, duration and intervals. Target filtering, equal-distance selection and attachment positions still need original-client verification.',
  'ultimate-fury-mutation': 'The three base generators fire beams and follow-up hits. The duplicate generator and the third generator’s assignment with exactly two enemies are unavailable.',
  'countdown-seeking': 'Both projectile forms home in. A marked target takes priority and receives 1.2× damage. Direction changes cannot yet shake off the projectile.',
  'shooting-chaser-beam': 'Unavailable. The tracker deals no damage by itself, and the connecting beam and subsequent hit triggers remain unverified.',
  'shooting-chaser-selection-fidelity': 'Contact connects the beam and triggers four hits using the contact record. Attachment to the target’s bones still needs original-client verification.',
  'space-crack-held-cost': 'Only the first Space Crack attack is available. Extra shots and their MP or DP cost are unavailable.',
  'stardust-missing-clips': 'Unavailable. The original LOOP and END animation clips are missing. MEMO_END uses its original EMP Shock animation alias.',
  'mind-break-scan-fidelity': 'Selects targets within the original PvP range of 500 and 35-degree elevation limit. Applies damage and a debuff, with recovery based on ESP target count. The secondary following effect still needs verification.',
  'maximum-strike-orbs': 'Creates six orbs for 60 seconds. Press the skill key again to fire them one at a time. They track the last target hit within 2 seconds, or fire forward. Orbs keep tracking invulnerable targets until expiry. On a valid hit they explode and continue through enemies in that direction for the rest of their original flight time. Each Mutation Point increases damage by 10%, up to three points. On expiry or death, each unused orb restores 25 MP or DP.',
  'void-field-held-cost': 'The initial cost covers one second. Hold for up to five seconds by spending MP or DP. The last bind lasts its original duration. Collapse and priority transitions still need original-client verification.',
  'moonlight-followup': 'The original initial attack is available. Follow-up hits and stacking are unavailable.',
  'force-finger-scan-and-angle': 'The explosion and MP drain are supported. The angle field is unimplemented. The range of 700 and two-target cap come from the reference code.',
  'reverse-stigma-native-position': 'Mark a target and activate again to return and strike. The return requires at least 20 MP but does not consume additional MP or DP. The web client saves the return position. Position accuracy still needs original-client verification.',
  'energy-boom-target2016': 'Spend one Mutation Point for 1.4× projectile lifetime and 1.5× outer range. Damage stays the same.',
  'prism-native-group-and-endpoint-host': 'Creates a field lasting 10 seconds. Each endpoint has one quarter of the caster’s HP and can be destroyed. The field expires on its own timer.',
  'stasis-source-phase': 'Stores damage and expands to 1.5× the original range. Press the key again to release the stored attack. On timeout, the skill refunds the MP spent.',
  'conqueror-source-inputs': 'Uses the original spread pattern. Mutation Points change the projectile count. Spread and equal-distance selection still need original-client verification. The older extra enhancement is disabled.',
  'quicksilver-native-clock': 'The forward and return hits, mutation stun and connecting effects are active. Map direction and animation poses still need original-client verification.',
  'drone-activator-source-phase': 'Hitting a target marks it and lowers its defense. Related follow-up skills reset cooldown and fire at half MP cost.',
  'flick-native-lot6': 'Tracking starts on hit. The disc uses its hit record to choose a new target, waits before retargeting and moves forward when no target is available.',
  'ultimate-fury-source-inputs': 'Creates three generators, or four with a Mutation Point. Beams and follow-up hits use the target allocation and hit limits.',
  'countdown-native-lot6-and-shake': 'Both forms track within the original range. Change direction left and right within three seconds to shake off the attached normal projectile. The mutation projectile cannot be shaken off this way.',
  'space-crack-native-producer': 'Hold the key for one initial shot and up to five extra shots at the original interval. Each extra shot costs 3 MP in normal mode or spends DP in Awakening.',
  'stardust-instance-inputs': 'After startup, damaging orbs rain down at the casting position and burst. Random landing positions still need original-client verification.',
  'void-native-hold-and-collapse': 'Hold for up to five seconds by spending MP or DP. The field gradually collapses without a second explosion.',
  'moonlight-native-socket-query': 'Creates the original persistent ring and triggers its follow-up hits and stacks on contact.',
  'force-finger-scan-fidelity': 'Selects one target in the original PvP range, explodes and drains 15 MP. A hit restores 45 MP or 900 DP. Target angle still needs original-client verification.',
};
notes['particle-shot-homing'] = notes['particle-shot-original-lot0'];
notes['pulse-cannon-homing'] = notes['pulse-cannon-native-inputs'];

export function capabilityNotes(value) {
  const keys = new Set((value?.limitations ?? []).map(note => String(note?.key ?? note).split(':')[0]));
  const skillId = Number(value?.originalSkillId ?? value?.skillId ?? value?.id);
  const lordKnight = value?.classId === 100 || (skillId >= 21000 && skillId < 22000);
  if (!lordKnight && value?.memoTypeName === 'MI_CRITICAL') keys.add('defensive-effect-bypass');
  if (Number(value?.skillId ?? value?.id) === 24009) keys.add('rf-charge-target');
  if (value?.memoTypeName === 'MI_USEFUL') keys.delete('additional-hit-count');
  return [...keys].map(key => notes[key] ?? 'Part of this effect is not implemented.');
}
