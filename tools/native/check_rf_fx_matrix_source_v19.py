"""Compile complete pinned Matrix/Rotate consumers against the shipped D3DX DLL.

The App view and event range are recording inputs, not a native client. Matrix
math executes the original x86 DLL. The small ABI declarations are separately
identified; they do not replace GetMatrix or the Rotate event with an oracle.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess

MATRIX_PIN = 'bfb6df4da42617fd9a0c4a49d18e2f3a71d6d889cea786e8705b4da7cc953aca'
PARTICLE_PIN = '43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050'
MESH_PIN = '0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d'
DLL_PIN = '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f'


def pinned(path, digest):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('Source hash mismatch: ' + str(path))
    return raw.decode('cp949')


def function(text, signature):
    start = text.index(signature)
    opening = text.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]


HARNESS = r'''
#include <windows.h>
#include <iostream>
#include <iomanip>
#include <cmath>
#include <algorithm>
#include <fstream>
#include <string>
#define __max(a,b) std::max(a,b)
#define __min(a,b) std::min(a,b)
#define X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION
#define LOCAL_ROTATE_EFFECT
// D3DX9 ABI: sixteen row-major floats, and a three-float vector.
struct D3DXVECTOR3 {
 float x=0,y=0,z=0;
 D3DXVECTOR3()=default; D3DXVECTOR3(float a,float b,float c):x(a),y(b),z(c){}
 D3DXVECTOR3 operator+(const D3DXVECTOR3& b)const{return {x+b.x,y+b.y,z+b.z};}
 D3DXVECTOR3 operator-(const D3DXVECTOR3& b)const{return {x-b.x,y-b.y,z-b.z};}
 D3DXVECTOR3 operator*(float a)const{return {x*a,y*a,z*a};}
 D3DXVECTOR3& operator+=(const D3DXVECTOR3& b){x+=b.x;y+=b.y;z+=b.z;return *this;}
};
struct D3DXMATRIX {
 union { float m[16]; struct {float _11,_12,_13,_14,_21,_22,_23,_24,_31,_32,_33,_34,_41,_42,_43,_44;};};
 D3DXMATRIX operator*(const D3DXMATRIX& b)const;
};
using M=D3DXMATRIX; using V=D3DXVECTOR3;
static_assert(sizeof(M)==64 && sizeof(V)==12,"D3DX9 float ABI size");
using Transform = M*(__stdcall*)(M*,float,float,float);
using Multiply = M*(__stdcall*)(M*,const M*,const M*);
using Inverse = M*(__stdcall*)(M*,float*,const M*);
Transform D3DXMatrixTranslation,D3DXMatrixScaling,D3DXMatrixRotationYawPitchRoll;
Multiply multiply; Inverse D3DXMatrixInverse;
M M::operator*(const M& b)const{M out;multiply(&out,this,&b);return out;}
M* D3DXMatrixIdentity(M* out){for(int i=0;i<16;i++)out->m[i]=(i%5==0?1.f:0.f);return out;}
float D3DXToRadian(float degree){return degree*(3.141592654f/180.f);}
struct App {
 M view; int count=1;
 int GetViewMatChangeCount(){return count;}
 void GetViewTransform(M* out){*out=view;}
 void SetWorldTransform(const M*){}
} app;
App* g_pKTDXApp=&app;
struct CKTDGMatrixSet {M m_FinalMatrix,m_TranslationMatrix,m_RotationMatrix,m_ScalingMatrix;V m_Pos,m_Rotate,m_Scale;};
class CKTDGMatrix {
public:
 enum BILLBOARD_TYPE{BT_NONE,BT_ALL,BT_X,BT_Y,BT_Z};
 CKTDGMatrixSet m_MatrixSet;bool m_bChange=true;BILLBOARD_TYPE m_LastBillboardType=BT_NONE;int m_ViewMatChangeCount=0;
 CKTDGMatrix(){m_MatrixSet.m_Pos={0,0,0};m_MatrixSet.m_Rotate={0,0,0};m_MatrixSet.m_Scale={1,1,1};}
 void Move(float,float,float);void Rotate(float,float,float);void Scale(float,float,float);
 void RotateDegree(float x,float y,float z){Rotate(D3DXToRadian(x),D3DXToRadian(y),D3DXToRadian(z));}
 const M& GetMatrix(BILLBOARD_TYPE,M* pRotationMatrix=NULL);
};
MATRIX_FUNCTIONS
class CKTDGParticleSystem {
public:
 struct CParticle {
  V local,final;float old=0,now=0;
  float GetEventTimerOld(){return old;}float GetEventTimer(){return now;}
  void SetRotateLocal(V v){local=v;}V GetRotateLocal(){return local;}
  void SetRotateFinal(V v){final=v;}V GetRotateFinal(){return final;}
 };
 struct Range{V target;V GetRandomNumInRange(){return target;}};
 struct CParticleEvent_Rotate {
  Range m_Rotate;struct{float m_Min,m_Max;}m_ActualTime;bool fade;
  bool IsFade(){return fade;}void OnFrameMove(CParticle&,float);
 };
};
ROTATE_FUNCTION
class CKTDGXMeshPlayer {
public:
 struct CXMeshInstance {V m_vRotateLocal,m_vRotateFinal;};
 struct CXMeshEvent_Rotate {
  CKTDGParticleSystem::Range m_Rotate;struct{float m_Min,m_Max;}m_ActualTime;bool fade;
  bool IsFade(){return fade;}void OnFrameMove(CXMeshInstance*,float,float,float,bool);
 };
};
MESH_ROTATE_FUNCTION
int main(int argc,char**argv){
 if(argc!=3)return 2;
 HMODULE dll=LoadLibraryA(argv[1]);if(!dll)return 3;
 D3DXMatrixTranslation=(Transform)GetProcAddress(dll,"D3DXMatrixTranslation");
 D3DXMatrixScaling=(Transform)GetProcAddress(dll,"D3DXMatrixScaling");
 D3DXMatrixRotationYawPitchRoll=(Transform)GetProcAddress(dll,"D3DXMatrixRotationYawPitchRoll");
 multiply=(Multiply)GetProcAddress(dll,"D3DXMatrixMultiply");
 D3DXMatrixInverse=(Inverse)GetProcAddress(dll,"D3DXMatrixInverse");
 if(!D3DXMatrixTranslation||!D3DXMatrixScaling||!D3DXMatrixRotationYawPitchRoll||!multiply||!D3DXMatrixInverse)return 4;
 std::ifstream inputs(argv[2]);std::string kind,id;std::cout<<std::setprecision(9);
 while(inputs>>kind>>id){
  if(kind=="M"){
   int type;V pos,rotate,scale;inputs>>type>>pos.x>>pos.y>>pos.z>>rotate.x>>rotate.y>>rotate.z>>scale.x>>scale.y>>scale.z;
   for(float& f:app.view.m)inputs>>f;app.count++;
   CKTDGMatrix m;m.Move(pos.x,pos.y,pos.z);m.RotateDegree(rotate.x,rotate.y,rotate.z);m.Scale(scale.x,scale.y,scale.z);
   const M& out=m.GetMatrix((CKTDGMatrix::BILLBOARD_TYPE)type);
   std::cout<<"{\"id\":\""<<id<<"\",\"matrix\":[";
   for(int i=0;i<16;i++){if(i)std::cout<<",";std::cout<<out.m[i];}std::cout<<"]}\n";
  }else if(kind=="R"||kind=="X"){
   CKTDGParticleSystem::CParticle p;CKTDGParticleSystem::CParticleEvent_Rotate e;
   int fade;inputs>>p.old>>p.now>>e.m_ActualTime.m_Min>>e.m_ActualTime.m_Max>>fade>>p.local.x>>p.local.y>>p.local.z>>p.final.x>>p.final.y>>p.final.z>>e.m_Rotate.target.x>>e.m_Rotate.target.y>>e.m_Rotate.target.z;e.fade=fade;
   if(kind=="R")e.OnFrameMove(p,p.now-p.old);
   else{
    CKTDGXMeshPlayer::CXMeshInstance instance;instance.m_vRotateLocal=p.local;instance.m_vRotateFinal=p.final;
    CKTDGXMeshPlayer::CXMeshEvent_Rotate event;event.m_Rotate=e.m_Rotate;event.m_ActualTime.m_Min=e.m_ActualTime.m_Min;event.m_ActualTime.m_Max=e.m_ActualTime.m_Max;event.fade=e.fade;
    event.OnFrameMove(&instance,p.now-p.old,p.old,p.now,false);p.local=instance.m_vRotateLocal;p.final=instance.m_vRotateFinal;
   }
   std::cout<<"{\"id\":\""<<id<<"\",\"rotate\":["<<p.local.x<<","<<p.local.y<<","<<p.local.z<<"],\"final\":["<<p.final.x<<","<<p.final.y<<","<<p.final.z<<"]}\n";
  }else return 5;
 }
 FreeLibrary(dll);
}
'''


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--matrix-source', default='.cache/matrix-source-v18/KTDGMatrix.cpp')
    p.add_argument('--particle-source', default='.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp')
    p.add_argument('--mesh-source', default='.cache/native-reference/KTDXLIB/KTDGXMeshPlayer.cpp')
    p.add_argument('--dll', default='asset_sources/client/data/d3dx9_43.dll')
    p.add_argument('--zig', required=True)
    p.add_argument('--inputs', required=True)
    p.add_argument('--output', default='artifacts/proof-xcrash-v19/native-matrix.json')
    a = p.parse_args()
    matrix = pinned(a.matrix_source, MATRIX_PIN)
    particle = pinned(a.particle_source, PARTICLE_PIN)
    mesh = pinned(a.mesh_source, MESH_PIN)
    if hashlib.sha256(Path(a.dll).read_bytes()).hexdigest() != DLL_PIN:
        raise ValueError('Only the frozen original shipped math DLL is allowed')
    functions = '\n\n'.join(function(matrix, sign) for sign in (
        'void CKTDGMatrix::Move(', 'void CKTDGMatrix::Rotate(',
        'void CKTDGMatrix::Scale(', 'const D3DXMATRIX& CKTDGMatrix::GetMatrix('))
    rotate = function(particle, 'void CKTDGParticleSystem::CParticleEvent_Rotate::OnFrameMove(')
    mesh_rotate = function(mesh, 'void CKTDGXMeshPlayer::CXMeshEvent_Rotate::')
    cache = Path('.cache/fx-matrix-v19').resolve()
    cache.mkdir(parents=True, exist_ok=True)
    source = cache / 'source-consumers.cpp'
    source.write_text(HARNESS.replace('MATRIX_FUNCTIONS', functions).replace('MESH_ROTATE_FUNCTION', mesh_rotate).replace('ROTATE_FUNCTION', rotate), encoding='utf-8')
    env = {**os.environ, 'ZIG_GLOBAL_CACHE_DIR': str(cache / 'zig-global'), 'ZIG_LOCAL_CACHE_DIR': str(cache / 'zig-local')}
    exe = cache / 'source-consumers.exe'
    subprocess.run([a.zig, 'c++', '-target', 'x86-windows-gnu', '-std=c++17', '-O2', str(source), '-o', str(exe)], check=True, env=env)
    result = subprocess.run([str(exe), str(Path(a.dll).resolve()), str(Path(a.inputs).resolve())], check=True, capture_output=True, text=True)
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    payload = {'schema': 'elsword.fx-matrix-source-v19', 'sourceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
               'matrixSourceSha256': MATRIX_PIN, 'particleSourceSha256': PARTICLE_PIN, 'meshSourceSha256': MESH_PIN, 'dllSha256': DLL_PIN,
               'scope': 'complete unchanged GetMatrix/Move/Rotate/Scale and particle/mesh Rotate event functions; recording App/range inputs and independent D3DX ABI bindings',
               'target2016ClientMeasured': False, 'gpuMeasured': False, 'compiledConsumerSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
               'harnessSha256': hashlib.sha256(HARNESS.encode()).hexdigest(),
               'inputsSha256': hashlib.sha256(Path(a.inputs).read_bytes()).hexdigest(),
               'sourceFunctionRanges': [
                   {'signature': signature, 'startLine': text[:text.index(body)].count('\n') + 1,
                    'endLine': text[:text.index(body)].count('\n') + 1 + body.count('\n')}
                   for text, signature in [
                       (matrix, 'void CKTDGMatrix::Move('), (matrix, 'void CKTDGMatrix::Rotate('),
                       (matrix, 'void CKTDGMatrix::Scale('), (matrix, 'const D3DXMATRIX& CKTDGMatrix::GetMatrix('),
                       (particle, 'void CKTDGParticleSystem::CParticleEvent_Rotate::OnFrameMove('),
                       (mesh, 'void CKTDGXMeshPlayer::CXMeshEvent_Rotate::')]
                   for body in [function(text, signature)]], 'cases': rows}
    output = Path(a.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'cases': len(rows), 'matrixCases': sum('matrix' in v for v in rows), 'rotateCases': sum('rotate' in v for v in rows), 'output': str(output)}))


if __name__ == '__main__':
    main()
