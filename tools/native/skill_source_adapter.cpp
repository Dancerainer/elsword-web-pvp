// Project-owned host boundary around unchanged, hash-verified RF callbacks.
// CommonFrameMove/EventProcess remain the existing shared simulation boundary.
// Slot swaps are disabled by the product's single eight-key bar requirement.
#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE
#define X2OPTIMIZE_PARTICLE_AND_ETC_HANDLE
#define BALANCE_PATCH_20110303
#define UPGRADE_SKILL_SYSTEM_2013
#define BALANCE_BLADE_MASTER_20130117
// Original Shadow dispatch is compiled under this explicit reference branch;
// it is not an assertion about target2016 skill/passive state bindings.
#define SERV_RAVEN_VETERAN_COMMANDER
#define ASSERT(value) ((void)0)
// This is an explicit conditional-branch compile policy, not target2016 proof.
#define SERV_SKILL_NOTE
#define NULL 0
#define null nullptr
#define LINE_RADIUS 30.0f
#define SAFE_DELETE(p) do{delete(p);(p)=nullptr;}while(0)
using UINT=unsigned;
using DAMAGE_EFFECT_HANDLE=unsigned;
struct CX2EffectSet{using Handle=int;};
static constexpr unsigned INVALID_DAMAGE_EFFECT_HANDLE=0;
static constexpr int XL_EFFECT_0=0;
static bool drillEnabled,drillHitCleared,drillDamageReplaced;
static unsigned drillBoxMask,drillHelperMask;
union DrillWord{float f;unsigned u;};
static DrillWord drillSnapshot[25];
static float skillMotionSnapshot[2];
static float skillExtraSnapshot[8];
// Explicit Now Bip01 input and persistent m_vXCrashPos. No actor-center substitute.
static float xCrashSnapshot[6];
static float vectorLockOnSnapshot[11];
static bool vectorLockOnEnabled;
static constexpr unsigned INVALID_PARTICLE_SEQUENCE_HANDLE=0xffffffffu;
static constexpr unsigned INVALID_MESH_INSTANCE_HANDLE=0xffffffffu;
namespace std {
template<class T> struct vector {
    T values[4]{};unsigned count=0;
    unsigned size()const{return count;}bool empty()const{return count==0;}
    T& operator[](unsigned i){return values[i];}
    T* begin(){return values;}
    void erase(T* at){unsigned i=unsigned(at-values);for(;i+1<count;++i)values[i]=values[i+1];if(count)--count;}
    void resize(unsigned n){count=n;if(drillEnabled&&n==0)drillHitCleared=true;}
    void push_back(T value){if(count<4)values[count++]=value;}
};
}
alignas(16) static unsigned char arcAllocation[512];static unsigned arcAllocationCount;
void* operator new(__SIZE_TYPE__){return arcAllocation+64*(arcAllocationCount++);}
void operator delete(void*)noexcept{}
void operator delete(void*,__SIZE_TYPE__)noexcept{}
enum { RSI_SA_RRF_WILD_CHARGING=1, RSI_SA_RRF_WILD_CHARGE_DASH=2,
       USI_WAIT=3, USI_JUMP_DOWN=4, RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK=5,
       RSI_A_RWT_FLAME_SWORD_FLY=6, RSI_A_RWT_FLAME_SWORD_GROUND=7,
       USI_JUMP_LANDING=8, RSI_SA_ROT_VALKYRIESJAVELIN_LANDING=9,
       RSI_SHADOW_STEP_THRUST=10, RSI_SHADOW_STEP_THRUST_ENHANCE=11,
       RSI_P_RRF_SHADOW_PUNISHER=12, RVC_SI_P_SHADOW_BACK_SLIDE=13,
       RVC_SI_P_SHADOW_BACK_SLIDE_END=14, RVC_SI_P_SHADOW_BUSTER=15,
       RVC_SI_P_SHADOW_STEP_FINISH=16, USI_DASH=17 };
using RAVEN_STATE_ID=int;
template<class T>T max(T a,T b){return a>b?a:b;}
static bool shadowEnabled;union ShadowWord{float f;unsigned u;int i;};
static ShadowWord shadowSnapshot[48];
static unsigned shadowPreparedMesh,shadowInfoCalls,shadowUiCalls,shadowDashRequests;
static unsigned effects, sounds, commonCalls, cancelCalls;
static float effectPower;
static unsigned effectHyperMask;
struct D3DXVECTOR3 {
    float x,y,z;
    D3DXVECTOR3(float a=0,float b=0,float c=0):x(a),y(b),z(c){}
    D3DXVECTOR3 operator*(float f)const{return {x*f,y*f,z*f};}
    D3DXVECTOR3 operator+(D3DXVECTOR3 v)const{return {x+v.x,y+v.y,z+v.z};}
    D3DXVECTOR3 operator-(D3DXVECTOR3 v)const{return {x-v.x,y-v.y,z-v.z};}
    D3DXVECTOR3& operator*=(float f){x*=f;y*=f;z*=f;return *this;}
    D3DXVECTOR3& operator+=(const D3DXVECTOR3& v){x+=v.x;y+=v.y;z+=v.z;return *this;}
    D3DXVECTOR3& operator-=(const D3DXVECTOR3& v){x-=v.x;y-=v.y;z-=v.z;return *this;}
};
static D3DXVECTOR3 operator*(float f,D3DXVECTOR3 v){return v*f;}
static float D3DXToRadian(float value){return value*0.017453292519943295f;}
static float D3DXToDegree(float value){return value*57.29577951308232f;}
static void D3DXVec3Normalize(D3DXVECTOR3* out,const D3DXVECTOR3* v){
    float length=__builtin_sqrtf(v->x*v->x+v->y*v->y+v->z*v->z);
    *out=length>0?*v*(1.f/length):D3DXVECTOR3{};
}
struct D3DXVECTOR2{float x,y;D3DXVECTOR2(float a=0,float b=0):x(a),y(b){}};
class CKTDGObject{};
class CX2GameUnit{public:enum{GUT_USER=0,GUT_NPC=1};unsigned uid;int type;
    int GetGameUnitType(){return type;}unsigned GetUnitUID(){return uid;}};
