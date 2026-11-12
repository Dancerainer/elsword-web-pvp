// Host storage and explicit boundaries; original callback bodies are inserted verbatim.
#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE
#define RAVEN_SECOND_CLASS_CHANGE
#define RAVEN_WEAPON_TAKER
#define SKILL_CANCEL_BY_HYPER_MODE
#define BALANCE_PATCH_20120329
#define NULL 0
#define INVALID_EFFECTSET_HANDLE 0
#define __max(a,b) ((a)>(b)?(a):(b))
// @@MACROS@@
struct D3DXVECTOR2 { float x,y; D3DXVECTOR2(float a=0,float b=0):x(a),y(b){} };
struct D3DXVECTOR3 { float x,y,z;
    D3DXVECTOR3(float a=0,float b=0,float c=0):x(a),y(b),z(c){}
    D3DXVECTOR3 operator*(float f)const{return {x*f,y*f,z*f};}
    D3DXVECTOR3& operator+=(D3DXVECTOR3 v){x+=v.x;y+=v.y;z+=v.z;return *this;}
    D3DXVECTOR3& operator-=(D3DXVECTOR3 v){x-=v.x;y-=v.y;z-=v.z;return *this;}
};
static D3DXVECTOR3 operator*(float f,D3DXVECTOR3 v){return v*f;}
static int effectSetCalls,effectStopCalls,magicFailCalls,cameraCalls;
class CX2GameUnit {};
class CKTDGParticleSystem { public: struct CParticleEventSequence {
    void SetAxisAngle(D3DXVECTOR3){} void SetAddRotate(D3DXVECTOR3){} }; };
struct HostEffectSets {int PlayEffectSet(const wchar_t*,CX2GameUnit*,CX2GameUnit*){++effectSetCalls;return 1;}
    void StopEffectSet(int){++effectStopCalls;} };
struct HostParticles { CKTDGParticleSystem::CParticleEventSequence seq;
    CKTDGParticleSystem::CParticleEventSequence* GetInstanceSequence(int){return &seq;} };
namespace std {template<class T> struct vector {void push_back(T){} };}

class CKTDGXSkinAnim {
public:
    float m_fAnimBeforeTime,m_fAnimCurrTime,m_fAnimOneshotTimer;
    bool ended;float period;D3DXVECTOR3 leftHand;
    bool EventTimer(float);
    float GetNowAnimationTime(){return m_fAnimCurrTime;}
    float GetMaxAnimationTime(){return period;}
    D3DXVECTOR3 GetCloneFramePosition(const wchar_t*){return leftHand;}
    bool IsAnimationEnd(){return ended;}
// @@CLOCK_INLINE@@
};
// @@CLOCK_OUT@@
struct HostLineMap {
    bool canDown; int calls;
    bool CanDown(D3DXVECTOR3, float, D3DXVECTOR3*, int*) {++calls;return canDown;}
};
struct HostWorld {HostLineMap lines;HostLineMap* GetLineMap(){return &lines;}};
struct HostGame {HostWorld world;HostEffectSets sets;HostParticles particles;HostWorld* GetWorld(){return &world;}
    HostEffectSets* GetEffectSet(){return &sets;} HostParticles* GetMajorParticle(){return &particles;} };
