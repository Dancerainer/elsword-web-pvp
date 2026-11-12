"""Restore LK skill/trait/buff target declarations from read-only catalog bytes.

No Lua or native callback is executed. Unresolved symbols remain explicit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

from kl82_static import read_declarations

NAMES = {
    'enum': 'Enum.lua', 'elsword': 'Elsword_SwordMan.lua',
    'skill': 'NewSkillTempletVer2.lua', 'damage': 'DamageEffect.lua',
    'effect': 'EffectSet.lua', 'skill-data': 'SkillData.lua',
    'skill-note': 'SkillNoteTemplet.lua', 'buff-factor': 'BattleFieldBuffFactor.lua',
    'buff-factor-int': 'BattleFieldBuffFactor_INT.lua',
    'battle-buff': 'BattleFieldBuffTemplet.lua',
    'way-of-sword': 'WayOfSword.lua',
}


class EnumTable(dict):
    """Distinguish a missing enum member from a literal Lua nil.

    The static reader uses dict.get for TGETS. A stock dict discarded the
    missing BFI_BUFF_RF_ENCHANT_HAND reference as None. Only the input enum
    namespace gets this wrapper; actual declaration tables retain Lua nil.
    """
    def __init__(self, values, prefix=''):
        super().__init__({k: EnumTable(v, prefix + str(k) + '.') if isinstance(v, dict) else v
                          for k, v in values.items()})
        self.prefix = prefix

    def get(self, key, default=None):
        if key in self:
            return super().get(key)
        if not self.prefix:
            return default
        return {'$symbol': self.prefix + str(key), '$unsupported': 'target enum member absent'}


def prepare(source, output, names=None, unit_keys=('elsword',)):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.is_relative_to(source):
        raise ValueError('Output must stay outside original extracted assets')
    with sqlite3.connect((source / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True) as catalog:
        prior = None
        output.mkdir(parents=True, exist_ok=True)
        for key, name in (NAMES if names is None else names).items():
            rows = list(catalog.execute('SELECT raw_path,sha256 FROM assets WHERE status=? AND name=? COLLATE NOCASE', ('ok', name)))
            if not rows or len({r[1] for r in rows}) != 1:
                raise ValueError('Missing or ambiguous target script: ' + name)
            path = (source / rows[0][0]).resolve()
            if not path.is_relative_to(source / 'raw') or hashlib.sha256(path.read_bytes()).hexdigest() != rows[0][1]:
                raise ValueError('Original byte hash/path mismatch: ' + name)
            value = read_declarations(path, prior, capture_calls=key not in unit_keys, capture_unresolved=True)
            (output / (key + '-declarations.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')
            if key == 'enum':
                prior = EnumTable(value['globals'])
            print(json.dumps({'file': name, 'sha256': rows[0][1], 'calls': len(value.get('nativeCalls', []))}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source_root, args.output)
