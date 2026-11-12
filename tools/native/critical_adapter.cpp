// RF host objects; original getter and critical-block bytes are generated includes.
#define IN
#define OUT
#define NULL nullptr
using BYTE=unsigned char;
struct D3DXVECTOR3 {float x=0,y=0,z=0;};
static float input[19],output[10];
struct CKTDGObject {};
struct CKTDXRandomNumbers {enum {SRO_ATTACK_CRITICAL=0};};
struct CX2DamageManager {enum {DT_MAGIC=1,DT_MIX=2,DT_WEAPON_MAGIC=4,DT_WEAPON_MIX=5};};
struct DamageData {BYTE damageType=0;float m_fCriticalRate=0,m_fApplyCriticalDamage=0;int m_WayofSwordType=0;
  bool m_bPenetrate=false,m_bIgnoreStateDefence=false,m_bGuard=false,bCanRevenge=true;};
struct ExtraPack {
  struct {float m_fTime=0,m_fCriticalRateToDefender=0;} m_Panic;
  struct {float m_fTime=0,m_DamagePerSec=0;} m_StigmaDebuff;
};
class CX2GameUnit : public CKTDGObject {
public:
  ExtraPack m_ExtraDamagePack;
  float baseRate=0,criticalAttack=1.5f,antiRate=0,criticalDefence=1,roll=0;
  int m_DamageReducePercent=0,m_DamageGuardPercent=0;
  bool IsIgnoreStateGuardByBuff(){return false;}
  float ReduceDamage(float fFinalDamage,DamageData* pAttDamageData){
    #include "damage_reduce.inc"
    return fFinalDamage;
  }
  virtual float GetCriticalPercent(BYTE,float=0){return 0;}
  virtual float GetCriticalValue(float=0){return criticalAttack;}
  virtual int GetGameUnitType(){return 1;}
  float GetCriticalRate(){return baseRate;}
  float GetCriticalDefence(){return criticalDefence;}
  float GetAntiCritialRate(){return antiRate;}
  float GetRandomFloat(int){return roll;}
  const float GetCriticalValueFromDefender();
  void SetCriticalPercent_WayOfSword(int,float&) {} // RF has no WayOfSword.
};
struct Particle {
  void CreateSequence(CKTDGObject*,const wchar_t*,D3DXVECTOR3 p){output[1]=1;output[3]=p.x;output[4]=p.y;output[5]=p.z;}
};
struct Camera {void ImpactForward(float,float,float,float,int){};};
struct CameraHost {Camera c;Camera& GetCamera(){return c;}};
struct Game {Particle p;CameraHost c;Particle* GetMajorParticle(){return &p;}CameraHost* GetX2Camera(){return &c;}};
static Game game;static Game* g_pX2Game=&game;
class CX2GUUser : public CX2GameUnit {
public:
  enum {GUT_USER=1};
  float m_fPassiveCriticalRate=0,m_fShadowOfDisasterRate=0,m_fAntiCriticalRate=0,magicRate=0,magicDamage=0;
  struct {float m_fTime=0,m_fCriticalRate=0;} m_petCheer;
  void* m_pFrame_Bip01_Head=nullptr;
  float GetCriticalPercent(BYTE,float=0) override;
  float GetAddMagicAttackCriticalRate(){return magicRate;}
  float GetAddMagicAttackCriticalDamageRate(){return magicDamage;}
  void GetFramePos(D3DXVECTOR3* p,void*){p->x=input[15];p->y=input[16];p->z=input[17];}
  void UpDownCrashCamera(float,float){} // User explicitly disables camera shake.
  void PlaySound(const wchar_t*){output[6]+=1;}
  bool m_bIsLimitCrusherCharge=false;
  int limitState=0;
  void StateChange(int value){limitState=value;}
  void LimitRevenge(DamageData* pDamageData);
  void CriticalDamage(float& fFinalDamage,DamageData* pDamageData,CX2GameUnit* pAttackerUnit){
    bool bBackAttack=false,bCriticalHit=false,bShowRedPicture=false;
    #include "critical_position.inc"
    #include "critical_damage.inc"
    output[2]=bShowRedPicture?1:0;
  }
};
class CX2GURaven : public CX2GUUser {
public:
  enum {RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK=1,RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK=2};
  void CommonStateStart(){};void CommonStateEnd(){};
  void RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateStart();
  void RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateEnd();
};
#include "limit_lifecycle.inc"
void CX2GUUser::LimitRevenge(DamageData* pDamageData){
  #include "limit_revenge.inc"
}
#include "critical_getters.inc"
extern "C" {
int nl_phase(int charging,int phase){
  CX2GURaven actor;actor.m_bIsLimitCrusherCharge=charging!=0;
  if(phase==1)actor.RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateStart();
  else if(phase==2)actor.RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateEnd();
  return actor.m_bIsLimitCrusherCharge?1:0;
}
int nl_revenge(int charging,int canRevenge){
  CX2GUUser actor;DamageData damage;actor.m_bIsLimitCrusherCharge=charging!=0;damage.bCanRevenge=canRevenge!=0;
  actor.LimitRevenge(&damage);return actor.limitState;
}
int nc_abi(){return 1;}
int nc_input_count(){return 19;}
int nc_output_count(){return 10;}
float* nc_input_ptr(){return input;}
float* nc_output_ptr(){return output;}
float nr_evaluate(float amount,int percent,int penetrate,int ignoreStateDefence,int guard,int guardPercent){
  CX2GameUnit defender;DamageData damage;
  defender.m_DamageReducePercent=percent;defender.m_DamageGuardPercent=guardPercent;
  damage.m_bPenetrate=penetrate!=0;damage.m_bIgnoreStateDefence=ignoreStateDefence!=0;damage.m_bGuard=guard!=0;
  return defender.ReduceDamage(amount,&damage);
}
void nc_evaluate(){
  for(float& v:output)v=0;
  CX2GUUser attacker,defender;
  attacker.baseRate=input[1];attacker.criticalAttack=input[2];attacker.m_fPassiveCriticalRate=input[3];
  attacker.magicRate=input[4];attacker.magicDamage=input[5];attacker.m_fShadowOfDisasterRate=input[6];
  defender.roll=input[7];defender.antiRate=input[8];defender.m_fAntiCriticalRate=input[9];defender.criticalDefence=input[10];
  defender.m_ExtraDamagePack.m_Panic.m_fTime=input[11];defender.m_ExtraDamagePack.m_Panic.m_fCriticalRateToDefender=input[12];
  DamageData data;data.damageType=(BYTE)input[13];data.m_fCriticalRate=input[14];data.m_fApplyCriticalDamage=input[18];
  float amount=input[0];defender.CriticalDamage(amount,&data,&attacker);output[0]=amount;
  output[7]=attacker.GetCriticalPercent(data.damageType,data.m_fCriticalRate);
  output[8]=defender.GetCriticalValueFromDefender();output[9]=attacker.GetCriticalValue();
}
}
