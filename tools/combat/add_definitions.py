"""Explicit Add target2016 skill and career ownership; never inferred from old IDs."""
PROFESSIONS={
 'lp':dict(classId=122,classes=(9,32,122),pose='ADD_LUNATIC_PSYKER',career='UC_ADD_LUNATIC_PSYKER',label='LP / Lunatic Psyker',prefixes=('APT','ALP'),equipment='rf'),
 'mm':dict(classId=123,classes=(9,33,123),pose='ADD_MASTERMIND',career='UC_ADD_MASTERMIND',label='MM / Mastermind',prefixes=('AAT','AMM'),equipment='vc'),
 'de':dict(classId=126,classes=(9,36,126),pose='ADD_DIABOLIC_ESPER',career='UC_ADD_DIABOLIC_ESPER',label='DE / Diabolic Esper',prefixes=('ATT','ADE'),equipment='vc'),
}
ACTIVE={
900:('ANSI_THROW_ITEM','RelationshipLove'),
29000:('ANSI_SA_AN_ENERGY_BOOM','EnergyBoom'),29201:('ANSI_A_AN_PHASE_SHIFT','PhaseShift'),
29001:('ANSI_SA_AN_VOID_BREAKER','VoidBreaker'),29002:('ANSI_SA_AN_PARTICLE_ACCELERATOR','ParticleAccelerator'),
29003:('ANSI_SA_AN_PARTICLE_PRISM','ParticlePrism'),29004:('ANSI_SA_AN_NEUTRON_BOMB','NeutronBomb'),
29202:('ANSI_A_AN_PULSE_BULLET','ParticleShot'),29203:('ANSI_A_APT_DESOLVER_DYNAMO','Dissolver'),
29005:('ANSI_SA_APT_QUAKE_BUSTER','QuakeBuster'),29006:('ANSI_SA_APT_PULSE_CANNON_READY','PulseCannon'),
29204:('ANSI_A_APT_PYLON_DYNAMO','Pylon'),29205:('ANSI_A_APT_MAGNETRON_DYNAMO','Magnetron'),
29007:('ANSI_SA_APT_STASIS_FIELD','StasisField'),29206:('ANSI_A_ALP_TWIRL_RUSH','RushTwirl'),
29008:('ANSI_SA_APT_CONQUEROR','Conqueror'),29009:('ANSI_SA_ALP_PSYCHIC_STORM','PsychicStorm'),
29010:('ANSI_SA_APT_EMP_SHOCK','EMPShock'),29207:('ANSI_A_ALP_PSIONIC_BEAT','PsionicBeat'),
29011:('ANSI_SA_ALP_QUICKSILVER_ACCEL','QuicksilverAccel'),29600:('ANSI_HA_ALP_DOOMS_DAY','DoomsDay'),
29208:('ANSI_A_AAT_RUSHING_DRONE_DYNAMO','RushingDrones'),29012:('ANSI_SA_AAT_PANZER_BUSTER_START','PanzerBuster'),
29013:('ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR','DroneActivator'),29209:('ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO','FissionShot'),
29014:('ANSI_SA_AAT_PSIONIC_GENERATOR','PsionicGenerator'),29210:('ANSI_A_AMM_FLICK_DISC_DYNAMO','FlickDisc'),
29015:('ANSI_SA_AAT_PHANTOM_SEEKER','PhantomSeeker'),29016:('ANSI_SA_AMM_INSTALLATION_STAR_FALL','Starfall'),
29017:('ANSI_SA_AMM_INSTALLATION_ULTIMATE_FURY','UltimateFury'),29211:('ANSI_A_AMM_COUNTDOWN_BOMB_DYNAMO','DelayedExplosion'),
29018:('ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER','ShootingChaser'),29601:('ANSI_HA_AMM_APOCALYPSE','Apocalypse'),
29212:('ANSI_A_ATT_SPACE_CRACK_START','SpaceCrack'),29019:('ANSI_SA_ADE_GRAVITY_BURSTER','GravityBuster'),
29020:('ANSI_SA_ADE_REVERSE_CIRCLE','ReverseCircle'),29213:('ANSI_SA_COMMON_CREST_OF_TIME','SealOfTime'),
29021:('ANSI_SA_ATT_STARDUST_SHOWER','StardustShower'),29214:('ANSI_A_AN_MIND_BREAK','MindBreak'),
29022:('ANSI_SA_ATT_MAXIMUM_STRIKE','MaximumStrike'),29023:('ANSI_SA_ATT_VOID_FIELD','VoidField'),
29024:('ANSI_SA_ADE_MOONLIGHT_RHAPSODY','MoonlightRhapsody'),29215:('ANSI_A_ADE_FORCE_FINGER','ForceFinger'),
29025:('ANSI_SA_ADE_REVERSE_STIGMA','ReverseStigma'),29602:('ANSI_HA_ADE_PARANOIA','Paranoia'),
}
FOLLOWUP={29201:['ANSI_A_AN_PHASE_SHIFT_BLINK'],29202:['ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_READY','ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_CHARGE','ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_FIRE'],
29006:['ANSI_SA_APT_PULSE_CANNON_LOOP','ANSI_SA_APT_PULSE_CANNON_FINISH'],29007:['ANSI_SA_APT_STASIS_FIELD_ACTIVE'],
29009:['ANSI_SA_ALP_PSYCHIC_STORM_LOOP','ANSI_SA_ALP_PSYCHIC_STORM_FINISH'],29011:['ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK'],
29012:['ANSI_SA_AAT_PANZER_BUSTER_AIMING','ANSI_SA_AAT_PANZER_BUSTER_FIRE','ANSI_SA_AAT_PANZER_BUSTER_DEGREE_UP','ANSI_SA_AAT_PANZER_BUSTER_DEGREE_DOWN'],
29212:['ANSI_A_ATT_SPACE_CRACK_WAIT','ANSI_A_ATT_SPACE_CRACK_MOVE','ANSI_A_ATT_SPACE_CRACK_END'],
29021:[], # target2016 selected path: main received-exit starts the persistent rain
29023:['ANSI_SA_ATT_VOID_FIELD_LOOP','ANSI_SA_ATT_VOID_FIELD_END'],29025:['ANSI_SA_ADE_REVERSE_STIGMA_RETURN']}
COMMON_ROLES=['WAIT','WALK','DASH','DASH_END','JUMP_READY','JUMP_UP','JUMP_DOWN','JUMP_LANDING','DASH_JUMP','DASH_JUMP_LANDING','DASH_JUMP_POWER_LANDING','HYPER_MODE','DIE_FRONT','DIE_BACK','DAMAGE_GROGGY','DAMAGE_SMALL_FRONT','DAMAGE_SMALL_BACK','DAMAGE_BIG_FRONT','DAMAGE_BIG_BACK','DAMAGE_DOWN_FRONT','DAMAGE_DOWN_BACK','DAMAGE_STANDUP_FRONT','DAMAGE_STANDUP_BACK','DAMAGE_AIR_SMALL','DAMAGE_AIR_DOWN','DAMAGE_AIR_DOWN_INVINCIBLE','DAMAGE_AIR_DOWN_LANDING','DAMAGE_AIR_FALL','DAMAGE_AIR_UP','DAMAGE_AIR_FLY_FRONT','DAMAGE_AIR_FLY_BACK','STANDUP_ATTACK_FRONT','STANDUP_ATTACK_BACK','DAMAGE_REVENGE']
ALIASES={**{'RSI_'+k:'ANSI_'+k for k in COMMON_ROLES},**{'RSI_'+k:'ANSI_'+k for k in ['COMBO_Z','COMBO_ZZ','COMBO_ZZZ','COMBO_ZZZZ','COMBO_X','COMBO_XX','COMBO_XXX','DASH_COMBO_Z','DASH_COMBO_ZZ','DASH_COMBO_X','DASH_JUMP_COMBO_Z','DASH_JUMP_COMBO_ZZ','DASH_JUMP_COMBO_X']},'RSI_JUMP_COMBO_Z':'ANSI_JUMP_ATTACK_Z','RSI_JUMP_COMBO_X':'ANSI_JUMP_ATTACK_X'}
COMMANDS=dict(groundZ='RSI_COMBO_Z',groundX='RSI_COMBO_X',dashZ='RSI_DASH_COMBO_Z',dashX='RSI_DASH_COMBO_X',jumpZ='RSI_JUMP_COMBO_Z',jumpX='RSI_JUMP_COMBO_X',dashJumpZ='RSI_DASH_JUMP_COMBO_Z',dashJumpX='RSI_DASH_JUMP_COMBO_X')
# Capability keys are independent of selectable status. Upgraded IDs inherit
# their target m_DeleteSkillIDByUpgrade base's incomplete behavior explicitly.
SKILL_LIMITATIONS={
 29000:[('mutation-range','Mutation range scaling has not been bound to the projectile consumer')],
 29202:[('particle-shot-original-lot0','Target2016 selected ordinary Pulse Bullet producer leavesLOT0 and has no autonomous targeting. Legacy Charged Impulsar9400 has no current target2016 skill-tree node')],
 29006:[('pulse-cannon-native-inputs','Target2016 four mandatory/eight maximum loops, MP25 extras, original ordered bone selection and LOT6 search/steering execute. Formed extra loops need the actual local10 DP float; absent input remains unsupported. Web seed and actor collection remain instance policies')],
 29205:[('magnetron-orbit','Startup executes; three orbiters and command-hit followup remain unsupported')],
 29007:[('stasis-accumulation-formula','Target15-second store, no-cost detonation5250% and minimum100MP timeout refund execute; growth to10500%/150% size/300MP remains unbound because the older reference formula conflicts')],
 29011:[('quicksilver-reference-timing','Forward/backward impact, paid return, mutation stun and original main-mesh link execute; callback timing remains a qualified fixed reference')],
 29013:[('drone-activator-lock','Projectile, target marking and original defense reduction execute; automatic installation firing, cooldown reset, half-cost firing and retargeting remain unsupported')],
 29208:[('rushing-drone-homing','Original projectiles execute; general target-seeking consumer remains unsupported')],
 29209:[('fission-lock','Original four/eight split payloads and accepted Drone Activator targeting execute; scoped DIE lock inheritance follows the original declaration through a qualified Web adapter, without a target2016 client trace')],
 29210:[('flick-disc-homing','Original attack set executes; target switching and seek semantics remain unsupported')],
 29015:[('phantom-seeker-homing','Original projectiles execute; homing and retarget callbacks remain unsupported')],
 29016:[('starfall-selection-fidelity','Target2016 native generation/timer and squared-distance consumers execute; actor filters, seeded RNG and posed target attachment retain explicit Web adapters')],
 29017:[('ultimate-fury-mutation','Original 3-drone linked beams and child damage execute; mutation duplicate factory and ambiguous 2-target third-drone assignment remain unsupported')],
 29211:[('countdown-seeking','Base and mutation projectile/explosion declarations execute; target-seeking and shake-off input remain unsupported')],
 29018:[('shooting-chaser-selection-fidelity','Original NO_DAMAGE contact retention, four-unit allocation and damage loop execute; nearest eligible target selection is an explicit Web adapter')],
 29212:[('space-crack-held-cost','Initial rupture executes; held extra-shot cost and repeated emissions remain unsupported')],
 29021:[('stardust-instance-inputs','Target2016 main enter/actual exit/persistent timer execute; original posed carrier nodes are required, deterministic Web random seed is an instance adapter')],
 29214:[('mind-break-scan-fidelity','Target damage, debuff and ESP target count execute; 700 range/forward scan timing are qualified reference; invulnerability damage bypass and secondary target-following visuals remain unverified')],
 29022:[('maximum-strike-orbs','Initial declared hit executes; six orbiters, target marking and release remain unsupported')],
 29023:[('void-field-held-cost','First prepaid second executes; extra held duration and DP/MP drains remain unsupported')],
 29024:[('moonlight-followup','Declared initial hit executes; contact-triggered followup stack behavior remains unsupported')],
 29215:[('force-finger-scan-and-angle','Target explosion and recipient-owned MP absorption execute; angle fields remain unbound and range700/cap2 are qualified reference candidates')],
 29025:[('reverse-stigma-native-position','Target mark, paid return and return damage execute; saved XYZ submission is a Web adapter without target-native displacement measurement')],
}
NO_EFFECTIVE_ATTACK=set()
