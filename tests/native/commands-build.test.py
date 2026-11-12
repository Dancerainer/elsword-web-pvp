"""Extraction checks use actual pinned source; no original client bytes in Git."""
import hashlib
import importlib.util
import os
import re
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('commands_build',ROOT/'tools/native/commands-build.py')
BUILD = importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(BUILD)
CACHE = Path(os.environ.get('RF_NATIVE_COMMAND_SOURCE_CACHE',ROOT/'.cache/native-reference'))
COMPAT = ROOT/'tools/native/commands-compat.hpp'

@unittest.skipUnless(all((CACHE/name).is_file() for name in BUILD.HASHES),'Pinned original source required')
class CommandsExtraction(unittest.TestCase):
    def test_original_fragment_bytes_unchanged_and_hashed(self):
        output,contract=BUILD.extract(CACHE,COMPAT)
        self.assertEqual(contract['referenceCommit'],BUILD.COMMIT)
        self.assertEqual(len(contract['functions']),50)
        for entry in contract['functions']:
            raw=b''.join((CACHE/entry['file']).read_bytes().splitlines(keepends=True)[entry['startLine']-1:entry['endLine']])
            self.assertEqual(entry['sha256'],hashlib.sha256(raw).hexdigest())
            self.assertEqual(output.count(raw),1,entry['name'])
            if entry['name'].startswith(('DamageAirSmall','RSI_DAMAGE_')):
                # Independently find the definition and brace matching end;
                # do not accept a self-consistent but truncated line selection.
                source=(CACHE/entry['file']).read_bytes()
                declaration=re.compile(rb'(?m)^void CX2GU(?:User|Raven)::'+re.escape(entry['name'].encode())+rb'\s*\(')
                match=declaration.search(source);self.assertIsNotNone(match)
                tokens=re.compile(rb'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{}]',re.DOTALL)
                depth=0;opening=None;end=None
                for token in tokens.finditer(source,match.end()):
                    if token.group()==b'{':
                        if opening is None:opening=token.start()
                        depth+=1
                    elif token.group()==b'}':
                        depth-=1
                        if depth==0:end=token.end();break
                self.assertIsNotNone(end)
                self.assertEqual(raw.rstrip(),source[match.start():end])
        self.assertNotIn(b'// @@',output)
        self.assertEqual(contract['evidenceClass'],'reference-V5-not2016')
        self.assertEqual({m['name'] for m in contract['selectedMacros']},
            {'X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE','RAVEN_SECOND_CLASS_CHANGE','RAVEN_WEAPON_TAKER','SKILL_CANCEL_BY_HYPER_MODE','BALANCE_PATCH_20120329'})

    def test_damaged_original_source_is_rejected_before_generation(self):
        base=ROOT/'.cache/native-command-extraction-tests';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            cache=Path(folder)
            for name in BUILD.HASHES:
                out=cache/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes((CACHE/name).read_bytes())
            raven=cache/'X2Lib/X2GURaven.cpp';raven.write_bytes(raven.read_bytes()+b'\n')
            with self.assertRaisesRegex(ValueError,'Pinned source hash mismatch: X2Lib/X2GURaven.cpp'):
                BUILD.extract(cache,COMPAT)

    def test_damaged_user_start_source_is_rejected(self):
        base=ROOT/'.cache/native-command-extraction-tests';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            cache=Path(folder)
            for name in BUILD.HASHES:
                out=cache/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes((CACHE/name).read_bytes())
            user=cache/'X2Lib/X2GUUser.cpp';user.write_bytes(user.read_bytes().replace(b'const float ADD_Y_SPEED = 700.f;',b'const float ADD_Y_SPEED = 701.f;'))
            with self.assertRaisesRegex(ValueError,'Pinned source hash mismatch: X2Lib/X2GUUser.cpp'):
                BUILD.extract(cache,COMPAT)

if __name__=='__main__':unittest.main()
