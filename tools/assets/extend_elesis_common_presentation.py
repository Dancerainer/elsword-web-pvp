"""Extend v28 with original Elesis mounts and KSM centers; no guessed bounds."""
import argparse, hashlib, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RAW=Path('asset_work')
spec=importlib.util.spec_from_file_location('common_v28',Path(__file__).with_name('build-common-presentation-v28.py'))
source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
sha=lambda b:hashlib.sha256(b).hexdigest()
def main(assets):
    path=ROOT/'contracts/common-presentation-source-v28.json'
    result=json.loads(path.read_text('utf8'))
    for id in ['gm','bh','ca']:
        manifest=json.loads((assets/id/'manifest.json').read_text('utf8'))
        attachments=[r for r in manifest['attachments'] if r['type']=='rigid' and r['parent']=='Dummy3_Weapon']
        if len(attachments)!=1:raise ValueError('Ambiguous original Elesis weapon '+id)
        row=attachments[0]
        result['weaponBindings'][id]={k:row[k] for k in ['node','parent','source']}
        result['weaponBindings'][id]['sourceSha256']=sha((RAW/row['source']).read_bytes())
        original=manifest['character']['sources'][0];motion=(RAW/original).read_bytes()
        result['unitCenters'][id]={**source.read_motion_center(motion),'source':original,'sha256':sha(motion),
            'consumer':'GUUser1577 SetCenter(GetMotion()->GetCenter); KSMHeader center offset12; KTDGObject GetTransformCenter/IsInFrustum'}
    path.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(json.dumps({id:result['weaponBindings'][id]['node'] for id in ['gm','bh','ca']}))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--assets',type=Path,default=ROOT/'artifacts')
    main(parser.parse_args().assets)
