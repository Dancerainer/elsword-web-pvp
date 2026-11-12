"""Export a bounded original 2016 resource closure for the pinned XXX consumer.

The callback is a version-reference candidate, not acquired target2016 source.
No resource-only DamageEffect_RF_XXX owner or 18-hit timing is invented.
"""
from pathlib import Path
import json
from PIL import Image
from build_rf import Catalog,digest,write_json
from build_rf_fx import read_definitions,select_templates

ROOT=Path(__file__).resolve().parents[3]
NAMES=('Smoke_Raven_ComboX03','Smoke_Raven_ComboX01','Flare_Raven_ComboX02')

def build(source_root=Path('asset_work'),output=None):
    output=(output or ROOT/'artifacts/rf/xxx-fx').resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source_root.resolve()):
        raise ValueError('XXX output must stay inside task artifacts')
    catalog=Catalog(source_root)
    selected,missing=select_templates(read_definitions(catalog),{'resourceOnlyTemplates':list(NAMES)})
    if missing or set(selected)!=set(NAMES):raise ValueError('Missing original XXX templates')
    for template in selected.values():
        if template['unsupported'] or template['kind']!='particle' or template['fields']['particleType']!='PT_3D_PLANE':
            raise ValueError('Unsupported original XXX particle declaration')
        template['textures']={}
        for event in template['events']:
            if event['property']!='Texture':continue
            name=event['value'];path=catalog.path(name)
            filename='textures/'+Path(name).stem+'-'+digest(path.read_bytes())[:10]+'.png'
            image=Image.open(path).convert('RGBA');(output/filename).parent.mkdir(parents=True,exist_ok=True)
            image.save(output/filename)
            template['textures'][name]={'file':'xxx-fx/'+filename,'width':image.width,'height':image.height,'source':catalog.evidence(path)}
    index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
      'templates':selected,'sourceFiles':list(catalog.used.values()),'missingTemplates':[],'meshFailures':[],
      'limits':['Source XXX trigger is the pinned older-version consumer; target2016 callback and GPU comparison remain unavailable.',
                'Manual damage remains an explicit unsupported source boundary; the resource-only 18-hit set is not bound by guess.']}
    write_json(output/'index.json',index);write_json(ROOT/'contracts/rf-xxx-explosion-fx-v13.json',index)
    print(json.dumps({'templates':len(selected),'textures':sum(len(t['textures']) for t in selected.values())}))
    return index

if __name__=='__main__':build()
