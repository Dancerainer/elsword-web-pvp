"""Execute unchanged device -> Manager UpdateData -> Game InputData in a host."""
import argparse,hashlib,json,os,re,subprocess
from pathlib import Path

PINS={
 'KTDXLIB/KTDIDeviceWinKey.cpp':'0d00dd7699ba6803dec3df17615b2b7fc561c1db9e2eb4532d46616a0f07cceb',
 'X2Lib/X2Game.h':'3ebc9cc8fc6f4e177bdd0632995aba47e54dabc62ed0f1c718410ede391b165d',
 'KTDXLIB/KTDIDevice.cpp':'8b54ccb1b622653ead48c09c996be250e9c1adc8e327aaa9bf1a7018864fc83a',
 'KTDXLIB/Always.h':'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069',
 'KTDXLIB/KTDX.h':'0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf',
}
def sha(d):return hashlib.sha256(d).hexdigest()
def fragment(data,pattern):
 matches=list(re.finditer(pattern,data))
 if len(matches)!=1:raise ValueError('Missing or ambiguous original fragment: '+str(pattern))
 start=matches[0].start();brace=data.index(b'{',matches[0].end());depth=1;end=brace+1
 while depth and end<len(data):depth+=(data[end]==123)-(data[end]==125);end+=1
 if depth:raise ValueError('Truncated original fragment')
 return data[start:end],data[:start].count(b'\n')+1,data[:end].count(b'\n')+1
