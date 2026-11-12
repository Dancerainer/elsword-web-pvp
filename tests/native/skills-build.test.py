import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('skill_callbacks',ROOT/'tools/native/build_skill_callbacks.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

# Scan the pinned bytes independently of extract() and its reported byte lengths.
# Quoted braces (including character literals), comments and non-void return types
# must not change the definition's actual source range.
CPP_TOKENS=re.compile(rb'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{}]',re.DOTALL)

def original_definition(source,name,class_name='CX2GURaven'):
    declaration=re.compile(rb'(?m)^[ \t]*(?:/\*[^\r\n]*?\*/[ \t]*)*(?P<definition>[A-Za-z_][\w:<>,*& \t]*\s+'+class_name.encode()+rb'::'+
                           re.escape(name.encode())+rb'\s*\()')
    matches=list(declaration.finditer(source))
    if len(matches)!=1:raise AssertionError('Expected one original definition: '+name)
    start=matches[0].start('definition')
    opening=None;stack=[]
    for token in CPP_TOKENS.finditer(source,matches[0].end()):
        if token.group()==b'{':
            if opening is None:opening=token.start()
            stack.append(token.start())
        elif token.group()==b'}':
            if not stack:raise AssertionError('Unbalanced original definition: '+name)
            stack.pop()
            if not stack:
                end=token.end()
                return start,opening,end
    raise AssertionError('Unterminated original definition: '+name)

class OriginalExtractionTests(unittest.TestCase):
    def test_new_skill_and_lock_on_functions_are_independent_original_ranges(self):
        report=json.loads((ROOT/'.cache/native-skills-generated/source-contract.json').read_text('utf8'))
        self.assertEqual(len(report['extraFunctions']),7)
        for row in report['extraFunctions']:
            if row['file'].endswith('X2DamageEffect.cpp'):
                path=ROOT/'.cache/native-source-runtime'/row['file'];name='VectorLockOn';class_name='CX2DamageEffect::CEffect'
            else:
                path=ROOT/('.cache/reference-combat-fixes-v11/X2GURaven.cpp' if row['sourceCommit']==builder.REPAIRED_COMMIT else '.cache/native-source-runtime/X2Lib/X2GURaven.cpp')
                name=row['name'];class_name='CX2GURaven'
            raw=path.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sourceFileSha256'])
            start,opening,end=original_definition(raw,name,class_name)
            self.assertEqual(hashlib.sha256(raw[start:end]).hexdigest(),row['sha256'])
            self.assertEqual(hashlib.sha256(raw[opening:end]).hexdigest(),row['bodySha256'])
            self.assertEqual(row['bytes'],end-start)
    def test_actual_pinned_methods_are_exact_original_byte_ranges(self):
        data=(ROOT/'.cache/native-source-runtime/X2Lib/X2GURaven.cpp').read_bytes()
        provenance=json.loads((ROOT/'contracts/rf-full-skill-source.json').read_text('utf-8'))
        original=next(row for row in provenance['referenceFiles'] if row['relativePath']=='X2Lib/X2GURaven.cpp')
        self.assertEqual(len(data),original['bytes'])
        self.assertEqual(hashlib.sha256(data).hexdigest(),original['sha256'])
        fragments,records=builder.extract(data)
        names=builder.FUNCTIONS+builder.ARC_HELPERS+builder.SHADOW_FUNCTIONS+builder.DRILL_FUNCTIONS+builder.MOTION_FUNCTIONS+builder.XCRASH_FUNCTIONS+['RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove']
        self.assertEqual(len(names),len(set(names)))
        self.assertEqual([row['name'] for row in records],names)
        expected_fragments=[]
        for row in records:
            with self.subTest(method=row['name']):
                start,opening,end=original_definition(data,row['name'])
                exact=data[start:end]
                expected_fragments.append(exact)
                self.assertEqual(row['file'],'X2Lib/X2GURaven.cpp')
                self.assertEqual(row['startLine'],data.count(b'\n',0,start)+1)
                self.assertEqual(row['endLine'],data.count(b'\n',0,end)+1)
                self.assertEqual(row['bytes'],len(exact))
                self.assertEqual(row['sha256'],hashlib.sha256(exact).hexdigest())
                self.assertEqual(row['bodySha256'],hashlib.sha256(data[opening:end]).hexdigest())
        self.assertEqual(fragments,b'\n\n'.join(expected_fragments)+b'\n')
        # The build report is an additional consistency check, not the oracle.
        report=json.loads((ROOT/'.cache/native-archenemy-skills-v19/source-contract.json').read_text('utf-8'))
        self.assertEqual(records,report['functions'])

    def test_independent_source_ranges_include_short_nonvoid_and_parameterized_methods(self):
        short=b'bool CX2GURaven::HasShadowStep()\r\n{ return true; }'
        parameterized=(b'void CX2GURaven::SetShadowStepAttackSkill(int state /* } */)\n'
                       b'{ const char* s="{ // }"; char c=\'}\'; // {\n'
                       b'  if (state) { consume(s,c); } /* } */\n}')
        source=short+b'\r\n\r\n'+parameterized+b'\n'
        for name,expected in [('HasShadowStep',short),('SetShadowStepAttackSkill',parameterized)]:
            with self.subTest(method=name):
                start,opening,end=original_definition(source,name)
                self.assertEqual(source[start:end],expected)
                self.assertEqual(source[opening:opening+1],b'{')
        self.assertLess(len(short),100)

    def test_truncated_changed_and_empty_sources_rejected_before_execution(self):
        data=(ROOT/'.cache/native-source-runtime/X2Lib/X2GURaven.cpp').read_bytes()
        for payload in (b'',data[:-1],data.replace(b'0.4f',b'0.5f',1)):
            with self.assertRaisesRegex(ValueError,'hash mismatch'):builder.extract(payload)

if __name__=='__main__':unittest.main()
