// Bounded storage around byte-preserved reference functions. Host IDs preserve
// the original damage-state interval; they are not the client's numeric IDs.
#define UPGRADE_RAVEN
#define X2OPTIMIZE_PARTICLE_AND_ETC_HANDLE
#define SERV_CHUNG_TACTICAL_TROOPER
#define RIDING_SYSTEM
#define NULL 0
struct D3DXVECTOR2{float x,y;D3DXVECTOR2(float a=0,float b=0):x(a),y(b){}};
struct D3DXVECTOR3{float x,y,z;D3DXVECTOR3(float a=0,float b=0,float c=0):x(a),y(b),z(c){}
 D3DXVECTOR3 operator*(float f)const{return{x*f,y*f,z*f};}D3DXVECTOR3&operator*=(float f){x*=f;y*=f;z*=f;return*this;}
 D3DXVECTOR3 operator+(D3DXVECTOR3 v)const{return{x+v.x,y+v.y,z+v.z};}};
static D3DXVECTOR3 operator*(float f,D3DXVECTOR3 v){return v*f;}
struct D3DXCOLOR{float r,g,b,a;D3DXCOLOR(float w,float x,float y,float z):r(w),g(x),b(y),a(z){}};
struct CKTDGXSkinAnim{enum{XAP_ONE_WAIT=2};};
struct HostMesh{float scale=0;int animation=0;D3DXVECTOR3 position;D3DXCOLOR color{0,0,0,0};
 void SetScale(float x,float,float){scale=x;}void ChangeAnim(const wchar_t*,int,float){animation=1;}
 void SetOutlineColor(D3DXCOLOR c){color=c;}void SetPos(D3DXVECTOR3 p){position=p;}void SetDirSpeed(float){}};
struct CKTDGXMeshPlayer{using CXMeshInstance=HostMesh;};
struct CX2DamageEffect{struct CEffect{HostMesh mesh;HostMesh*GetMainEffect(){return&mesh;}
 void SetAttackTime(D3DXVECTOR2){}void SetLandPos(float){}};CEffect effect;CEffect*GetInstance(int){return&effect;}
 bool IsLiveInstance(CEffect*){return true;}};
struct HostGame{CX2DamageEffect damage;CX2DamageEffect*GetDamageEffect(){return&damage;}};
static HostGame game;static HostGame*g_pX2Game=&game;
struct CX2Unit{enum{UT_RAVEN=3};int GetType(){return UT_RAVEN;}};
struct CX2DamageManager{
 enum{EDT_MANA_DAMAGE=1,EDT_DAMAGE_RATE=2,EDT_WATER_HOLD=3,EDT_ATTACK_ALL_TEAM=4,
 RT_DUMMY_DAMAGE=7,RT_SENSOR=10,HT_GROUND_HIT=26};
 struct DamageData{struct Extra{int m_ExtraDamageType=0;}m_ExtraDamage;
 bool m_bNoDamage=false;float m_fHpPercentUp=0,m_fIncreaseMP=0;int reActResult=1,hitType=1;};};
