"""Original files/static consumers remain independent from gameplay traces."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
sys.path.insert(0, str(ROOT / 'tools/native'))
import audit_rf_awakened_skills_v17 as audit
import check_skill_wasm_reproducibility_v17 as repro

class AwakenedSkillSourceTests(unittest.TestCase):
    def test_fresh_original_declarations_and_callbacks_equal_independent_report(self):
        actual = audit.audit(Path('asset_work/raw/data/data036.kom'), ROOT / '.cache/native-skills-source')
        retained = json.loads((ROOT / 'reports/rf-awakened-skills-source-v17.json').read_text('utf8'))
        self.assertEqual(actual, retained)
        self.assertEqual(sum(len(row['branchArrays']) for row in actual['skills']), 36)
        self.assertEqual(len(actual['skills']), 20)
        self.assertEqual(actual['targetClientMeasured'], 0)

    def test_rebuilt70_complete_methods_and_all_reference_spans_keep_exact_original_bytes(self):
        old = json.loads((ROOT / '.cache/native-skills-generated/source-contract.json').read_text('utf8'))
        new = json.loads((ROOT / '.cache/native-awakened-skills-v17/source-contract.json').read_text('utf8'))
        self.assertEqual(old['functions'], new['functions'])
        self.assertEqual(old['extraFunctions'], new['extraFunctions'])
        self.assertEqual(len(new['functions']) + len(new['extraFunctions']), 70)
        self.assertEqual(new['callbackGroupIds'], list(range(1, 70)))
        contract = json.loads((ROOT / 'contracts/rf-awakened-skills-source-v17.json').read_text('utf8'))
        for span in contract['sourceSpans']:
            raw = (ROOT / '.cache/native-source-runtime' / span['file']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), span['sourceFileSha256'])
            fragment = b''.join(raw.splitlines(keepends=True)[span['startLine'] - 1:span['endLine']])
            self.assertEqual(hashlib.sha256(fragment).hexdigest(), span['fragmentSha256'])

    def test_g0_rebuild_is_raw_equal_across_input_directories_and_keeps_execution_data(self):
        old = ROOT / '.cache/native-awakened-skills-v17-before-g0'
        new = ROOT / '.cache/native-awakened-skills-v17'
        other = ROOT / '.cache/native-awakened-skills-v17-independent-g0'
        actual = repro.verify((old / 'skills.wasm').read_bytes(), (old / 'root-default-debug-skills.wasm').read_bytes(),
                              (new / 'skills.wasm').read_bytes(), (other / 'skills.wasm').read_bytes())
        retained = json.loads((ROOT / 'reports/rf-skills-wasm-reproducibility-v17.json').read_text('utf8'))
        self.assertEqual(actual, retained)
        self.assertTrue(actual['canonicalRawBytesEqual'])
        self.assertTrue(actual['executionDataNameAndTargetFeaturesUnchanged'])
        self.assertEqual(actual['canonicalFlagChange'], ['-g0'])

    def test_parser_handles_quoted_braces_and_fails_closed_on_damaged_source(self):
        valid = b'void CX2GURaven::Probe(){ char c=\'}\'; const char* s="{"; /* } */ if(c){ f(); } // {\n}'
        self.assertEqual(audit.fragment(valid, 'Probe')[0], valid)
        for invalid in [b'', valid[:-1], valid + valid]:
            with self.assertRaises(ValueError):
                audit.fragment(invalid, 'Probe')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'Enum.lua').write_bytes(b'authored damaged KL header')
            with self.assertRaisesRegex(ValueError, 'Target source hash drift'):
                audit.read_target(path)
        for malformed in [b'', b'\0asm\x01\0\0\0\x01\x04\0', b'\0asm\x01\0\0\0\x01\xff\xff\xff\xff\xff\x00']:
            with self.assertRaises(ValueError):
                repro.sections(malformed)

if __name__ == '__main__':
    unittest.main()