class CX2GUUser:public CX2GameUnit{public:void AttackResultPlayEffect(){++commonCalls;}};
struct CX2DamageManager{enum{RT_DUMMY_DAMAGE=1,RT_BIG_DAMAGE=2,AT_UNIT=0};}; // Host semantic tags; native enum numbers are not transported.
struct CX2SkillTree{
    enum{SMI_RAVEN_MEMO10=10,SMI_RAVEN_MEMO4=4,SMI_RAVEN_MEMO6=6,SMI_RAVEN_MEMO7=7,
         SI_A_RF_SHADOW_STEP=24200,SA_TELEPORT_RANGE_ABS=1};
    struct SkillTemplet{int m_eID=SI_A_RF_SHADOW_STEP;
        float GetSkillAbilityValue(int,int)const{return shadowSnapshot[2].f;}
        float GetSkillCoolTimeValue(int)const{return shadowSnapshot[3].f;}};
}; // Symbolic host tags, not native enum numeric provenance.
struct CX2UserSkillTree{int GetSkillLevel(int)const{return shadowSnapshot[4].i;}
    void SetSkillCoolTimeLeft(int,float value){shadowSnapshot[32].f=value;shadowSnapshot[33].u=1;}};
struct ShadowUnitData{CX2UserSkillTree m_UserSkillTree;};
struct ShadowUnit{ShadowUnitData data;const ShadowUnitData& GetUnitData(){return data;}
    ShadowUnitData& AccessUnitData(){return data;}};
