// Bounded RF host ABI. Original Gauge/User bodies are byte-preserved includes.
#define THEMIDA_ENCODE_START
#define THEMIDA_ENCODE_END
#define NULL nullptr
static float input[17], output[13];
#include "mana_constants.inc"
class CX2GageData {
public:
  struct Gage {float fNow=0,fMax=0;void Increase(float,float=0.f);};
  Gage mp,charge;
  float rate=0,m_fNowChargeMpForDetonation=0;
  bool canCharge=false,active=false;
  float GetNowMp()const{return mp.fNow;}
  void UpNowMp(float v){mp.Increase(v);}
  float GetNowChargeMpForDetonation()const{return charge.fNow;}
  void SetNowChargeMpForDetonation(float v){charge.fNow=v;}
  float GetMaxChargeMpForDetonation()const{return charge.fMax;}
  void SetMaxChargeMpForDetonation(float v){charge.fMax=v;}
  float GetChangeRateChargeMpForDetonation()const{return rate;}
  void UpNowChargeMpForDetonation(float v){charge.fNow+=v;}
  bool GetCanChargeMpForDetonation()const{return canCharge;}
  void SetCanChargeMpForDetonation(bool v){canCharge=v;}
  bool GetActivateDetonation()const{return active;}
  void SetActivateDetonation(bool v,float cost){active=v;m_fNowChargeMpForDetonation=cost;}
  void DetonationFrameMove(double,float);
  bool DamageFlushMp();
  bool UpdateDamageFlushMP();
};
struct D3DXVECTOR3 {float x=0,y=0,z=0;};
struct CX2DamageManager {enum {DT_BUFF=6};struct DamageData {int damageType=0;D3DXVECTOR3 backSpeed,impactPoint;};};
struct CKTDGObject {};
struct CKTDGParticleSystem {struct CParticleEventSequence {void SetLandPosition(float){}};};
struct MinorParticle {
  CKTDGParticleSystem::CParticleEventSequence seq;
  auto CreateSequence(CKTDGObject*,const wchar_t*,D3DXVECTOR3,int,int,int,int){output[10]+=1;return &seq;}
};
struct Game {MinorParticle p;auto GetMinorParticle(){return &p;}};
struct DGManager {void ClearScreen(int){}}; // Screen flash suppressed by user UI policy.
struct App {DGManager dg;auto GetDGManager(){return &dg;}};
static Game game;static App app;static Game* g_pX2Game=&game;static App* g_pKTDXApp=&app;
class CX2GUUser:public CKTDGObject {
public:
  enum {USI_DAMAGE_DOWN_FRONT=1,USI_DAMAGE_DOWN_BACK=2,USI_DAMAGE_AIR_DOWN_INVINCIBLE=3,
    USI_RIDING_DAMAGE_FRONT=4,USI_RIDING_DAMAGE_BACK=5};
  struct Frame {struct {bool bAttackerFront=false;D3DXVECTOR3 landPosition;}unitCondition;};
  Frame m_FrameDataFuture,m_FrameDataNow;
  struct {D3DXVECTOR3 nowSpeed;}m_PhysicParam;
  struct {bool pureZ=false,pureX=false;}m_OrgInputData;
  CX2GageData* gauge=nullptr;
  bool grounded=false,noDet=false,blocked=false;
  bool GetRidingOn(){return false;} // RF fixture has no riding subsystem.
  bool GetNoDetonation(){return noDet;}
  bool IsDetonationImpossibleByBuff(){return blocked;}
  auto GetGageData(){return gauge;}
  bool IsOnSomethingFuture(){return grounded;}
  void StateChange(int v,bool){output[7]=v;}
  void SetStopTime(float v){output[9]=v;}
  void DetonationEventProcess();
  void DetonationStateChange(CX2DamageManager::DamageData*);
};
#include "mana_gauge.inc"
#include "mana_user.inc"
extern "C" {
int mb_abi(){return 1;}
float* mb_input_ptr(){return input;}
float* mb_output_ptr(){return output;}
int mb_input_count(){return 17;}
int mb_output_count(){return 13;}
void mb_evaluate(int operation){
  for(auto& value:output)value=0;
  CX2GageData g;
  g.mp={input[0],input[1]};g.charge={input[2],input[3]};g.rate=input[4];
  g.canCharge=input[5]!=0;g.active=input[6]!=0;g.m_fNowChargeMpForDetonation=input[7];
  CX2GUUser user;user.gauge=&g;user.noDet=input[9]!=0;user.blocked=input[10]!=0;
  user.m_OrgInputData={input[11]!=0,input[12]!=0};user.grounded=input[13]!=0;
  user.m_FrameDataFuture.unitCondition.bAttackerFront=input[14]!=0;
  CX2DamageManager::DamageData damage;damage.backSpeed.y=input[15];damage.damageType=int(input[16]);
  if(operation==0)g.DetonationFrameMove(0,input[8]);
  else if(operation==1)user.DetonationEventProcess();
  else if(operation==2)output[6]=g.DamageFlushMp()?1:0;
  else if(operation==3)output[6]=g.UpdateDamageFlushMP()?1:0;
  else if(operation==4)user.DetonationStateChange(&damage);
  output[0]=g.mp.fNow;output[1]=g.charge.fNow;output[2]=g.charge.fMax;
  output[3]=g.canCharge?1:0;output[4]=g.active?1:0;output[5]=g.m_fNowChargeMpForDetonation;
  output[8]=user.m_PhysicParam.nowSpeed.y;output[11]=THREE_CHARGE;output[12]=ONE_CHARGE;
}
}
