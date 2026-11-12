/** Execute the production catch and activity gates without loading game assets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const boundary=game.lastIndexOf('\n} catch(error) {');
assert.ok(boundary>game.indexOf('window.rfWorkbench='),'Select the actual outer bootstrap catch');
const handler=game.slice(boundary+3,game.lastIndexOf('\n}\n'));
const removal=game.split('\n').find(line=>line.includes("$('.loading-overlay').remove();active=true;"));
assert.ok(removal,'Production late-boot overlay removal remains covered');
const tickGuard=game.match(/function tick\([^\n]+\n(  if\(!active[^\n]+)/)?.[1];
const keyGuard=game.slice(game.indexOf("listenBattleWindow('keydown'")).match(/^  if\(!active[^\n]+/m)?.[0];
assert.ok(tickGuard&&keyGuard,'Use the actual combat and input guards');

function fixture(){
  const logs=[],nodes=[];
  class Element{
    constructor(){this.children=[];this.style={};this.attributes={};this.className='';this.hidden=false;nodes.push(this);}
    append(child){child.remove();child.parent=this;this.children.push(child);}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
    setAttribute(name,value){this.attributes[name]=value;}
    get classList(){return {add:name=>{this.className=[...new Set([...this.className.split(' '),name])].join(' ');}};}
  }
  const body=new Element(),app=new Element(),viewport=new Element(),overlay=new Element();
  body.append(app);app.append(viewport);viewport.append(overlay);overlay.className='loading-overlay';
  const query=selector=>selector==='.viewport'?viewport:selector==='#app'?app:nodes.find(node=>node.parent&&node.className.split(' ').includes(selector.slice(1)))??null;
  const original=new Error('Original startup failure <unsafe markup>');
  const state={active:false,paused:false,bootError:original,console:{error:error=>logs.push(error)},$:query,
    document:{body,createElement:()=>new Element()},canvas:{focus(){}},say(){}};
  vm.createContext(state);
  function fail(){assert.throws(()=>vm.runInContext(`try { throw bootError; } ${handler}`,state),error=>error===original);}
  function verify(expected){
    assert.deepEqual(logs,[original],'Log the original error once, preserving stack and identity');
    assert.equal(state.active,false);assert.equal(state.paused,true);
    const visible=query('.load-error');assert.equal(visible,expected);
    assert.equal(visible.textContent,'Loading failed:'+original.message);assert.equal(visible.hidden,false);
    assert.equal(visible.attributes.role,'alert');assert.equal(visible.style.zIndex,'1200','Remain above the already-created lobby');
    assert.equal(viewport.children.filter(node=>node.className.includes('loading-overlay')).length,1);
    vm.runInContext(`
      function tick(manual=false){${tickGuard}\nthrow Error('Combat advanced after failed boot');}
      function keydown(){${keyGuard}\nthrow Error('Input accepted after failed boot');}
      tick(false);tick(true);keydown();
    `,state);
  }
  return {state,original,overlay,viewport,query,fail,verify};
}

test('early production bootstrap failure reuses a visible overlay and preserves the original rejection',()=>{
  const f=fixture();f.overlay.hidden=true;f.fail();f.verify(f.overlay);
});

test('late production bootstrap failure recreates the removed overlay and stops normal/manual/input activity',()=>{
  const f=fixture();vm.runInContext(removal,f.state);
  assert.equal(f.query('.loading-overlay'),null);assert.equal(f.state.active,true);
  f.fail();const restored=f.query('.loading-overlay');assert.notEqual(restored,f.overlay);f.verify(restored);
});
