"""Read-only, bounded-memory audio binding audit for the twelve shipped professions.

This audits declarations, URL bindings and unchanged original bytes, not audible
playback or original-client execution. Profiles are released between professions;
pose documents are scanned in 1 MiB chunks without decoding matrix arrays.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[2]
JOBS = ('RF', 'LK', 'VC', 'RS', 'BM', 'IS', 'GM', 'BH', 'CA', 'LP', 'MM', 'DE')
SOUND = re.compile(r'[^/\\\x00]+\.(?:ogg|wav)$', re.I)
POSE_SOUND = re.compile(rb'"([^"\\\r\n]{1,240}\.(?:ogg|wav))"', re.I)
BEHAVIOR = ('states', 'damageEffects', 'effectSets', 'effectTemplates', 'skillCatalog',
            'buffTemplates', 'buffFactors', 'summonDeclarations', 'components',
            'sourceLiteralResources', 'resourceOnlyTemplates', 'resourceOnlyEffectSets')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def walk(value, path=''):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, path + '.' + str(key))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from walk(child, path + '[' + str(i) + ']')


def strings(value, path=''):
    return ((at, val) for at, val in walk(value, path)
            if isinstance(val, str) and SOUND.fullmatch(val))


def audit(assets_root, source_root, output, composition='legacy-v60'):
    assets_root, source_root, output = (Path(p).resolve() for p in (assets_root, source_root, output))
    if not output.is_relative_to(ROOT / 'reports') or output.is_relative_to(assets_root):
        raise ValueError('Report must be task-local reports/, never an asset or upstream directory')
    inputs, file_checks, directory_names, issues = {}, {}, {}, []
    physical_audio = defaultdict(list)
    for path in assets_root.rglob('*'):
        if path.is_file() and path.suffix.casefold() in ('.ogg', '.wav'):
            physical_audio[path.name].append(path.relative_to(assets_root).as_posix())
    checked_source, catalog_cache = {}, {}
    catalog_path = source_root / 'catalog.sqlite'
    db = sqlite3.connect(catalog_path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA cache_size=-4096')
    # Only catalog metadata; no archives are opened or unpacked.
    catalog_rows = defaultdict(list)
    for row in db.execute("SELECT archive,ordinal,name,raw_path,sha256,status FROM assets WHERE lower(name) LIKE '%.ogg' OR lower(name) LIKE '%.wav'"):
        catalog_rows[row['name'].casefold()].append(dict(row))

    def document(path, label):
        if path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError('Use the streaming pose scanner for large JSON: ' + label)
        raw = path.read_bytes()
        inputs[label] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        return json.loads(raw)

    def asset_document(relative):
        return document(assets_root / relative, 'assets/' + relative)

    def source_document(relative):
        return document(ROOT / relative, relative)

    def exact_path(base, relative):
        """Detect Linux-sensitive URL casing even while auditing on Windows."""
        parts = PurePosixPath(relative).parts
        if relative.startswith('/') or '\\' in relative or any(p in ('', '..') for p in parts):
            return {'status': 'unsafe-path', 'requested': relative}
        current, actual = base, []
        for part in parts:
            key = str(current)
            if key not in directory_names:
                directory_names[key] = {p.name: p for p in current.iterdir()} if current.is_dir() else {}
            names = directory_names[key]
            if part in names:
                selected = part
            else:
                matches = [name for name in names if name.casefold() == part.casefold()]
                if len(matches) != 1:
                    return {'status': 'missing-file' if not matches else 'ambiguous-case-path', 'requested': relative}
                selected = matches[0]
            actual.append(selected)
            current = names[selected]
        if not current.is_file():
            return {'status': 'missing-file', 'requested': relative}
        actual = '/'.join(actual)
        return {'status': 'ok' if actual == relative else 'url-case-mismatch', 'actual': actual,
                'bytes': current.stat().st_size, 'sha256': cached_digest(current)}

    def cached_digest(path):
        key = str(path)
        if key not in file_checks:
            file_checks[key] = digest(path)
        return file_checks[key]

    def catalog(name):
        if name in catalog_cache:
            return catalog_cache[name]
        rows = catalog_rows.get(name.casefold(), [])
        good = [r for r in rows if r['status'] == 'ok']
        hashes = sorted({r['sha256'].lower() for r in good})
        result = {'status': 'unique-original' if len(hashes) == 1 else 'ambiguous-original' if hashes else 'unavailable-original',
                  'matchingRows': len(rows), 'validRows': len(good), 'uniqueHashes': hashes,
                  'exactCaseNames': sorted({r['name'] for r in good})}
        candidates = []
        for row in sorted(good, key=lambda r: (r['archive'], r['ordinal'])):
            if row['sha256'].lower() in {r['sha256'] for r in candidates}:
                continue
            source = {k: row[k] for k in ('archive', 'ordinal', 'name', 'raw_path', 'sha256')}
            source['sha256'] = source['sha256'].lower()
            if source['raw_path'] not in checked_source:
                resolved = exact_path(source_root, source['raw_path'].replace('\\', '/'))
                checked_source[source['raw_path']] = resolved
            resolved = checked_source[source['raw_path']]
            source['verifiedRaw'] = resolved['status'] == 'ok' and resolved['sha256'] == source['sha256']
            if not source['verifiedRaw']:
                source['rawIssue'] = resolved
            if 'bytes' in resolved:
                source['bytes'] = resolved['bytes']
            candidates.append(source)
        result['candidates'] = candidates
        catalog_cache[name] = result
        return result

    all_bindings = defaultdict(list)

    def layer(manifest, label, profession=None, prefix=None):
        result = {}
        for name, record in manifest.get('files', {}).items():
            file = record.get('file', '')
            if prefix is not None:
                relative = prefix + file
            elif profession and not file.startswith('../'):
                relative = 'audio/../' + profession.lower() + '/' + file
            else:
                relative = 'audio/' + file
            relative = posixpath.normpath(relative)
            actual = exact_path(assets_root, relative)
            item = {'manifest': label, 'file': relative, 'sha256': actual.get('sha256'), 'bytes': actual.get('bytes'),
                    'declaredSha256': record.get('sha256'), 'declaredBytes': record.get('bytes')}
            original = catalog(name)
            reasons = []
            if actual['status'] != 'ok':
                reasons.append(actual['status'])
            if 'sha256' in actual:
                if record.get('sha256') and actual['sha256'] != record['sha256']:
                    reasons.append('manifest-hash-mismatch')
                if isinstance(record.get('bytes'), int) and actual['bytes'] != record['bytes']:
                    reasons.append('manifest-size-mismatch')
                if original['uniqueHashes'] and actual['sha256'] not in original['uniqueHashes']:
                    reasons.append('original-catalog-hash-mismatch')
                source = record.get('source')
                if isinstance(source, dict) and source.get('sha256') and actual['sha256'] != source['sha256']:
                    reasons.append('manifest-source-hash-mismatch')
            if original['status'] != 'unique-original':
                reasons.append(original['status'])
            if any(not row['verifiedRaw'] for row in original['candidates']):
                reasons.append('original-raw-unverified')
            if reasons:
                issues.append({'name': name, **item, 'reasons': reasons, 'actual': actual, 'catalog': original})
            result[name] = item
            all_bindings[name].append(item)
        return result

    common, common_manifests = {}, []
    for path in ('audio/manifest.json', 'audio/pose-v25/manifest.json', 'audio/feedback-v26/manifest.json', 'audio/pvp/manifest.json'):
        m = asset_document(path)
        common.update(layer(m, path))
        common_manifests.append((path, m))
    if (assets_root / 'map-mechanics/index.json').is_file():
        map_audio = asset_document('map-mechanics/index.json').get('audio', {})
        common.update(layer({'files': map_audio}, 'map-mechanics/index.json', prefix='map-mechanics/'))
    shield = asset_document('rf/core-shield-audio/manifest.json')
    shield_bindings = layer(shield, 'rf/core-shield-audio/manifest.json', prefix='rf/core-shield-audio/')
    critical = asset_document('rf/critical-fx/index.json')['audio']
    critical_binding = layer({'files': {critical['name']: critical}}, 'rf/critical-fx/index.json', prefix='rf/')
    composition_evidence = {'mode': composition, 'executed': False}
    if composition == 'roster-v61':
        helper = ROOT / 'apps/web/roster-audio-v61.mjs'
        helper_text = helper.read_text(encoding='utf-8')
        game_text = (ROOT / 'apps/web/game.mjs').read_text(encoding='utf-8')
        for literal in ('AUDIO_SOURCE_CONFIG', 'loadRosterAudio', 'rf/critical-fx/index.json',
                        'rf/core-shield-audio/manifest.json', 'rf/core-shield-audio/'):
            if literal not in helper_text:
                raise ValueError('Roster composition contract changed: ' + literal)
        if not re.search(r"from\s*['\"]\./roster-audio-v61\.mjs['\"]", game_text) or not re.search(r'await\s+loadRosterAudio\(', game_text):
            raise ValueError('Roster helper is not wired into game startup')
        composition_evidence.update({'helper': 'apps/web/roster-audio-v61.mjs', 'sha256': digest(helper),
                                     'verification': 'Explicit static config/loader wiring and asset hashes; helper execution is a separate test'})
    hit_source = source_document('contracts/rf-hit-audio-source-v17.json')['bindings']
    pose_source = source_document('contracts/rf-pose-sounds-v25.json')
    prism = source_document('contracts/add-prism-endpoints-2016.json')
    raven = source_document('contracts/raven-core-attack-sounds-v5.json')
    victims = set()
    for job in JOBS:
        p = source_document('packages/combat-core/' + job.lower() + '-profile.json')
        victims.add(p['components']['HITTED_TYPE'])
        victims.update(state['raw']['HITTED_TYPE_AT_STATE'] for state in p['states'].values()
                       if isinstance(state['raw'].get('HITTED_TYPE_AT_STATE'), int) and state['raw']['HITTED_TYPE_AT_STATE'] != -1)
        del p
    result = {'schemaVersion': 1, 'targetClientMeasured': False, 'browserPlaybackMeasured': False,
              'classification': 'static target declarations, shipped runtime binding composition and original byte hashes',
              'sourceRef': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'runtimeComposition': composition_evidence,
              'assetsRoot': assets_root.relative_to(ROOT).as_posix() if assets_root.is_relative_to(ROOT) else str(assets_root),
              'catalog': {'path': 'catalog.sqlite', 'bytes': catalog_path.stat().st_size, 'sha256': digest(catalog_path), 'readOnly': True},
              'victimTypes': sorted(victims), 'professions': {}, 'integrityIssues': issues,
              'limits': ['Declarations are not proof that a state is reachable or a sound audibly plays.',
                         'Single-profession roster composition; other roster members must not accidentally supply missing bindings.',
                         'Pose documents are bounded-memory string scans, not full JSON semantic validation; shared directories outside each profession are not scanned.',
                         'sourceLiteralResources-only entries are original script literals, not proof of an implemented sound callback. Other declared effects may also be unreachable.',
                         'No full archive unpack, browser, audio decode/listening, or original-client execution.']}
    for job in JOBS:
        profile_path = 'packages/combat-core/' + job.lower() + '-profile.json'
        profile = source_document(profile_path)
        manifest = asset_document(job.lower() + '/manifest.json')
        bindings, refs = dict(common), defaultdict(list)
        local_manifests = []
        if job == 'RF':
            bindings.update(shield_bindings)
            bindings.update(critical_binding)
        if manifest.get('audioManifest'):
            path = job.lower() + '/' + manifest['audioManifest']
            audio = asset_document(path)
            bindings.update(layer(audio, path, job))
            local_manifests.append((path, audio))
        if job == 'MM':
            path = 'mm/summons/apocalypse/manifest.json'
            summon = asset_document(path)
            audio_path = posixpath.normpath('mm/summons/apocalypse/' + summon['audio'])
            audio = asset_document(audio_path)
            bindings.update(layer(audio, audio_path, job))
            local_manifests.append((audio_path, audio))
        if job in ('LP', 'MM', 'DE'):
            bindings.update(layer(prism['audio'], 'contracts/add-prism-endpoints-2016.json#audio', job))
        code_resolved = []
        if composition == 'roster-v61':
            added = {**critical_binding, **(shield_bindings if job in ('RF', 'BM', 'VC') else {})}
            code_resolved = [{'name': name, **record, 'resolvedByCode': 'apps/web/roster-audio-v61.mjs'}
                             for name, record in sorted(added.items()) if name not in bindings]
            # The source files are validated separately; a second roster member
            # is never required to make these bindings available.
            bindings.update(added)

        def add(name, category, origin):
            row = {'category': category, 'origin': origin}
            if row not in refs[name]:
                refs[name].append(row)

        for category in BEHAVIOR:
            for origin, name in strings(profile.get(category, {}), category):
                add(name, category, profile_path + '#' + origin)
        if job == 'RF':
            for origin, name in strings(pose_source['states'], 'states'):
                add(name, 'presentationPose', 'contracts/rf-pose-sounds-v25.json#' + origin)
        if job in ('LP', 'MM', 'DE'):
            for origin, name in strings(prism['scripts'], 'scripts'):
                add(name, 'summonDeclarations', 'contracts/add-prism-endpoints-2016.json#' + origin)
        if job in ('RF', 'BM', 'VC'):
            for entry in raven['files']:
                add(entry['name'], 'referenceCallback', 'contracts/raven-core-attack-sounds-v5.json#' + entry['name'])
            for name in shield['files']:
                add(name, 'runtimeCoreShield', 'apps/web/game.mjs#rfAssets-conditional-shield-audio')
        add('Critical_Hit.wav', 'runtimeCritical', 'apps/web/game.mjs#rfAssets-criticalSoundFile')
        for path, audio in ([common_manifests[0]] if job == 'RF' else local_manifests):
            for entry in (audio.get('referenceTriggers') or {}).get('files', []):
                add(entry['name'], 'referenceCallback', path + '#referenceTriggers')
        # Match the existing resolver: no-sound/sensor guards and exact table fallback.
        no_damage, sensor = hit_source['reactTypes']['RT_NO_DAMAGE'], hit_source['reactTypes']['RT_SENSOR']
        tables = hit_source['damageSoundTables']
        for category in BEHAVIOR:
            for origin, data in walk(profile.get(category, {}), category):
                if not isinstance(data, dict) or not isinstance(data.get('REACT_TYPE'), int):
                    continue
                hit = data.get('HIT_TYPE', 0)
                if not isinstance(hit, int) or hit == -1 or data['REACT_TYPE'] in (no_damage, sensor):
                    continue
                for victim in sorted(victims):
                    table = tables.get(str(hit), {})
                    name = table.get(str(victim)) or table.get('0') or tables.get('0', {}).get('0')
                    if name:
                        add(name, 'acceptedHit', profile_path + '#' + origin + f';hit={hit};victim={victim}')

        # Directories are scanned once per profession, one chunk/file at a time.
        pose_count = pose_bytes = 0
        pose_inventory = hashlib.sha256()
        pose_files = sorted({*list((assets_root / job.lower()).rglob('*.pose.json')),
                             *list((assets_root / job.lower()).rglob('*-pose.json'))})
        for path in pose_files:
            h, tail, found = hashlib.sha256(), b'', set()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
                    found.update(m.decode('utf-8') for m in POSE_SOUND.findall(tail + block))
                    tail = block[-512:]
            rel = path.relative_to(assets_root).as_posix()
            pose_count += 1
            pose_bytes += path.stat().st_size
            pose_inventory.update((rel + '\0' + h.hexdigest() + '\n').encode())
            for name in sorted(found):
                add(name, 'poseLiteral', rel)

        missing, counts = [], Counter()
        for name, origins in sorted(refs.items()):
            for category in {r['category'] for r in origins}:
                counts[category] += 1
            if name in bindings:
                continue
            original = catalog(name)
            alternatives = sorted(n for n in bindings if n.casefold() == name.casefold())
            exported = sorted(physical_audio.get(name, []))
            classification = ('binding-key-case-mismatch' if alternatives else
                              'exported-but-not-bound' if exported else
                              'not-exported' if original['status'] == 'unique-original' else original['status'])
            categories = {r['category'] for r in origins}
            reachability = ('not-established-source-literal-only' if categories == {'sourceLiteralResources'} else
                            'known-runtime-binding' if categories & {'runtimeCoreShield', 'runtimeCritical'} else
                            'static-declaration-trigger-unmeasured')
            behavioral_origins = [r for r in origins if r['category'] != 'sourceLiteralResources']
            unsupported_only = bool(behavioral_origins) and all(
                'SOUND_PLAY_EX' in r['origin'] or 'STATE_SOUND_PLAY' in r['origin'] for r in behavioral_origins)
            consumer = ('source-literal-only' if not behavioral_origins else
                        'unsupported-declaration-field' if unsupported_only else 'supported-consumer-declaration')
            missing.append({'name': name, 'classification': classification, 'runtimeReachability': reachability,
                            'consumerStatus': consumer,
                            'categories': sorted({r['category'] for r in origins}),
                            'originCount': len(origins), 'origins': origins[:8],
                            'originsTruncated': len(origins) > 8, 'catalog': original,
                            'caseInsensitiveBindings': alternatives, 'exportedPaths': exported})
        metadata_only = []
        for path, audio in local_manifests:
            declared = {name for section in ('states', 'effectSounds') for _, name in strings(audio.get(section, {}))}
            metadata_only.extend({'manifest': path, 'name': name, 'classification': 'manifest-declaration-not-in-current-profile-or-known-callbacks'}
                                 for name in sorted(declared - set(refs)))
        result['professions'][job] = {'profile': profile_path, 'runtimeManifestFiles': len(bindings),
                                     'referencedNames': len(refs), 'categories': dict(sorted(counts.items())),
                                     'matchedNames': len(set(refs) & set(bindings)), 'missingBindings': missing,
                                     'runtimeMissingBindings': [m['name'] for m in missing if m['consumerStatus'] == 'supported-consumer-declaration'],
                                     'unimplementedFieldBindings': [m['name'] for m in missing if m['consumerStatus'] == 'unsupported-declaration-field'],
                                     'sourceLiteralPotential': [m['name'] for m in missing if m['consumerStatus'] == 'source-literal-only'],
                                     'repairBindings': [m for m in missing if m['consumerStatus'] != 'source-literal-only'],
                                     'resolvedByCode': code_resolved,
                                     'manifestOnlyDeclarations': metadata_only,
                                     'poseScan': {'files': pose_count, 'bytes': pose_bytes, 'inventorySha256': pose_inventory.hexdigest()},
                                     'declaredUnsupported': [{'manifest': path, 'entries': audio.get('unsupported', [])}
                                                             for path, audio in local_manifests if audio.get('unsupported')]}
        del profile
    # Determine exported-but-unbound after every profession's manifest was read.
    for profession in result['professions'].values():
        for item in profession['missingBindings']:
            item['exportedPaths'] = sorted(physical_audio.get(item['name'], []))
            if item['classification'] == 'not-exported' and item['exportedPaths']:
                item['classification'] = 'exported-but-not-bound'
    result['sameNameConflicts'] = [{'name': name, 'bindings': rows} for name, rows in sorted(all_bindings.items())
                                 if len({r['sha256'] for r in rows}) > 1]
    for relative in ('tools/assets/audit-profession-audio-v61.py', 'apps/web/game.mjs', 'apps/web/battle-audio.mjs',
                     'apps/web/load-profession-assets.mjs', 'apps/web/pose-audio.mjs',
                     'packages/combat-assets/add-summon-assets.mjs', 'packages/combat-core/hit-audio.mjs'):
        path = ROOT / relative
        inputs[relative] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    if composition == 'roster-v61':
        helper = ROOT / 'apps/web/roster-audio-v61.mjs'
        inputs['apps/web/roster-audio-v61.mjs'] = {'bytes': helper.stat().st_size, 'sha256': digest(helper)}
    result['inputs'] = inputs
    result['summary'] = {'professions': len(result['professions']), 'missingBindings': sum(len(p['missingBindings']) for p in result['professions'].values()),
                         'uniqueMissingNames': len({m['name'] for p in result['professions'].values() for m in p['missingBindings']}),
                         'sourceLiteralOnlyMissingBindings': sum(m['runtimeReachability'] == 'not-established-source-literal-only'
                                                               for p in result['professions'].values() for m in p['missingBindings']),
                         'supportedConsumerMissingBindings': sum(len(p['runtimeMissingBindings']) for p in result['professions'].values()),
                         'unimplementedFieldBindings': sum(len(p['unimplementedFieldBindings']) for p in result['professions'].values()),
                         'resolvedByCode': sum(len(p['resolvedByCode']) for p in result['professions'].values()),
                         'repairBindings': sum(len(p['repairBindings']) for p in result['professions'].values()),
                         'integrityIssues': len(issues), 'sameNameConflicts': len(result['sameNameConflicts']),
                         'verifiedDistinctFiles': len(file_checks), 'queriedOriginalNames': len(catalog_cache),
                         'originalRawFiles': len(checked_source)}
    db.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    return result['summary']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets-root', default=ROOT / 'artifacts', type=Path)
    parser.add_argument('--source-root', default=Path('asset_work'), type=Path)
    parser.add_argument('--output', default=ROOT / 'reports/audio-v61-resource-audit.json', type=Path)
    parser.add_argument('--composition', choices=('legacy-v60', 'roster-v61'), default='legacy-v60')
    args = parser.parse_args()
    print(json.dumps(audit(args.assets_root, args.source_root, args.output, args.composition), ensure_ascii=False))
