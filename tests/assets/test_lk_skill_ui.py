"""Validate target skill names and reject broken upgrade chains."""
import json
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from lk_skill_ui import display_name

class SkillNameTests(unittest.TestCase):
    def test_source_names_and_declared_parent(self):
        rows = json.loads((ROOT/'packages/combat-core/lk-profile.json').read_text('utf8'))['skillCatalog']
        by_id = {row['skillId']:row for row in rows}
        result = display_name(by_id[21026], by_id)
        self.assertEqual(result['name'], '[Enhanced] Mega Slash')
        self.assertEqual(result['sourceSkillId'], 21026)
        self.assertEqual(result['replacementChain'], [21026,21000])

    def test_invalid_target_chain_is_rejected(self):
        row={'skillId':2,'replacesSkillId':1,'raw':{'m_DeleteSkillIDByUpgrade':3,'m_wstrName':'[Enhanced] Skill'}}
        with self.assertRaisesRegex(ValueError,'differs from target'):display_name(row,{2:row})
        row['raw']['m_DeleteSkillIDByUpgrade']=1
        with self.assertRaisesRegex(ValueError,'Missing target'):display_name(row,{2:row})
        parent={'skillId':1,'replacesSkillId':2,'raw':{'m_DeleteSkillIDByUpgrade':2}}
        with self.assertRaisesRegex(ValueError,'Cyclic'):display_name(row,{1:parent,2:row})


if __name__=='__main__':unittest.main()
