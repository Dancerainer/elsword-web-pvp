/** Preserve source JSON numeric spellings and all untouched raw declarations.
 * Only changed skill metadata and added DD/literal keys are serialized. */
function end(text,start){let depth=0,string=false,escape=false;for(let i=start;i<text.length;i++){const c=text[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}if(c==='"'){string=true;continue;}if(c==='{'||c==='[')depth++;if(c==='}'||c===']'){if(--depth===0)return i+1;}}throw new TypeError('Unclosed profile JSON');}
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const formatted=(v,indent)=>JSON.stringify(v,null,2).replaceAll('\n','\n'+' '.repeat(indent));
function fieldSpan(text,name,from=0){const marker='"'+name+'": ',at=text.indexOf(marker,from);if(at<0)throw new TypeError('Missing profile field '+name);const start=at+marker.length;return [start,end(text,start)];}
export function updateAddProfileText(original,profile){
 let text=original;const [start,finish]=fieldSpan(text,'skillCatalog'),replacements=[];
 for(let i=start+1;i<finish;){while(i<finish&&text[i]!=='{')i++;if(i>=finish)break;const stop=end(text,i),old=JSON.parse(text.slice(i,stop)),next=profile.skillCatalog.find(s=>s.skillId===old.skillId);if(!next)throw new TypeError('Missing skill');
  if(!eq(old,next)){let row=formatted(next,4);const [a,b]=fieldSpan(row,'raw'),[c,d]=fieldSpan(text.slice(i,stop),'raw');row=row.slice(0,a)+text.slice(i+c,i+d)+row.slice(b);replacements.push([i,stop,row]);}i=stop;
 }
 for(const [a,b,value]of replacements.reverse())text=text.slice(0,a)+value+text.slice(b);
 for(const category of ['damageEffects','effectSets','effectTemplates']){
  const [a,b]=fieldSpan(text,category),existing=JSON.parse(text.slice(a,b)),added=Object.entries(profile[category]).filter(([name])=>!Object.hasOwn(existing,name));
  if(added.length){const suffix=added.map(([name,row])=>',\n    '+JSON.stringify(name)+': '+formatted(row,4)).join('');text=text.slice(0,b-2)+suffix+'\n  }'+text.slice(b);}
 }
 const [r,s]=fieldSpan(text,'referenceSemantics'),before=JSON.parse(text.slice(r,s));if(!eq(before,profile.referenceSemantics))text=text.slice(0,r)+formatted(profile.referenceSemantics,2)+text.slice(s);
 if(Object.hasOwn(profile,'sourceLiteralResources')){const [c,d]=fieldSpan(text,'sourceLiteralResources'),oldLiterals=JSON.parse(text.slice(c,d));if(!eq(oldLiterals,profile.sourceLiteralResources))text=text.slice(0,c)+formatted(profile.sourceLiteralResources,2)+text.slice(d);}
 if(!eq(JSON.parse(text),profile))throw new TypeError('Profile preservation did not reproduce intended metadata');return text;
}