static HostGame game;static HostGame* g_pX2Game=&game;
struct CX2Unit {
    // Only RF107 is executable through this host; other class tags cannot match.
    enum {UC_RAVEN_RECKLESS_FIST=107,UC_RAVEN_OVER_TAKER=-31,UC_RAVEN_WEAPON_TAKER=-32,UC_RAVEN_SOUL_TAKER=-33,UC_RAVEN_BLADE_MASTER=-34};
    struct Data {int m_UnitClass=UC_RAVEN_RECKLESS_FIST;} data;
    Data& GetUnitData(){return data;} int GetClass(){return data.m_UnitClass;}
};
class CX2GUUser:public CX2GameUnit {
public:
    // Host ABI symbolic IDs, not a claim about the original enum's numeric values.
    enum { NONE=0,USI_WAIT=1,USI_WALK=2,USI_JUMP_READY=3,USI_JUMP_DOWN=4,
        USI_JUMP_LANDING=5,USI_DASH_JUMP_LANDING=6,RSI_DASH_JUMP_COMBO_Z=7,
        RSI_DASH_JUMP_COMBO_ZZ=8,RSI_DASH_JUMP_COMBO_ZZ_Landing=9,
        RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX=10,RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING=11,
        RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX=12,RSI_JUMP_COMBO_Z=13,RSI_JUMP_COMBO_X=14,
        RSI_COMBO_ZZXX=15,RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX=16,DASH_REQUEST=17,
        USI_DAMAGE_AIR_SMALL=18,USI_DAMAGE_SMALL_FRONT=19,USI_DAMAGE_SMALL_BACK=20,
        USI_DAMAGE_BIG_FRONT=21,USI_DAMAGE_BIG_BACK=22, RSI_COMBO_Z=23,RSI_COMBO_ZZ=24,RSI_COMBO_ZZZ=25,
        RSI_COMBO_ZZZZ=26,RSI_COMBO_ZZX=27,RSI_COMBO_X=28,RSI_COMBO_XX=29,RSI_COMBO_XXX=30,
        RRF_DASH_JUMP_COMBO_X=31,RRF_DASH_JUMP_COMBO_XX=32,RRF_DASH_JUMP_COMBO_XX_LANDING=33,
        RRF_COMBO_ZZXFRONTX=34,RRF_COMBO_ZZXFRONTXX=35,RSI_OVER_TAKER_COMBO_XXfrontX=36,
        RSI_OVER_TAKER_COMBO_XXdownX=37,AWAKEN_REQUEST=38,UNSUPPORTED_ZZZX=39,
        RSI_COMBO_ZZZX=UNSUPPORTED_ZZZX,RSI_WEAPON_TAKER_COMBO_ZZZdownX=-40,
        RSI_SOUL_TAKER_COMBO_ZZZupZ=-41,RBM_COMBO_XZ=-42,RSI_SOUL_TAKER_COMBO_XXZ=-43 };
    enum {COMMON_MAJOR_PII_MAGIC_FAIL=1};
    struct Input {
        bool oneZ,oneX,oneDown,pureRight,pureLeft,pureUp,pureDown,pureDoubleRight,pureDoubleLeft;
        bool pureZ,pureX,pureA,pureS,pureD,pureC,pureQ,pureW,pureE,pureR,oneLCtr;
    } m_InputData;
    struct Frame {
        struct State {bool bEventFlagList[3];} stateParam;
        struct Sync {D3DXVECTOR3 position;int lastTouchLineIndex;bool bIsRight;int m_HyperModeCount;} syncData;
        struct Condition {D3DXVECTOR3 landPosition;bool bAttackerFront;D3DXVECTOR3 dirVector;} unitCondition;
    } m_FrameDataFuture,m_FrameDataNow;
    struct Physic {D3DXVECTOR2 nowSpeed,passiveSpeed;float fGAccel,fMaxGSpeed;} m_PhysicParam;
    CKTDGXSkinAnim anim;CKTDGXSkinAnim* m_pXSkinAnimFuture=&anim;CKTDGXSkinAnim* m_pXSkinAnim=&anim;
    CX2Unit unit;
    float m_fElapsedTime,m_fCanNotJumpTime,walkSpeed,m_fCanNotAttackTime,m_fReAttackZ1Time,mp,hyperRemaining;
    bool m_bReAttackZ1Right,canReawaken; int m_iSuccessiveHit_OneZ,m_hEffectDashJumpComboX;
    std::vector<int> m_vecEffectSetToDeleteOnDamageReact;
    bool grounded;
    int requested,futureCalls,eventCalls,startCalls,endCalls,nowCalls;
    bool IsOnSomethingFuture(){return grounded;}
    float GetWalkSpeed(){return walkSpeed;}
    CX2Unit* GetUnit(){return &unit;}
    void StateChange(int id){requested=id;}
    void StateChangeDashIfPossible(){requested=DASH_REQUEST;}
    void CommonFrameMoveFuture(){++futureCalls;}
    void CommonEventProcess(){++eventCalls;}
    void CommonStateStartFuture(){++startCalls;}
    void CommonStateEnd(){++endCalls;}void CommonFrameMove(){++nowCalls;}
    bool SpecialAttackEventProcess(){return false;} // Skill dispatch is performed by the host.
    bool IsThereEffectiveBlackHoleDamageEffect(){return false;} // Host actor has no such active binding.
    float GetRemainHyperModeTime(){return hyperRemaining;}
    bool GetCanChangeHyperModeInHyperModeState(){return canReawaken;}
    int GetHypetMpdeStateID(){return AWAKEN_REQUEST;}
    bool FlushMp(float cost){if(mp<cost)return false;mp-=cost;return true;}
    bool GetIsRight(){return m_FrameDataFuture.syncData.bIsRight;}
    D3DXVECTOR3 GetRotateDegree(){return {0,GetIsRight()?0.f:180.f,0};}
    int GetHandleCommonMajorParticleByEnum(int code){return code;}
    void PlaySequenceByTriggerCount(CKTDGParticleSystem::CParticleEventSequence*,D3DXVECTOR3,int,int,int){++magicFailCalls;}
    void UpDownCrashCamera(float,float){++cameraCalls;} // Product requires disabled dynamic camera.

