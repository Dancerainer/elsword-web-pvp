/** Refresh adopted metadata and write task-owned artifact manifest deltas.
 * This never modifies the supplied resource baseline or raw2016 rows. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {updateAddProfileText} from './add-profile-text.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith('--')).map(s=>{const i=s.indexOf('=');return i<0?[s.slice(2),true]:[s.slice(2,i),s.slice(i+1)];}));
const updates={
 29003:['prism-native-group-and-endpoint-host','Target2016 field follows10s main-Mesh anchor rather than6.9s endpoint TTL; endpoint quarterHP/script/native-timer/handle domain is implemented behind the required independent motion host. Original NPC hit geometry, defence stats and animation completion host remain unbound'],
 29202:['particle-shot-original-lot0','Target2016 selected ordinary Pulse Bullet producer leavesLOT0; no autonomous target producer is enabled. No guessed homing or legacy9400 skill is added'],
 29000:['energy-boom-target2016','Target2016 one-point projectile lifetime×1.4 and external three-axis size×1.5; original battle instance unmeasured'],
 29007:['stasis-source-phase','Target2016 independent A/B accumulation, frozen multiplier, size cap1.5 and current-cost refund execute; shared wrapped-damage input stage remains a Web integration boundary'],
 29008:['conqueror-source-inputs','Target2016 indexed32k table, related scatter indices and mutation projectile counts execute. Battle seed and candidate enumeration are Web inputs; original Hyper skill9009 modifier input unavailable'],
 29011:['quicksilver-native-clock','Target2016 priority .8 impact else .001 link creation else .85 retire, separate main-only transform and exact trigonometric constants execute; original dynamic matrices remain instance inputs'],
 29013:['drone-activator-source-phase','Target2016 eight-ID half-price/cooldown reset and held Magnetron release execute; marker setter and independent timing retain stated ownership adapters'],
 29017:['ultimate-fury-source-inputs','Target2016 fourth mutation drone, actual AttackDummy01..04, no-break two-target allocation and first-three shared attempt budget execute; posed matrices and candidate order remain simulation inputs'],
 29210:['flick-native-lot6','Target2016 strict nearest/history-mode3/first-contact unlock execute. Web actor collection supplies actual candidate inputs; further original retarget and compensation clocks are not asserted identical'],
 29211:['countdown-native-lot6-and-shake','Target2016 strict mode1 history clearing, saved-speed stop/restore,3s trace and10 observed facing-difference prune execute; mutation has no positive shake threshold'],
 29212:['space-crack-native-producer','Target2016 independent timer1Main+5Sub,3MP and strict-DP payment versus inclusive permission execute. Web frozenDP cost60 is the observed writable-global input, not a claim of original global invariance'],
 29021:['stardust-instance-inputs','Target2016 main enter/actual exit/persistent timer execute; real carrier posed nodes required; Web seeded random remains an instance policy'],
 29214:['mind-break-scan-fidelity','Target2016 PvP500 scan, caller maximum and35-degree elevation gate execute; exact native Euler normalization and secondary anchored visual remain separately qualified'],
 29215:['force-finger-scan-fidelity','Target2016 PvP500 scan and actual one-candidate caller,15 drain/45MP or900DP recovery execute; exact Euler extraction remains a Web map-basis adapter'],
 29023:['void-native-hold-and-collapse','Target2016 maintenance precedes release/max checks, strict rawDP admission and independent per-callback .98 scale/-.03 visibility collapse execute; END adds no second explosion'],
 29024:['moonlight-native-socket-query','Target2016 exact skill29024 delta0/default and predecessor query, base*(1+delta), and type15 exclusion of extraHyper branch execute; immutable Web equipment currently has no per-ID sockets'],
};
const fury=JSON.parse(fs.readFileSync(path.join(root,'contracts/mm-command-fury-2016.json'),'utf8'));
const awake=JSON.parse(fs.readFileSync(path.join(root,'contracts/add-awakening-2016.json'),'utf8'));
for(const career of ['lp','mm','de']){
 const file=path.join(root,`packages/combat-core/${career}-profile.json`),original=fs.readFileSync(file,'utf8'),p=JSON.parse(original);
 for(const group of ['effectSets','damageEffects','effectTemplates'])Object.assign(p[group],awake[group]);
 // Explicit product input: these playable Web actors have no mounted/riding
 // state system. Do not derive this independent byte from formation or claim
 // the value was observed in an original battle heap.
 p.referenceSemantics.awakening.nativePredicateInput=0;
 p.referenceSemantics.awakening.nativePredicateInputEvidence='Web ordinary playable actor policy supplies original6d7e input0; independent of formation; not original-client battle observation';
 for(const s of p.skillCatalog){const base=s.raw.m_DeleteSkillIDByUpgrade??s.skillId,u=updates[base];if(!u)continue;
  s.limitations=[{key:u[0],message:u[1],evidenceClass:'target2016 static consumer; current Web integration, not original-client measurements'}];
  if(base===29021){s.states=[s.state];s.missingAnimationStates=[];s.supported=true;s.supportStatus='partial-target2016-static-consumer';delete s.unavailableReason;}
 }
 if(career==='mm'){Object.assign(p.damageEffects,fury.rows);p.sourceLiteralResources=[...new Set([...p.sourceLiteralResources,...Object.keys(fury.rows)])];}
 fs.writeFileSync(file,updateAddProfileText(original,p));
 if(args['artifact-output']){
  if(!args['artifact-base'])throw new TypeError('--artifact-base is required');
  const source=path.resolve(String(args['artifact-base']),career,'manifest.json'),dest=path.resolve(String(args['artifact-output']),career,'manifest.json');
  if(source.toLowerCase()===dest.toLowerCase())throw new TypeError('Artifact output must be independent of shared baseline');
  const manifest=JSON.parse(fs.readFileSync(source,'utf8'));manifest.profile={profileId:p.profileId,sha256:createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n?/g,'\n')).digest('hex'),hashNormalization:'UTF-8 LF'};
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(manifest,null,2)+'\n');
 }
 console.log(career+': adopted target2016 metadata and command DD');
}