union ArcWord{float f;unsigned u;int i;};
static ArcWord arcSnapshot[304];static bool arcEnabled;static unsigned arcVisualCount,arcRandCount,arcNextHandle,arcEffectCount,arcTimerRestarts;
struct ArcVisual{unsigned name;D3DXVECTOR3 pos,rot,axis;} arcVisual[4];
static int rand(){unsigned value=arcRandCount<4?arcSnapshot[12+arcRandCount].u:0;++arcRandCount;return int(value);}
struct ArcAnim{float reset=0;void Reset(float value){reset=value;}};
struct CKTDGXMeshPlayer {
    struct CXMeshInstance {
        D3DXVECTOR3 pos,rot,axis,manualDir;float dirSpeed=0,nowLife=0,maxLife=0;ArcAnim anim;unsigned handle=0;
        D3DXVECTOR3 GetPos(){return pos;}void SetPos(D3DXVECTOR3 p){pos=p;}
        unsigned GetHandle(){return handle;}
        void SetRotateDegree(D3DXVECTOR3 r){rot=r;}void SetMoveAxisAngleDegree(D3DXVECTOR3 r){axis=r;}
        ArcAnim* GetXSkinAnim(){return &anim;}void SetDirSpeed(float n){dirSpeed=n;}
        void SetNowLifeTime(float n){nowLife=n;}void SetMaxLifeTime(float n){maxLife=n;}
        D3DXVECTOR3 GetManualDirDegree(){return manualDir;}
        void SetManualDirDegree(D3DXVECTOR3 v){manualDir=v;}void UseManualDirDegree(bool){}
    };
    CXMeshInstance visualInstance;
    CXMeshInstance* CreateInstance(CKTDGObject*,const wchar_t* name,D3DXVECTOR3 p,D3DXVECTOR3 r,D3DXVECTOR3 a,int){
        unsigned code=0;
        const wchar_t* names[]={L"Raven_Overtaker_Sp2a_FlyingImpact_Start_01",L"Raven_Overtaker_Sp2a_FlyingImpact_Start_02",L"Raven_Overtaker_Sp2a_FlyingImpact_Start_03",L"Raven_Overtaker_Sp2a_FlyingImpact_Start_04"};
        for(unsigned i=0;i<4;++i){const wchar_t* x=name;const wchar_t* y=names[i];while(*x&&*x==*y){++x;++y;}if(*x==*y)code=i+1;}
        if(arcVisualCount<4)arcVisual[arcVisualCount++]={code,p,r,a};return &visualInstance;
    }
    CXMeshInstance* CreateInstance(CKTDGObject*,const wchar_t*,D3DXVECTOR3 p,D3DXVECTOR3 r,D3DXVECTOR3 a){
        drillHelperMask|=2;visualInstance.pos=p;visualInstance.rot=r;visualInstance.axis=a;
        visualInstance.handle=drillSnapshot[18].u;
        return visualInstance.handle==INVALID_MESH_INSTANCE_HANDLE?nullptr:&visualInstance;
    }
    CXMeshInstance* GetMeshInstance(unsigned handle){
        if(vectorLockOnEnabled)return &visualInstance;
        if(drillSnapshot[13].u||handle==drillSnapshot[18].u){drillHelperMask|=8;return &visualInstance;}
        return nullptr;
    }
};
struct CX2DamageEffect {
    // X2DamageEffect.h:522-529 original constructor initializes both to -1.
    // UID host boundary is explicitly32 bits; NPC remains signed int32.
    struct LockOnData{unsigned m_LockOnUnitUID=0xffffffff;int m_LockOnNPCUID=-1;float m_fCurveSpeed=0;};
    struct CEffect{
        unsigned handle=0,name=0;bool alive=false,hasMesh=false,created=false;
        float power=0,landY=0;D3DXVECTOR2 attackTime;LockOnData lock;CKTDGXMeshPlayer::CXMeshInstance mesh;
        CKTDGXMeshPlayer::CXMeshInstance* GetMainEffect(){return hasMesh?&mesh:nullptr;}
        unsigned GetHandle(){return handle;}LockOnData& GetLockOnData(){return lock;}
        void SetAttackTime(D3DXVECTOR2 t){attackTime=t;}void SetLandPos(float y){landY=y;}
        unsigned m_hMeshInstHandle=1;LockOnData m_LockOnData;float m_fElapsedTime=0;
        void VectorLockOn(const D3DXVECTOR3& targetPos);
    };
};
static CX2DamageEffect::CEffect arcEffects[8];
static unsigned damageCode,particleCode,cameraCalls,cutinCalls,colorCalls;
static D3DXVECTOR3 damagePos,damageRotation,particlePos,particleRotation;
static float damageLandY,damagePower,particleLandY,executionTime;
static bool same(const wchar_t* a,const wchar_t* b){while(*a&&*a==*b){++a;++b;}return *a==*b;}
struct EffectSink {
    int PlayEffectSet(const wchar_t* name,void*,void* = nullptr,bool hyper=false,float power=1) {
        unsigned bit=0;
        if(same(name,L"EffectSet_WILD_CHARGE_MAX"))bit=1;
        if(same(name,L"EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK"))bit=2;
        if(same(name,L"EffectSet_Raven_Shadow_Buster"))bit=4;
        if(same(name,L"EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW"))bit=8;
        if(same(name,L"EffectSet_RF_WILD_CHARGE_CHARGING"))bit=16;
        effects|=bit;
        // X2EffectSet.cpp:1866 stores the explicit argument, default false.
        // Its delayed consumers select HYPER_NAME from that saved mode.
        if(hyper)effectHyperMask|=bit;
        effectPower=power;return 1;
    }
    void StopEffectSet(int){effects|=32;}
};
struct DamageSink {
    CX2DamageEffect::CEffect* CreateInstance(CX2GameUnit* owner,const wchar_t* name,float power,D3DXVECTOR3 pos,D3DXVECTOR3 rotation,D3DXVECTOR3 axis){
        if(same(name,L"RRF_X_CRASH_NODAMAGE"))damageCode=3;
        else if(same(name,L"RRF_X_CRASH_NODAMAGE_HYPER"))damageCode=4;
        damagePos=pos;damageRotation=rotation;damagePower=power;
        return nullptr; // Creation is transported to the host; this callback never dereferences it.
    }
    CX2DamageEffect::CEffect* CreateInstance(CX2GameUnit*,const wchar_t* name,float power,D3DXVECTOR3 pos,D3DXVECTOR3 rotation,D3DXVECTOR3 axis,float landY){
        if(same(name,L"RAVEN_OVER_TAKER_CHARGED_BOLT"))damageCode=1;
        if(same(name,L"RAVEN_OVER_TAKER_CHARGED_BOLT_MEMO"))damageCode=2;
        damagePos=pos;damageRotation=rotation;damageLandY=landY;damagePower=power;
        if(arcEnabled){unsigned at=0;while(at<arcEffectCount&&arcEffects[at].alive)++at;
            if(at==arcEffectCount){if(arcEffectCount>=8)return nullptr;++arcEffectCount;}
            auto* e=&arcEffects[at];*e={};e->handle=arcNextHandle++;e->alive=e->hasMesh=e->created=true;
            e->name=same(name,L"RAVEN_OVER_TAKER_ARC_ENEMY_MEMO")?2:same(name,L"RAVEN_OVER_TAKER_ARC_ENEMY")?1:
                same(name,L"RAVEN_OVER_TAKER_ARC_ENEMY_HYPER")?4:same(name,L"RAVEN_OVER_TAKER_ARC_ENEMY_MEMO_HYPER")?5:
                same(name,L"RAVEN_OVER_TAKER_FLYING_IMPACT_HYPER")?6:3;
            e->power=power;e->landY=landY;e->mesh.pos=pos;e->mesh.rot=rotation;e->mesh.axis=axis;
            e->mesh.maxLife=arcSnapshot[16].f;return e;}
        return nullptr;
    }
    CX2DamageEffect::CEffect* GetInstance(unsigned handle){for(unsigned i=0;i<arcEffectCount;++i)if(arcEffects[i].handle==handle&&arcEffects[i].alive)return &arcEffects[i];return nullptr;}
    void DestroyInstanceHandle(unsigned handle){auto* e=GetInstance(handle);if(e)e->alive=false;}
};
struct CKTDGParticleSystem {
    struct CParticleEventSequence {
        void SetAxisAngle(D3DXVECTOR3 rotation){particleRotation=rotation;}
        void SetLandPosition(float landY){particleLandY=landY;}
        void SetPosition(D3DXVECTOR3){drillHelperMask|=4;}
    } sequence;
    CParticleEventSequence* CreateSequence(CKTDGObject*,const wchar_t* name,D3DXVECTOR3 pos){
        if(same(name,L"Flare_Raven_Overtaker_Sp1a_ChargedBolt02"))particleCode=1;
        particlePos=pos;return &sequence;
    }
    unsigned CreateSequenceHandle(CKTDGObject*,const wchar_t*,D3DXVECTOR3){drillHelperMask|=1;return drillSnapshot[17].u;}
    CParticleEventSequence* GetInstanceSequence(unsigned handle){
        return drillSnapshot[12].u||handle==drillSnapshot[17].u?&sequence:nullptr;
    }
};
struct InfoSink{template<class... T>void PushText(T...){++shadowInfoCalls;}};
static constexpr int XUF_DODUM_20_BOLD=0,STR_ID_2549=0,DT_CENTER=0;
static int GET_STRING(int){return 0;}struct D3DXCOLOR{D3DXCOLOR(float,float,float,float){}};
struct GameSink{EffectSink sink;DamageSink damage;CKTDGParticleSystem particles;CKTDGXMeshPlayer meshes;InfoSink info;
    EffectSink* GetEffectSet(){return &sink;}DamageSink* GetDamageEffect(){return &damage;}
    CKTDGParticleSystem* GetMajorParticle(){return &particles;}CKTDGXMeshPlayer* GetMajorXMeshPlayer(){return &meshes;}
    InfoSink& GetInfoTextManager(){return info;}void UpdateSkillSlotUI(){++shadowUiCalls;}};
