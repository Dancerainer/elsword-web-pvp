"""Extract the original critical sequence, DDS pixels and WAV; inputs read-only."""
from pathlib import Path
import json, struct
from PIL import Image
from build_rf import Catalog,digest,write_json
from build_rf_fx import read_definitions,select_templates

ROOT=Path(__file__).resolve().parents[3]

def inspect_wave(sound):
    if len(sound)<12 or sound[:4]!=b'RIFF' or sound[8:12]!=b'WAVE' or struct.unpack_from('<I',sound,4)[0]+8!=len(sound):
        raise ValueError('Invalid original critical WAV framing')
    cursor=12;chunks={}
    while cursor<len(sound):
        if cursor+8>len(sound):raise ValueError('Truncated WAV chunk')
        tag=sound[cursor:cursor+4];size=struct.unpack_from('<I',sound,cursor+4)[0];end=cursor+8+size
        if end>len(sound) or end+(size&1)>len(sound):raise ValueError('WAV chunk exceeds source')
        if tag in chunks:raise ValueError('Duplicate WAV chunk')
        chunks[tag]=sound[cursor+8:end];cursor=end+(size&1)
    if b'fmt ' not in chunks or b'data' not in chunks or len(chunks[b'fmt '])<16:raise ValueError('Missing WAV format/data')
    encoding,channels,sample_rate,byte_rate,alignment,bits=struct.unpack_from('<HHIIHH',chunks[b'fmt '])
    if encoding!=1 or channels<1 or sample_rate<1 or bits not in (8,16,24,32) or alignment!=channels*bits//8 or byte_rate!=sample_rate*alignment or len(chunks[b'data'])%alignment:
        raise ValueError('Invalid/unsupported PCM WAV format')
    return {'encoding':encoding,'channels':channels,'sampleRate':sample_rate,'byteRate':byte_rate,'blockAlign':alignment,'bitsPerSample':bits}

def build(source_root=Path('asset_work'),output=None):
    output=(output or ROOT/'artifacts/rf/critical-fx').resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source_root.resolve()):
        raise ValueError('Critical output must stay inside task artifacts')
    catalog=Catalog(source_root)
    selected,missing=select_templates(read_definitions(catalog),{'resourceOnlyTemplates':['CriticalHit01']})
    if missing or set(selected)!={'CriticalHit01'}:raise ValueError('Missing original critical template')
    t=selected['CriticalHit01']
    if t['unsupported'] or t['kind']!='particle' or t['fields']['particleType']!='PT_3D_PLANE':
        raise ValueError('Unsupported original critical declaration')
    t['textures']={}
    for event in t['events']:
        if event['property']!='Texture':continue
        name=event['value'];path=catalog.path(name)
        filename='textures/'+Path(name).stem+'-'+digest(path.read_bytes())[:10]+'.png'
        image=Image.open(path).convert('RGBA');(output/filename).parent.mkdir(parents=True,exist_ok=True)
        image.save(output/filename)
        t['textures'][name]={'file':'critical-fx/'+filename,'width':image.width,'height':image.height,'source':catalog.evidence(path)}
    name='Critical_Hit.wav';path=catalog.path(name);sound=path.read_bytes()
    audio={'name':name,'file':'critical-fx/'+name,'sha256':digest(sound),'bytes':len(sound),'source':catalog.evidence(path),
      'format':inspect_wave(sound),
      'evidence':'Original source request X2GUUser.cpp:9230; original WAV copied without transcoding; playback unmeasured'}
    output.mkdir(parents=True,exist_ok=True);(output/name).write_bytes(sound)
    index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
      'templates':selected,'sourceFiles':list(catalog.used.values()),'audio':audio,
      'missingTemplates':[],'meshFailures':[],'limits':['Source trigger compiled from fixed V5; target2016 GPU/render and sound comparison pending.']}
    write_json(output/'index.json',index);write_json(ROOT/'contracts/rf-critical-fx-index-v11.json',index)
    print(json.dumps({'templates':1,'textures':len(t['textures']),'audioFormat':audio['format']}))
    return index

if __name__=='__main__':build()
