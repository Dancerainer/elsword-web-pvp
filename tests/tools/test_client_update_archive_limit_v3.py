"""Exercise the publisher's actual member guard; historical registry guards stay intact."""
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / 'scripts/publish-client-updates.py').read_text(encoding='utf-8')
LINE = next(line.strip() for line in SOURCE.splitlines() if 'member.isfile()' in line)
GUARD = compile(LINE, '<actual publisher archive guard>', 'exec')
NAME = 'a'*64 + '/blobs/' + 'b'*64 + '.gz'

class UpdateArchiveLimit(unittest.TestCase):
    def check(self, size, name=NAME, regular=True):
        exec(GUARD, {'member':SimpleNamespace(size=size,isfile=lambda:regular),'name':name,'re':re})
    def test_exact_100_megabyte_compressed_member_is_admitted(self):
        self.check(100_000_000)
    def test_one_byte_over_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'Invalid update archive'):self.check(100_000_001)
    def test_non_regular_files_and_paths_remain_rejected(self):
        for name, regular in [('../escape',True),(NAME,False),('current.json/escape',True)]:
            with self.subTest(name=name,regular=regular):
                with self.assertRaises(RuntimeError):self.check(1,name,regular)

    def test_actual_fresh_deployment_template_keeps_update_plans_and_files_streaming(self):
        source=(ROOT/'scripts/deploy-cloud.py').read_text(encoding='utf-8')
        start=source.index('def release_templates(')
        namespace={};exec(compile(source[start:source.index('\ndef deploy(',start)],'<actual deployment template>','exec'),namespace)
        unit,nginx=namespace['release_templates']('example.invalid')
        for endpoint in ['plan','file']:
            body=re.search(r'location = /api/client-update/'+endpoint+r' \{([^}]+)\}',nginx).group(1)
            for directive in ['proxy_buffering off;','proxy_cache off;','gzip off;','proxy_read_timeout 3600s;']:
                self.assertIn(directive,body)

if __name__ == '__main__':unittest.main()
