/** Execute the production boot boundaries with real HUD consumers and atlas
 * metadata. This checks asynchronous initialization, not browser/GPU rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const programRoot=process.env.GAME_BOOT_PROGRAM_ROOT??root;
const assetRoot=process.env.GAME_BOOT_ASSET_ROOT??path.join(programRoot,'artifacts');
const load=file=>import(pathToFileURL(path.join(programRoot,file)).href);
const [{createAddHud},{createBuffBar},{isAddProfession},{PROFESSIONS,normalizeProfessionId}]=await Promise.all([
  load('apps/web/add-hud.mjs'),load('apps/web/buff-bar.mjs'),
  load('packages/professions/identity.mjs'),load('packages/professions/catalog.mjs'),
]);
const profile=JSON.parse(readFileSync(path.join(programRoot,'packages/combat-core/rf-profile.json'),'utf8'));
const game=readFileSync(path.join(programRoot,'apps/web/game.mjs'),'utf8').replace(/\r\n/g,'\n');
function between(first,last){
  const start=game.indexOf(first),end=game.indexOf(last,start);
  assert.ok(start>=0&&end>start,`Production boot boundary missing: ${first}`);
  return game.slice(start,end);
}
const prepare=between('  const launchPlayers=','  const localAssets=');
const create=between('  const [ui,pvpAssets]=','  keyDialog=createKeyBindingsDialog');
const finish=between('  await initializeOnline(session);','  nameplates=createPlayerNameplates');
const index=JSON.parse(readFileSync(path.join(assetRoot,'ui/add/index.json'),'utf8'));

class Element{
  constructor(){this.children=[];this.dataset={};this.style={};this.classList={toggle(){}};}
  setAttribute(name,value){this[name]=value;}
  removeAttribute(name){delete this[name];}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const ringActor={id:'local',professionId:'RF',buffs:[],sourceTimeRing:{remaining:12}};
function icon(bar,id){
  const node=bar.element.children.flatMap(line=>line.children).find(node=>node.dataset.buffId===id);
  assert.ok(node,`Actual buff DOM row missing: ${id}`);return node;
}
function boot(professions,roster=['RF']){
  const document={createElement:()=>new Element()},host=new Element();host.ownerDocument=document;
  const addHud=createAddHud({document,host:new Element()}),requests=[],loaded=[];
  const online=deferred(),early=deferred(),created=[];
  const state={profile,professionId:'RF',session:{professionId:'RF'},bootSession:{online:{}},
    launchIntent:{match:{players:roster.map(professionId=>({professionId}))}},PROFESSIONS,normalizeProfessionId,isAddProfession,createBuffBar,
    addHud,buffBar:null,professionAssets:new Map(),$:()=>host,
    assetVersions:{files:Object.fromEntries([...professions.map(id=>id.toLowerCase()+'/manifest.json'),'ui/buffs/manifest.json'].map(file=>[file,'fixture']))},
    professionAssetCache:{async loadAll(ids){loaded.push(...ids);return new Map(ids.map(id=>[id,{professionId:id}]));}},
    simulation:{profile,actor:()=>null},
    async data(url){requests.push(url);assert.ok(url.startsWith('/assets/'));return JSON.parse(readFileSync(path.join(assetRoot,url.slice('/assets/'.length)),'utf8'));},
    onlineReady:online.promise,observeEarly(){early.resolve();},
    observeCreated(bar){bar.update(ringActor,{mode:'practice'});created.push(icon(bar,'add-time-ring').buffRow);},
  };
  vm.createContext(state);
  const promise=vm.runInContext(`
    async function initializeOnline(session){await onlineReady;${create}\nobserveCreated(buffBar);}
    (async()=>{${prepare}\nobserveEarly();${finish}\nreturn buffBar;})()
  `,state);
  // Observe rejection immediately, including the former early null dereference.
  promise.catch(()=>{});
  return {state,addHud,requests,loaded,created,promise,early:early.promise,release:online.resolve};
}

test('deployment without Add boots the real buff bar without requesting Add UI',async()=>{
  const f=boot(['RF','LK']);
  await Promise.race([f.early,f.promise]);
  assert.equal(f.state.buffBar,null,'the online UI has not been created yet');
  assert.deepEqual(f.requests,[],'optional Add atlas is not fetched on an older deployment');
  f.release();const bar=await f.promise;
  assert.equal(f.state.buffBar,bar);
  assert.ok(!f.requests.includes('/assets/ui/add/index.json'));
  bar.update({professionId:'RF',buffs:[{templateId:37,behaviors:[],finalizers:[{kind:'time',remaining:5}]}]},{mode:'practice'});
  const burn=icon(bar,'37');assert.equal(burn.buffRow.originalIcon,true);assert.equal(burn.children[0].hidden,false);
  f.addHud.update({professionId:'RF'});assert.equal(f.addHud.element.hidden,true);
});

test('RF entering a real Add roster prepares its Add UI before online creation and installs original buff icons afterwards',async()=>{
  const f=boot(['RF','LK','LP','MM','DE'],['RF','LP','MM','DE']);
  await Promise.race([f.early,f.promise]);
  assert.equal(f.state.professionId,'RF');assert.equal(f.state.buffBar,null);
  assert.deepEqual(f.loaded,['RF','LP','MM','DE'],'only actual roster professions are prepared; an unrelated deployed LK is not resident');
  assert.deepEqual(f.requests,['/assets/ui/add/index.json']);
  const [back,fill]=f.addHud.element.children[0].children;
  assert.equal(back.src,'/assets/ui/add/'+index.pieces.BG_DPSYSTEM_BACK.file);
  assert.equal(fill.src,'/assets/ui/add/'+index.pieces.BG_DPSYSTEM_GAUGE.file);
  f.release();const bar=await f.promise;
  assert.equal(f.created.length,1);assert.equal(f.created[0].originalIcon,false,'online creation alone has no Add atlas');
  assert.equal(f.requests.filter(url=>url==='/assets/ui/add/index.json').length,1);
  bar.update(ringActor,{mode:'practice'});
  const ring=icon(bar,'add-time-ring');
  assert.equal(ring.buffRow.templateId,436);assert.equal(ring.buffRow.originalIcon,true);
  assert.equal(ring.children[0].src,'/assets/ui/add/'+index.pieces.BUFF_ICON_CREST_OF_TIME.file);
  assert.equal(ring.children[0].hidden,false);assert.equal(ring.children[1].hidden,true);
  bar.update({id:'local',professionId:'RF',buffs:[],sourceTimeSickness:8},{mode:'practice'});
  const sickness=icon(bar,'add-time-sickness');
  assert.equal(sickness.buffRow.templateId,673);assert.equal(sickness.buffRow.originalIcon,true);
  assert.equal(sickness.children[0].src,'/assets/ui/add/'+index.pieces.DEBUFF_ICON_CREST_OF_TIME.file);
  assert.equal(sickness.children[0].hidden,false);assert.equal(sickness.buffRow.isDebuff,true);
  f.addHud.update(ringActor);assert.equal(f.addHud.element.hidden,true,'receiving an Add buff does not display Add resources on RF');
});

test('solo RF practice never loads optional Add UI merely because Add professions are deployed',async()=>{
 const f=boot(['RF','LK','LP','MM','DE']);await Promise.race([f.early,f.promise]);
 assert.deepEqual(f.loaded,['RF']);assert.deepEqual(f.requests,[]);f.release();await f.promise;
 assert.equal(f.requests.includes('/assets/ui/add/index.json'),false);
});
