"""Build target2016 Elesis resource closures, audio, skills and original UI."""
import argparse
import json
import sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog, digest, write_json
from build_lk_fx import build as build_fx
from lk_skill_ui import build as build_ui
from build_lk_sword_ui import inspect_picture_groups
from ui import read_tet, crop_piece
import audio

SOURCE = Path('asset_work')
UI = {'gm': ('DLG_UI_Common_Texture76_NEW', 'EL_SGM'),
      'bh': ('DLG_UI_Common_Texture76_NEW', 'EL_SBH'),
      'ca': ('DLG_UI_Common_Texture85_NEW', 'EL_SCA')}
CLASSES = {'gm': 120, 'bh': 121, 'ca': 125}


def shared_indexes(job):
    result = []
    for existing in ('lk', 'rf', 'vc', 'rs', 'bm', 'is', 'gm', 'bh'):
        if existing == job: break
        for path in sorted((ROOT/'artifacts'/existing).glob('*/index.json')):
            if 'templates' in json.loads(path.read_text('utf8')):
                result.append((path, '../'+existing+'/'))
    return result


def build_audio(job):
    profile = ROOT/f'packages/combat-core/{job}-profile.json'
    output = ROOT/'artifacts'/job
    audio.VERSION = 'elesis-audio-target2016-v1'
    reference = json.loads((ROOT/'contracts/elesis-skill-reference-v1.json').read_text('utf8'))
    by_name = {}
    for method in reference['methods']:
        for name in method['literalResources']:
            if name.lower().endswith('.ogg'):
                by_name.setdefault(name, []).append(method['method'])
    contract = ROOT/'contracts/elesis-native-audio-v1.json'
    write_json(contract, {'schemaVersion': 1, 'evidence': 'reference-v5; target triggers unmeasured',
        'source': reference['source'], 'files': [{'name': n, 'sourceMethods': m} for n,m in sorted(by_name.items())],
        'limits': 'Resource closure from fixed source including 2026 reconstruction; original 2016 callback parity is unmeasured.'})
    manifest = audio.build(profile, SOURCE, output/'audio', ROOT/f'reports/{job}-audio.json', contract)
    for row in manifest['files'].values(): row['file'] = '../'+job+'/audio/'+row['file']
    write_json(output/'audio/manifest.json', manifest)


def build(job):
    profile = ROOT/f'packages/combat-core/{job}-profile.json'
    output = ROOT/'artifacts'/job
    build_fx(output/'fx', profile, SOURCE, ROOT/f'contracts/{job}-fx-index.json',
             additional_particle_scripts=('GameMinorParticle.txt',) if job == 'ca' else (),
             shared_indexes=shared_indexes(job))
    atlas, prefix = UI[job]
    build_ui(SOURCE, ROOT/'artifacts/ui/skills'/job, profile, output/'ui',
         profession_id=job, unit_class=CLASSES[job],
        portrait_atlas=atlas, portrait_prefix=prefix, portrait_pieces={'STATE': prefix+'_FACE'})
    build_audio(job)


def common_ui():
    catalog = Catalog(SOURCE)
    def crop(atlas, piece, output):
        ap, tp = catalog.path(atlas+'.tga'), catalog.path(atlas+'.tet')
        with Image.open(ap) as image: cropped, bounds = crop_piece(image.convert('RGBA'), read_tet(tp.read_bytes())[piece])
        output.parent.mkdir(parents=True, exist_ok=True); cropped.save(output)
        return {'file': output.name, 'width': cropped.width, 'height': cropped.height,
                'size': [cropped.width, cropped.height], 'atlas': atlas, 'piece': piece, 'bounds': bounds, 'sha256': digest(output.read_bytes()),
                'rgbaSha256': digest(cropped.tobytes()), 'sources': [catalog.evidence(ap), catalog.evidence(tp)]}
    lobby = ROOT/'artifacts/ui/lobby'
    lobby_manifest = json.loads((lobby/'manifest.json').read_text('utf8'))
    portraits = {}
    for job, (atlas, prefix) in UI.items():
        row = crop(atlas, prefix+'_SMALL', lobby/'portraits'/f'{job}.png')
        row['file'] = 'portraits/'+job+'.png'
        lobby_manifest['portraits'][job.upper()] = portraits[job] = row
    write_json(lobby/'manifest.json', lobby_manifest)
    loading = ROOT/'artifacts/ui/loading'
    avatar = crop('DLG_UI_Common_Texture75_NEW', 'ELESIS_COLOR', loading/'elesis-avatar.png')
    manifest = json.loads((loading/'manifest.json').read_text('utf8'))
    manifest['pieces']['elesis-avatar.png'] = avatar
    manifest['characterAvatars']['elesis'] = {'professions': ['GM','BH','CA'], 'file': 'elesis-avatar.png'}
    write_json(loading/'manifest.json', manifest)
    source_path = catalog.path('DLG_Elesis_WayOfSword.lua')
    groups = inspect_picture_groups(source_path.read_bytes())
    directory = ROOT/'artifacts/ui/elesis-way-of-sword'
    for name, rows in groups.items():
        for ordinal, row in enumerate(rows):
            image = crop(Path(row['atlas']).stem, row['piece'], directory/f'{name}-{ordinal}.png')
            # Color is a source display multiply, applied to pixels as LK does.
            if row['color'] != [1,1,1,1]:
                path = directory/image['file']; rgba = Image.open(path).convert('RGBA')
                rgba = Image.merge('RGBA', tuple(channel.point([int(v*factor+.5) for v in range(256)])
                    for channel, factor in zip(rgba.split(), row['color'])))
                rgba.save(path); image['sha256'] = digest(path.read_bytes())
                image['rgbaSha256'] = digest(rgba.tobytes())
            row.update(image)
    sword = {'schemaVersion': 1, 'evidenceClass': 'target2016-static-pixels-and-layout',
             'targetClientMeasured': False, 'baseUrl': '/assets/ui/elesis-way-of-sword/',
             'sides': {'blue': 'g_pStatic_EL_BLUE', 'red': 'g_pStatic_EL_RED'}, 'groups': groups,
             'sources': list(catalog.used.values()), 'sourceDialog': catalog.evidence(source_path),
             'skillSwordUi': {'sharedIndex': '/assets/ui/skill-sword/index.json',
                'evidence': 'Target DLG_GAME_SKILL_SLOT_NEW has common Static_EL_SKILL_B/R groups; class-specific visibility is a separate consumer'}}
    write_json(directory/'index.json', sword)
    write_json(ROOT/'contracts/elesis-ui-source-v1.json', {'sword': sword, 'portraits': portraits, 'loadingAvatar': avatar})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profession', choices=CLASSES)
    parser.add_argument('--audio-only', action='store_true')
    parser.add_argument('--ui-only', action='store_true')
    args = parser.parse_args()
    if args.ui_only: common_ui()
    else:
        for job in [args.profession] if args.profession else CLASSES:
            build_audio(job) if args.audio_only else build(job)
        if not args.audio_only: common_ui()
