"""Actual mutation resource delta and Countdown trace non-emission evidence."""
import json,re,sys,unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import digest
from build_rf_fx import declaration
read=lambda p:json.loads(p.read_text('utf8'))
class MutationResources(unittest.TestCase):
    def test_single_template_keeps_source_and_four_runtime_files_close(self):
        index=read(ROOT/'contracts/mm-mutation-fx-index-v1.json');self.assertEqual(list(index['templates']),['ADD_Countdown_Bomb_Trace_Mutation'])
        t=index['templates']['ADD_Countdown_Bomb_Trace_Mutation'];source=Path('asset_work')/t['source']['rawPath'];raw=source.read_bytes()
        self.assertEqual(digest(raw),t['source']['sha256']);text=raw.decode('latin1')
        match=re.search(r'TEMPLET\s+"ADD_Countdown_Bomb_Trace_Mutation"\s*\{([^{}]*)\}',text)
        expected=declaration(match[1]);self.assertEqual(t['fields'],expected['fields']);self.assertEqual(t['events'],expected['events'])
        self.assertEqual(t['fields']['DrawCount'],0);self.assertNotIn('UseSlashTrace',t['fields'])
        texture=t['textures']['AN_Formation_TRACE.tga'];original=Path('asset_work')/texture['source']['rawPath']
        self.assertEqual(Image.open(original).convert('RGBA').tobytes(),Image.open(ROOT/'artifacts/mm'/texture['file']).convert('RGBA').tobytes())
        receipt=read(ROOT/'reports/mm-mutation-assets-handoff-v1.json');self.assertEqual(len(receipt['files']),4)
        for row in receipt['files']:
            p=ROOT/'artifacts'/row['file'];self.assertEqual(digest(p.read_bytes()),row['sha256']);self.assertEqual(p.stat().st_size,row['bytes'])
        self.assertEqual(index['meshFailures'],[]);self.assertEqual(index['missingTemplates'],[])
    def test_declared_trace_has_no_original_endpoint_and_always_bones_are_closed(self):
        report=read(ROOT/'reports/mm-countdown-trace-source-v1.json');self.assertEqual(report['meshFrames'],['Scene_Root','Dummy01','ATTACK_SPHERE1'])
        for row in report['fixedReference']:
            raw=Path(row['path']).read_bytes();self.assertEqual(digest(raw),row['sha256']);lines=raw.splitlines(keepends=True)
            for f in row['fragments']:self.assertEqual(digest(b''.join(lines[f['start']-1:f['end']])),f['sha256'])
        bones=read(ROOT/'reports/mm-apocalypse-always-bones-v1.json');self.assertEqual(len(bones['boneBindings']),38);self.assertEqual(bones['missingBones'],[])
        templates={**read(ROOT/'artifacts/mm/fx/index.json')['templates'],**read(ROOT/'artifacts/mm/summons/apocalypse/fx/index.json')['templates']}
        self.assertTrue(all(r['name']in templates for r in bones['boneBindings']))
if __name__=='__main__':unittest.main()
