import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuildPanel} from '../../apps/web/guild-panel.mjs';

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.listeners=new Map();}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,callback){this.listeners.set(name,callback);}
  removeEventListener(name){this.listeners.delete(name);}
  focus(){this.focused=true;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
}
const flatten=node=>[node,...node.children.flatMap(flatten)];

test('independent guild page is twelve read-only Lv5 cards, closes on Escape, restores focus and releases handlers',()=>{
  const document=new Element('document');document.body=new Element('body');document.createElement=tag=>new Element(tag);document.activeElement=new Element('previous');
  let opened=0,closed=0;const view=createGuildPanel({document,onOpen:()=>opened++,onClose:()=>closed++});
  assert.equal(view.isOpen(),false);assert.equal(view.element.hidden,true);
  const elements=flatten(view.element),cards=elements.filter(node=>node.tagName==='article');assert.equal(cards.length,12);
  assert.equal(elements.filter(node=>node.tagName==='button').length,1,'only close button, no passive editing controls');
  assert.equal(elements.some(node=>['input','select'].includes(node.tagName)),false);
  assert.ok(cards.every(node=>node.children.some(child=>child.className==='guild-skill-rank'&&child.textContent==='5 / 5')));
  assert.ok(cards.every(node=>node.children.some(child=>child.className==='guild-skill-level'&&child.textContent==='Lv.5')));
  assert.ok(cards.every(node=>node.children[0].src.endsWith('/'+node.dataset.skillId+'.png')));
  assert.equal(cards.filter(node=>node.dataset.predecessor).length,2);
  view.open();view.open();assert.equal(opened,1);assert.equal(view.isOpen(),true);
  let prevented=0,stopped=0;document.listeners.get('keydown')({key:'Escape',preventDefault:()=>prevented++,stopPropagation:()=>stopped++});
  assert.equal(view.isOpen(),false);assert.equal(closed,1);assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(document.activeElement.focused,true);
  view.dispose();assert.equal(document.listeners.has('keydown'),false);assert.equal(document.body.children.length,0);
});
