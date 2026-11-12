"""Extract the English buff strings referenced by the target profiles."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_strings(data):
    if not data.startswith(b'\xff\xfe'):
        raise ValueError('Expected a UTF-16 LE ESS file')
    rows = {}
    for line in data[2:].decode('utf-16le').splitlines():
        if line:
            key, value = ''.join(chr(ord(c) ^ 16) for c in line).split('\t', 1)
            if not key.isdecimal() or key in rows:
                raise ValueError('Duplicate or invalid ESS string ID')
            rows[key] = value
    return rows


def build(source):
    proof = ROOT / 'contracts/buff-display-source-v26.json'
    data = source.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != json.loads(proof.read_text('utf8'))['targetGeneralSha256']:
        raise ValueError('Source differs from the pinned 2016 NA General.ess')
    strings = read_strings(data)
    profiles = {}
    bindings = []
    for path in sorted((ROOT / 'packages/combat-core').glob('*-profile.json')):
        profile = json.loads(path.read_text('utf8'))
        profession = path.name.split('-')[0].upper()
        rows = {}
        profiles[profession] = rows
        for buff_id, buff in profile['buffTemplates'].items():
            fields = {}
            for field, output in [('BUFF_NAME', 'name'), ('BUFF_DESC', 'description')]:
                ref = buff['raw'].get(field)
                if not isinstance(ref, dict):
                    continue
                match = re.fullmatch(r'STR_ID_(\d+)', ref.get('$symbol', ''))
                if not match:
                    continue
                value = re.sub(r'#C[0-9a-fA-F]{6}|#CX', '', strings.get(match[1], '')).strip().replace(r'\n','\n')
                if not value or re.search(r'@\d|%[dsf]', value):
                    continue
                fields[output] = value
                bindings.append(dict(profession=profession, buff=buff_id, field=field, stringId=int(match[1])))
            if fields:
                rows[buff_id] = fields
    def save(path, value):
        path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf8', newline='\n')
    save(ROOT / 'packages/localization/buff-display-v26.json', {'locale':'en', 'profiles':profiles})
    save(proof, {'targetGeneralSha256':digest, 'rows':bindings})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Read-only extracted 2016 NA General.ess')
    build(parser.parse_args().source)
