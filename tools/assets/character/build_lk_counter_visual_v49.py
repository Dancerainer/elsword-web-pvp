"""Original minor RevengeWait resource, task-owned additive output only."""
from pathlib import Path
import argparse,json
from PIL import Image
from build_rf import Catalog,digest,write_json
from lk_presentation_roots import minor_declarations
ROOT=Path(__file__).resolve().parents[3]
def build(source_root=Path('asset_work'),output=ROOT/'artifacts/lk/counter-v49'):
 output=output.resolve()
 if not output.is_relative_to(ROOT) or output.is_relative_to(source_root.resolve()):raise ValueError('Output must belong to this task')
 catalog=Catalog(source_root);template=minor_declarations(catalog,('RevengeWait',))['RevengeWait'];template['textures']={}
 for event in template['events']:
  if event['property']!='Texture':continue
  path=catalog.path(event['value']);relative='counter-v49/textures/'+path.stem+'-'+digest(path.read_bytes())[:10]+'.png'
  target=output.parent/relative;target.parent.mkdir(parents=True,exist_ok=True)
  image=Image.open(path).convert('RGBA');image.save(target)
  template['textures'][event['value']]={'file':relative,'width':image.width,'height':image.height,'source':catalog.evidence(path)}
 index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,'templates':{'RevengeWait':template},
  'sourceFiles':list(catalog.used.values()),'nativeBinding':'contracts/lk-counter-native-v49.json',
  'limits':['Original target runtime/GPU unmeasured; exact .09 registration and callback are offline target2016 evidence.']}
 write_json(ROOT/'contracts/lk-counter-visual-v49.json',index);write_json(output/'index.json',index)
 paths=[output/'index.json',*(output.parent/t['file']for t in template['textures'].values())]
 write_json(ROOT/'reports/lk-counter-assets-v49.json',{'schemaVersion':1,'sourceFiles':index['sourceFiles'],'inventory':[
  {'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())}for p in paths]})
 print(json.dumps({'output':str(output),'templates':1,'textures':len(template['textures'])}))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,default=Path('asset_work'));p.add_argument('--output',type=Path,default=ROOT/'artifacts/lk/counter-v49');args=p.parse_args();build(args.source_root,args.output)
