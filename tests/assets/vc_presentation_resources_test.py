import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
from vc_presentation_resources import extend, NAMES


class VCPresentationResourcesTest(unittest.TestCase):
    def setUp(self):
        self.source = json.loads((ROOT/'contracts/rf-awakening-fx-index.json').read_text('utf8'))
        self.base = {'schemaVersion': 1, 'referenceVersion': self.source['referenceVersion'],
                     'templates': {}, 'sharedTemplates': [], 'sourceFiles': []}

    def test_actual_source_reuses_two_templates_and_one_texture_without_mutating_inputs(self):
        original = copy.deepcopy(self.source)
        result = extend(self.base, self.source, original)
        self.assertEqual(set(result['templates']), set(NAMES))
        self.assertEqual(len({t['textures']['Energy.dds']['file'] for t in result['templates'].values()}), 1)
        self.assertTrue(all(t['textures']['Energy.dds']['file'].startswith('../rf/') for t in result['templates'].values()))
        self.assertEqual(self.base['templates'], {})
        self.assertEqual(self.source, original)
        self.assertEqual(extend(result, self.source, original), result)

    def test_modified_source_and_conflicting_version_or_template_fail_closed(self):
        broken = copy.deepcopy(self.source)
        broken['templates'][NAMES[0]]['fields']['Lifetime'] = 99
        with self.assertRaisesRegex(ValueError, 'hash-frozen'):
            extend(self.base, broken, self.source)
        broken = copy.deepcopy(self.base)
        broken['referenceVersion'] = 'other'
        with self.assertRaisesRegex(ValueError, 'versions differ'):
            extend(broken, self.source, self.source)
        broken = copy.deepcopy(self.base)
        broken['templates'][NAMES[0]] = {'fake': True}
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            extend(broken, self.source, self.source)


if __name__ == '__main__':
    unittest.main()
