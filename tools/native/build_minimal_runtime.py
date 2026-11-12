"""Hash-checked bounded source execution. Never writes source inputs or old modules."""
import argparse, json, os, subprocess
from pathlib import Path
from run_camera_source import extract, sha

ROOT=Path(__file__).resolve().parents[2]
DEVICE='KTDXLIB/KTDIDeviceWinKey.cpp'
HEADER='KTDXLIB/KTDIDeviceWinKey.h'
GAME='X2Lib/X2Game.h'
RAVEN='X2Lib/X2GURaven.cpp'
HASHES={DEVICE:'0d00dd7699ba6803dec3df17615b2b7fc561c1db9e2eb4532d46616a0f07cceb',
 HEADER:'aed201f10d54bbdae4203f56a6e95cf3d9a2fe2f158332f1ee61097791006542',
 RAVEN:'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'}
EVENTS=['RSI_WAIT','RSI_WALK','RSI_JUMP_READY','RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_DASH']

def generate(source):
    manifest=json.loads((ROOT/'contracts/rf-input-prebuffer-source-v13.json').read_text('utf8'))
    hashes={f['relativePath']:f['sha256'] for f in manifest['files']}
    hashes.update(HASHES)
    raw={p:(source/p).read_bytes() for p in [DEVICE,HEADER,GAME,RAVEN]}
    for p,data in raw.items():
        if sha(data)!=hashes[p]:raise ValueError('Source hash mismatch: '+p)
    records=[]
    def piece(p,sig):
        body,first,last=extract(raw[p],sig.encode())
        records.append(dict(path=p,signature=sig,lineStart=first,lineEnd=last,sha256=sha(body)))
        return body
    cpp=(ROOT/'tools/native/minimal_input_adapter.cpp').read_bytes()
    cpp=cpp.replace(b'// @@DOUBLE@@',piece(HEADER,'struct DoubleKey')+b';')
    methods=['BOOL CKTDIDeviceWinKey::Clear(', 'BOOL CKTDIDeviceWinKey::Read(',
      'BOOL  CKTDIDeviceWinKey::GetKeyState(', 'BOOL  CKTDIDeviceWinKey::GetPureKeyState(',
      'BOOL  CKTDIDeviceWinKey::GetDoubleKeyPureState(', 'BOOL  CKTDIDeviceWinKey::GetDoubleKeyState(',
      'void  CKTDIDeviceWinKey::SetDoubleKeyReset(']
    cpp=cpp.replace(b'// @@DEVICE@@',b'\n'.join(piece(DEVICE,s) for s in methods))
    cpp=cpp.replace(b'// @@INPUTDATA@@',piece(GAME,'inline void InputData('))
    move=(ROOT/'tools/native/minimal_movement_adapter.cpp').read_bytes()
    move=move.replace(b'// @@EVENTS@@',b'\n'.join(piece(RAVEN,'void CX2GURaven::'+s+'_EventProcess(') for s in EVENTS))
    return {'input':cpp,'movement':move},dict(schemaVersion=1,referenceCommit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
      targetClientMeasured=False,target2016Equivalent=False,files={p:sha(v) for p,v in raw.items()},fragments=records,
      macros={'movement':['NEW_SKILL_TREE'],'input':[], 'disabledScope':['awakening','skills','riding','wall-jump']},
      getterOrder=['pureDouble','oneDouble','pure','one'],actionOrder=['LEFT','RIGHT','UP','DOWN','Z','X'],
      getterOrderSource='X2Game.h:1852; X2Game.cpp:5276-5279,5490-5491, source contract rf-input-prebuffer-source-v13',
      boundary=['Input: WinKey candidate, fixed DWORD/LONG 32-bit, bounded FIFO; browser supplies monotonic millisecond stamps.',
        'Movement: six unchanged reference EventProcess bodies; no skill/awakening/riding/wall-jump in this experiment.',
        'CommonEventProcess, physics, state commit, Now/Future buffering and animation remain explicit existing JS host boundaries.',
        '2016 data, V5 consumers and current simulation are separate evidence; this is not a cropped official client.'])

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--zig',type=Path,required=True)
    a=p.parse_args();units,contract=generate(a.source)
    output=ROOT/'artifacts/minimal';output.mkdir(parents=True,exist_ok=True)
    cache=ROOT/'.cache/minimal-compiler';cache.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ,ZIG_LOCAL_CACHE_DIR=str(cache/'local'),ZIG_GLOBAL_CACHE_DIR=str(cache/'global'))
    contract['modules']={}
    exports={'input':['__wasm_call_ctors','device_reset','device_enqueue','device_sample','device_state_ptr','device_state_size'],
      'movement':['movement_run','movement_result_ptr']}
    for name,cpp in units.items():
        unit=output/(name+'.cpp');unit.write_bytes(cpp)
        command=[str(a.zig.resolve()),'c++','-std=c++17','-O2','-fno-fast-math','-ffp-contract=off','-target','wasm32-freestanding',
          '-nostdlib','-fno-exceptions','-fno-rtti','-fno-builtin',str(unit),'-Wl,--no-entry','-Wl,--export-memory',
          *['-Wl,--export='+n for n in exports[name]],'-o',str(output/(name+'.wasm'))]
        subprocess.run(command,env=env,check=True)
        contract['modules'][name]=dict(file=name+'.wasm',sha256=sha((output/(name+'.wasm')).read_bytes()),translationUnitSha256=sha(cpp))
    contract['compilerSha256']=sha(a.zig.read_bytes())
    data=(json.dumps(contract,indent=2)+'\n').encode()
    (output/'manifest.json').write_bytes(data)
    (ROOT/'contracts/rf-minimal-runtime-v1.json').write_bytes(data)
    print(json.dumps({'output':str(output),'modules':contract['modules']}))
if __name__=='__main__':main()
