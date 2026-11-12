"""Owned failure injection fixtures test three-file publication rollback."""
import copy,json,shutil,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
import publish_arc_runtime_v19 as publish
import seal_v11_runtime as seal
import check_arc_composition_v19 as composition

class ArcPublicationTests(unittest.TestCase):
    def test_both_sealing_failures_restore_manifest_binary_and_existing_or_new_contract(self):
        for phase in (1,2):
            for existed in (False,True):
                with self.subTest(phase=phase,contractExisted=existed),tempfile.TemporaryDirectory() as temp:
                    root=Path(temp);(root/'artifacts/native').mkdir(parents=True);(root/'contracts').mkdir()
                    manifest=root/'artifacts/native/manifest.json';binary=root/'artifacts/native/skills.wasm'
                    contract=root/'contracts/arc.json'
                    previous={'runtimeVersion':'v10','modules':{'skills':{'sha256':'1'*64},'retained':{'sha256':'2'*64}},
                              'seal':{'manifestContentSha256':'3'*64,'republishHistory':[{'reason':'old'}]}}
                    result=copy.deepcopy(previous);result['runtimeVersion']='v11';result['modules']['skills']['sha256']='4'*64
                    manifest.write_bytes(json.dumps(previous).encode());binary.write_bytes(b'owned original binary')
                    if existed:contract.write_bytes(b'owned original contract')
                    before_manifest=manifest.read_bytes();before_binary=binary.read_bytes();calls=[]
                    def failure(task_root,check_only=False):
                        calls.append(check_only)
                        if len(calls)==phase:raise ValueError('injected seal failure')
                        current=json.loads(manifest.read_text());current['seal']={'manifestContentSha256':'5'*64}
                        return current
                    with self.assertRaisesRegex(ValueError,'injected seal failure'):
                        publish.commit_candidate(root,contract,{'new':'owned fixture'},result,previous,b'owned new binary',failure)
                    self.assertEqual(manifest.read_bytes(),before_manifest);self.assertEqual(binary.read_bytes(),before_binary)
                    self.assertEqual(contract.read_bytes() if contract.exists() else None,b'owned original contract' if existed else None)
                    self.assertEqual(len(calls),phase)

    def test_unknown_method_commit_and_wrong_hyper_origin_are_rejected(self):
        name='RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove'
        seal.check_arc_origins({'sourceCommit':seal.COMMIT},[{'name':name}])
        for generated,methods in [({'sourceCommit':'unknown'},[{'name':name}]),
                                  ({'sourceCommit':seal.COMMIT},[{'name':name,'sourceCommit':'unknown'}]),
                                  ({'sourceCommit':seal.COMMIT},[{'name':name,'sourceCommit':seal.RECOVERY_COMMIT}])]:
            with self.subTest(generated=generated,methods=methods),self.assertRaises(ValueError):seal.check_arc_origins(generated,methods)

    def test_actual_nine_includes_and_adapter_match_pinned_source_and_corrupt_inputs_fail(self):
        candidate=ROOT/'.cache/native-archenemy-skills-v19'
        result=composition.check(ROOT,candidate)
        self.assertEqual(result['includes'],9);self.assertEqual(result['originalMethods'],71)
        for name in ('original_skill_methods.inc','original_skill_macros.inc','skills.generated.cpp'):
            with self.subTest(corrupt=name),tempfile.TemporaryDirectory() as temp:
                output=Path(temp)
                for path in candidate.iterdir():
                    if path.is_file() and path.suffix in ('.json','.inc','.cpp'):shutil.copyfile(path,output/path.name)
                path=output/name;path.write_bytes(path.read_bytes()+b'\n/* owned corrupt suffix */\n')
                with self.assertRaises(ValueError):composition.check(ROOT,output)

if __name__=='__main__':unittest.main()