class CX2GURaven;
class CX2GUUser{public:
 enum{USI_JUMP_UP=1,USI_JUMP_DOWN=2,USI_DASH_JUMP=3,USI_DAMAGE_GROGGY=100,USI_DAMAGE_GRAPPLED_FRONT=118};
 struct Frame{struct Condition{bool bFootOnLine,bAttackerFront;}unitCondition;}m_FrameDataFuture,m_FrameDataNow;
 bool m_bParryingState=false,held=false,grappled=false,riding=false,superArmor=false;float hyperRemaining=0;
 CX2Unit unit;CX2Unit*GetUnit(){return&unit;}bool GetHold(){return held;}bool GetGrap(){return grappled;}
 Frame&GetFrameData(){return m_FrameDataNow;}
 bool GetRidingOn(){return riding;}bool IsSuperArmor(){return superArmor;}float GetRemainHyperModeTime(){return hyperRemaining;}
 void DamageReact_ExtraDamage(CX2DamageManager::DamageData*,bool){}
 void ComputeNasodGuard(CX2DamageManager::DamageData*pDamageData);
};
class CX2GURaven:public CX2GUUser{public:
 enum{RSI_COMBO_ZZZX=200,RBM_COMBO_ZZZXZ=201,RBM_COMBO_ZZZX_EXPLOSION=202};
 struct Ball{int m_hEffect=1;CX2DamageEffect::CEffect*m_pEffect=&game.damage.effect;}ball;
 Ball*m_pNasodBall=nullptr;bool m_bParrying=false,m_bCanParrying=false,m_bDelayAttackNasodBall=false,m_bAttackNasodBall=false;
 float m_fParryingTime=0,m_fDelayAttackTime=0,m_fNasodBallAttackTime=0,m_fRageGauge=0,m_fElapsedTime=0;
 int m_iNaosdBallLv=0,state=0,random=1,characterAnimation=0,soundCount=0;bool right=true,restored=false;
 struct Anim{int*output;void ChangeAnim(const wchar_t*,bool){*output=1;}}anim{&characterAnimation};
 struct AnimRef{Anim*p;Anim*get(){return p;}}m_pXSkinAnim{&anim};
 int GetNowStateID(){return state;}bool GetIsRight(){return right;}D3DXVECTOR3 GetDirVector(){return{1,0,0};}
 D3DXVECTOR3 GetPos(){return{0,0,0};}D3DXVECTOR3 GetScaleByUnit(){return{1,1,1};}
 int GetRandomInt(int){return random;}void CommonStateStart(){}void CommonStateEnd(){}
 void PlaySound(const wchar_t*){++soundCount;}void RestoreNasodBall(){restored=true;}
 bool IsAttackNasodBall(){return m_bAttackNasodBall;}bool GetParrying(){return m_bParrying;}
 bool CanParrying(){return m_bCanParrying;}int GetNasodBall(){return m_iNaosdBallLv;}
 bool CanParryingState();void DoParrying();void RSI_PARRYING_Start();void RSI_PARRYING_StateEnd();
 void TickParrying();
};
#include "original_nasod_methods.inc"
void CX2GUUser::ComputeNasodGuard(CX2DamageManager::DamageData*pDamageData){
#include "original_nasod_gate.inc"
}
void CX2GURaven::TickParrying(){
#include "original_nasod_timer.inc"
}
static float input[20],output[24];
extern "C" unsigned ns_abi(){return 1;}
extern "C" float*ns_input(){return input;}
extern "C" float*ns_output(){return output;}
extern "C" void ns_eval(unsigned kind){
 CX2GURaven r;game.damage.effect={};
 r.state=(int)input[0];r.m_FrameDataNow.unitCondition.bFootOnLine=input[1]!=0;
 r.m_FrameDataFuture.unitCondition.bAttackerFront=input[2]!=0;r.hyperRemaining=input[3];
 r.m_iNaosdBallLv=(int)input[4];r.m_fRageGauge=input[5];r.m_bParrying=input[6]!=0;r.m_bCanParrying=input[7]!=0;
 r.m_fParryingTime=input[8];r.m_bAttackNasodBall=input[9]!=0;r.superArmor=input[10]!=0;
 r.held=input[11]!=0;r.grappled=input[12]!=0;r.riding=input[13]!=0;r.m_fElapsedTime=input[14];
 r.m_pNasodBall=input[15]!=0?&r.ball:nullptr;r.right=input[16]!=0;r.random=(int)input[17];
 CX2DamageManager::DamageData d;unsigned flags=(unsigned)input[18];
 d.m_bNoDamage=flags&1;d.m_fHpPercentUp=(flags&2)?1:0;d.m_fIncreaseMP=(flags&4)?1:0;
 d.reActResult=(flags&8)?7:(flags&16)?10:1;d.hitType=(flags&32)?26:1;d.m_ExtraDamage.m_ExtraDamageType=(int)input[19];
 if(kind==0)r.ComputeNasodGuard(&d);else if(kind==1)r.RSI_PARRYING_Start();else if(kind==2)r.TickParrying();else if(kind==3)r.RSI_PARRYING_StateEnd();
 output[0]=r.m_bParryingState;output[1]=r.CanParryingState();output[2]=r.m_bParrying;output[3]=r.m_bCanParrying;
 output[4]=r.m_fParryingTime;output[5]=r.m_fRageGauge;output[6]=(float)r.m_iNaosdBallLv;
 output[7]=r.m_bAttackNasodBall;output[8]=r.m_bDelayAttackNasodBall;output[9]=r.m_fDelayAttackTime;output[10]=r.m_fNasodBallAttackTime;
 output[11]=game.damage.effect.mesh.scale;output[12]=game.damage.effect.mesh.animation;
 output[13]=game.damage.effect.mesh.position.x;output[14]=game.damage.effect.mesh.position.y;
 output[15]=r.characterAnimation;output[16]=r.soundCount;output[17]=r.restored;
 output[18]=game.damage.effect.mesh.color.r;output[19]=game.damage.effect.mesh.color.g;output[20]=game.damage.effect.mesh.color.b;
}
