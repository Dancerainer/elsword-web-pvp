"""Add the omitted original PC_D glyph to a task-private manifest overlay.

No font drawing, recoloring, interpolation or upstream/shared output writes.
The coordinating task merges these two output assets into its private snapshot.
"""
from io import BytesIO
from pathlib import Path
import argparse
import hashlib
import json
import struct
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sha = lambda value: hashlib.sha256(value).hexdigest()


def build(source_root, base_manifest, output):
    source_root, base_manifest, output = (Path(p).resolve() for p in (source_root, base_manifest, output))
    runtime = (ROOT / 'runtime').resolve()
    if not output.is_relative_to(runtime) or output == runtime:
        raise ValueError('DP glyph output must be a new private directory inside this task runtime')
    if output.exists():
        raise FileExistsError('Refuse to overwrite an existing glyph overlay')
    contract_path = ROOT / 'contracts/add-dp-popup-v62.json'
    contract_bytes = contract_path.read_bytes()
    contract = json.loads(contract_bytes)
    glyph = contract['glyph']
    source = (source_root / glyph['rawPath']).resolve()
    if not source.is_relative_to(source_root / 'raw'):
        raise ValueError('Original glyph source escaped the explicitly selected raw root')
    raw = source.read_bytes()
    if len(raw) != glyph['bytes'] or sha(raw) != glyph['sha256']:
        raise ValueError('Original PC_D source identity differs')
    if raw[:4] != b'DDS ' or struct.unpack_from('<I', raw, 4)[0] != 124:
        raise ValueError('Invalid original DDS header')
    with Image.open(BytesIO(raw)) as decoded:
        if decoded.format != 'DDS' or decoded.size != (glyph['width'], glyph['height']):
            raise ValueError('Original D glyph format/dimensions differ')
        decoded.load()
        image = decoded.convert('RGBA')
    png = BytesIO()
    image.save(png, format='PNG')
    encoded = png.getvalue()
    with Image.open(BytesIO(encoded)) as roundtrip:
        if roundtrip.convert('RGBA').tobytes() != image.tobytes():
            raise ValueError('PNG conversion altered original D pixels')
    old_bytes = base_manifest.read_bytes()
    manifest = json.loads(old_bytes)
    if 'D' in manifest['glyphs']:
        raise ValueError('Base manifest already has D; select the frozen V61 input')
    record = {'file': 'PC_D.png', 'textureId': glyph['textureId'], 'width': image.width,
        'height': image.height, 'format': 'RGBA', 'rgbaSha256': sha(image.tobytes()),
        'source': {k: glyph[k] for k in ('archive', 'ordinal', 'name', 'rawPath', 'sha256', 'bytes')},
        'sha256': sha(encoded), 'bytes': len(encoded)}
    manifest['glyphs']['D'] = record
    manifest['dpGlyphSource'] = {'contract': 'contracts/add-dp-popup-v62.json',
        'sha256': sha(contract_bytes), 'nativeClientMeasured': False}
    # The remaining glyphs, templates, colors, widths and event clocks are untouched.
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    report = {'schemaVersion': 1, 'scope': 'one original glyph plus complete manifest overlay',
        'source': record['source'], 'baseManifest': {'path': str(base_manifest), 'sha256': sha(old_bytes)},
        'output': str(output), 'assets': {'PC_D.png': {'sha256': sha(encoded), 'bytes': len(encoded)},
            'manifest.json': {'sha256': sha(manifest_bytes), 'bytes': len(manifest_bytes)}},
        'glyph': record, 'oldGlyphsChanged': False, 'templatesChanged': False,
        'stylesChanged': False, 'resourceArithmeticChanged': False,
        'sourceContract': {'path': 'contracts/add-dp-popup-v62.json', 'sha256': sha(contract_bytes)}}
    output.mkdir(parents=True)
    (output / 'PC_D.png').write_bytes(encoded)
    (output / 'manifest.json').write_bytes(manifest_bytes)
    (output / 'overlay-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--base-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source_root, args.base_manifest, args.output), ensure_ascii=False))
