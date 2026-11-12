"""Convert ADD's four target2016 costume sets on its six authored dynamo bones."""
from pathlib import Path
import sys,copy,json
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
import build_costumes as shared
from build_rf import Catalog,load_x,walk,node,to_tree,parse_ksm,Exporter,asset_metadata,write_json
SETS={
 'officer':{'name':'El Search Party Officer','add':{'body':[82123,82124,82125,82126,82129],'weapon':82122,'accessories':[82128,89193]}},
 'nasod':{'name':'Nasod Battle Suit','add':{'body':[82446,82447,82448,82449,82450],'weapon':82445,'accessories':[82451]}},
 'royal':{'name':'Royal Servant','add':{'body':[88942,88943,88944,88945,88946],'weapon':88941,'accessories':[88947,88948]}},
 'solace':{'name':'Salvatore Solace','add':{'body':[82438,82439,82440,82441,82442],'weapon':82437,'accessories':[82443,82444]}}}

def contract(c):
 p=c.path('item.kim');kim=shared.CostumeKim(p.read_bytes());items={}
 for definition in SETS.values():
  choice=definition['add']
  for id in [*choice['body'],choice['weapon'],*choice['accessories']]:
   row=kim.visual(id)
   if row['unitType']!=9 or not row['models'][0] or row['textureChange'] or row['animationXet']:raise ValueError('Unsupported source costume '+str(id))
   row['sourceModels']=[]
   for name in filter(None,row['models']):
    modes={'normal':c.evidence(c.path(name))}
    if row['canHyperMode']:modes['awakened']=c.evidence(c.path('Hyper_'+name))
    row['sourceModels'].append(modes)
   items[str(id)]=row
 return {'schemaVersion':1,'id':'add-costumes-target2016-v1','clientMeasured':False,'sets':SETS,'characters':{'add':{'unitType':9,'motion':'Motion_ADD.x'}},'items':items,'inputs':[c.evidence(p)],
         'limits':['Independent display-only original item models. KIM Dummy3_Weapon uses ADD-specific six Weapon01..06 adapter; target consumer execution remains unmeasured.']}

def body(c,destination,character,selected,items):
 primary=c.path('Motion_ADD.x');motion=parse_ksm(primary);skeleton=to_tree(motion);names={f['name']for f in motion['frames']}
 for frame,_ in walk(skeleton):frame.children=[ch for ch in frame.children if ch.kind!='Mesh']
 frames={n.name:n for n,_ in walk(skeleton)if n.kind=='Frame'}
 for id in selected['body']:
  item=items[str(id)]
  if item['useType']!=1 or item['canHyperMode']:raise ValueError('Unsupported costume body')
  for filename in filter(None,item['models']):
   count=0
   for mesh,ancestry in walk(load_x(c.path(filename))):
    if mesh.kind!='Mesh' or not mesh.children_of('SkinWeights'):continue
    holder=ancestry[-1]
    if holder.name not in frames:
     added=node('Frame',name='Costume_'+holder.name);added.children.append(copy.deepcopy(holder.child('FrameTransformMatrix')));frames['Scene_Root'].children.append(added);frames[holder.name]=added
    frames[holder.name].children.append(copy.deepcopy(mesh));count+=1
   if not count:raise ValueError('No original body geometry '+filename)
 weapon=items[str(selected['weapon'])]
 # Target item 82428 declares the older Dummy1_Rhand metadata, while its
 # original geometry has the same Weapon01 hierarchy as other ADD dynamos.
 # Keep this exception identity-scoped; all six authored bones still drive it.
 expected_mount='Dummy1_Rhand' if weapon['itemId']==82428 else 'Dummy3_Weapon'
 if weapon['attachFrames'][0]!=expected_mount or weapon['canHyperMode']:raise ValueError('Unexpected ADD weapon metadata')
 tree=load_x(c.path(weapon['models'][0]));source=[n for n,_ in walk(tree)if n.kind=='Frame' and n.name=='Weapon01']
 if len(source)!=1:raise ValueError('Original ADD weapon frame missing/ambiguous')
 for i in range(1,7):
  name='Costume_Dynamo'+str(i).zfill(2);mount=copy.deepcopy(source[0]);mount.name=name
  for n,_ in walk(mount):
   if n.kind=='Frame' and n is not mount:n.name=name+'_'+(n.name or 'Unnamed')
  frames['Weapon'+str(i).zfill(2)].children.append(mount)
 ex=Exporter('body',texture_lookup=c,asset_root=c.root);ex.add(primary,destination,tree=skeleton,clips_override=[])
 if ex.missing_textures:raise ValueError('Missing original costume texture')
 ex.doc['extensionsUsed']=['KHR_materials_unlit']
 for m in ex.doc['materials']:m['extensions']={'KHR_materials_unlit':{}};m['doubleSided']=False
 for n in ex.doc['nodes']:n['name']=n['name'].removeprefix(primary.stem+'/')
 summary=asset_metadata(ex,destination,ex.save(destination))
 return {'glb':'body.glb','sourceMotion':c.evidence(primary),'meshCount':summary['meshes'],'poseFrames':[{'name':n.name,'parent':a[-2].name if len(a)>1 else None}for n,a in walk(skeleton)if n.kind=='Frame' and n.name in names],'keptProfessionParts':['face'],'weaponNodes':['Costume_Dynamo'+str(i).zfill(2)for i in range(1,7)]}

def main():
 c=Catalog(Path('asset_work'));proof=contract(c);write_json(ROOT/'contracts/add-costumes-source-v1.json',proof)
 if '--record-only' in sys.argv:return
 shared.SETS=SETS;shared.CHARACTERS={'add':{'unitType':9,'motion':'Motion_ADD.x'}};shared.body=body
 result=shared.build(c,proof,ROOT/'artifacts/costumes')
 for entry in result['characters']['add'].values():
  attachments=[]
  for row in entry['attachments']:
   if row['owner']=='body' and row['bone']=='Costume_SwordMount':
    attachments += [{**row,'bone':'Costume_Dynamo'+str(i).zfill(2),'sourceBone':'Weapon01'}for i in range(1,7)]
   else:attachments.append(row)
  entry['attachments']=attachments
 write_json(ROOT/'artifacts/costumes/manifest.json',result)
if __name__=='__main__':main()
