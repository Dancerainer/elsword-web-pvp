"""Extract the original XXdownX CreateSequence resource; no synthetic effects.

Independent index, existing fx texture namespace, task-owned outputs. This does
not rebuild or relabel any native publication. UseLand remains an explicit
runtime consumer gap, not a resource declaration guessed by this tool.
"""
from pathlib import Path
import argparse
import json
import re
from PIL import Image
from build_rf import Catalog, digest, write_json
from build_rf_fx import declaration, explicit_template_references

ROOT=Path(__file__).resolve().parents[3]
NAME='Raven_attackX3Front_Particle01'
INDEX=ROOT/'contracts/rf-xx2x-fx-index-v12.json'

def parse(text):
    matches=list(re.finditer(r'eventsequence\s+"'+NAME+r'"\s*\{([^{}]*)\}',text))
    if len(matches)!=1:raise ValueError('Missing or ambiguous original XX2X particle')
    match=matches[0]
    record=declaration(match[1])
    if record['unsupported'] or record['fields'].get('particleType')!='PT_3D_PLANE':
        raise ValueError('Unsupported original XX2X particle declaration')
    if list(explicit_template_references(record['fields'])) or list(explicit_template_references(record['repeated'])):
        raise ValueError('XX2X particle has unclosed template children')
    if record['fields'].get('Mesh') or record['fields'].get('MeshName'):
        raise ValueError('XX2X particle unexpectedly requires original mesh extraction')
    return record,match

def build(source_root=Path('asset_work'),output=ROOT/'artifacts/rf',index_output=INDEX,report_output=ROOT/'reports/rf-xx2x-particle-assets-v12.json'):
    output=Path(output).resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(Path(source_root).resolve()):
        raise ValueError('XX2X output must stay in this task repository')
    for p in (index_output,report_output):
        if p is not None and not Path(p).resolve().is_relative_to(ROOT):raise ValueError('XX2X index/report must stay in this task repository')
    catalog=Catalog(source_root)
    source=catalog.path('GameMajorParticle2.txt');text=source.read_bytes().decode('latin1')
    template,match=parse(text)
    template.update(name=NAME,kind='particle',source={**catalog.evidence(source),'byteOffset':match.start(),
        'line':text.count('\n',0,match.start())+1},declarationSha256=digest(match[0].encode('latin1')),textures={})
    files=[]
    for event in template['events']:
        if event['property']!='Texture':continue
        name=event['value'];asset=catalog.path(name)
        relative='fx/textures/'+Path(name).stem+'-'+digest(asset.read_bytes())[:10]+'.png'
        target=output/relative;target.parent.mkdir(parents=True,exist_ok=True)
        image=Image.open(asset).convert('RGBA');image.save(target)
        template['textures'][name]={'file':relative,'width':image.width,'height':image.height,'source':catalog.evidence(asset)}
        files.append(target)
    index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
        'templates':{NAME:template},'sourceFiles':list(catalog.used.values()),'meshFailures':[],'missingTemplates':[],
        'limits':['Original target client unmeasured; resource completeness does not prove native callback equivalence.',
            'Original UseLand/LandPos remain declared; current particle interpreter reports land-plane clamp/bounce unsupported.',
            'GPU blend, billboard particle roll, RNG call ordering and original frame scheduling remain target acceptance items.']}
    artifact=output/'xx2x-fx/index.json';write_json(artifact,index);files.append(artifact)
    if index_output is not None:write_json(Path(index_output),index)
    report={'schemaVersion':1,'targetClientMeasured':False,'fullTargetClientExecuted':False,
        'resourceClosed':True,'runtimeComplete':False,'template':NAME,'declarationSource':template['source'],
        'declarationSha256':template['declarationSha256'],'meshDependencyCount':0,'textures':template['textures'],
        'sourceFiles':index['sourceFiles'],'originalFields':template['fields'],'originalEvents':template['events'],
        'runtimeGaps':index['limits'],'nativePublicationChanged':False,
        'inventory':[{'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())} for p in files]}
    if report_output is not None:write_json(Path(report_output),report)
    print(json.dumps({'resourceClosed':True,'runtimeComplete':False,'templates':1,'textures':len(template['textures']),
        'meshDependencies':0,'output':str(artifact)}))
    return index

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/rf')
    p.add_argument('--index-output',type=Path,default=INDEX)
    p.add_argument('--report-output',type=Path,default=ROOT/'reports/rf-xx2x-particle-assets-v12.json')
    args=p.parse_args();build(args.source_root,args.output,args.index_output,args.report_output)
