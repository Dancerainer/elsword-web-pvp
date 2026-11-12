/** Original320a6400 /3209dda0 instruction-derived expectations; no Native load. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisShadowTargets} from '../../packages/combat-core/elesis-shadow-edge.mjs';
const actor=(id,x,y=0,patch={})=>({id,x,y,z:0,team:1,hp:100,facing:1,lineId:0,professionId:'CA',...patch});
function fixture(actors,{mode='PVP',facing=1,line=[1,0,0]}={}){
 const a=actor('caster',0,0,{team:0,facing}),sim={state:{actors:[a,...actors]},presetFor:()=>({gameMode:mode}),
  map:{lines:[{lineId:0,start:[0,0,0],end:line}]}};
 return {sim,a,targets:()=>elesisShadowTargets(sim,a).map(b=>b.id)};
}
test('original nearest scan chooses at most3, with later enumeration replacing equal distances',()=>{
 const f=fixture([actor('far',400),actor('equal-first',100),actor('equal-last',100),actor('middle',200)]);
 assert.deepEqual(f.targets(),['equal-last','equal-first','middle']);
});
for(const [mode,r]of [['PVP',700],['NPC',1200]])test(`original ${mode} acquisition includes distance${r}, rejects distance${r}+.1`,()=>{
 assert.deepEqual(fixture([actor('edge',r)],{mode}).targets(),['edge']);
 assert.deepEqual(fixture([actor('outside',r+.1)],{mode}).targets(),[]);
 assert.deepEqual(fixture([actor('vertical',600,Math.sqrt(r*r-600*600))],{mode}).targets(),['vertical']);
});
test('front gate uses target lane X/Z and caster facing, with exact-zero left branch',()=>{
 assert.deepEqual(fixture([actor('front',-200),actor('back',200)],{facing:-1}).targets(),['front']);
 assert.deepEqual(fixture([actor('zero',0,100)],{facing:1}).targets(),[]);
 assert.deepEqual(fixture([actor('zero',0,100)],{facing:-1}).targets(),['zero']);
 const q=actor('on-z',0,0,{z:200});assert.deepEqual(fixture([q],{line:[0,0,1]}).targets(),['on-z']);
 assert.deepEqual(fixture([q],{line:[0,0,1],facing:-1}).targets(),[]);
});
test('original user selection excludes dead, same team and invulnerability before spending a slot',()=>{
 const f=fixture([actor('ally',1,0,{team:0}),actor('zero-hp',2,0,{hp:0}),actor('dead',3,0,{pvpDead:true}),
  actor('invincible',4,0,{invincible:true}),actor('forced',5,0,{forceInvincible:1}),actor('valid',600)]);
 assert.deepEqual(f.targets(),['valid']);
});
