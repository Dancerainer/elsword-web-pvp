"""Owned manifest fixtures verify bounded rebuild publication history."""
from pathlib import Path
import copy
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_builder', ROOT/'tools/native/build_runtime.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class PublicationHistoryTests(unittest.TestCase):
    def setUp(self):
        self.old = {'modules': {'skills': {'sha256': '1'*64}, 'mana-break': {'sha256': '2'*64}},
                    'seal': {'manifestContentSha256': '3'*64,
                             'republishHistory': [{'reason': 'independent recovery source refresh'}],
                             'moduleAdditionHistory': [{'module': 'mana-break'}]}}
        self.new = copy.deepcopy(self.old)
        self.new['modules']['skills']['sha256'] = '4'*64
        self.new['seal'] = {'manifestContentSha256': '5'*64}

    def test_history_survives_rebuild_and_an_unchanged_rebuild_does_not_duplicate_it(self):
        result = tool.retain_rebuild_history(self.old, self.new, 'skills')
        self.assertEqual(result['seal']['republishHistory'], self.old['seal']['republishHistory'])
        self.assertEqual(result['seal']['moduleAdditionHistory'], self.old['seal']['moduleAdditionHistory'])
        self.assertEqual(result['seal']['boundedRebuildHistory'][0]['previousSha256'], '1'*64)
        self.assertEqual(tool.retain_rebuild_history(result, result, 'skills'), result)
        result['seal']['republishHistory'][0]['reason'] = 'changed fixture'
        self.assertNotEqual(result['seal']['republishHistory'], self.old['seal']['republishHistory'])

    def test_unrelated_module_change_or_removal_is_rejected(self):
        self.new['modules']['mana-break']['sha256'] = '6'*64
        with self.assertRaisesRegex(ValueError, 'retained module'):
            tool.retain_rebuild_history(self.old, self.new, 'skills')
        del self.new['modules']['mana-break']
        with self.assertRaisesRegex(ValueError, 'inventory'):
            tool.retain_rebuild_history(self.old, self.new, 'skills')


if __name__ == '__main__':
    unittest.main()
