"""Reuse the already verified common Raven minor aura in the VC FX closure.

The ordinary major-script closure cannot discover a compiled callback's minor
particle names. No DDS/PNG/model bytes are copied or regenerated here.
"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ('HyperBoostRightBlack', 'HyperBoostLeftBlack')


def extend(index, source, frozen, prefix='../rf/', evidence_contract='contracts/vc-presentation-source-v3.json'):
    if any(doc.get('schemaVersion') != 1 for doc in (index, source, frozen)):
        raise ValueError('Original versioned particle indexes required')
    if len({doc.get('referenceVersion') for doc in (index, source, frozen)}) != 1:
        raise ValueError('Aura target versions differ')
    result = copy.deepcopy(index)
    shared = result.setdefault('sharedTemplates', [])
    for name in NAMES:
        original = source['templates'].get(name)
        if original is None or original != frozen['templates'].get(name):
            raise ValueError('Shared Raven aura differs from hash-frozen original declaration: '+name)
        record = copy.deepcopy(original)
        for texture in record['textures'].values():
            if not texture.get('file') or texture['file'].startswith(('/', '../')):
                raise ValueError('Expected source-local verified Raven texture')
            texture['file'] = prefix + texture['file']
        record['sharedResourceEvidence'] = {
            'index': 'artifacts/rf/awakening-fx/index.json',
            'declarationSha256': original['declarationSha256'],
        }
        previous = result['templates'].get(name)
        if previous is not None and previous != record:
            raise ValueError('Conflicting VC aura declaration: '+name)
        result['templates'][name] = record
        if name not in shared:
            shared.append(name)
    files = {row['rawPath']: row for row in result.get('sourceFiles', [])}
    for row in source.get('sourceFiles', []):
        if row['rawPath'] in files and files[row['rawPath']] != row:
            raise ValueError('Conflicting original aura source identity')
        files[row['rawPath']] = copy.deepcopy(row)
    result['sourceFiles'] = list(files.values())
    result['presentationRoots'] = list(NAMES)
    result['presentationRootsEvidence'] = evidence_contract
    result['missingTemplates'] = [name for name in result.get('missingTemplates', []) if name not in NAMES]
    return result


def add_vc_presentation_resources(output=ROOT/'artifacts/vc'):
    read = lambda p: json.loads(p.read_text('utf8'))
    index = extend(read(output/'fx/index.json'), read(ROOT/'artifacts/rf/awakening-fx/index.json'),
                   read(ROOT/'contracts/rf-awakening-fx-index.json'))
    text = json.dumps(index, ensure_ascii=False, indent=2)+'\n'
    (output/'fx/index.json').write_text(text, encoding='utf8')
    (ROOT/'contracts/vc-fx-index.json').write_text(text, encoding='utf8')
    return index


if __name__ == '__main__':
    index = add_vc_presentation_resources()
    # Existing local runtime refresh only. Do not rebuild or overwrite combat
    # profiles/animation conversion while sibling implementation work is live.
    from pack_vc_runtime import pack
    reuse = pack()
    path = ROOT/'reports/vc-assets-runtime.json'
    report = json.loads(path.read_text('utf8'))
    report['outputs'] = reuse['outputs']
    report['summary'].update(files=reuse['runtimeFiles'], bytes=reuse['runtimeBytes'],
                             fxTemplates=len(index['templates']),
                             fxTextures=len({r['file'] for t in index['templates'].values() for r in t['textures'].values()}))
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'addedSharedMinorTemplates': list(NAMES), 'templates': len(index['templates']),
                      'newTextures': 0, 'newModels': 0}))