HEADER=r'''
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <deque>
#include <initializer_list>
using DWORD=uint32_t;using LONG=int32_t;using BYTE=uint8_t;using BOOL=int;using UINT=unsigned;using HRESULT=int;using LPVOID=void*;
#define FALSE 0
#define TRUE 1
#define VK_SNAPSHOT 44
#define DOUBLE_INPUT_GAP 0.4f
#define ZeroMemory(p,n) std::memset(p,0,n)
#define GAMEACTION_END 256
#define GAMEACTION_TOTAL 256
#define KEYBOARD 1
#define MOUSE 2
#define JOYSTICK 3
#define SUCCEEDED(v) ((v)>=0)
#define FAILED(v) ((v)<0)
#define DIERR_INPUTLOST -1
#define DIERR_NOTACQUIRED -2
using GAME_ACTION=int;
int frameTime=0;
struct CKTDIDeviceWinKey {
 struct KeyTime {DWORD m_dwStamp;BYTE m_byVirtualKey;bool m_bDown;};
 struct DoubleKey {bool bFirstDown=false,bKeyUp=false;float fTimeOut=0;bool bDoubleOK=false,bDoubleKeyLock=false;
  void Init(){bFirstDown=bKeyUp=bDoubleOK=bDoubleKeyLock=false;fTimeOut=0;}};
 BYTE m_aVKtoDIKMap[256]={};bool m_abQueuedVKState[256]={},m_abCurrentVKState[256]={};BYTE m_State[256]={};
 BOOL m_Locks[256]={};DoubleKey m_DoubleKeyCheck[256];std::deque<KeyTime> m_dequeKeyTime;BYTE m_ActionMap[256]={};
 BOOL Read(DWORD,float);BOOL GetKeyState(unsigned char);BOOL GetPureKeyState(unsigned char);
 BOOL GetDoubleKeyPureState(unsigned char);BOOL GetDoubleKeyState(unsigned char);bool GetActionState(int,long* lpData=nullptr);
};
struct DIMOUSESTATE {long lX=0,lY=0,lZ=0;BYTE rgbButtons[4]={};};struct DIJOYSTATE {BYTE rgbButtons[32]={};};
struct POINT {long x=0,y=0;};void GetCursorPos(POINT*){}void ScreenToClient(void*,POINT*){}
struct HostDI {struct Edge{int key;bool down;int time;};std::deque<Edge> queue;BYTE levels[256]={};
 void Poll(){}HRESULT Acquire(){return 0;}HRESULT GetDeviceState(long n,LPVOID target){while(!queue.empty()&&queue.front().time<=frameTime){auto e=queue.front();queue.pop_front();levels[e.key]=e.down?0x80:0;}std::memcpy(target,levels,n);return 0;}} hostDI;
struct CKTDIDevice {
 BYTE m_State[256]={},m_ActionMap[256]={};BOOL m_Locks[256]={};CKTDIDeviceWinKey::DoubleKey m_DoubleKeyCheck[256];
 HostDI* m_pDIDevice=&hostDI;int m_Type=KEYBOARD;BOOL m_Windowed=false;void* m_hWnd=nullptr;
 long m_XPos=0,m_YPos=0,m_ZPos=0;DIMOUSESTATE mouse;DIJOYSTATE joystick;DIMOUSESTATE* m_MouseState=&mouse;DIJOYSTATE* m_JoystickState=&joystick;
 BOOL Read(float);bool GetActionState(int,long* lpData=nullptr);void UpdateMouseDeltaPosition(){}
};
#ifdef CHANGE_KEY_DEVICE
using Keyboard=CKTDIDeviceWinKey;
#else
using Keyboard=CKTDIDevice;
#endif
Keyboard device;
struct CKTDIManager {
 bool m_State[256]={},m_Locks[256]={};CKTDIDeviceWinKey::DoubleKey m_DoubleKeyCheck[256];
 bool m_bEnabled=true;Keyboard* m_KTDIKeyboard=&device;CKTDIDevice* m_KTDIMouse=nullptr;CKTDIDevice* m_KTDIJoystic=nullptr;
 BOOL GetActionState(int);BOOL GetPureActionState(int);BOOL GetDoubleActionPureState(int);BOOL GetDoubleActionState(int);
 BOOL SetActionState(int,BOOL);void HandleAction(UINT,bool,long lData=0);void ApplyActionInput(int,float);void UpdateData(float);Keyboard* Getkeyboard(){return &device;}
} manager;
struct App {CKTDIManager* GetDIManager(){return &manager;}DWORD GetFrameTimestamp(){return frameTime;}} app;App* g_pKTDXApp=&app;
#define IN
#define OUT
'''
MAIN=r'''
};Game game;
void edge(int key,bool down,int time){
#ifdef CHANGE_KEY_DEVICE
device.m_dequeKeyTime.push_back({DWORD(time),BYTE(key),down});
#else
hostDI.queue.push_back({key,down,time});
#endif
}
void sample(const char* name,int time){
 frameTime=time;manager.UpdateData(1.f/60.f);
 bool pl=false,ol=false,dl=false,odl=false,pr=false,orr=false,dr=false,odr=false;
 game.InputData(1,dl,odl,pl,ol);game.InputData(2,dr,odr,pr,orr);
 std::printf("{\"name\":\"%s\",\"timeMs\":%d,\"left\":[%d,%d,%d,%d],\"right\":[%d,%d,%d,%d]},\n",
 name,time,dl,odl,pl,ol,dr,odr,pr,orr);
}
int main(){for(int i=1;i<256;i++){
#ifdef CHANGE_KEY_DEVICE
device.m_aVKtoDIKMap[i]=i;
#endif
device.m_ActionMap[i]=i;}std::puts("[");
 edge(2,true,1);sample("first6",16);
 edge(2,false,20);sample("released6",32);
 edge(2,true,40);sample("second6",48);
 sample("held-double-next",64);
 edge(2,false,65);edge(1,true,66);edge(2,true,68);edge(1,false,69);sample("same-packet46",80);
 sample("final6-held",96);
 edge(2,false,100);sample("final6-released",112);
 edge(2,true,120);sample("next6",128);
 std::puts("null]");}
'''
def build(root,out,compiler,manager_root=Path('.cache/input-manager-source-v19')):
 blobs={name:(root/name).read_bytes() for name in PINS}
 for name,pin in PINS.items():
  if sha(blobs[name])!=pin:raise ValueError('Pinned source changed: '+name)
 assert re.search(rb'^#define KEY_MAPPING\s',blobs['KTDXLIB/Always.h'],re.M)
 assert re.search(rb'#ifdef X2TOOL\s*#define SHOW_LINEMAP_FILE_NAME\s*#define CHANGE_KEY_DEVICE',blobs['KTDXLIB/KTDX.h'])
 out.mkdir(parents=True,exist_ok=True);parts=[];manifest=[]
 for name in ['Read','GetKeyState','GetPureKeyState','GetDoubleKeyPureState','GetDoubleKeyState']:
  body,first,last=fragment(blobs['KTDXLIB/KTDIDeviceWinKey.cpp'],rb'BOOL\s+CKTDIDeviceWinKey::'+name.encode()+rb'\([^)]*\)')
  parts.append(body);manifest.append({'file':'KTDXLIB/KTDIDeviceWinKey.cpp','method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'bodyUnchanged':True})
 for file,names in [('KTDXLIB/KTDIDeviceWinKey.cpp',['GetActionState']),('KTDXLIB/KTDIDevice.cpp',['Read','GetActionState'])]:
  cls=b'CKTDIDeviceWinKey' if 'WinKey' in file else b'CKTDIDevice'
  for name in names:
   m,first,last=fragment(blobs[file],rb'(?:BOOL|bool)\s+'+cls+rb'::'+name.encode()+rb'\([^)]*\)')
   parts.append(m);manifest.append({'file':file,'method':name,'firstLine':first,'lastLine':last,'sha256':sha(m),'bodyUnchanged':True})
 body,first,last=fragment(blobs['X2Lib/X2Game.h'],rb'inline void InputData\([^)]*\)')
 manifest.append({'file':'X2Lib/X2Game.h','method':'InputData','firstLine':first,'lastLine':last,'sha256':sha(body),'bodyUnchanged':True})
 manager_data=(manager_root/'KTDIManager.cpp').read_bytes();manager_h=(manager_root/'KTDIManager.h').read_bytes()
 if sha(manager_data)!='df4e04a9195146450421a56d89ef0099efe99ba2e54cb9949818518008799820' or sha(manager_h)!='67624f15256381c81fe8493a29718acbe4432e79aacaee4a3b63cdaf66f645c9':raise ValueError('Pinned Manager source changed')
 for name in ['GetActionState','GetPureActionState','GetDoubleActionPureState','GetDoubleActionState','ApplyActionInput','SetActionState','HandleAction','UpdateData']:
  m,first,last=fragment(manager_data,rb'(?:BOOL|void)\s+CKTDIManager::'+name.encode()+rb'\([^)]*\)')
  parts.append(m);manifest.append({'file':'KTDIManager.cpp','method':name,'firstLine':first,'lastLine':last,'sha256':sha(m),'bodyUnchanged':True})
 lines=manager_h.splitlines();macros=b'#ifdef KEY_MAPPING\n'+b'\n'.join(lines[142:146])+b'\n#else\n'+b'\n'.join(lines[256:260])+b'\n#endif\n'
 unit=HEADER.encode()+macros+b'\nstruct Game {\n'+body+MAIN.encode()+b'\n'+b'\n'.join(parts)
 cpp=out/'keyboard.cpp';cpp.write_bytes(unit);exe=out/'keyboard.exe'
 env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str((out/'zig-global').resolve()),ZIG_LOCAL_CACHE_DIR=str((out/'zig-local').resolve()))
 branch_rows=[]
 for mapped,win in [(False,True),(True,True),(True,False)]:
  r=subprocess.run([str(compiler),'c++','-std=c++17','-O0',*(['-DKEY_MAPPING'] if mapped else []),*(['-DCHANGE_KEY_DEVICE'] if win else []),str(cpp),'-o',str(exe)],env=env,capture_output=True)
  if r.returncode:raise RuntimeError((r.stdout+r.stderr).decode(errors='replace'))
  rows=json.loads(subprocess.check_output([str(exe.resolve())]));rows.pop()
  expected=[[0,0,1,1],[0,0,0,0],[1,1,1,1],[1,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,0,0],[0,0,1,1]]
  assert [r['right'] for r in rows]==expected
  assert all(r['left']==[0,0,0,0] for r in rows)
  branch_rows.append({'KEY_MAPPING':mapped,'CHANGE_KEY_DEVICE':win,'cases':rows})
 result={'schema':'rf-keyboard-independent-source-v19','evidenceClass':'compiled-fixed-reference-not2016','targetClientMeasured':False,
  'sourceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','files':{n:{'sha256':sha(b),'bytes':len(b)} for n,b in blobs.items()},
  'fragments':manifest,'channelOrder':['pureDouble','oneDouble','pure','one'],'cases':rows,
  'macroBranches':branch_rows,'managerFiles':{'KTDIManager.cpp':{'sha256':sha(manager_data),'bytes':len(manager_data)},'KTDIManager.h':{'sha256':sha(manager_h),'bytes':len(manager_h)}},
  'macroLineRanges':[[143,146],[257,260]],'managerAcquisition':json.loads((manager_root/'acquisition.json').read_text(encoding='utf-8')),
  'unitSha256':sha(unit),'compilerSha256':sha(compiler.read_bytes()),
  'referenceBuildMacros':{'KEY_MAPPING':{'file':'KTDXLIB/Always.h','line':2223,'defined':True},'CHANGE_KEY_DEVICE':{'file':'KTDXLIB/KTDX.h','line':557,'condition':'X2TOOL','toolDefined':True,'gameDefinedHere':False},'target2016Confirmed':False},
  'boundary':'17 unchanged methods: WinKey Read/ordered getters/action getter, DI Read/action getter, Manager UpdateData/HandleAction/SetActionState/ApplyActionInput/ordered getters, Game InputData and raw Manager macros. KEY_MAPPING reference game route with DI and optional tool WinKey route executed. Host action map, COM GetDeviceState final level fixture and clock; null joystick/mouse, no SDK/App loop. Target2016 mapping configuration/build/read timing unknown.'}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n');return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,default=Path('.cache/native-source-runtime'));p.add_argument('--out',type=Path,default=Path('artifacts/proof-double-cancel-v19/source'));p.add_argument('--compiler',type=Path,required=True)
 a=p.parse_args();r=build(a.source_root,a.out,a.compiler);print(json.dumps({'cases':len(r['cases']),'out':str(a.out/'result.json')}))
