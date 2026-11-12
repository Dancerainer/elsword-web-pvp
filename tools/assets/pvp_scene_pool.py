"""Build every packaged PvP scene using the original PvP list and world registry.

Also includes unlisted PvP scene scripts (forest and summer test variants).
Does not execute the original scripts or substitute any map geometry.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from scene_build import Catalog, build, dump, sha, SCENE_ID, DEFAULT_SCENE
from scene_kl import recover, display

ROOT = Path(__file__).resolve().parents[2]


def scene_id(name):
    if name.casefold() == DEFAULT_SCENE.casefold():
        return SCENE_ID
    return re.sub(r'[^a-z0-9]+', '-', Path(name).stem.casefold()).strip('-')


def inventory(source_root):
    catalog = Catalog(source_root)
    pvp = recover(catalog.lookup('PVP_Map_List.lua').read_bytes())['globals']['PVP_MAP_LIST']
    worlds = recover(catalog.lookup('WorldData.lua').read_bytes())
    registry = {}
    for call in worlds['calls']:
        if call['callee'] == 'AddWorldData':
            row = call['arguments'][0]
            key = display(row['worldID'])
            if key in registry and registry[key] != row['dataFileName']:
                raise ValueError('Conflicting world registry: ' + key)
            registry[key] = row['dataFileName']
    maps = {}
    for index, entry in sorted(pvp.items()):
        name = registry[display(entry['m_WorldID'])]
        maps[name.casefold()] = {'sceneId': scene_id(name), 'sourceScene': name,
            'classification': 'original-pvp-list', 'listIndex': index,
            'worldIdSymbol': display(entry['m_WorldID']),
            'displayNameSymbol': display(entry['m_MapName']),
            'thumbnail': {'texture': entry['m_MapTexName'], 'key': entry['m_MapTexKeyName']}}
    # Search every archive, not only data040 or filenames in the UI list.
    candidates = catalog.db.execute("SELECT DISTINCT name FROM assets WHERE bucket='scripts' "
        "AND lower(name) LIKE '%.lua' AND instr(lower(name),'pvp')>0 "
        "AND instr(lower(name),'linemap')=0 ORDER BY name")
    for row in candidates:
        name = row['name']
        if name.casefold() in maps:
            continue
        # NPC, skill and UI scripts contain 'pvp' too. Only actual world scripts
        # that declare SetLineMap are additional scene candidates.
        raw = catalog.lookup(name).read_bytes()
        if b'SetLineMap' not in raw:
            continue
        rec = recover(raw)
        if not any(c['callee'] == 'SetLineMap' for c in rec['calls']):
            continue
        maps[name.casefold()] = {'sceneId': scene_id(name), 'sourceScene': name,
            'classification': 'packaged-unlisted-pvp-variant', 'listIndex': None,
            'worldIdSymbol': None, 'displayNameSymbol': None, 'thumbnail': None}
    entries = list(maps.values())
    if len({e['sceneId'] for e in entries}) != len(entries):
        raise ValueError('Duplicate stable scene ID')
    for entry in entries:
        name = entry['sourceScene']
        rec = recover(catalog.lookup(name).read_bytes())
        line_calls = [c for c in rec['calls'] if c['callee'] == 'SetLineMap']
        if len(line_calls) != 1:
            raise ValueError('Expected exactly one line map: ' + name)
        entry['sourceLineMap'] = line_calls[0]['arguments'][0]
        catalog.lookup(entry['sourceLineMap'])
        entry['declarationSources'] = [catalog.used[n.casefold()] for n in (name, entry['sourceLineMap'])]
    return entries, [catalog.used[n.casefold()] for n in ('PVP_Map_List.lua', 'WorldData.lua')]


def build_pool(source_root, output, report_path):
    source_root, output = source_root.resolve(), output.resolve()
    if output != ROOT / 'artifacts' / 'scene':
        raise ValueError('Pool output must be this worktree artifacts/scene')
    entries, registry_sources = inventory(source_root)
    rows, failures, sources = [], [], {}
    for entry in entries:
        try:
            manifest = build(source_root, output / entry['sceneId'], entry['sourceScene'], entry['sceneId'])
            collision = json.loads((output / entry['sceneId'] / 'collision.json').read_text(encoding='utf-8'))
            for src in manifest['sources']:
                sources[(src['name'].casefold(), src['sha256'])] = src
            row = {**entry, 'manifestUrl': entry['sceneId'] + '/manifest.json',
                'manifestSha256': sha(output / entry['sceneId'] / 'manifest.json'),
                'geometry': manifest['geometry'], 'collision': manifest['collision'],
                'spawnCount': len(collision['spawns']),
                'teamSpawnCount': sum(s['kind'] == 'SetTeamStartPos' for s in collision['spawns']),
                'lineTypes': sorted({line['type'] for line in collision['lines']}),
                'originalClientMeasured': False,
                'conversionGaps': manifest['conversionGaps'], 'textureAliases': manifest['textureAliases'],
                'unsupportedObjectCount': sum('unsupported' in o['conversionStatus'] for o in manifest['objects'])}
            rows.append(row)
            print(json.dumps({'sceneId': entry['sceneId'], 'status': 'converted',
                'lines': row['collision']['lineCount'], 'teamSpawns': row['teamSpawnCount']}, ensure_ascii=False), flush=True)
        except Exception as exc:
            failure = {**entry, 'error': type(exc).__name__ + ': ' + str(exc)}
            failures.append(failure)
            print(json.dumps({'sceneId': entry['sceneId'], 'status': 'failed', 'error': failure['error']}, ensure_ascii=False), flush=True)
    result = {'schemaVersion': 1, 'poolVersion': 'packaged-pvp-scenes-v1', 'defaultSceneId': SCENE_ID,
        'evidence': 'original 2016 declarations/resources; simulation acceptance separate; client unmeasured',
        'originalClientMeasured': False, 'sourceInputsReadOnly': True,
        'registrySources': registry_sources, 'maps': rows, 'failures': failures,
        'converters': [{'path': 'tools/assets/pvp_scene_pool.py', 'sha256': sha(Path(__file__))}],
        'candidateCount': len(entries), 'convertedCount': len(rows),
        'sourceCount': len(sources),
        'unknowns': ['2016 client collision, camera and four-player acceptance pending',
                     'unlisted variants are resource coverage, not proof of official matchmaking eligibility',
                     'fog, world layers, particles, UV scroll and animation native defaults pending']}
    dump(report_path, {**result, 'sources': sorted(sources.values(), key=lambda s: (s['name'].casefold(), s['sha256']))})
    # A failed rebuild must not publish a partial new pool as successful.
    if failures:
        raise ValueError(f'{len(failures)} of {len(entries)} maps failed; see {report_path}')
    dump(output / 'catalog.json', result)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-root', type=Path, default=Path('asset_sources/upstream'))
    ap.add_argument('--output', type=Path, default=ROOT / 'artifacts' / 'scene')
    ap.add_argument('--report', type=Path, default=ROOT / 'reports' / 'pvp-map-pool.json')
    ap.add_argument('--inventory-only', action='store_true')
    args = ap.parse_args()
    if args.inventory_only:
        entries, sources = inventory(args.source_root)
        print(json.dumps({'maps': entries, 'registrySources': sources}, ensure_ascii=False, indent=2))
    else:
        result = build_pool(args.source_root, args.output, args.report)
        print(json.dumps({'convertedCount': result['convertedCount'], 'sourceCount': result['sourceCount']}))


if __name__ == '__main__':
    main()
