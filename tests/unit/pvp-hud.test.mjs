import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPvpHud,pvpCountdown,pvpRoster,pvpMemberGauges,pvpMemberProfession} from '../../apps/web/pvp-hud.mjs';
import {createPlayerNameplates} from '../../apps/web/player-nameplates.mjs';

class Element {
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.style={};this.dataset={};this.attributes={};this.hidden=false;this.className='';this._text='';
    this.classList={toggle:(value,enabled)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));if(enabled)values.add(value);else values.delete(value);this.className=[...values].join(' ');}};}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this._text='';this.append(...nodes);}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
}
class Clock {
  callbacks=new Map(); next=0;
  setTimeout(callback,delay){assert.ok(this instanceof Clock,'timer receiver is retained');assert.equal(delay,1500);const id=++this.next;this.callbacks.set(id,callback);return id;}
  clearTimeout(id){assert.ok(this instanceof Clock,'clearTimer receiver is retained');this.callbacks.delete(id);}
  fire(){for(const [id,callback]of this.callbacks){this.callbacks.delete(id);callback();}}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const hasClass=(node,value)=>node.className.split(/\s+/).includes(value);
const byClass=(node,value)=>descendants(node).find(child=>hasClass(child,value));
const allTags=(node,tag)=>descendants(node).filter(child=>child.tagName===tag);
const members=(hud,value)=>byClass(hud.root,value).children;
const manifest=JSON.parse(await readFile(new URL('../../contracts/rf-pvp-hud-source-v1.json',import.meta.url),'utf8'));
const pvpAssets={pieces:manifest.pixelAssets};
function fixture(options={}){
  const document={createElement:tag=>new Element(tag,document)},host=new Element('main',document),timers=new Clock();
  const pvp={phase:'intro',score:[2,1],remaining:419.999,players:[
    {id:'red-a',nickname:'Red 1',team:0,kills:2,assists:1,deaths:0},
    {id:'blue-local',nickname:'<Local>',team:1,kills:1,assists:0,deaths:2},
    {id:'red-b',nickname:'Red 2',team:0,kills:0,assists:2,deaths:1},
    {id:'blue-ally',nickname:'Blue Ally',team:1,kills:0,assists:3,deaths:0},
  ]};
  const actors=[{id:'red-b',team:0,hp:75,hpMax:100,mp:90,mpMax:300},
    {id:'blue-ally',team:1,hp:125,hpMax:100,mp:150,mpMax:300},
    {id:'blue-local',team:1,hp:100,hpMax:100,mp:300,mpMax:300,uiAbilities:{showOpponentMp:false}},
    {id:'red-a',team:0,hp:50,hpMax:100,mp:30,mpMax:300}];
  const hud=createPvpHud({host,localId:'blue-local',pvpAssets,timers,...options});
  return {document,host,timers,pvp,actors,hud,update:()=>hud.update(pvp,{actors,localId:'blue-local'})};
}

test('roster selects one ally and two enemies by server order, independent of actor position/order',()=>{
  const {pvp,actors}=fixture(),roster=pvpRoster(pvp,actors,'blue-local');
  assert.deepEqual(roster.allies.map(player=>player.id),['blue-ally']);
  assert.deepEqual(roster.opponents.map(player=>player.id),['red-a','red-b']);
  assert.equal(roster.local.actor,actors[2]);
  actors.reverse();assert.deepEqual(pvpRoster(pvp,actors,'blue-local').opponents.map(player=>player.id),['red-a','red-b']);
  assert.deepEqual(pvpRoster(pvp,actors,'unknown').opponents,[],'unknown local team must not mislabel every player enemy');
});

test('member gauges use actual actor maxima, clamp widths, and restrict enemy MP to local explicit permission',()=>{
  const {pvp,actors}=fixture(),roster=pvpRoster(pvp,actors,'blue-local');
  assert.deepEqual(pvpMemberGauges(roster.local,roster.allies[0]).hp,{fraction:1,text:'125 / 100'});
  assert.deepEqual(pvpMemberGauges(roster.local,roster.allies[0]).mp,{fraction:.5,text:'150 / 300'});
  assert.equal(pvpMemberGauges(roster.local,roster.opponents[0]).showMp,false);
  assert.deepEqual(pvpMemberGauges(roster.local,roster.opponents[0]).mp,{fraction:0,text:''});
  roster.local.actor.uiAbilities.showOpponentMp=true;
  assert.deepEqual(pvpMemberGauges(roster.local,roster.opponents[0]).mp,{fraction:.1,text:'30 / 300'});
  delete roster.opponents[0].actor.hpMax;
  assert.deepEqual(pvpMemberGauges(roster.local,roster.opponents[0]).hp,{fraction:0,text:'—'},'do not substitute an old client default maximum');
  roster.opponents[0].connected=false;
  assert.deepEqual(pvpMemberGauges(roster.local,roster.opponents[0]).hp,{fraction:0,text:''});
});

test('four-actor HUD retains stable enemy slots and clears both HP and MP for disconnected players',()=>{
  const {hud,pvp,actors,update}=fixture();update();hud.show(true);
  assert.equal(hud.root.hidden,false);
  assert.deepEqual(members(hud,'pvp-opponents').map(node=>node.dataset.playerId),['red-a','red-b']);
  const first=members(hud,'pvp-opponents')[0],ally=members(hud,'pvp-allies')[0];
  assert.equal(first.style.top,'0px');assert.equal(members(hud,'pvp-opponents')[1].style.top,'44px');
  assert.equal(byClass(first,'pvp-member-hp').style.width,'47.5px');
  assert.equal(byClass(first,'pvp-member-mp').style.width,'0px');
  assert.equal(byClass(ally,'pvp-member-mp').style.width,'46.5px');
  actors.find(actor=>actor.id==='blue-local').uiAbilities.showOpponentMp=true;update();
  assert.equal(byClass(first,'pvp-member-mp-number').textContent,'30 / 300');
  pvp.players[0].connected=false;update();
  assert.equal(members(hud,'pvp-opponents')[0],first);
  assert.equal(first.dataset.relationship,'enemy');assert.ok(hasClass(first,'disconnected'));
  assert.equal(byClass(first,'pvp-member-hp').style.width,'0px');assert.equal(byClass(first,'pvp-member-mp').style.width,'0px');
  assert.equal(byClass(first,'pvp-member-hp-number').textContent,'');assert.equal(byClass(first,'pvp-member-mp-number').textContent,'');
});

test('Score01 shows own team left, two-digit scores, four-digit seconds and the actual KILL target',()=>{
  const {hud,pvp,update}=fixture();pvp.score=[14,12];update();
  const score=byClass(hud.root,'pvp-score'),sprites=score.children;
  assert.equal(score.dataset.localTeam,'1');assert.equal(score.getAttribute('aria-label'),'Allies 12, opponents 14');
  assert.ok(sprites[0].src.endsWith('/bg_pvpscore_blue.png'));
  assert.deepEqual(sprites[1].children.map(node=>node.src.split('/').pop()),['lscore_1.png','lscore_2.png']);
  assert.deepEqual(sprites[2].children.map(node=>node.src.split('/').pop()),['rscore_1.png','rscore_4.png']);
  assert.equal(byClass(hud.root,'pvp-time').textContent,'419');assert.equal(byClass(hud.root,'pvp-time').getAttribute('role'),'timer');
  assert.deepEqual(byClass(hud.root,'pvp-time').children.slice(1).map(node=>node.src.split('/').pop()),['timenum_0.png','timenum_4.png','timenum_1.png','timenum_9.png']);
  assert.deepEqual(byClass(hud.root,'pvp-goal-number').children.map(node=>node.src.split('/').pop()),['killnum_0.png','killnum_4.png']);
  assert.equal(pvpCountdown(-.1),'0');assert.equal(pvpCountdown(NaN),'0');assert.equal(pvpCountdown(60.99),'60');
  const frame=score.children[0];update();assert.equal(score.children[0],frame,'unchanged render frames retain decoded score assets');
  pvp.score=[4,3];update();assert.deepEqual(byClass(hud.root,'pvp-score-left').children.map(node=>node.src.split('/').pop()),['lscore_0.png','lscore_3.png']);
  pvp.players.find(player=>player.id==='blue-local').team=0;update();assert.ok(score.children[0].src.endsWith('/bg_pvpscore_red.png'));
  assert.equal(score.getAttribute('aria-label'),'Allies 4, opponents 3');
});

test('member level uses frozen combat attributes before legacy roster levels and never manufactures an unknown level',()=>{
  const {hud,pvp,actors,update}=fixture();pvp.players[0].level=99;
  actors.find(actor=>actor.id==='red-a').formulaRules={combatLevel:85};update();
  const [first,second]=members(hud,'pvp-opponents');
  assert.equal(byClass(first,'pvp-member-level').textContent,'Lv 85');
  assert.equal(byClass(second,'pvp-member-level').hidden,true);
  assert.equal(descendants(first).some(node=>hasClass(node,'rf-buff-bar')),false,'member rows do not expose other actors buffs');
});

test('TAB board toggles local row and four-player K/A/D without adding native point formula or injecting nickname HTML',()=>{
  const {hud,update}=fixture();update();const board=byClass(hud.root,'pvp-board');
  assert.equal(board.style.height,'40px');assert.equal(allTags(board,'tbody')[0].children.length,1);assert.equal(allTags(board,'thead').length,0);
  assert.equal(allTags(board,'td')[0].textContent,'<Local>');assert.equal(allTags(board,'Local').length,0);
  assert.equal(hud.toggle(),true);assert.equal(board.style.height,'124px');assert.equal(board.getAttribute('aria-expanded'),'true');
  assert.deepEqual(allTags(board,'th').map(node=>node.textContent),['Nickname','K','A','D']);
  assert.deepEqual(allTags(board,'tbody')[0].children.map(row=>row.dataset.playerId),['red-a','blue-local','red-b','blue-ally']);
  assert.ok(hasClass(allTags(board,'tbody')[0].children[1],'local-player'));
  update();assert.equal(board.dataset.expanded,'true');assert.equal(hud.toggle(false),false);
});

test('intro remains empty across repeated ticks, fight banner timeout belongs to the HUD and is canceled on leaving',()=>{
  const {hud,pvp,timers,update}=fixture();update();update();const banner=byClass(hud.root,'pvp-banner');
  assert.equal(banner.textContent,'');pvp.phase='fight';update();assert.equal(banner.textContent,'Fight!');
  assert.equal(timers.callbacks.size,1);update();assert.equal(timers.callbacks.size,1);timers.fire();assert.equal(banner.children.length,0);
  pvp.phase='intro';update();pvp.phase='fight';update();assert.equal(timers.callbacks.size,1);
  hud.show(false);assert.equal(timers.callbacks.size,0);
});

test('clear resets expanded board, result and player widgets so a later match cannot retain names or timers',()=>{
  const {hud,pvp,timers,host,update}=fixture();update();hud.toggle(true);pvp.phase='fight';update();
  hud.result({winnerTeam:1,score:[1,4],players:pvp.players});assert.equal(timers.callbacks.size,0);
  hud.clear();assert.equal(hud.root.hidden,true);assert.equal(byClass(hud.root,'pvp-result').hidden,true);
  assert.equal(byClass(hud.root,'pvp-result').children.length,0,'settlement DOM and its callback must be released');
  assert.equal(byClass(hud.root,'pvp-board').children.length,0);assert.equal(members(hud,'pvp-allies').length,0);assert.equal(members(hud,'pvp-opponents').length,0);
  pvp.players=pvp.players.map(player=>({...player,nickname:'New '+player.id}));update();
  assert.equal(byClass(hud.root,'pvp-board').style.height,'40px');assert.ok(!byClass(hud.root,'pvp-board').textContent.includes('<Local>'));
  hud.dispose();assert.equal(host.children.length,0);assert.equal(timers.callbacks.size,0);
});

test('settlement follows active local team and returns through the provided callback',()=>{
  let returned=0;const {hud,pvp,update}=fixture({onReturn:()=>returned++});update();
  hud.result({winnerTeam:1,score:[1,4],players:pvp.players});const result=byClass(hud.root,'pvp-result');
  assert.equal(result.hidden,false);assert.equal(allTags(result,'strong')[0].getAttribute('aria-label'),'Victory');
  assert.deepEqual(allTags(result,'th').map(node=>node.textContent),['Nickname','K','A','D']);
  allTags(result,'button')[0].onclick();assert.equal(returned,1);assert.equal(result.hidden,true);
  hud.result({winnerTeam:null,score:[2,2],players:pvp.players});assert.equal(allTags(result,'strong')[0].getAttribute('aria-label'),'Draw');
});

test('1v1 shows one enemy and seconds without score sprites or score target, and TAB contains only two players',()=>{
  const {hud,pvp,actors,update}=fixture();pvp.mode='1v1';pvp.players=pvp.players.slice(0,2);pvp.scoreLimit=1;update();
  assert.equal(hud.root.dataset.mode,'1v1');assert.equal(byClass(hud.root,'pvp-score').hidden,true);assert.equal(byClass(hud.root,'pvp-score').children.length,0);
  assert.equal(byClass(hud.root,'pvp-goal').hidden,true);assert.equal(byClass(hud.root,'pvp-time').textContent,'419');
  assert.equal(byClass(hud.root,'pvp-clock-frame').hidden,false);assert.ok(byClass(hud.root,'pvp-clock-background').src.endsWith('/bg_pvp.png'));
  assert.equal(members(hud,'pvp-allies').length,0);assert.equal(byClass(hud.root,'pvp-allies').hidden,true);assert.equal(members(hud,'pvp-opponents').length,1);
  hud.toggle(true);assert.equal(allTags(byClass(hud.root,'pvp-board'),'tbody')[0].children.length,2);
  hud.result({mode:'1v1',winnerTeam:1,score:[0,1],players:pvp.players});assert.equal(allTags(byClass(hud.root,'pvp-result'),'p').length,0,'duel settlement also omits team scores');
  pvp.mode='2v2';update();assert.equal(byClass(hud.root,'pvp-score').hidden,false);assert.equal(byClass(hud.root,'pvp-goal').hidden,false);
});

test('3v3 shows two allies, three stable enemies, six-point goal and all six scoreboard rows',()=>{
  const {hud,pvp,actors,update}=fixture();pvp.mode='3v3';pvp.scoreLimit=6;
  pvp.players.push({id:'blue-ally-2',nickname:'Blue Ally 2',team:1},{id:'red-c',nickname:'Red 3',team:0});
  actors.push({id:'blue-ally-2',team:1,hp:100,hpMax:100,mp:75,mpMax:300},{id:'red-c',team:0,hp:100,hpMax:100,mp:150,mpMax:300});update();
  assert.equal(members(hud,'pvp-allies').length,2);assert.equal(members(hud,'pvp-opponents').length,3);
  assert.deepEqual(members(hud,'pvp-opponents').map(node=>node.style.top),['0px','44px','88px']);
  assert.equal(byClass(hud.root,'pvp-opponents').style.height,'132px');assert.equal(byClass(hud.root,'pvp-goal').textContent,'6 points to win');
  assert.equal(byClass(members(hud,'pvp-allies')[1],'pvp-member-mp-number').textContent,'75 / 300');
  hud.toggle(true);const board=byClass(hud.root,'pvp-board');assert.equal(allTags(board,'tbody')[0].children.length,6);assert.equal(board.style.height,'166px');
  const enemy=members(hud,'pvp-opponents')[2];pvp.players.at(-1).connected=false;update();assert.equal(members(hud,'pvp-opponents')[2],enemy);assert.ok(hasClass(enemy,'disconnected'));
});

for(const mode of ['2v2','3v3'])test(`${mode}: opponent and teammate portraits follow their own profession and repair delayed actor identity`,()=>{
  const {hud,pvp,actors,update}=fixture();pvp.mode=mode;
  if(mode==='3v3'){pvp.players.push({id:'red-c',team:0,professionId:'RF'},{id:'blue-c',team:1,professionId:'LK'});}
  pvp.players[0].professionId='RF';pvp.players[0].portraitKey='EL_LORD_KNIGHT_PARTY';
  pvp.players[2].professionId='LK';pvp.players[3].professionId='RF';update();
  const [rf,lk]=members(hud,'pvp-opponents');
  assert.equal(byClass(rf,'pvp-member-face').src,'/assets/ui/r_fist_party.png');
  assert.equal(byClass(lk,'pvp-member-face').src,'/assets/lk/ui/portrait-party.png');
  assert.equal(byClass(members(hud,'pvp-allies')[0],'pvp-member-face').src,'/assets/ui/r_fist_party.png');
  delete pvp.players[2].professionId;actors.find(a=>a.id==='red-b').professionId='RF';update();
  assert.equal(members(hud,'pvp-opponents')[1],lk);assert.equal(byClass(lk,'pvp-member-face').src,'/assets/ui/r_fist_party.png');
  actors.find(a=>a.id==='red-b').professionId='LK';update();
  assert.equal(byClass(lk,'pvp-member-face').src,'/assets/lk/ui/portrait-party.png');
  assert.equal(lk.dataset.professionId,'LK');assert.equal(byClass(lk,'pvp-member-face').alt,'Lord Knight');
  assert.equal(pvpMemberProfession({professionId:'RF',actor:{professionId:'LK'}}).id,'RF');
  pvp.players[2].professionId='IS';pvp.players[3].professionId='IS';update();
  assert.equal(byClass(members(hud,'pvp-opponents')[1],'pvp-member-face').src,'/assets/is/ui/portrait-party.png');
  assert.equal(byClass(members(hud,'pvp-allies')[0],'pvp-member-face').src,'/assets/is/ui/portrait-party.png');
  assert.equal(byClass(members(hud,'pvp-opponents')[1],'pvp-member-face').alt,'Infinity Sword');
});

test('nameplates use feet projection and roster nicknames with native red/blue relationship classes',()=>{
  const {host,pvp,actors}=fixture(),view=createPlayerNameplates({host}),seen=[];
  view.update(actors,{localId:'blue-local',players:pvp.players,visible:true,projectFeet:actor=>{seen.push(actor);return{x:120,y:400};}});
  const root=byClass(host,'online-nameplates'),labels=root.children;
  assert.deepEqual(seen,actors);assert.equal(labels.length,4);
  const local=labels.find(label=>label.dataset.playerId==='blue-local'),red=labels.find(label=>label.dataset.playerId==='red-a');
  assert.equal(local.textContent,'<Local>');assert.ok(hasClass(local,'local-player'));assert.ok(hasClass(local,'team-1'));assert.ok(hasClass(red,'team-0'));
  assert.equal(local.style.top,'400px');assert.equal(local.style.left,'120px');assert.equal(local.hidden,false);
  view.update(actors,{localId:'blue-local',players:pvp.players,visible:true,projectHead:()=>({x:10,y:10})});
  assert.ok(labels.every(label=>label.hidden),'a head callback must not silently replace the required feet anchor');
});

test('hidden/disconnected/nonfinite nameplates are suppressed and removed actor labels release DOM references',()=>{
  const {host,pvp,actors}=fixture(),view=createPlayerNameplates({host});
  actors[0].hidden=true;pvp.players[0].connected=false;
  view.update(actors,{localId:'blue-local',players:pvp.players,visible:true,projectFeet:actor=>actor.id==='blue-ally'?{x:NaN,y:100}:{x:120,y:400}});
  const root=byClass(host,'online-nameplates'),byId=id=>root.children.find(label=>label.dataset.playerId===id);
  assert.equal(byId('red-b').hidden,true);assert.equal(byId('red-a').hidden,true);assert.equal(byId('blue-ally').hidden,true);assert.equal(byId('blue-local').hidden,false);
  view.update(actors.slice(1),{localId:'blue-local',players:pvp.players,visible:true,projectFeet:()=>({x:20,y:30})});
  assert.equal(byId('red-b'),undefined);assert.equal(root.children.length,3);
  view.clear();assert.equal(root.children.length,0);assert.equal(root.hidden,true);view.dispose();assert.equal(root.parent,null);
});

test('unchanged four-player updates retain every board row, frame and member attachment',()=>{
  const {hud,document,pvp,update}=fixture();pvp.phase='fight';update();hud.toggle(true);
  const board=byClass(hud.root,'pvp-board'),before=descendants(board),body=allTags(board,'tbody')[0];
  const allyLine=byClass(hud.root,'pvp-allies'),enemyLine=byClass(hud.root,'pvp-opponents');
  let created=0,reattached=0;const create=document.createElement;document.createElement=tag=>{created++;return create(tag);};
  for(const node of [board,body,allyLine,enemyLine]){const replace=node.replaceChildren;node.replaceChildren=function(...children){reattached++;return replace.apply(this,children);};}
  for(let i=0;i<720;i++)update();
  assert.equal(created,0,'one minute of unchanged 12Hz HUD updates creates no elements');
  assert.equal(reattached,0,'unchanged rows stay attached, including keyboard/focus and decoded images');
  assert.deepEqual(descendants(board),before);
});

test('stable board updates KAD, names, local identity, team, order and reconnect without stale cached rows',()=>{
  const {hud,pvp,actors,update}=fixture();update();hud.toggle(true);
  const board=byClass(hud.root,'pvp-board'),body=allTags(board,'tbody')[0],originalRows=new Map(body.children.map(row=>[row.dataset.playerId,row]));
  pvp.players[0].kills=11;pvp.players[0].assists=8;pvp.players[0].deaths=3;pvp.players[0].nickname='<renamed>';pvp.players[0].connected=false;update();
  const red=originalRows.get('red-a');assert.equal(body.children[0],red);assert.deepEqual(red.children.map(cell=>cell.textContent),['<renamed> · Offline','11','8','3']);
  assert.ok(hasClass(red,'disconnected'));assert.equal(allTags(board,'renamed').length,0);
  pvp.players[0].connected=true;pvp.players[0].team=1;pvp.players.reverse();hud.update(pvp,{actors,localId:'red-a'});
  assert.deepEqual(body.children.map(row=>row.dataset.playerId),pvp.players.map(player=>player.id));
  assert.equal(body.children.at(-1),red);assert.ok(hasClass(red,'team-1'));assert.ok(hasClass(red,'local-player'));assert.ok(!hasClass(red,'disconnected'));
  hud.toggle(false);assert.equal(body.children[0],red);hud.toggle(true);assert.equal(body.children.at(-1),red,'collapse does not recreate same-match rows');
  pvp.players=pvp.players.filter(player=>player.id!=='red-a');hud.update(pvp,{actors,localId:'blue-local'});assert.equal(red.parent,null);
  pvp.players.push({id:'red-a',nickname:'Returned player',team:0,kills:0});hud.update(pvp,{actors,localId:'blue-local'});
  assert.notEqual(body.children.at(-1),red,'a departed player releases its cached row');assert.equal(body.children.at(-1).children[0].textContent,'Returned player');
});

test('nameplate projections finish before DOM writes and unchanged labels retain text and position',()=>{
  const {host,pvp,actors}=fixture(),view=createPlayerNameplates({host});
  const options={localId:'blue-local',players:pvp.players,visible:true,projectFeet:()=>({x:120,y:400})};view.update(actors,options);
  const root=byClass(host,'online-nameplates'),labels=[...root.children],events=[];
  for(const label of labels){
    const original=Object.getOwnPropertyDescriptor(Element.prototype,'textContent');
    Object.defineProperty(label,'textContent',{get(){return original.get.call(this);},set(value){events.push('text');original.set.call(this,value);}});
    const initial=label.style;label.style=new Proxy(initial,{set(target,key,value){events.push('style');target[key]=value;return true;}});
  }
  view.update(actors,{...options,projectFeet:()=>{events.push('projection');return{x:120,y:400};}});
  assert.deepEqual(events,Array(4).fill('projection'),'stable names/coordinates do not rewrite text or position');events.length=0;
  pvp.players[0].nickname='New name';view.update(actors,{...options,projectFeet:()=>{events.push('projection');return{x:121,y:402};}});
  assert.deepEqual(events.slice(0,4),Array(4).fill('projection'),'all canvas layout reads precede label layout writes');
  assert.equal(root.children.find(label=>label.dataset.playerId==='red-a').textContent,'New name');
  assert.ok(labels.every(label=>label.style.left==='121px'&&label.style.top==='402px'));
  assert.deepEqual(root.children,labels);
});
