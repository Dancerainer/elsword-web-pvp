/** Rebuild small source contract from separately acquired, ignored source inputs.
 * Static target declarations come from kl82_static.read_declarations; no Lua is executed.
 * node tools/combat/build_pvp_source.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const cache=path.join(root,'.cache/pvp-source');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const declarations=name=>{
  const result=json(path.join(cache,'target2016',`${name}.json`));
  if(hash(fs.readFileSync(result.source.path))!==result.source.sha256)throw new Error(`Changed target source: ${name}`);
  return result;
};
const fighter=declarations('RAVEN_FIGHTER'),factor=declarations('BattleFieldBuffFactor');
const template=declarations('BattleFieldBuffTemplet'),linemap=declarations('Sander_Garpai_Rock_Pvpmap_Linemap');
const profile=json(path.join(root,'packages/combat-core/rf-profile.json'));
const enumContract=json(path.join(root,'contracts/rf-buff-bar-source-v1.json'));
const teamStarts=linemap.nativeCalls.flatMap((c,index)=>{
  if(c.target!=='g_pLineMap.SetTeamStartPos')return [];
  const ref=c.args[2]?.$symbol?.match(/^call@(\d+)\.return0$/),vector=ref&&linemap.nativeCalls[Number(ref[1])];
  if(vector?.target!=='D3DXVECTOR3'||vector.args.length!==3||vector.args.some(v=>!Number.isFinite(v)))throw new Error('Unresolved original team start vector');
  return [{kind:'SetTeamStartPos',index:linemap.nativeCalls.slice(0,index).filter(c=>c.target==='g_pLineMap.SetTeamStartPos').length,teamFlag:c.args[1],position:vector.args,facingRight:c.args[3],lineId:c.args[4]}];
});
if(teamStarts.length!==8)throw new Error('Original Garpai team start count changed');
const poseList=name=>{
  const list=fighter.globals.INIT_COMMON_RANDOM_STATE.RAVEN_RECKLESS_FIST[`${name.toUpperCase()}_STATE_LIST`];
  const result=[];
  for(let i=1;i<=Object.keys(list).length;i+=2){
    const state=list[i],animationName=fighter.globals[state].ANIM_NAME,clip=profile.clips[animationName];
    if(!clip?.decodedKeysSha256)throw new Error(`Missing independently indexed motion: ${state}`);
    result.push({state,weight:list[i+1],animationName,duration:clip.durationSeconds,decodedKeysSha256:clip.decodedKeysSha256});
  }
  if(result.reduce((n,p)=>n+p.weight,0)!==100)throw new Error('Pose probabilities do not total 100');
  return result;
};
const levels=[1,2,3].map(level=>{
  const suffix=`PVP_REVENGE_MODE_LEVEL_${level}`;
  const record=factor.nativeCalls.map(c=>c.args[1]).find(r=>r?.BUFF_FACTOR_ID?.$symbol?.endsWith(suffix));
  const tpl=template.nativeCalls.map(c=>c.args[1]).find(r=>r?.BUFF_TEMPLET_ID?.$symbol?.endsWith(suffix));
  const behavior=record.BUFF_FACTOR.BEHAVIOR;
  const multiplier=name=>{
    const values=Object.values(behavior[name].PERCENT);
    if(new Set(values).size!==1)throw new Error(`Level-dependent unsupported value ${name}`);
    return values[0];
  };
  const attackMultiplier=multiplier('BBT_CHANGE_PHYSIC_ATTACK');
  if(attackMultiplier!==multiplier('BBT_CHANGE_MAGIC_ATTACK'))throw new Error('Physical/magic revenge mismatch');
  const symbol=`BTI_BUFF_${suffix}`,templateId=enumContract.pvpRevengeIds[symbol];
  if(!Number.isInteger(templateId))throw new Error(`Unresolved original template enum: ${symbol}`);
  return {level,templateId,symbol,attackMultiplier,
    receivedDamageMultiplier:multiplier('BBT_CHANGE_FINAL_DEFENCE_MULTIPLIER'),
    receivedMpMultiplier:multiplier('BBT_CHARGE_MP_HITTED'),accumulationLimit:tpl.ACCUMULATION_LIMIT};
});
const v5Files=['X2Lib/X2PVPGameTeamDeath.cpp','X2Lib/X2PVPGame.cpp','X2Lib/X2PVPGameTeam.cpp','X2Lib/X2GUUser.cpp','X2Lib/X2Define.h','X2Lib/X2PVPRoom.cpp','X2Lib/X2StatePVPGame.cpp','X2Lib/X2GameUnit.cpp','X2Lib/X2Game.cpp','X2Lib/X2GURaven.cpp','KncWX2Server/CenterServer/PvPRoom.cpp','KncWX2Server/CenterServer/PvPRoom.h','KncWX2Server/CenterServer/ResultProcess.cpp','KncWX2Server/CenterServer/RoomUserManager.cpp','KncWX2Server/ServerResource/PvpMatchData.lua','KncWX2Server/Common/X2Data/XSLRoom.h'];
const localFiles=['Elsword/ServerResource/PvpMatchData.lua','Elsword/ServerResource/PvPDropTable.lua'];
const sourceFile=(file,base)=>{const bytes=fs.readFileSync(path.join(base,file));return {path:file,sha256:hash(bytes),bytes:bytes.length};};
const v5Source=file=>{
  const result=sourceFile(file,cache),repositoryPath='JP_TW_EU_CN_US/Trunk/'+file;
  const entry=execFileSync('git',['-C',path.join(root,'.cache/pvp-reference'),'ls-tree','a8438f3ed18dd6f0944793de6c0d8bb9334e9633','--',repositoryPath],{encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'}});
  const gitBlob=entry.split(/\s+/)[2],bytes=fs.readFileSync(path.join(cache,file));
  const actualBlob=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(!gitBlob||actualBlob!==gitBlob)throw new Error(`Source bytes do not match pinned commit tree: ${file}`);
  return {...result,repositoryPath,gitBlob};
};
const contract={
  schemaVersion:1,contractId:'rf-pvp-rules-source-v1',targetClientMeasured:false,
  targetVersion:'NA-2016-V6.0420.5-resources',
  scope:'Resource declarations + fixed V5 source consumers + independently frozen server reference snapshot. No 1:1 runtime claim.',
  targetSources:[fighter,factor,template,linemap].map(r=>({...r.source,evidence:'2016 static KL declaration; Lua not executed'})),
  enumContract:{path:'contracts/rf-buff-bar-source-v1.json',enumSource:enumContract.sources['Enum.lua'],resolvedRevengeIds:enumContract.pvpRevengeIds,note:'Revenge template IDs resolved from target Enum.lua by independently generated buff contract'},
  v5:{commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',remote:'reference-v5',files:v5Files.map(v5Source),caution:'Pinned source reconstruction reference; not the target2016 executable runtime.'},
  serverReference:{snapshot:'asset_sources/upstream/server',dirtySnapshot:true,files:localFiles.map(f=>sourceFile(f,'asset_sources/upstream/server')),caution:'Local edited deployment; Git HEAD alone does not identify deployed resource contents.'},
  map:{id:'sander-garpai-rock-pvp',teamStarts,evidence:'Target2016 SetTeamStartPos declaration plus referenced D3DXVECTOR3 literal. Same blue/red layout independently compared in reports/pvp-scene.json.'},
  match:{kind:'TEAM_DEATH_2_ON_2',selected:{scoreLimit:4,duration:420,evidence:'User requires first4; fixed V5 PvpMatchData.lua TEAM_DEATH_2_ON_2 agrees'},v5:{scoreLimit:4,duration:420},serverReference:{scoreLimit:8,duration:420},ordinaryTeam2v2:{v5ScoreLimit:2,duration:300},unusedRoomChoices:[200,500,800,1100]},
  poses:{start:poseList('start'),win:poseList('win'),lose:poseList('lose'),selection:'V5 weighted state list, rand%100 consumer; web seeded xorshift32 stream',introDuration:4.5,intro:'Fixed V5 X2GUUser StartEventProcess waits EVENT_TIME4.5 then WAIT; StartEnd plays Fight.ogg and GameFight. Web concurrent presentation holds authored clip end until4.5. Derived RF camera/network synchronization and target native runtime not measured.'},
  respawn:{formula:'clamp(15+3*(ownScore-enemyScore),0,30)',evidence:'Server reference PvPDropTable.lua CALCULATE_REBIRTH_TIME; V5 PvPRoom calls CalculateRebirthTime. Ring adjustment unsupported.',position:'User customization: random connected live teammate; fallback to own authored team start when none is alive. Fixed V5 client instead uses random AddStartPos.',lock:{state:'RSI_START_INTRUDE',animationName:'RespawnLanding',duration:profile.clips.RespawnLanding.durationSeconds,decodedKeysSha256:profile.clips.RespawnLanding.decodedKeysSha256},invincibleSeconds:5,whiteFlashInterval:0.05,invincibleEvidence:'V5 X2Game RebirthUserUnit SetForceInvincible/SetShowInvincible(5); GUUser CommonFrameMove_Invincible toggles .05',deathReady:'V5 server waits for DIE_COMPLETE under SERV_PVP_REBIRTH_ADD_CONDITION. Web host exposes actor.deathComplete and must complete death before revival.',mp:'V5 PVP_SEASON2 ReInit: score lead >1 clears MP, lead1 halves MP, otherwise retains MP.'},
  revenge:{levels,iconKey:'Buff_Icon_PVP_Revenge',iconName:'DLG_UI_Common_Texture_Buff.tga',selection:'V5 server applies losing team level clamp(score deficit,0,3), replacing prior level; target 2016 factors determine multipliers.'},
  outnumbered:{hitMpBonusPerMissingPlayer:3,receivedMpBonusPerMissingPlayer:2,receivedMpBase:3,evidence:'V5 GUUser DamageReact: (3+2*connected roster deficit)*increaseMpRate then charge-MP-hitted buff. X2GameUnit UpNowMpPerHitOthers: (HIT_ADD_MP+3*deficit)*fRel.',attackDamageBonus:false,indicator:'Synthetic web HUD buff; no native template ID or icon asserted.',caution:'Base3 is a V5 consumer literal, target2016 native runtime not measured; role refers to attack-hit MP and received-hit MP, not attack damage.'},
  victory:{slowScale:0.2,slowDuration:1.5,finishForceInvincible:9999,evidence:'V5 X2PVPGameTeamDeath DetermineLastKill SlowFrame(.2,1.5) and all units SetForceInvincible(9999); web triggers on resolved victory, preserving real rule elapsed separately from combat scale.',priority:['greater team score','greater summed HP percentage; dead deathmatch player counts100%','lower integer average level','first team (red) on complete tie'],tieEvidence:'V5 ResultProcess DecidePVPWinTeam, std::map team iteration; XSLRoom.h red0/blue1. Target2016 runtime and simultaneous packet ordering not measured.',simultaneous:'Host adaptation: all hp0 from one combat step form one death batch before victory; then fixed V5 result priority.',disconnect:'User requirement overrides source early-draw special case: no connected player on one team gives other team victory.'},
  kda:{kill:'Final damaging attacker of enemy death',assist:'Host adaptation: greatest accumulated damage contributor in current life, counted only when different from final attacker',evidence:'V5 death packet separates killer and maxDamageKiller; result log labels max-damage count assist. No verified TTL window, so no invented original assist timeout.',zeroDeaths:'KDA=null; display may represent undefeated ratio as infinity; persist raw kills/deaths/assists.'},
  unsupported:['Target2016 original executable PvP/network trace','Native all-camera intro sequence','Original server max-damage attribution accumulation window','Original simultaneous packet resolution timing','Revival ring item','Additional characters and their pose declarations'],
};
// Referenced enum contract is independently generated; prevent an absent or changed declaration from being ignored.
contract.respawn.resourcesContract='contracts/rf-pvp-resources-source-v3.json';
if(!enumContract.targetSources&&!enumContract.sources)throw new Error('Malformed buff source contract');
const destination=path.join(root,'contracts/rf-pvp-rules-source-v1.json');
const content=JSON.stringify(contract,null,2)+'\n';
if(process.argv.includes('--check')){
  if(fs.readFileSync(destination,'utf8')!==content)throw new Error('PvP source contract drift; inspect sources before rebuilding');
  console.log('PvP source contract and input hashes verified');
}else{fs.writeFileSync(destination,content);console.log('Wrote contracts/rf-pvp-rules-source-v1.json');}