    void DamageAirSmallStartFuture();void DamageAirSmallEventProcess();
};
class CX2GURaven: public CX2GUUser {
public:
    void RSI_DAMAGE_SMALL_FRONT_EventProcess();void RSI_DAMAGE_SMALL_BACK_EventProcess();
    void RSI_DAMAGE_BIG_FRONT_EventProcess();void RSI_DAMAGE_BIG_BACK_EventProcess();
    void RSI_COMBO_ZZXX_FrameMoveFuture();void RSI_COMBO_ZZXX_EventProcess();
    void RSI_DASH_JUMP_COMBO_Z_EventProcess();
    void RSI_DASH_JUMP_COMBO_ZZ_FrameMoveFuture();void RSI_DASH_JUMP_COMBO_ZZ_EventProcess();
    void RSI_JUMP_COMBO_Z_FrameMoveFuture();void RSI_JUMP_COMBO_Z_EventProcess();
    void RSI_JUMP_COMBO_X_FrameMoveFuture();void RSI_JUMP_COMBO_X_EventProcess();
    void RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_FrameMoveFuture();
    void RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_EventProcess();
    void RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_StartFuture();
    void RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_EventProcess();
    void RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX_EventProcess();
    void RSI_COMBO_Z_EventProcess();
    void RSI_COMBO_ZZ_EventProcess();
    void RSI_COMBO_ZZZ_EventProcess();
    void RSI_COMBO_ZZZZ_FrameMoveFuture();
    void RSI_COMBO_ZZZZ_EventProcess();
    void RSI_COMBO_ZZX_EventProcess();
    void RSI_COMBO_X_EventProcess();
    void RSI_COMBO_XX_EventProcess();
    void RSI_DASH_JUMP_COMBO_ZZ_Landing_StartFuture();
    void RSI_DASH_JUMP_COMBO_ZZ_Landing_EventProcess();
    void RRF_DASH_JUMP_COMBO_X_FrameMoveFuture();
    void RRF_DASH_JUMP_COMBO_X_FrameMove();
    void RRF_DASH_JUMP_COMBO_X_EventProcess();
    void RRF_DASH_JUMP_COMBO_XX_FrameMoveFuture();
    void RRF_DASH_JUMP_COMBO_XX_EventProcess();
    void RRF_DASH_JUMP_COMBO_XX_LANDING_EventProcess();
    void RRF_COMBO_ZZXFRONTX_FrameMoveFuture();
    void RRF_COMBO_ZZXFRONTX_EventProcess();
    void RRF_COMBO_ZZXFRONTX_End();
    void RRF_COMBO_ZZXFRONTXX_EventProcess();
};
// @@CALLBACKS@@
static CX2GURaven actor;
static float result[22];
extern "C" {
int command_abi_version(){return 3;}
unsigned int result_ptr(){return (unsigned int)(__UINTPTR_TYPE__)&result;}
int result_count(){return 22;}
// phase0 Future,1 Event,2 Start. Common advancement is performed by the host.
int run_callback(int phase,int state,float dt,float now,float before,float oneshot,
    float vx,float vy,float px,float py,float gravity,float maxG,float walk,int flags,
    int keys,int facing,int grounded,int ended,float y,float jumpLock,int canDown,float landY,int attackerFront,float period,float attackLock,float reAttackTime,int reAttackRight,float mp,int effectHandle,int hyperCount,float hyperRemaining,int canReawaken){
    actor.anim={before,now,oneshot,ended!=0,period,{0,y,0}};
    effectSetCalls=effectStopCalls=magicFailCalls=cameraCalls=0;
    actor.mp=mp;actor.m_fCanNotAttackTime=attackLock;actor.m_fReAttackZ1Time=reAttackTime;actor.m_bReAttackZ1Right=reAttackRight!=0;
    actor.m_hEffectDashJumpComboX=effectHandle;actor.hyperRemaining=hyperRemaining;actor.canReawaken=canReawaken!=0;
    actor.m_fElapsedTime=dt;actor.m_fCanNotJumpTime=jumpLock;actor.walkSpeed=walk;
    actor.m_PhysicParam={{vx,vy},{px,py},gravity,maxG};actor.grounded=grounded!=0;
    actor.requested=0;actor.futureCalls=actor.eventCalls=actor.startCalls=actor.endCalls=actor.nowCalls=0;
    actor.m_FrameDataFuture.stateParam.bEventFlagList[0]=(flags&1)!=0;
    actor.m_FrameDataFuture.stateParam.bEventFlagList[1]=(flags&2)!=0;
    actor.m_FrameDataFuture.stateParam.bEventFlagList[2]=(flags&4)!=0;
    actor.m_FrameDataFuture.syncData.position={0,y,0};actor.m_FrameDataFuture.syncData.bIsRight=facing>0;
    actor.m_FrameDataFuture.unitCondition.landPosition={0,landY,0};
    actor.m_FrameDataFuture.syncData.m_HyperModeCount=hyperCount;actor.m_FrameDataNow.unitCondition.dirVector={1,0,0};
    actor.m_FrameDataNow.unitCondition.bAttackerFront=attackerFront!=0;
    actor.m_InputData={(keys&1)!=0,(keys&2)!=0,(keys&4)!=0,(keys&8)!=0,(keys&16)!=0,
        (keys&32)!=0,(keys&64)!=0,(keys&128)!=0,(keys&256)!=0,(keys&512)!=0,(keys&1024)!=0,
        (keys&2048)!=0,(keys&4096)!=0,(keys&8192)!=0,(keys&16384)!=0,(keys&32768)!=0,
        (keys&65536)!=0,(keys&131072)!=0,(keys&262144)!=0,(keys&524288)!=0};
    game.world.lines.canDown=canDown!=0;game.world.lines.calls=0;
    bool handled=false;
    if(phase==0){
        switch(state){
        case CX2GURaven::RSI_COMBO_ZZZZ:actor.RSI_COMBO_ZZZZ_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RRF_DASH_JUMP_COMBO_X:actor.RRF_DASH_JUMP_COMBO_X_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RRF_DASH_JUMP_COMBO_XX:actor.RRF_DASH_JUMP_COMBO_XX_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RRF_COMBO_ZZXFRONTX:actor.RRF_COMBO_ZZXFRONTX_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZXX:actor.RSI_COMBO_ZZXX_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RSI_DASH_JUMP_COMBO_ZZ:actor.RSI_DASH_JUMP_COMBO_ZZ_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX:actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RSI_JUMP_COMBO_Z:actor.RSI_JUMP_COMBO_Z_FrameMoveFuture();handled=true;break;
        case CX2GURaven::RSI_JUMP_COMBO_X:actor.RSI_JUMP_COMBO_X_FrameMoveFuture();handled=true;break;
        }
        // Explicit common-boundary action: native UpdateBeforeAnimationTime runs
        // before controller advancement, after the state's Future callback.
        actor.anim.UpdateBeforeAnimationTime();
    }else if(phase==1){
        switch(state){
        case CX2GURaven::RSI_COMBO_Z:actor.RSI_COMBO_Z_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZ:actor.RSI_COMBO_ZZ_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZZ:actor.RSI_COMBO_ZZZ_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZZZ:actor.RSI_COMBO_ZZZZ_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZX:actor.RSI_COMBO_ZZX_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_X:actor.RSI_COMBO_X_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_XX:actor.RSI_COMBO_XX_EventProcess();handled=true;break;
        case CX2GURaven::RSI_DASH_JUMP_COMBO_ZZ_Landing:actor.RSI_DASH_JUMP_COMBO_ZZ_Landing_EventProcess();handled=true;break;
        case CX2GURaven::RRF_DASH_JUMP_COMBO_X:actor.RRF_DASH_JUMP_COMBO_X_EventProcess();handled=true;break;
        case CX2GURaven::RRF_DASH_JUMP_COMBO_XX:actor.RRF_DASH_JUMP_COMBO_XX_EventProcess();handled=true;break;
        case CX2GURaven::RRF_DASH_JUMP_COMBO_XX_LANDING:actor.RRF_DASH_JUMP_COMBO_XX_LANDING_EventProcess();handled=true;break;
        case CX2GURaven::RRF_COMBO_ZZXFRONTX:actor.RRF_COMBO_ZZXFRONTX_EventProcess();handled=true;break;
        case CX2GURaven::RRF_COMBO_ZZXFRONTXX:actor.RRF_COMBO_ZZXFRONTXX_EventProcess();handled=true;break;
        case CX2GUUser::USI_DAMAGE_AIR_SMALL:actor.DamageAirSmallEventProcess();handled=true;break;
        case CX2GUUser::USI_DAMAGE_SMALL_FRONT:actor.RSI_DAMAGE_SMALL_FRONT_EventProcess();handled=true;break;
        case CX2GUUser::USI_DAMAGE_SMALL_BACK:actor.RSI_DAMAGE_SMALL_BACK_EventProcess();handled=true;break;
        case CX2GUUser::USI_DAMAGE_BIG_FRONT:actor.RSI_DAMAGE_BIG_FRONT_EventProcess();handled=true;break;
        case CX2GUUser::USI_DAMAGE_BIG_BACK:actor.RSI_DAMAGE_BIG_BACK_EventProcess();handled=true;break;
        case CX2GURaven::RSI_COMBO_ZZXX:actor.RSI_COMBO_ZZXX_EventProcess();handled=true;break;
        case CX2GURaven::RSI_DASH_JUMP_COMBO_Z:actor.RSI_DASH_JUMP_COMBO_Z_EventProcess();handled=true;break;
        case CX2GURaven::RSI_DASH_JUMP_COMBO_ZZ:actor.RSI_DASH_JUMP_COMBO_ZZ_EventProcess();handled=true;break;
        case CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX:actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_EventProcess();handled=true;break;
        case CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING:actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_EventProcess();handled=true;break;
        case CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX:actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX_EventProcess();handled=true;break;
        case CX2GURaven::RSI_JUMP_COMBO_Z:actor.RSI_JUMP_COMBO_Z_EventProcess();handled=true;break;
        case CX2GURaven::RSI_JUMP_COMBO_X:actor.RSI_JUMP_COMBO_X_EventProcess();handled=true;break;
        }
    }else if(phase==3&&state==CX2GURaven::RRF_DASH_JUMP_COMBO_X){
        actor.RRF_DASH_JUMP_COMBO_X_FrameMove();handled=true;
    }else if(phase==4&&state==CX2GURaven::RRF_COMBO_ZZXFRONTX){
        actor.RRF_COMBO_ZZXFRONTX_End();handled=true;
    }else if(phase==2&&state==CX2GURaven::RSI_DASH_JUMP_COMBO_ZZ_Landing){
        actor.RSI_DASH_JUMP_COMBO_ZZ_Landing_StartFuture();handled=true;
    }else if(phase==2&&state==CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING){
        actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_StartFuture();handled=true;
    }else if(phase==2&&state==CX2GUUser::USI_DAMAGE_AIR_SMALL){
        actor.DamageAirSmallStartFuture();handled=true;
    }
    result[0]=actor.m_PhysicParam.nowSpeed.x;result[1]=actor.m_PhysicParam.nowSpeed.y;
    result[2]=actor.m_PhysicParam.passiveSpeed.x;result[3]=actor.m_PhysicParam.passiveSpeed.y;
    result[4]=(actor.m_FrameDataFuture.stateParam.bEventFlagList[0]?1:0)|(actor.m_FrameDataFuture.stateParam.bEventFlagList[1]?2:0)|(actor.m_FrameDataFuture.stateParam.bEventFlagList[2]?4:0);
    result[5]=actor.requested;result[6]=actor.m_FrameDataFuture.syncData.position.y;
    result[7]=actor.m_fCanNotJumpTime;result[8]=actor.anim.m_fAnimBeforeTime;result[9]=actor.anim.m_fAnimOneshotTimer;
    result[10]=actor.futureCalls;result[11]=actor.eventCalls;result[12]=actor.startCalls;result[13]=game.world.lines.calls;
    result[14]=actor.m_fCanNotAttackTime;result[15]=actor.m_fReAttackZ1Time;result[16]=actor.m_bReAttackZ1Right;
    result[17]=actor.mp;result[18]=effectSetCalls;result[19]=magicFailCalls;result[20]=cameraCalls;
    result[21]=actor.m_hEffectDashJumpComboX;
    return handled;
}
}