static GameSink game; static GameSink* g_pX2Game=&game;
struct CKTDGXSkinAnim {
    float m_fAnimCurrTime,m_fAnimBeforeTime,m_fAnimOneshotTimer;bool ended;
    bool IsAnimationEnd(){return ended;}
    float GetNowAnimationTime(){return m_fAnimCurrTime;}
    D3DXVECTOR3 GetCloneFramePosition(const wchar_t*){return {xCrashSnapshot[0],xCrashSnapshot[1],xCrashSnapshot[2]};}
    bool EventTimer(float);
    #include "original_skill_timer_inline.inc"
};
#include "original_skill_timer_out.inc"
struct WildChargeData {
    float power,afterFull,hpPrevious;bool held;
    int handle=0;
    float GetPowerRateWildCharging(){return power;}
    void SetPowerRateWildCharging(float p){power=p;}
    float GetTimeAfterFullCharging(){return afterFull;}
    void SetTimeAfterFullCharging(float p){afterFull=p;}
    float GetHpEachWildChargeFrame(){return hpPrevious;}
    void SetHpEachWildChargeFrame(float p){hpPrevious=p;}
    bool GetChargeKey(){return held;}
    void SetHandleWildCharingEffectSet(int value){handle=value;}
    int GetHandleReferenceWildCharingEffectSet(){return handle;}
};
struct KeyManager {
    bool held;
    void CheckSkillSlotSwap(){}
    template<class T> bool IsUnpressedCurrentSkillKey(T){return !held;}
};
// The original cancellation macros call the full movement/input host. Record
// this boundary; do not execute invented successors inside the source module.
#define WALK_CANCEL_AFTER(value) ++cancelCalls;
#define DASH_CANCEL_AFTER(value) ++cancelCalls;
#define SKILL_CANCEL_AFTER(value) ++cancelCalls;
#define SKILL_CANCEL_AFTER_FLY(value) ++cancelCalls;
struct NativeInput {
    bool pureUp,pureDown,pureRight,pureLeft,pureZ,pureX,pureA,pureS,pureD,pureC,pureQ,pureW,pureE,pureR,pureLCtr;
};
// The exact original skip-input macros are generated from the pinned header.
#include "original_skill_macros.inc"
class CX2GURaven:public CX2GUUser {
public:
    struct ArcEnemyData{D3DXVECTOR3 m_vOffsetRotate,m_vOffsetPos;DAMAGE_EFFECT_HANDLE m_hEffect;
        ArcEnemyData();~ArcEnemyData();};
    std::vector<ArcEnemyData*> m_vecArcEnemyData;float m_fArcEnemyEachTime=0;
    struct {void restart(){++arcTimerRestarts;}}m_TimerFlyingImpact;
    struct {int reActResult,defenderType;CX2GameUnit* optrDefenderGameUnit;
        struct{float fPhysic,fMagic;}damage;struct{float m_DamagePerSec;}m_ExtraDamage;int reActType;
        std::vector<unsigned> hitUnitList;bool bReAttack=false;float fHitGap=0;D3DXVECTOR2 backSpeed;
        int attackerType;CX2GameUnit* optrAttackerGameUnit;
        // Whole target DAMAGE_DATA_NEXT is loaded by the host, not fabricated
        // by this bounded SimpleInit/SetDamageData boundary.
        void SimpleInit(){hitUnitList.resize(0);bReAttack=false;fHitGap=0;backSpeed={};}
    }m_DamageData;
    struct{struct{bool bSuperArmorNotRed;}stateParam;struct{struct{float y;}landPosition;}unitCondition;
        struct{bool bFrameStop;}syncData;}m_FrameDataNow;
    struct{struct{struct{float y;}position;}syncData;struct{float fStateTime;}unitCondition;}m_FrameDataFuture;
    struct{D3DXVECTOR2 passiveSpeed,nowSpeed;float fDownAccel,fGAccel;}m_PhysicParam;
    std::vector<int> m_vecEffectSetToDeleteOnDamageReact;
    bool m_bDisableGravity;int damageReducePercent;
    int GetDamageReducePercent(){return damageReducePercent;}
    void SetDamageReducePercent(int value){damageReducePercent=value;}
    struct{float GetDashSpeed(){return drillSnapshot[1].f;}}m_OrgPhysicParam;
    struct{float m_fPowerRate;int stateID;}m_NowStateData;
    struct{bool BeginTableByReference(int){return drillSnapshot[9].u;}void EndTable(){}}m_LuaManager;
    float m_fDamageDataChangeTime;
    unsigned m_hSeqMagnumBlaster1,m_hMesh_MagnumBlaster2;
    void SetDamageData(const char*){drillDamageReplaced=true;drillSnapshot[24].u=1;}
    D3DXVECTOR3 GetBonePos(const wchar_t*){return {drillSnapshot[14].f,drillSnapshot[15].f,drillSnapshot[16].f};}
    void SetEnableAttackBox(const wchar_t* name,bool enabled){
        if(same(name,L"Lhand1")){drillSnapshot[7].u=enabled;drillBoxMask|=1;}
        if(same(name,L"Sword")){drillSnapshot[8].u=enabled;drillBoxMask|=2;}
    }
    float m_fShadowStepTimeLeft,m_fShadowBackSlideTimeLeft,m_fShadowStepCooTime;
    float m_fAttackPowerRateShadowStepThrust,m_fAttackPowerRateShadowStepThrustEnhance,m_fAttackPowerRateShadowStepPunisher,m_fShadowBusterPowerRate;
    bool m_bEnableShadowStepThrust,m_bEnableShadowStepThrustEnhance,m_bEnableShadowStepPunisher,m_bEnableShadowBackSlide;
    bool m_bActiveShadowStepCombo,m_bIsShadowStepIcon,alphaObject,afterImage;
    int m_iRVCComboLoopCount,m_iShadowBackSlideLevel;
    struct{bool bAlphaBlend;struct{float a;}color;}m_RenderParam;
    struct Gage{float alpha;void SetAlpha(float value){alpha=value;}}m_GageManager,gage;
    Gage* m_pGageUI=&gage;
    struct AfterImage{void SetAfterImageColor(unsigned value){shadowSnapshot[35].u=value;}
        void Disable(){shadowSnapshot[38].u=1;}}afterImageObject;
    AfterImage* m_pAfterImage=&afterImageObject;
    ShadowUnit unit;CX2SkillTree::SkillTemplet equipped;
    float m_fElapsedTime,hp,hpMax,power,awake;
    float m_fWalkCancelAfter,m_fDashCancelAfter,m_fSkillCancelAfter,m_fSkillCancelAfterFly;
    NativeInput m_InputData;int state;bool grounded;
    WildChargeData data;WildChargeData* m_WildChargeDataPtr=&data;
    CKTDGXSkinAnim anim;CKTDGXSkinAnim* m_pXSkinAnim=&anim;CKTDGXSkinAnim* m_pXSkinAnimFuture=&anim;
    D3DXVECTOR3 position,rotation,direction,zDirection;bool isRight,memo;
    D3DXVECTOR3 m_vXCrashPos;
    bool nowHyperState=false;
    bool IsHyperState(){return nowHyperState;}
    KeyManager m_sCurrentSkillKeyManager;
    float GetNowHp(){return hp;}float GetMaxHp(){return hpMax;}
    float GetPowerRate(){return shadowEnabled?m_NowStateData.m_fPowerRate:power;}float GetRemainHyperModeTime(){return awake;}
    bool IsOnSomethingFuture(){return grounded;}
    void StateChange(int s){state=s;}
    void PlaySound(const wchar_t*){++sounds;}
    void CommonFrameMove(){++commonCalls;if(arcEnabled)NativeArcFrameFollow();}
    void CommonEventProcess(){++commonCalls;}
    D3DXVECTOR3 GetRotateDegree(){return rotation;}D3DXVECTOR3 GetPos(){return position;}
    D3DXVECTOR3 GetDirVector(){return direction;}bool GetIsRight(){return isRight;}
    D3DXVECTOR3 GetZVector(){return zDirection;}
    bool GetEqippedSkillMemo(int type){return shadowEnabled?GetShadowMemo(type):memo;}
    bool GetShadowMemo(int type){return (shadowSnapshot[8].u&(1u<<(type==CX2SkillTree::SMI_RAVEN_MEMO6?9:10)))!=0;}
    float GetElapsedTime(){return m_fElapsedTime;}
    ShadowUnit* GetUnit(){return (shadowSnapshot[8].u&4)?&unit:nullptr;}
    const CX2SkillTree::SkillTemplet* GetEquippedActiveSkillTemplet(int){return (shadowSnapshot[8].u&2)?&equipped:nullptr;}
    bool FlushMp(float value){if(shadowSnapshot[6].f<value)return false;shadowSnapshot[6].f-=value;return true;}
    void StateChangeDashIfPossible(){++shadowDashRequests;StateChange(shadowSnapshot[31].i);}
    bool SpecialAttackEventProcess(){++shadowSnapshot[40].u;return (shadowSnapshot[8].u&2048)!=0;}
    bool IsMyUnit(){return (shadowSnapshot[8].u&4096)!=0;}bool IsNullGageUI(){return m_pGageUI==nullptr;}
    void CommonStateStart(){++commonCalls;}void CommonStateStartFuture(){++commonCalls;}
    void CommonStateEnd(){++commonCalls;}void CommonFrameMoveFuture(){++commonCalls;}
    void SetAlphaObject(bool enabled){alphaObject=enabled;}
    void EnableAfterImage(){afterImage=true;}void DisableAfterImage(){afterImage=false;}
    void XSkinMeshReadyInBackground(const wchar_t* name){shadowPreparedMesh=same(name,L"Raven_SI_A_RF_Shadow_Step_Mesh01.X")?1:2;++shadowSnapshot[27].u;}
    void XSkinMeshReady(const wchar_t* name){XSkinMeshReadyInBackground(name);}
    float GetRandomFloat(){return shadowSnapshot[37].f;}
    void SetShadowStepAttackSkill(RAVEN_STATE_ID eStateID=RSI_SHADOW_STEP_THRUST);
    void InitShadowStep();
    void ChangeWorldColorByHyperMode(){++colorCalls;}
    void ShowActiveSkillCutInAndLight(const wchar_t*,float,int){++cutinCalls;}
    void UpDownCrashCamera(float,float){++cameraCalls;}
    void RSI_SA_RRF_WILD_CHARGE_READY_EventProcess();
    void RSI_SA_RRF_WILD_CHARGING_FrameMove();
    void RSI_SA_RRF_WILD_CHARGING_EventProcess();
    void RSI_SA_RRF_WILD_CHARGE_DASH_FrameMove();
    void RSI_SA_RRF_WILD_CHARGE_DASH_EventProcess();
    void RSI_A_RRF_LIMIT_CRUSHER_CHARGE_EventProcess();
    void ClearArcEnemyData();void AttackResultPlayEffect();
    void NativeArcFrameFollow(){
        #include "original_arc_follow.inc"
        #include "original_arc_cooldown.inc"
    }
    // @@METHOD_DECLARATIONS@@
    // @@EXTRA_DECLARATIONS@@
};
#include "original_arc_lifecycle.inc"
#include "original_skill_methods.inc"
#include "original_extra_skill_methods.inc"
#include "original_vector_lockon.inc"
static float output[33];
static float lastOneshotTimer;
extern "C" {
unsigned skills_callback_group_count(){return 70;}
float* skills_vector_lockon_ptr(){return vectorLockOnSnapshot;}
unsigned skills_vector_lockon_words(){return 11;}
void skills_vector_lockon_eval(){
    vectorLockOnEnabled=true;auto& mesh=game.meshes.visualInstance;
    mesh.pos={vectorLockOnSnapshot[0],vectorLockOnSnapshot[1],vectorLockOnSnapshot[2]};
    mesh.manualDir={vectorLockOnSnapshot[3],vectorLockOnSnapshot[4],vectorLockOnSnapshot[5]};
    CX2DamageEffect::CEffect effect;effect.m_LockOnData.m_fCurveSpeed=vectorLockOnSnapshot[9];
    effect.m_fElapsedTime=vectorLockOnSnapshot[10];
    effect.VectorLockOn({vectorLockOnSnapshot[6],vectorLockOnSnapshot[7],vectorLockOnSnapshot[8]});
    vectorLockOnSnapshot[3]=mesh.manualDir.x;vectorLockOnSnapshot[4]=mesh.manualDir.y;vectorLockOnSnapshot[5]=mesh.manualDir.z;
    vectorLockOnEnabled=false;
}
unsigned skills_effect_hyper_mask(){return effectHyperMask;}
void skills_eval(int kind,float now,float before,float elapsed,float hp,float hpMax,
                 float charge,float afterFull,float previousHp,int held,int ended,int onLine,
                 float scale,float awake,float walkCancel,float dashCancel,float skillCancel,int inputMask,
                 float x,float y,float z,float rx,float ry,float rz,float dx,float dy,float dz,float landY,int isRight,int memo,float oneshot) {
    CX2GURaven r{};
    arcEnabled=(kind>=25&&kind<=27)||kind==70;shadowEnabled=kind>=28&&kind<=55;drillEnabled=kind>=56&&kind<=58;
    const bool motionEnabled=kind>=59&&kind<=60;
    const bool extraEnabled=kind>=61&&kind<=66;
    drillHitCleared=drillDamageReplaced=false;drillBoxMask=drillHelperMask=0;
    arcVisualCount=arcRandCount=arcTimerRestarts=0;arcAllocationCount=0;
    shadowPreparedMesh=shadowInfoCalls=shadowUiCalls=shadowDashRequests=0;
    arcNextHandle=arcSnapshot[2].u;arcEffectCount=arcEnabled?arcSnapshot[8].u:0;
    effects=sounds=commonCalls=cancelCalls=0;effectHyperMask=0;effectPower=scale;
    damageCode=particleCode=cameraCalls=cutinCalls=colorCalls=0;
    damagePos=damageRotation=particlePos=particleRotation={0,0,0};
    damageLandY=damagePower=particleLandY=0;executionTime=now;
    r.hp=hp;r.hpMax=hpMax;r.power=scale;r.awake=awake;r.m_fElapsedTime=elapsed;
    if(kind==69)r.nowHyperState=awake!=0;
    if(kind==69)r.m_vXCrashPos={xCrashSnapshot[3],xCrashSnapshot[4],xCrashSnapshot[5]};
    r.anim={now,before,oneshot,bool(ended)};r.data={charge,afterFull,previousHp,bool(held)};
    r.position={x,y,z};r.rotation={rx,ry,rz};r.direction={dx,dy,dz};r.isRight=bool(isRight);r.memo=bool(memo);
    CX2GameUnit defender{};
    if(arcEnabled){
        r.zDirection={arcSnapshot[9].f,arcSnapshot[10].f,arcSnapshot[11].f};r.m_fArcEnemyEachTime=arcSnapshot[1].f;
        defender.uid=arcSnapshot[7].u;defender.type=int(arcSnapshot[6].u);
        r.m_DamageData={arcSnapshot[4].u?CX2DamageManager::RT_DUMMY_DAMAGE:0,int(arcSnapshot[3].u),arcSnapshot[5].u?&defender:nullptr};
        for(unsigned i=0;i<arcEffectCount;++i){unsigned b=64+24*i;auto& e=arcEffects[i];e={};
            e.handle=arcSnapshot[b].u;e.name=arcSnapshot[b+1].u;e.alive=bool(arcSnapshot[b+2].u);e.hasMesh=bool(arcSnapshot[b+3].u);
            e.mesh.pos={arcSnapshot[b+4].f,arcSnapshot[b+5].f,arcSnapshot[b+6].f};e.mesh.rot={arcSnapshot[b+7].f,arcSnapshot[b+8].f,arcSnapshot[b+9].f};
            e.mesh.axis={arcSnapshot[b+10].f,arcSnapshot[b+11].f,arcSnapshot[b+12].f};e.power=arcSnapshot[b+13].f;e.landY=arcSnapshot[b+14].f;
            e.mesh.anim.reset=arcSnapshot[b+15].f;e.lock.m_LockOnUnitUID=arcSnapshot[b+16].u;e.lock.m_LockOnNPCUID=arcSnapshot[b+17].i;
            e.mesh.dirSpeed=arcSnapshot[b+18].f;e.mesh.nowLife=arcSnapshot[b+19].f;e.mesh.maxLife=arcSnapshot[b+20].f;
            e.attackTime={arcSnapshot[b+21].f,arcSnapshot[b+22].f};
        }
        for(unsigned i=0;i<arcSnapshot[0].u;++i){unsigned b=32+8*i;auto* a=new CX2GURaven::ArcEnemyData;
            a->m_hEffect=arcSnapshot[b].u;a->m_vOffsetPos={arcSnapshot[b+1].f,arcSnapshot[b+2].f,arcSnapshot[b+3].f};
            a->m_vOffsetRotate={arcSnapshot[b+4].f,arcSnapshot[b+5].f,arcSnapshot[b+6].f};r.m_vecArcEnemyData.push_back(a);}
    }
    r.m_FrameDataNow.unitCondition.landPosition.y=landY;
    r.m_sCurrentSkillKeyManager.held=bool(held);r.grounded=bool(onLine);r.state=0;
    r.m_FrameDataFuture.syncData.position.y=0;
    r.m_fWalkCancelAfter=walkCancel;r.m_fDashCancelAfter=dashCancel;r.m_fSkillCancelAfter=skillCancel;
    r.m_fSkillCancelAfterFly=skillCancel;
    r.m_InputData={bool(inputMask&1),bool(inputMask&2),bool(inputMask&4),bool(inputMask&8),bool(inputMask&16),bool(inputMask&32),
                  bool(inputMask&64),bool(inputMask&128),bool(inputMask&256),bool(inputMask&512),bool(inputMask&1024),
                  bool(inputMask&2048),bool(inputMask&4096),bool(inputMask&8192),bool(inputMask&16384)};
    if(shadowEnabled){
        unsigned flags=shadowSnapshot[8].u;
        r.m_fShadowStepTimeLeft=shadowSnapshot[0].f;r.m_fShadowBackSlideTimeLeft=shadowSnapshot[1].f;
        r.m_PhysicParam.passiveSpeed.x=shadowSnapshot[5].f;r.m_FrameDataFuture.unitCondition.fStateTime=shadowSnapshot[7].f;
        r.m_FrameDataNow.syncData.bFrameStop=flags&1;
        r.m_bEnableShadowStepThrust=flags&8;r.m_bEnableShadowStepThrustEnhance=flags&16;
        r.m_bEnableShadowStepPunisher=flags&32;r.m_bEnableShadowBackSlide=flags&64;
        r.m_bActiveShadowStepCombo=flags&128;r.m_bIsShadowStepIcon=flags&256;
        r.m_fShadowStepCooTime=shadowSnapshot[9].f;r.m_iShadowBackSlideLevel=shadowSnapshot[10].i;r.m_iRVCComboLoopCount=shadowSnapshot[11].i;
        r.m_fAttackPowerRateShadowStepThrust=shadowSnapshot[12].f;r.m_fAttackPowerRateShadowStepThrustEnhance=shadowSnapshot[13].f;
        r.m_fAttackPowerRateShadowStepPunisher=shadowSnapshot[14].f;r.m_fShadowBusterPowerRate=shadowSnapshot[15].f;
        r.afterImage=shadowSnapshot[16].u;r.m_RenderParam.color.a=shadowSnapshot[17].f;
        r.m_RenderParam.bAlphaBlend=shadowSnapshot[18].u;r.alphaObject=shadowSnapshot[19].u;
        r.gage.alpha=r.m_GageManager.alpha=shadowSnapshot[20].f;
        r.m_DamageData.damage.fPhysic=shadowSnapshot[21].f;r.m_DamageData.damage.fMagic=shadowSnapshot[22].f;
        r.m_DamageData.m_ExtraDamage.m_DamagePerSec=shadowSnapshot[23].f;r.m_NowStateData.m_fPowerRate=shadowSnapshot[24].f;
        r.m_DamageData.reActType=shadowSnapshot[36].i;
        r.m_pGageUI=(flags&8192)?&r.gage:nullptr;r.m_pAfterImage=(flags&16384)?&r.afterImageObject:nullptr;
        shadowSnapshot[27].u=shadowSnapshot[33].u=shadowSnapshot[35].u=shadowSnapshot[38].u=shadowSnapshot[40].u=0;
    }
    if(drillEnabled){
        r.m_PhysicParam.nowSpeed.x=drillSnapshot[0].f;r.m_fDamageDataChangeTime=drillSnapshot[2].f;
        r.m_DamageData.hitUnitList.count=drillSnapshot[3].u;r.m_DamageData.bReAttack=drillSnapshot[4].u;
        r.m_DamageData.fHitGap=drillSnapshot[5].f;r.m_DamageData.backSpeed.x=drillSnapshot[6].f;
        r.m_hSeqMagnumBlaster1=drillSnapshot[10].u;r.m_hMesh_MagnumBlaster2=drillSnapshot[11].u;
    }
    if(motionEnabled){r.m_PhysicParam.nowSpeed.x=skillMotionSnapshot[0];r.m_PhysicParam.passiveSpeed.x=skillMotionSnapshot[1];}
    if(extraEnabled){r.m_PhysicParam.nowSpeed.x=skillExtraSnapshot[0];r.m_PhysicParam.nowSpeed.y=skillExtraSnapshot[1];
        r.m_PhysicParam.passiveSpeed.x=skillExtraSnapshot[2];r.m_PhysicParam.passiveSpeed.y=skillExtraSnapshot[3];
        r.m_bDisableGravity=bool(skillExtraSnapshot[4]);r.m_PhysicParam.fDownAccel=skillExtraSnapshot[5];
        r.m_PhysicParam.fGAccel=skillExtraSnapshot[6];r.damageReducePercent=int(skillExtraSnapshot[7]);}
    if(kind==1)r.RSI_SA_RRF_WILD_CHARGE_READY_EventProcess();
    if(kind==2){r.RSI_SA_RRF_WILD_CHARGING_FrameMove();r.RSI_SA_RRF_WILD_CHARGING_EventProcess();}
    if(kind==3){r.RSI_SA_RRF_WILD_CHARGE_DASH_FrameMove();r.RSI_SA_RRF_WILD_CHARGE_DASH_EventProcess();}
    if(kind==4)r.RSI_A_RRF_LIMIT_CRUSHER_CHARGE_EventProcess();
    // @@METHOD_DISPATCH@@
    if(kind==26)r.NativeArcFrameFollow();
    if(kind==27)r.AttackResultPlayEffect();
    // @@SHADOW_DISPATCH@@
    // @@DRILL_DISPATCH@@
    // @@EXTRA_DISPATCH@@
    if(kind==69){xCrashSnapshot[3]=r.m_vXCrashPos.x;xCrashSnapshot[4]=r.m_vXCrashPos.y;xCrashSnapshot[5]=r.m_vXCrashPos.z;}
    output[0]=r.data.power;output[1]=r.data.afterFull;output[2]=r.data.hpPrevious;
    output[3]=r.state;output[4]=effects;output[5]=effectPower;output[6]=sounds;
    output[7]=r.m_FrameDataFuture.syncData.position.y;
    output[8]=commonCalls;output[9]=cancelCalls;
    output[10]=r.m_FrameDataNow.stateParam.bSuperArmorNotRed;output[11]=kind;
    output[12]=damageCode;output[13]=damagePos.x;output[14]=damagePos.y;output[15]=damagePos.z;
    output[16]=damageRotation.x;output[17]=damageRotation.y;output[18]=damageRotation.z;
    output[19]=damageLandY;output[20]=damagePower;output[21]=particleCode;
    output[22]=particlePos.x;output[23]=particlePos.y;output[24]=particlePos.z;
    output[25]=particleRotation.x;output[26]=particleRotation.y;output[27]=particleRotation.z;
    output[28]=particleLandY;output[29]=executionTime;output[30]=cameraCalls;output[31]=cutinCalls;output[32]=colorCalls;
    lastOneshotTimer=r.anim.m_fAnimOneshotTimer;
    if(motionEnabled){skillMotionSnapshot[0]=r.m_PhysicParam.nowSpeed.x;skillMotionSnapshot[1]=r.m_PhysicParam.passiveSpeed.x;}
    if(extraEnabled){skillExtraSnapshot[0]=r.m_PhysicParam.nowSpeed.x;skillExtraSnapshot[1]=r.m_PhysicParam.nowSpeed.y;
        skillExtraSnapshot[2]=r.m_PhysicParam.passiveSpeed.x;skillExtraSnapshot[3]=r.m_PhysicParam.passiveSpeed.y;
        skillExtraSnapshot[4]=r.m_bDisableGravity;skillExtraSnapshot[5]=r.m_PhysicParam.fDownAccel;
        skillExtraSnapshot[6]=r.m_PhysicParam.fGAccel;skillExtraSnapshot[7]=r.damageReducePercent;}
    if(drillEnabled){
        drillSnapshot[0].f=r.m_PhysicParam.nowSpeed.x;drillSnapshot[3].u=r.m_DamageData.hitUnitList.count;
        drillSnapshot[4].u=r.m_DamageData.bReAttack;drillSnapshot[5].f=r.m_DamageData.fHitGap;
        drillSnapshot[6].f=r.m_DamageData.backSpeed.x;
        drillSnapshot[10].u=r.m_hSeqMagnumBlaster1;drillSnapshot[11].u=r.m_hMesh_MagnumBlaster2;
        drillSnapshot[19].u=drillDamageReplaced;drillSnapshot[20].u=drillHitCleared;
        drillSnapshot[21].u=drillBoxMask;drillSnapshot[22].u=drillHelperMask;
    }
    if(shadowEnabled){
        shadowSnapshot[0].f=r.m_fShadowStepTimeLeft;shadowSnapshot[1].f=r.m_fShadowBackSlideTimeLeft;
        shadowSnapshot[5].f=r.m_PhysicParam.passiveSpeed.x;
        unsigned flags=shadowSnapshot[8].u&~384u;
        if(r.m_bActiveShadowStepCombo)flags|=128;if(r.m_bIsShadowStepIcon)flags|=256;shadowSnapshot[8].u=flags;
        shadowSnapshot[9].f=r.m_fShadowStepCooTime;shadowSnapshot[11].i=r.m_iRVCComboLoopCount;
        shadowSnapshot[16].u=r.afterImage;shadowSnapshot[17].f=r.m_RenderParam.color.a;
        shadowSnapshot[18].u=r.m_RenderParam.bAlphaBlend;shadowSnapshot[19].u=r.alphaObject;
        shadowSnapshot[20].f=r.gage.alpha;
        if(kind==38||kind==41)shadowSnapshot[20].f=r.m_GageManager.alpha;
        shadowSnapshot[21].f=r.m_DamageData.damage.fPhysic;shadowSnapshot[22].f=r.m_DamageData.damage.fMagic;
        shadowSnapshot[23].f=r.m_DamageData.m_ExtraDamage.m_DamagePerSec;shadowSnapshot[24].f=r.m_NowStateData.m_fPowerRate;
        shadowSnapshot[26].u=shadowPreparedMesh;shadowSnapshot[28].u=shadowInfoCalls;
        shadowSnapshot[29].u=shadowUiCalls;shadowSnapshot[30].u=shadowDashRequests;shadowSnapshot[36].i=r.m_DamageData.reActType;
        if(shadowSnapshot[38].u)shadowSnapshot[16].u=0;
    }
    if(arcEnabled){
        arcSnapshot[0].u=r.m_vecArcEnemyData.size();arcSnapshot[1].f=r.m_fArcEnemyEachTime;arcSnapshot[2].u=arcNextHandle;
        arcSnapshot[3].u=arcTimerRestarts;arcSnapshot[4].u=arcVisualCount;arcSnapshot[5].u=arcRandCount;arcSnapshot[8].u=arcEffectCount;
        for(unsigned i=0;i<r.m_vecArcEnemyData.size();++i){unsigned b=32+8*i;auto* a=r.m_vecArcEnemyData[i];arcSnapshot[b].u=a->m_hEffect;
            arcSnapshot[b+1].f=a->m_vOffsetPos.x;arcSnapshot[b+2].f=a->m_vOffsetPos.y;arcSnapshot[b+3].f=a->m_vOffsetPos.z;
            arcSnapshot[b+4].f=a->m_vOffsetRotate.x;arcSnapshot[b+5].f=a->m_vOffsetRotate.y;arcSnapshot[b+6].f=a->m_vOffsetRotate.z;}
        for(unsigned i=0;i<arcEffectCount;++i){unsigned b=64+24*i;auto& e=arcEffects[i];arcSnapshot[b].u=e.handle;arcSnapshot[b+1].u=e.name;
            arcSnapshot[b+2].u=e.alive;arcSnapshot[b+3].u=e.hasMesh;
            arcSnapshot[b+4].f=e.mesh.pos.x;arcSnapshot[b+5].f=e.mesh.pos.y;arcSnapshot[b+6].f=e.mesh.pos.z;
            arcSnapshot[b+7].f=e.mesh.rot.x;arcSnapshot[b+8].f=e.mesh.rot.y;arcSnapshot[b+9].f=e.mesh.rot.z;
            arcSnapshot[b+10].f=e.mesh.axis.x;arcSnapshot[b+11].f=e.mesh.axis.y;arcSnapshot[b+12].f=e.mesh.axis.z;
            arcSnapshot[b+13].f=e.power;arcSnapshot[b+14].f=e.landY;arcSnapshot[b+15].f=e.mesh.anim.reset;
            arcSnapshot[b+16].u=e.lock.m_LockOnUnitUID;arcSnapshot[b+17].i=e.lock.m_LockOnNPCUID;
            arcSnapshot[b+18].f=e.mesh.dirSpeed;arcSnapshot[b+19].f=e.mesh.nowLife;arcSnapshot[b+20].f=e.mesh.maxLife;
            arcSnapshot[b+21].f=e.attackTime.x;arcSnapshot[b+22].f=e.attackTime.y;arcSnapshot[b+23].u=e.created;
        }
        for(unsigned i=0;i<arcVisualCount;++i){unsigned b=256+12*i;auto& v=arcVisual[i];arcSnapshot[b].u=v.name;
            arcSnapshot[b+1].f=v.pos.x;arcSnapshot[b+2].f=v.pos.y;arcSnapshot[b+3].f=v.pos.z;
            arcSnapshot[b+4].f=v.rot.x;arcSnapshot[b+5].f=v.rot.y;arcSnapshot[b+6].f=v.rot.z;
            arcSnapshot[b+7].f=v.axis.x;arcSnapshot[b+8].f=v.axis.y;arcSnapshot[b+9].f=v.axis.z;}
    }
}
unsigned skills_output_ptr(){return (unsigned)(unsigned long)output;}
unsigned skills_output_count(){return 33;}
unsigned skills_xcrash_snapshot_ptr(){return (unsigned)(unsigned long)xCrashSnapshot;}
unsigned skills_xcrash_snapshot_words(){return 6;}
unsigned skills_arc_snapshot_ptr(){return (unsigned)(unsigned long)arcSnapshot;}
unsigned skills_arc_snapshot_words(){return 304;}
float skills_oneshot_timer(){return lastOneshotTimer;}
unsigned skills_shadow_snapshot_ptr(){return (unsigned)(unsigned long)shadowSnapshot;}
unsigned skills_shadow_snapshot_words(){return 48;}
unsigned skills_drill_snapshot_ptr(){return (unsigned)(unsigned long)drillSnapshot;}
unsigned skills_drill_snapshot_words(){return 25;}
unsigned skills_motion_snapshot_ptr(){return (unsigned)(unsigned long)skillMotionSnapshot;}
unsigned skills_motion_snapshot_words(){return 2;}
unsigned skills_extra_snapshot_ptr(){return (unsigned)(unsigned long)skillExtraSnapshot;}
unsigned skills_extra_snapshot_words(){return 8;}
}
