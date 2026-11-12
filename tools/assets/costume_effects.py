"""Costume visual closure: target KIM attachments, qualified V5 render consumers.

No added light, generated wing texture, or invented particle declaration.
"""
import copy
import json
import re
from pathlib import Path
from PIL import Image
from build_rf import build_effect, write_json, digest
from build_rf_fx import declaration

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT/'.cache/costume-source-v1'


def render_profile(item_id, attached=False):
    # KTDGXRenderer.h:162..168, X2Eqip.cpp:592..610, 3107..3171;
    # X2Define.h ALL_ALPHA_ACCESSARY / ATTACHED_SKIN_MESH_FOR_ATTACH_ANIM.
    profile = dict(realColor=False, blend=False, sourceBlend='D3DBLEND_SRCALPHA',
        destBlend='D3DBLEND_INVSRCALPHA', cull='back', depthWrite=True, alphaTest=False,
        evidence='fixed-V5-consumer-reference; target2016 GPU unmeasured')
    if item_id in (131835, 131841):
        profile.update(realColor=True, blend=True, destBlend='D3DBLEND_DESTALPHA', cull='none', depthWrite=False)
    elif attached:
        profile.update(realColor=True, blend=True, destBlend='D3DBLEND_DESTALPHA')
        if item_id in (130892, 130895, 131646, 131649):
            profile.update(destBlend='D3DBLEND_INVSRCALPHA', alphaTest=True)
        elif item_id in (88402, 88405):
            profile.update(cull='none', depthWrite=False)
    elif item_id in (132763, 132766):
        profile['blend'] = True
    return profile


def write_attachment_request(catalog, contract):
    sources = {}
    for item in contract['items'].values():
        for row in item['attachedMeshes']:
            if row['jiggle']:
                raise ValueError('Unsupported attached jiggle mesh')
            try:
                path = catalog.path(row['name'])
            except FileNotFoundError:
                # These exact two references are dangling in the frozen NA2016
                # catalog. Report the gap; do not substitute another era/model.
                if (item['itemId'], row['name']) not in {
                    (132546, 'Mesh_Elsword_Event_Weapon09Effect_Sorted.x'),
                    (132564, 'Mesh_Raven_Event_Weapon09Effect_Sorted.x')}:
                    raise
                row['unsupported'] = 'Referenced mesh absent from target2016 catalog'
                continue
            source = catalog.evidence(path)
            row['source'] = source
            if path.read_bytes()[:4] == b'xof ':
                sources[source['sha256']] = {'source':str(path), 'sourceSha256':source['sha256'], 'sourceBytes':source['bytes']}
    receipt = ROOT/'reports/costume-effects-d3dx-execution-v2.json'
    if receipt.exists():
        for trace in json.loads(receipt.read_bytes())['traces']:
            source = sources.get(trace.get('sourceSha256'))
            if source is not None and 'hresult' in trace:
                source.update(actualLoaderHresult=trace['hresult'], nativeAnimations=[
                    {key:a[key] for key in ('index','name','period','ticksPerSecond','playbackType')}
                    for a in trace.get('animations',[])])
    write_json(ROOT/'reports/costume-effects-d3dx-sources-v2.json', {
        'schema':'elsword.native-d3dx-source-request.v1',
        'dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'scope':'All selected KIM additional meshes; static OpenXMesh and animated SubEquip distinguished by consumer',
        'sources':list(sources.values())})
    references = []
    for name in ['X2Eqip.cpp', 'X2SubEquip.cpp', 'X2Define.h', 'KTDGXRenderer.h']:
        raw = (REFERENCE/name).read_bytes()
        references.append({'name':name, 'sha256':digest(raw)})
    # Validate the special categories against the fixed reference, not names.
    header = (REFERENCE/'X2Define.h').read_bytes().decode('latin1')
    for category, expected in [('ALL_ALPHA_ACCESSARY_ITEM_ID', {131835,131841}),
                               ('ATTACHED_SKIN_MESH_FOR_ATTACH_ANIM', {88402,88405})]:
        match = re.search(r'\b'+category+r'\[\]\s*=\s*\{(.*?)\}', header, re.S)
        found = set(map(int, re.findall(r'\b\d+\b', re.sub(r'//[^\n]*', '', match[1]))))
        if found.intersection(map(int, contract['items'])) != expected:
            raise ValueError('Changed costume render consumer category '+category)
    contract['visualConsumerV2'] = {'references':references,
        'attachmentOffsets':{'particles':164,'meshes':168},
        'evidenceClass':'target2016 records plus fixed-V5 consumers; no full-client execution'}


def build_attachment(catalog, destination, item, attached, owner):
    animated = item['itemId'] in (88402,88405) or item['useType'] == 1
    profile = render_profile(item['itemId'], attached=True)
    result = build_effect(catalog, destination/'effects', attached['name'],
        render_profile=profile, static_mesh=not animated)
    if not result['glb'] or result['unsupportedPoseTracks'] or len(result['animations']) > 1:
        raise ValueError('Incomplete original costume attachment '+attached['name'])
    bone = 'Costume_SwordMount' if owner == 'body' and item['useType'] != 1 else attached['bone']
    return {'itemId':item['itemId'], 'owner':owner, 'bone':bone, 'sourceBone':attached['bone'],
        'name':attached['name'], 'animated':animated, 'normal':{
            'glb':result['glb'], 'poseData':result['poseData'], 'animations':result['animations'], 'renderProfile':profile}}


def build_particles(catalog, contract, output):
    # Equipment uses UI major explicitly. GameMajorParticle20 contains a
    # same-named sequence with DIFFERENT depth flags; never pick by name alone.
    path = catalog.path('UIMajorParticle.txt'); text = path.read_bytes().decode('latin1')
    templates = {}
    names = {r['name'] for item in contract['items'].values() for r in item['attachedParticles']}
    for name in sorted(names):
        matches = list(re.finditer(r'eventsequence\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}', text))
        if len(matches) != 1:
            raise ValueError('Ambiguous UI equipment particle '+name)
        match = matches[0]; row = declaration(match[1], casefold_tokens=True)
        if row['unsupported'] or row['fields'].get('particleType') != 'PT_3D_PLANE':
            raise ValueError('Unsupported equipment particle '+name)
        row.update(name='costume:'+name, kind='particle', sourceFamily='ui-major', textures={},
            source={**catalog.evidence(path), 'byteOffset':match.start()}, declarationSha256=digest(match[0].encode('latin1')))
        for texture in {e['value'] for e in row['events'] if e['property']=='Texture'}:
            original = catalog.path(texture); file = 'particles/'+original.stem+'.png'
            (output/'particles').mkdir(exist_ok=True)
            with Image.open(original) as image:
                image.convert('RGBA').save(output/file)
                row['textures'][texture] = {'file':'../costumes/'+file, 'source':catalog.evidence(original),
                    'width':image.width, 'height':image.height}
        templates[row['name']] = row
    write_json(output/'particles.json', {'schemaVersion':1, 'templates':templates})
    return 'particles.json'
