/** Exercise the page's real synchronous publication and picker transactions.
 * Rendering/resources are stand-ins; this verifies lifecycle, not GPU output. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {scheduleRenderPreparation} from '../../apps/web/render-preparation.mjs';
import {createPickerDialogController} from '../../apps/web/skill-picker-dialog.mjs';
import {choosePickerBranch,applyPickerBranches,quickEquipTarget} from '../../apps/web/skill-picker-state.mjs';
import {editPickerLoadout} from '../../apps/web/skill-picker.mjs';

const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const eventRecorder=source.match(/^function recordEvent\(event\).*$/m)?.[0];
assert.ok(eventRecorder,'execute the production bounded diagnostic recorder');
const modeGuard=source.match(/^const isPvpMode=.*;$/m)?.[0];
assert.ok(modeGuard,'execute production PvP mode guard');
function section(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from,`page function boundary: ${start}`);return source.slice(from,to);}
const publication=section('function publishProfession(','async function startFreePractice(');
const handlers=section('async function selectBranch(',"$('#skills').onclick=");
// Keep the preparation fixture bounded to its own function; adjacent costume
// resource helpers have their own production asset/lifecycle tests.
const preparingViews=source.match(/async function prepareProfessionPracticeViews\([\s\S]*?\r?\n}/)?.[0];
assert.ok(preparingViews,'complete production practice-view preparation function');
const spec={RF:{skillId:24027,branch:'memo-21'},LK:{skillId:21219,branch:'memo-28'}};
const config=(id,branch='none')=>({loadout:[{skillId:spec[id].skillId,branchId:branch},...Array(7).fill(null)],branchChoices:{[spec[id].skillId]:branch}});
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function view(name){return {name,meshes:[],enabled:false,disposed:0,root:{setEnabled(value){this.owner.enabled=value;}},dispose(){this.disposed++;}};}
function boundView(name){const result=view(name);result.root.owner=result;return result;}
function fixture(){
  const effects=[],records=[],calls=[],elements=new Map(['.skill-picker','.skill-catalog','.picker-slots','.picker-message'].map(key=>[key,{hidden:true,inert:false,textContent:'',replaceChildren(){}}]));
  const professions={RF:{id:'RF',name:'Reckless Fist'},LK:{id:'LK',name:'Lord Knight'}};
  const definitions=id=>[{id:spec[id].skillId,branches:[{id:spec[id].branch,selectable:true}]}];
  const presets=Object.fromEntries(['RF','LK'].map(id=>[id,{skillKeys:['A','S','D','C','Q','W','E','R'],cameraAdapter:{verticalFovRadians:id==='RF'?1:2}}]));
  const profiles={RF:{id:'RF'},LK:{id:'LK'}},preferences=new Map(),assets=new Map(),groups=new Map();
  for(const id of ['RF','LK']){
    preferences.set(id,{...config(id),client:{async save(value){calls.push({id,value:structuredClone(value)});return structuredClone(value);}}});
    assets.set(id,{manifest:{professionId:id},catalog:{skills:definitions(id)},characterPose:{id},corePose:id==='RF'?{id:'RF-core'}:null});
    groups.set(id,new Map(['player','target'].map(actorId=>{const item=boundView(id+'-'+actorId);
      if(id==='RF')item.core=boundView(id+'-'+actorId+'-core');return [actorId,item];})));
  }
  let context;
  const createPracticeSimulation=(id,loadout)=>{
    const actors=['player','target'].map(actorId=>({id:actorId,professionId:id,loadout:structuredClone(loadout)}));
    return {state:{actors},map:context.mapManifest,snapshot:()=>({actors:structuredClone(actors)}),
      configureLoadout(next){actors[0].loadout=structuredClone(next);return structuredClone(next);}};
  };
  const clear=()=>{};
  context={structuredClone,performance,document:{},PROFESSIONS:professions,getProfessionProfile:id=>profiles[id],getProfessionPreset:id=>presets[id],
    createProfessionSwitch,professionId:'RF',professionEpoch:0,profession:professions.RF,profile:profiles.RF,preset:presets.RF,
    professionAssets:assets,professionPreferences:preferences,professionPracticeViews:groups,professionPrewarmReady:true,
    engine:{stopRenderLoop:()=>assert.fail('profession publication must retain its render loop')},scene:{id:'original-scene'},
    mapManifest:{id:'original-map'},online:{close:()=>assert.fail('profession publication must retain its transport')},
    fetch:()=>assert.fail('resident profession publication cannot fetch'),location:{reload:()=>assert.fail('profession publication cannot reload')},
    active:true,mode:'lobby',onlineTransportError:null,configurationLocked:false,slotPreparation:false,keyDialog:{isOpen:false},guildPanel:{isOpen:()=>false},interfaceAudio:null,
    createPracticeSimulation,practiceActors:()=>[{id:'one'},{id:'two'}],closeDiagnostics:clear,stopSounds:clear,inputBuffer:{clear},keyTranslator:{releaseAll:clear},secondPressed:[],
    effectsView:{clear,setLocalProfession:id=>effects.push(id),async prewarm(){},async prepareProfession(){}},worldColorView:{clear},damageNumbers:{clear},
    weaponTrails:{clear,setLocalActor:clear},wayOfSwordParticles:{clear},nameplates:{clear},views:new Map(groups.get('RF')),
    loadout:structuredClone(preferences.get('RF').loadout),branchChoices:structuredClone(preferences.get('RF').branchChoices),
    rfManifest:assets.get('RF').manifest,skillCatalog:assets.get('RF').catalog,skillPreferences:preferences.get('RF').client,
    pickerDefinitionCache:null,pickerRenderedSkillId:null,selectedSlot:0,selectedSkillId:null,pickerTooltip:{hide:clear},cancelPickerDrag:clear,
    currentSession:{professionId:'RF'},localPlayerId:null,remotePackets:new Map(),remoteDevices:new Map(),remoteHeld:new Map(),
    prediction:{clear},ownershipSync:{clear},ownedPresentation:{clear},createPoseAudit:pose=>({pose}),characterAudit:null,coreAudit:null,
    motionInspector:{setView(value){this.view=value;}},mapProjection:(_map,fov)=>({minZ:1,maxZ:200,fov}),camera:{},cameraTracking:null,
    updateProfessionPresentation:clear,rebuildSlots:clear,rebuildPicker:clear,beginRecording:reason=>records.push(reason),resetDisplayClock:clear,
    actorsNow:()=>context.simulation.state.actors,renderActor:clear,updateCamera:clear,updateHud:clear,drain:clear,updateModeControls:clear,lastProfessionSwitchMs:null,
    $:selector=>{assert.ok(elements.has(selector),selector);return elements.get(selector);},lobby:{error:message=>assert.fail(message)},eventLog:[],
    choosePickerBranch,applyPickerBranches,quickEquipTarget,editPickerLoadout,pickerDefinitions:()=>definitions(context.professionId),
    supportFor:()=>({supported:true})};
  context.simulation=context.practiceSimulation=createPracticeSimulation('RF',context.loadout);
  context.baselineSnapshot=context.simulation.snapshot();context.practiceSnapshot=context.simulation.snapshot();
  context.hitLighting={clear(){assert.fail('profession switch must retain prepared hit lights');},reset(){}};context.poseAudio={clear(){}};
  vm.createContext(context);vm.runInContext(eventRecorder+'\n'+modeGuard+'\n'+publication+handlers+'\nthis.publish=publishProfession;this.switcher=professionSwitch;this.selectBranch=selectBranch;this.pickerEdit=pickerEdit;this.queue=queueWithConfirmedConfiguration;',context);
  context.pickerDialog=createPickerDialogController({keyboardTarget:new EventTarget(),closeButton:new EventTarget(),picker:elements.get('.skill-picker'),
    isPreparing:()=>context.slotPreparation,onClose(){elements.get('.skill-picker').hidden=true;context.switcher.flush();}});
  return {context,elements,effects,records,calls,preferences,assets,groups};
}

test('six actual page publications retain engine scene map transport and both sets of resident views',async()=>{
  const f=fixture(),c=f.context,before={engine:c.engine,scene:c.scene,map:c.mapManifest,online:c.online},originalGroups=new Map([...f.groups].map(([id,group])=>[id,[...group.values()]]));
  const temporary=boundView('obsolete-match-player');c.views.set('obsolete-match-player',temporary);
  for(const item of f.groups.get('RF').values())item.core.root.setEnabled(true);
  for(const id of ['LK','RF','LK','RF','LK','RF']){
    await c.switcher.select(id,async()=>({professionId:id}));
    assert.equal(c.professionId,id);assert.equal(c.currentSession.professionId,id);assert.equal(c.profile.id,id);
    assert.equal(c.skillPreferences,f.preferences.get(id).client);assert.equal(c.skillCatalog,f.assets.get(id).catalog);
    assert.deepEqual(plain(c.loadout),config(id).loadout);assert.deepEqual(plain(c.branchChoices),config(id).branchChoices);
    assert.equal(c.motionInspector.view,f.groups.get(id).get('player'));assert.equal(c.camera.fov,id==='RF'?1:2);
    for(const [other,group]of f.groups){assert.deepEqual([...group.values()],originalGroups.get(other));
      for(const [actorId,item]of group){assert.equal(item.disposed,0);assert.equal(item.enabled,other===id);if(other===id)assert.equal(c.views.get(actorId),item);
        if(item.core){assert.equal(item.core.disposed,0);assert.equal(item.core.enabled,false,'an independently rooted RF core cannot remain visible across profession publication');}}}
    assert.equal(c.engine,before.engine);assert.equal(c.scene,before.scene);assert.equal(c.mapManifest,before.map);assert.equal(c.online,before.online);
    if(id==='RF')for(const item of f.groups.get('RF').values())item.core.root.setEnabled(true);
  }
  assert.equal(temporary.disposed,1);assert.deepEqual(f.effects,['LK','RF','LK','RF','LK','RF']);
  assert.equal(c.switcher.proof().switches,6);assert.equal(f.calls.length,0,'publication must not rewrite either profession preference');
});

test('missing prepared preferences reject before replacing the current profession or disposing a view',()=>{
  const f=fixture(),c=f.context,oldSimulation=c.simulation,oldViews=[...c.views.values()];f.preferences.delete('LK');
  assert.throws(()=>c.publish('LK'),/Class assets are unavailable/);assert.equal(c.professionId,'RF');assert.equal(c.simulation,oldSimulation);
  assert.deepEqual([...c.views.values()],oldViews);for(const item of oldViews)assert.equal(item.disposed,0);
});

for(const fails of [false,true])test(`GM fallback deferred behind closing picker cannot inherit LK branches when its save ${fails?'fails':'succeeds'}`,async()=>{
  const f=fixture(),c=f.context;c.publish('LK');const done=deferred(),arrived=deferred();
  f.preferences.get('LK').client.save=async value=>{arrived.resolve();await done.promise;return structuredClone(value);};
  f.elements.get('.skill-picker').hidden=false;
  const saving=c.selectBranch(spec.LK.skillId,spec.LK.branch);await arrived.promise;
  assert.equal(c.pickerDialog.close(),false);c.switcher.observe('RF');assert.equal(c.professionId,'LK');assert.equal(c.slotPreparation,true);
    if(fails)done.reject(Error('fixture save denied'));else done.resolve();await saving;await c.switcher.settled();
  assert.equal(c.professionId,'RF');assert.equal(c.slotPreparation,false);assert.equal(f.elements.get('.skill-picker').hidden,true);
  assert.deepEqual(plain(c.branchChoices),config('RF').branchChoices);assert.deepEqual(plain(c.loadout),config('RF').loadout);
  assert.deepEqual(f.preferences.get('LK').branchChoices,config('LK',fails?'none':spec.LK.branch).branchChoices);
  assert.equal(c.selectedSlot,0);assert.equal(c.selectedSkillId,null);
});

test('a failed picker edit cannot restore old LK selection indices after closing publishes the forced RF fallback',async()=>{
  const f=fixture(),c=f.context;c.publish('LK');c.selectedSlot=3;c.selectedSkillId=spec.LK.skillId;
  const done=deferred(),arrived=deferred();f.preferences.get('LK').client.save=async()=>{arrived.resolve();await done.promise;};
  f.elements.get('.skill-picker').hidden=false;const saving=c.pickerEdit({type:'remove',target:0});await arrived.promise;
  c.pickerDialog.close();c.switcher.observe('RF');done.reject(Error('fixture save denied'));await saving;await c.switcher.settled();
  assert.equal(c.professionId,'RF');assert.equal(c.selectedSlot,0);assert.equal(c.selectedSkillId,null);
  assert.deepEqual(plain(c.loadout),config('RF').loadout);
});

test('GM fallback during queue preference confirmation publishes only after saving and cancels the obsolete join',async()=>{
  const f=fixture(),c=f.context;c.publish('LK');const done=deferred(),arrived=deferred();let joins=0;
  c.online.join=async()=>{joins++;};c.skillPreferences.save=async value=>{arrived.resolve();await done.promise;return structuredClone(value);};
  const queued=c.queue('1v1'),rejected=assert.rejects(queued,/Available classes have changed/);await arrived.promise;
  c.switcher.observe('RF');assert.equal(c.professionId,'LK');assert.equal(c.slotPreparation,true);assert.equal(joins,0);
  done.resolve();await rejected;await c.switcher.settled();assert.equal(c.professionId,'RF');assert.equal(c.slotPreparation,false);assert.equal(joins,0);
  assert.deepEqual(plain(c.branchChoices),config('RF').branchChoices);
});

for(const stop of ['lock','transport','logout'])test(`${stop} during queue preference confirmation prevents its late continuation from joining`,async()=>{
  const f=fixture(),c=f.context,done=deferred(),arrived=deferred();let joins=0;
  c.online.join=async()=>{joins++;};c.skillPreferences.save=async value=>{arrived.resolve();await done.promise;return structuredClone(value);};
  const queued=c.queue('1v1'),rejected=assert.rejects(queued);await arrived.promise;
  if(stop==='lock')c.configurationLocked=true;
  if(stop==='transport')c.onlineTransportError=Error('fixture transport stopped');
  if(stop==='logout'){c.active=false;c.switcher.dispose();}
  done.resolve();await rejected;assert.equal(c.slotPreparation,false);assert.equal(joins,0);
});

test('failed queue confirmation sends no join, releases the save lock and permits a successful retry',async()=>{
  const f=fixture(),c=f.context;let joins=0;c.online.join=async mode=>{joins++;return {mode};};
  c.skillPreferences.save=async()=>{throw Error('fixture save denied');};
  await assert.rejects(c.queue('1v1'),/fixture save denied/);assert.equal(c.slotPreparation,false);assert.equal(joins,0);
  c.skillPreferences.save=async value=>structuredClone(value);assert.deepEqual(await c.queue('1v1'),{mode:'1v1'});assert.equal(joins,1);
});

test('preparing both practice professions uses unique clone names while preserving each simulation actor key',async()=>{
  const names=[],compiled=[],groups=new Map(),assets=new Map([['RF',{bodyContainer:{},coreContainer:{}}],['LK',{bodyContainer:{}}]]);
  const context={scheduleRenderPreparation,professionAssets:assets,professionPracticeViews:groups,mapManifest:{},practiceActors:()=>[{id:'rf'},{id:'target'}],
    costumePreferences:{raven:'default',elsword:'default'},selectedCostume:()=> 'default',
    prepareActorCostume:async()=>null,publishCostume(){},
    createView:async(_container,name)=>{names.push(name);const result=boundView(name);
      result.meshes=[{name,getTotalVertices:()=>3,material:{async forceCompilationAsync(mesh){compiled.push(mesh.name);}}}];return result;},styleCharacter:()=>{},styleNasodCore:value=>value};
  vm.createContext(context);vm.runInContext(preparingViews+'\nthis.prepare=prepareProfessionPracticeViews;',context);await context.prepare();
  assert.equal(names.length,6);assert.equal(new Set(names).size,6);assert.deepEqual(compiled,names,'every resident body and core shader is prepared before returning');
  for(const id of ['RF','LK']){assert.deepEqual([...groups.get(id).keys()],['rf','target']);for(const item of groups.get(id).values())assert.equal(item.enabled,false);}
});
