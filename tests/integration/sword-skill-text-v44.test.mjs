import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSkillDescription,cleanSkillText} from '../../apps/web/skill-slot.mjs';
import {skillDisplayText} from '../../packages/localization/skills.mjs';
class Element{
 constructor(){this.children=[];this.className='';}
 append(...children){this.children.push(...children);}
}
const document={createElement:()=>new Element()};
for(const profession of ['lk','rs','is','gm','bh','ca','rf','bm','vc','lp','mm','de']){
 test(`${profession}: only declared sword skills gain one colored line; existing prose stays intact`,()=>{
  const catalog=JSON.parse(readFileSync(`artifacts/ui/skills/${profession==='rf'?'':profession+'/'}catalog.json`));
  let added=0;
  for(const skill of catalog.skills){
   const before=JSON.stringify(skill),blocks=createSkillDescription(document,skill);
   const sword=blocks.filter(b=>/skill-description-sword-/.test(b.className));
   const expected=['lk','rs','is','gm','bh','ca'].includes(profession)&&![1,8].includes(skill.type)&&[1,2].includes(skill.template.m_usWOSType);
   assert.equal(sword.length,expected?1:0,`${skill.id}`);
   assert.equal(JSON.stringify(skill),before);
   const main=cleanSkillText(skillDisplayText(skill)?.main??skill.template.m_wstrMainDesc);
   const original=main.split(/(?:\n\n)?Final Enhanced Skill:?/)[0];
   assert.equal(blocks.find(b=>b.className.endsWith('-prose'))?.children[0].textContent??'',original);
   if(expected){
    added++;
    const vitality=skill.template.m_usWOSType===2;
    const label=['gm','bh','ca'].includes(profession)?(vitality?'Gale':'Annihilation'):(vitality?'Vitality':'Destruction');
    assert.ok(sword[0].className.endsWith(vitality?'sword-vitality':'sword-destruction'));
    assert.ok(sword[0].children[0].textContent.startsWith(`${label} skill: ${label} `));
    const trueIndex=blocks.findIndex(b=>b.className.endsWith('-true'));
    if(trueIndex>=0)assert.ok(blocks.indexOf(sword[0])<trueIndex);
   }
  }
  if(['lk','rs','is','gm','bh','ca'].includes(profession))assert.ok(added>0);
 });
}

