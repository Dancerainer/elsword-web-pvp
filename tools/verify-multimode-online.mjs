/** Real HTTP/SSE -> frozen native assets -> local owner -> room result.
 * Uses private disposable accounts. It never writes deployed player history.
 */
import {createDevServer} from '../apps/server/dev-server.mjs';
import {createBattleDriverFactory} from '../apps/server/battle-driver.mjs';
import {loadServerCombatAssets} from '../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../packages/combat-core/index.mjs';
import {encodeOwnedState} from '../packages/online/owned-state.mjs';
import {MODE_CONFIG,ONLINE_MODES} from '../packages/online/modes.mjs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url)),assetRoot=process.env.RF_ASSET_ROOT??path.join(root,'artifacts');
await mkdir(path.join(root,'runtime'),{recursive:true});
const assets=await loadServerCombatAssets({root,assetRoot}),driverFactory=await createBattleDriverFactory({root,assetRoot});
assert.ok(driverFactory,'Real frozen battle resources are required');
const waitFor=async(fn,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,20));}throw Error('Multimode verification timed out');};
const report={schemaVersion:1,evidenceClass:'actual-http-native-web-simulation',originalClientMeasured:false,eventTransport:'sse',modes:{}};

async function verifyMode(mode){
  const spec=MODE_CONFIG[mode],accountRoot=await mkdtemp(path.join(root,'runtime/multimode-verification-'));
  const credentials=Array.from({length:spec.playerCount},(_,i)=>({username:i===0?'fixture_admin':'qa-player-'+i,role:i===0?'gm':'player',password:randomBytes(16).toString('hex')}));
  let stamp=Date.now();const ctx=await createDevServer({root,assetRoot,accountRoot,credentials:credentials[0],additionalCredentials:credentials.slice(1),driverFactory,now:()=>stamp});
  await new Promise(r=>ctx.server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+ctx.server.address().port,cookies=new Map(),events=new Map(),controllers=[];
  async function api(user,url,method='GET',body){
    const response=await fetch(origin+url,{method,headers:{Origin:origin,...(cookies.has(user)?{Cookie:cookies.get(user)}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const value=await response.json();if(response.headers.get('set-cookie'))cookies.set(user,response.headers.get('set-cookie').split(';')[0]);return {status:response.status,value};
  }
  async function stream(user){
    const controller=new AbortController();controllers.push(controller);const list=[];events.set(user,list);
    const response=await fetch(origin+'/api/online/events',{headers:{Cookie:cookies.get(user),'Accept-Encoding':'gzip'},signal:controller.signal});assert.equal(response.status,200);
    const reader=response.body.getReader(),decoder=new TextDecoder();
    void(async()=>{let buffer='';try{while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});let cut;
      while((cut=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const type=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1];if(type&&data){list.push({type,data:JSON.parse(data)});if(list.length>300)list.shift();}}}}
      catch(error){if(!controller.signal.aborted)throw error;}})().catch(error=>{console.error(error);process.exitCode=1;});
  }
  try{
    for(const credential of credentials){const response=await api(credential.username,'/api/login','POST',credential);assert.equal(response.status,200);assert.equal(response.value.role,credential.role);await stream(credential.username);}
    const gm='fixture_admin',ordinary=credentials[1].username;
    assert.equal((await api(ordinary,'/api/online/modes','POST',{mode,enabled:false})).status,403);
    assert.equal((await api(ordinary,'/api/online/queue','POST',{mode})).status,200);
    assert.equal((await api(gm,'/api/online/modes','POST',{mode,enabled:false})).status,200);
    const kicked=(await api(ordinary,'/api/online/status')).value;
    assert.equal(kicked.queued,false);assert.equal(kicked.locked,false);assert.equal(kicked.queueNotice.reason,'mode-disabled');
    assert.equal((await api(ordinary,'/api/online/queue','POST',{mode})).status,409);
    assert.equal((await api(gm,'/api/online/modes','POST',{mode,enabled:true})).status,200);
    for(const credential of credentials)assert.equal((await api(credential.username,'/api/online/queue','POST',{mode})).status,200);
    const queue=(await api(gm,'/api/online/status')).value.queue;
    assert.equal(queue.size,spec.playerCount);assert.equal(queue.mode,mode);assert.equal(Math.round(queue.remainingSeconds),mode==='1v1'?5:11);
    stamp+=mode==='1v1'?5100:11100;await ctx.online.tick();
    const match=await waitFor(()=>events.get(gm).find(e=>e.type==='match')?.data);
    assert.equal(match.mode,mode);assert.equal(match.players.length,spec.playerCount);for(const team of [0,1])assert.equal(match.players.filter(p=>p.team===team).length,spec.teamSize);
    for(const credential of credentials)assert.equal((await api(credential.username,'/api/online/ready','POST',{matchId:match.id})).status,200);
    const state=await waitFor(()=>events.get(gm).find(e=>e.type==='state'&&e.data.pvp.phase==='fight')?.data);
    assert.equal(state.pvp.mode,mode);assert.equal(state.pvp.scoreLimit,spec.scoreLimit);assert.equal(state.snapshot.actors.length,spec.playerCount);
    for(const actor of state.snapshot.actors){assert.equal(actor.mp,0);assert.equal(actor.awakening.gauge,50);}
    const selectedAssets=assets.forScene(match.sceneId);
    const mover=match.players[0].id,{native,samplers}=await selectedAssets.createRuntime();
    const sim=createSimulation({profile:assets.profile,map:selectedAssets.map,preset:{...assets.preset,onlineMatch:true},networkOwnerId:mover,seed:match.seed,
      actors:state.snapshot.actors.map(actor=>({id:actor.id,team:actor.team,position:[actor.x,actor.y,actor.z],lineId:actor.lineId,facing:actor.facing,loadout:actor.loadout})),...samplers,
      nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:state.snapshot.versions});
    sim.restore(state.snapshot);const initial=sim.actor(mover).x;
    for(let i=0;i<12;i++)sim.step(1/60,{[mover]:{held:['RIGHT'],pressed:i===0?['RIGHT']:[],released:[]}},{snapshot:false});
    assert.notEqual(sim.actor(mover).x,initial);
    const owner=encodeOwnedState(sim,mover,{epoch:state.ownership.actors[mover].epoch,frameSeq:12,events:sim.drainEvents()});
    assert.equal((await api(mover,'/api/online/input','POST',{matchId:match.id,sequence:0,frames:[{held:['RIGHT'],frameSeq:12}],owner})).status,200);
    await waitFor(()=>ctx.online.matchSnapshot(mover).snapshot.actors.find(actor=>actor.id===mover).x===sim.actor(mover).x);
    const leaving=match.players.filter(p=>p.team===0),remaining=match.players.find(p=>p.team===1);
    for(const player of leaving)assert.equal((await api(player.id,'/api/logout','POST')).status,200);
    const result=await waitFor(()=>events.get(remaining.id).find(e=>e.type==='result')?.data.result);
    assert.equal(result.winnerTeam,1);assert.equal(result.mode,mode);assert.equal(result.players.length,spec.playerCount);
    const history=(await api(remaining.id,'/api/history')).value;assert.equal(history.history?.wins??history.wins,1);
    report.modes[mode]={players:spec.playerCount,scoreLimit:spec.scoreLimit,duration:state.pvp.duration,queueWaitSeconds:Math.round(queue.remainingSeconds),gmOnlyControl:true,disabledQueueKicked:true,
      sceneId:match.sceneId,loadingTimeoutSeconds:match.loadingTimeoutSeconds,
      frozenNativeRuntime:true,localMovementAccepted:true,serverCombatSteps:state.stats?.combatSteps??0,resultRecorded:true,spawnPositions:state.snapshot.actors.map(a=>({team:a.team,x:a.x,y:a.y,z:a.z}))};
    console.log(JSON.stringify({verified:mode,...report.modes[mode]}));
  }finally{for(const controller of controllers)controller.abort();ctx.online.close();ctx.server.closeAllConnections();await new Promise(r=>ctx.server.close(r));}
}
for(const mode of ONLINE_MODES)await verifyMode(mode);
await writeFile(path.join(root,'runtime/multimode-online-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({allModesPassed:true,modes:Object.keys(report.modes)}));
