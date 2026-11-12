"""Small owned C++/legal WASM fixtures for all-or-nothing runtime publication."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('seal_v11_runtime',ROOT/'tools/native/seal_v11_runtime.py')
tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)


def encoded(value):return (json.dumps(value,indent=2)+'\n').encode()


class RuntimeSealingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.directory=self.root/'artifacts/native'
        # Valid empty module with an empty-name custom section. Different
        # payload bytes provide independent identities without third-party code.
        self.binary=b'\x00asm\x01\x00\x00\x00\x00\x01\x00'
        self.sources=b'/*virtual*/ int owned_a() { return 1; }\nint owned_b() { return 2; }\n'
        source_record={'relativePath':'X2Lib/Owned.cpp','sha256':tool.sha(self.sources),'bytes':len(self.sources),
            'gitBlob':hashlib.sha1(b'blob '+str(len(self.sources)).encode()+b'\0'+self.sources).hexdigest()}
        self.put('.cache/native-source-runtime/X2Lib/Owned.cpp',self.sources)
        self.json('contracts/rf-native-runtime-sources.json',{'commit':tool.COMMIT,'files':[source_record]})
        modules={}
        for i,name in enumerate(tool.BASE):
            binary=self.binary+bytes([0,2,0,i])
            self.put('artifacts/native/'+name+'.wasm',binary)
            modules[name]={'file':name+'.wasm','sha256':tool.sha(binary),'bytes':len(binary),
                'originalFunctions':[{'name':'owned_'+name}],'evidenceClass':'fixture-reference',
                'extraMetadata':{'preserveExactly':i}}
        self.manifest={'schemaVersion':1,'runtimeVersion':'original-source-functions-v7','referenceCommit':tool.COMMIT,
            'fullTargetClientExecuted':False,'modules':modules,'boundaries':{'skills':['retain source boundary']},
            'extraTopLevel':{'preserveExactly':True}}
        self.json('artifacts/native/manifest.json',self.manifest)
        recovery_source=b''.join(('void owned_recovery_'+str(i)+'() {}\n').encode() for i in range(8))
        functions=[]
        for i,line in enumerate(recovery_source.splitlines(),1):
            functions.append({'name':'owned_recovery_'+str(i-1),'file':tool.PREFIX+'X2Lib/X2GURaven.cpp',
                'startLine':i,'endLine':i,'bytes':len(line),'sha256':tool.sha(line)})
        self.put('.cache/reference-combat-fixes-v11/X2GURaven.cpp',recovery_source)
        generated=b'// owned host fixture\n'+recovery_source
        self.put('artifacts/native/commands-recovery/commands-recovery.generated.cpp',generated)
        self.recovery={'schemaVersion':1,'sourceCommit':tool.RECOVERY_COMMIT,'baselineReferenceCommit':tool.COMMIT,
            'sourcePath':tool.PREFIX+'X2Lib/X2GURaven.cpp','sourceSha256':tool.sha(recovery_source),
            'sourceBytes':len(recovery_source),
            'sourceGitBlob':hashlib.sha1(b'blob '+str(len(recovery_source)).encode()+b'\0'+recovery_source).hexdigest(),
            'functions':functions,'generatedCppSha256':tool.sha(generated),
            'wasm':{'bytes':len(self.binary),'sha256':tool.sha(self.binary)},
            'evidenceClass':'fixture-reconstruction','boundaries':['fixture bounded host']}
        self.json('artifacts/native/commands-recovery/source-contract.json',self.recovery)
        self.json('contracts/rf-combo-recovery-source-v11.json',self.recovery)
        section=self.sources.splitlines(keepends=True)[0]
        fragment={'file':'X2Lib/Owned.cpp','lines':[1,1],'sha256':tool.sha(section),'bytes':len(section)}
        adapter=b'// owned adapter\n'
        self.put('tools/native/nasod_source_adapter.cpp',adapter)
        self.nasod={'referenceCommit':tool.COMMIT,'targetClientMeasured':False,'referenceFiles':[source_record],
            'extractions':[fragment],'adapterSha256':tool.sha(adapter),
            'module':{'file':'nasod.wasm','sha256':tool.sha(self.binary),'bytes':len(self.binary)},
            'evidenceClass':'fixture-reference','hostBoundary':['fixture bounded host']}
        self.json('contracts/rf-native-nasod-v11.json',self.nasod)
        getter=section[len(b'/*virtual*/ '):].rstrip(b'\r\n')
        critical_fragment={'path':'X2Lib/Owned.cpp','lineStart':1,'lineEnd':1,'sha256':tool.sha(getter),'bytes':len(getter)}
        self.critical={'referenceCommit':tool.COMMIT,'targetClientMeasured':False,'files':[source_record],
            'fragments':[critical_fragment],'evidenceClass':'fixture-critical','hostBoundary':['fixture bounded host']}
        self.json('contracts/rf-critical-source-v11.json',self.critical)
        self.critical_entry={'file':'critical.wasm','sha256':tool.sha(self.binary),'bytes':len(self.binary),
            'sourceCommit':tool.COMMIT,'sourceContract':'contracts/rf-critical-source-v11.json',
            'originalFunctions':[critical_fragment],'evidenceClass':'fixture-critical'}
        self.json('.cache/native-critical-generated/module-entry.json',self.critical_entry)
        self.put('tools/native/critical_adapter.cpp',adapter)
        self.put('.cache/native-critical-generated/critical_adapter.cpp',adapter)
        for name in tool.ADDITIONS:self.put('artifacts/native/'+name+'.wasm',self.binary)

    def tearDown(self):self.tmp.cleanup()

    def put(self,name,data):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)

    def json(self,name,value):self.put(name,encoded(value))

    def unchanged_failure(self,pattern):
        original=(self.directory/'manifest.json').read_bytes()
        with self.assertRaisesRegex((ValueError,FileNotFoundError),pattern):tool.seal(self.root)
        self.assertEqual((self.directory/'manifest.json').read_bytes(),original)
        self.assertFalse(list(self.directory.glob('.seal-v11-*.tmp')))

    def test_complete_seal_preserves_six_records_and_binaries_and_is_reproducible(self):
        before={name:(self.directory/(name+'.wasm')).read_bytes() for name in tool.BASE+tool.ADDITIONS}
        result=tool.seal(self.root)
        self.assertEqual(result['runtimeVersion'],'original-source-functions-v8')
        self.assertEqual(set(result['modules']),set(tool.BASE+tool.ADDITIONS))
        self.assertEqual(result['seal']['moduleCount'],9)
        self.assertEqual(result['extraTopLevel'],self.manifest['extraTopLevel'])
        self.assertEqual(result['boundaries']['skills'],['retain source boundary'])
        for name in tool.BASE:self.assertEqual(result['modules'][name],self.manifest['modules'][name])
        for name,data in before.items():self.assertEqual((self.directory/(name+'.wasm')).read_bytes(),data)
        first=(self.directory/'manifest.json').read_bytes();tool.seal(self.root)
        self.assertEqual((self.directory/'manifest.json').read_bytes(),first)

    def test_check_only_validates_complete_candidate_without_writing(self):
        original=(self.directory/'manifest.json').read_bytes()
        result=tool.seal(self.root,True);self.assertEqual(len(result['modules']),9)
        self.assertEqual((self.directory/'manifest.json').read_bytes(),original)

    def test_missing_baseline_module_and_addition_file_never_publish(self):
        missing=copy.deepcopy(self.manifest);del missing['modules']['geometry']
        self.json('artifacts/native/manifest.json',missing);self.unchanged_failure('Missing retained baseline')
        self.json('artifacts/native/manifest.json',self.manifest)
        (self.directory/'critical.wasm').unlink();self.unchanged_failure('critical.wasm')

    def test_corrupt_binary_byte_count_hash_and_structural_wasm_are_rejected(self):
        self.put('artifacts/native/commands.wasm',b'corrupt');self.unchanged_failure('Byte count drift: commands')
        original=self.binary+bytes([0,2,0,2]);self.put('artifacts/native/commands.wasm',original[:-1]+b'Z')
        self.unchanged_failure('Hash drift: commands')
        malformed=b'\x00asm\x01\x00\x00\x00\x01\x7f'
        bad=copy.deepcopy(self.manifest);bad['modules']['commands'].update(bytes=len(malformed),sha256=tool.sha(malformed))
        self.put('artifacts/native/commands.wasm',malformed);self.json('artifacts/native/manifest.json',bad)
        self.unchanged_failure('Truncated WASM section')

    def test_unsafe_binary_contract_and_source_paths_are_rejected(self):
        for file in ('../critical.wasm','C:/critical.wasm','/critical.wasm','sub/commands.wasm'):
            bad=copy.deepcopy(self.manifest);bad['modules']['commands']['file']=file
            self.json('artifacts/native/manifest.json',bad);self.unchanged_failure('Unsafe or mismatched module file')
        self.json('artifacts/native/manifest.json',self.manifest)
        bad=copy.deepcopy(self.critical_entry);bad['sourceContract']='../../other.json'
        self.json('.cache/native-critical-generated/module-entry.json',bad);self.unchanged_failure('Wrong critical source contract')
        self.json('.cache/native-critical-generated/module-entry.json',self.critical_entry)
        bad=copy.deepcopy(self.nasod);bad['referenceFiles'][0]['relativePath']='../Owned.cpp'
        self.json('contracts/rf-native-nasod-v11.json',bad);self.unchanged_failure('Unsafe relative path')

    def test_source_and_fragment_drift_is_not_repaired(self):
        bad=copy.deepcopy(self.recovery);bad['sourceCommit']=tool.COMMIT
        self.json('artifacts/native/commands-recovery/source-contract.json',bad)
        self.unchanged_failure('Recovery source contract drift')
        self.json('artifacts/native/commands-recovery/source-contract.json',self.recovery)
        self.put('.cache/native-source-runtime/X2Lib/Owned.cpp',self.sources.replace(b'1',b'9'))
        self.unchanged_failure('Hash drift: source')
        self.put('.cache/native-source-runtime/X2Lib/Owned.cpp',self.sources)
        bad=copy.deepcopy(self.nasod);bad['extractions'][0]['sha256']='0'*64
        self.json('contracts/rf-native-nasod-v11.json',bad);self.unchanged_failure('Source extraction drift')

    def test_host_imports_and_retained_metadata_tampering_are_rejected(self):
        imported=b'\x00asm\x01\x00\x00\x00\x02\x01\x01'
        bad=copy.deepcopy(self.manifest);bad['modules']['commands'].update(bytes=len(imported),sha256=tool.sha(imported))
        self.put('artifacts/native/commands.wasm',imported);self.json('artifacts/native/manifest.json',bad)
        self.unchanged_failure('host imports')
        self.put('artifacts/native/commands.wasm',self.binary+bytes([0,2,0,2]));self.json('artifacts/native/manifest.json',self.manifest)
        result=tool.seal(self.root);result['modules']['skills']['extraMetadata']['preserveExactly']=999
        self.json('artifacts/native/manifest.json',result);self.unchanged_failure('Existing sealed manifest drift')

    def test_sealed_source_contract_drift_and_incomplete_sealed_version_are_rejected(self):
        result=tool.seal(self.root)
        changed=copy.deepcopy(self.critical_entry);changed['extra']='changed after seal'
        self.json('.cache/native-critical-generated/module-entry.json',changed)
        self.unchanged_failure('Previously sealed source contract drift')
        self.json('.cache/native-critical-generated/module-entry.json',self.critical_entry)
        result['runtimeVersion']='original-source-functions-v7'
        self.json('artifacts/native/manifest.json',result);self.unchanged_failure('Existing sealed manifest drift')

    def test_republish_is_bounded_requires_a_real_change_and_never_changes_binaries(self):
        for path in ('../other.json','contracts/unknown.json'):
            with self.assertRaisesRegex(ValueError,'Unknown republish'):
                tool.seal(self.root,republish=[path],republish_reason='reviewed')
        path='.cache/native-critical-generated/module-entry.json'
        with self.assertRaisesRegex(ValueError,'explicit reason'):
            tool.seal(self.root,republish=[path],republish_reason=' ')
        with self.assertRaisesRegex(ValueError,'existing complete seal'):
            tool.seal(self.root,republish=[path],republish_reason='reviewed')
        first=tool.seal(self.root)
        before={name:(self.directory/(name+'.wasm')).read_bytes() for name in tool.BASE+tool.ADDITIONS}
        with self.assertRaisesRegex(ValueError,'did not change'):
            tool.seal(self.root,republish=[path],republish_reason='reviewed')
        changed=copy.deepcopy(self.critical_entry);changed['reviewedAnnotation']='first correction'
        self.json(path,changed)
        second=tool.seal(self.root,republish=[path],republish_reason='Record the reviewed annotation')
        entry=second['seal']['republishedSourceContracts'][path]
        self.assertEqual(entry['previousSha256'],first['seal']['sourceContracts'][path])
        self.assertEqual(entry['sha256'],second['seal']['sourceContracts'][path])
        self.assertEqual(len(second['seal']['republishHistory']),1)
        encoded_second=(self.directory/'manifest.json').read_bytes()
        tool.seal(self.root)
        self.assertEqual((self.directory/'manifest.json').read_bytes(),encoded_second)
        changed['reviewedAnnotation']='second correction';self.json(path,changed)
        third=tool.seal(self.root,republish=[path],republish_reason='Follow-up reviewed annotation')
        self.assertEqual(len(third['seal']['republishHistory']),2)
        self.assertEqual(third['seal']['republishHistory'][0],second['seal']['republishHistory'][0])
        for name,data in before.items():self.assertEqual((self.directory/(name+'.wasm')).read_bytes(),data)

    def test_missing_sealed_contract_inventory_cannot_disable_drift_check(self):
        result=tool.seal(self.root)
        result['seal']['sourceContracts']={}
        self.json('artifacts/native/manifest.json',result)
        self.unchanged_failure('Incomplete or unexpected sealed source contracts')

    def test_extraction_contract_or_inconsistent_compile_link_cannot_be_sealed(self):
        extracted=copy.deepcopy(self.recovery);extracted['compilationStatus']='not-compiled'
        self.json('artifacts/native/commands-recovery/source-contract.json',extracted)
        self.json('contracts/rf-combo-recovery-source-v11.json',extracted)
        self.unchanged_failure('extracted but not compiled')
        for key in ('generatedCppSha256','moduleSha256','compilerExeSha256'):
            bad=copy.deepcopy(self.recovery)
            bad['compiler']={'exeSha256':'1'*64}
            bad['compilationStatus']='compiled'
            bad['compilation']={'generatedCppSha256':bad['generatedCppSha256'],
                'moduleSha256':bad['wasm']['sha256'],'compilerExeSha256':'1'*64}
            bad['compilation'][key]='0'*64
            self.json('artifacts/native/commands-recovery/source-contract.json',bad)
            self.json('contracts/rf-combo-recovery-source-v11.json',bad)
            self.unchanged_failure('compilation provenance drift')

    def prepare_recovery_rebuild(self):
        previous=tool.seal(self.root)
        old_contract=(self.root/'artifacts/native/commands-recovery/source-contract.json').read_bytes()
        old_cpp=(self.root/'artifacts/native/commands-recovery/commands-recovery.generated.cpp').read_bytes()
        for data,suffix in ((self.binary,'wasm'),(old_contract,'json'),(old_cpp,'cpp')):
            self.put('artifacts/native/superseded/'+tool.sha(data)+'.'+suffix,data)
        rebuilt=self.binary+b'\x00\x02\x00\x07'
        cpp=old_cpp+b'// newly compiled owned adapter\n'
        self.put('artifacts/native/commands-recovery.wasm',rebuilt)
        self.put('artifacts/native/commands-recovery/commands-recovery.generated.cpp',cpp)
        contract=copy.deepcopy(self.recovery)
        contract['generatedCppSha256']=tool.sha(cpp)
        contract['wasm']={'bytes':len(rebuilt),'sha256':tool.sha(rebuilt)}
        contract['compiler']={'exeSha256':'1'*64}
        contract['compilationStatus']='compiled'
        contract['compilation']={'generatedCppSha256':tool.sha(cpp),'moduleSha256':tool.sha(rebuilt),'compilerExeSha256':'1'*64}
        self.json('artifacts/native/commands-recovery/source-contract.json',contract)
        self.json('contracts/rf-combo-recovery-source-v11.json',contract)
        return previous,contract

    def publish_recovery(self):
        return tool.seal(self.root,republish=['artifacts/native/commands-recovery/source-contract.json'],
            republish_reason='Reviewed owned callback rebuild',republish_modules=['commands-recovery'])

    def test_module_republish_preserves_old_pair_and_all_eight_other_modules(self):
        previous,new_contract=self.prepare_recovery_rebuild()
        before={name:(self.directory/(name+'.wasm')).read_bytes() for name in tool.BASE+('nasod','critical')}
        result=self.publish_recovery()
        self.assertEqual(result['modules']['commands-recovery']['sha256'],new_contract['wasm']['sha256'])
        for name,data in before.items():
            self.assertEqual(result['modules'][name],previous['modules'][name])
            self.assertEqual((self.directory/(name+'.wasm')).read_bytes(),data)
        record=result['seal']['republishHistory'][-1]['modules']['commands-recovery']
        self.assertEqual(record['previousSha256'],previous['modules']['commands-recovery']['sha256'])
        self.assertEqual(record['supersededSourceContractSha256'],previous['seal']['sourceContracts']['artifacts/native/commands-recovery/source-contract.json'])
        first=(self.directory/'manifest.json').read_bytes();tool.seal(self.root)
        self.assertEqual((self.directory/'manifest.json').read_bytes(),first)

    def test_module_republish_requires_bounded_name_paired_contract_and_old_bytes(self):
        for name in ('commands','nasod','critical','../commands-recovery'):
            with self.assertRaisesRegex(ValueError,'Unsupported module republish'):
                tool.seal(self.root,republish_modules=[name])
        with self.assertRaisesRegex(ValueError,'paired source-contract'):
            tool.seal(self.root,republish_modules=['commands-recovery'])
        previous,_=self.prepare_recovery_rebuild()
        original=(self.directory/'manifest.json').read_bytes()
        (self.directory/'superseded'/(previous['modules']['commands-recovery']['sha256']+'.wasm')).unlink()
        with self.assertRaises(FileNotFoundError):self.publish_recovery()
        self.assertEqual((self.directory/'manifest.json').read_bytes(),original)

    def test_module_republish_rejects_unrelated_drift_and_noncompiled_pair(self):
        previous,new=self.prepare_recovery_rebuild()
        original=(self.directory/'manifest.json').read_bytes()
        data=(self.directory/'commands.wasm').read_bytes()
        self.put('artifacts/native/commands.wasm',data[:-1]+b'Z')
        with self.assertRaisesRegex(ValueError,'Hash drift: commands'):self.publish_recovery()
        self.put('artifacts/native/commands.wasm',data)
        del new['compilation'];new['compilationStatus']='unproven'
        self.json('artifacts/native/commands-recovery/source-contract.json',new)
        self.json('contracts/rf-combo-recovery-source-v11.json',new)
        with self.assertRaisesRegex(ValueError,'provenance triple'):self.publish_recovery()
        self.assertEqual((self.directory/'manifest.json').read_bytes(),original)

    def test_module_republish_rejects_superseded_cpp_or_contract_tampering(self):
        previous,_=self.prepare_recovery_rebuild()
        original=(self.directory/'manifest.json').read_bytes()
        path=self.directory/'superseded'/(self.recovery['generatedCppSha256']+'.cpp')
        cpp=path.read_bytes();path.write_bytes(cpp+b'corrupt')
        with self.assertRaisesRegex(ValueError,'Superseded recovery CPP drift'):self.publish_recovery()
        path.write_bytes(cpp)
        old_hash=previous['seal']['sourceContracts']['artifacts/native/commands-recovery/source-contract.json']
        (self.directory/'superseded'/(old_hash+'.json')).write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'source-contract drift'):self.publish_recovery()
        self.assertEqual((self.directory/'manifest.json').read_bytes(),original)


if __name__=='__main__':unittest.main()
