// Bounded event decisions only: public common phases remain outside this module.
#define NEW_SKILL_TREE
#define LINE_RADIUS 30.0f
// No awakening in the slice. Disabled branch is visible in the source contract.
#define ELSE_IF_CAN_HYPER_MODE_THEN_STATE_CHANGE(id)
struct V {float x,y,z;};
struct Map {bool canDown;bool CanDown(V,float,V*,int*){return canDown;}};
struct World {Map map;Map* GetLineMap(){return &map;}};
struct Game {World world;World* GetWorld(){return &world;}};
static Game game;static Game* g_pX2Game=&game;
struct CX2SkillTree {enum {ASUT_AIR=1};};
enum {USI_WAIT=1,USI_WALK,USI_JUMP_READY,USI_JUMP_UP,USI_JUMP_DOWN,USI_DASH,
 USI_JUMP_LANDING,USI_DASH_JUMP,USI_DASH_END,RSI_COMBO_Z,RSI_COMBO_X,
 RSI_JUMP_COMBO_Z,RSI_JUMP_COMBO_X,RSI_DASH_COMBO_Z,RSI_DASH_COMBO_X};
class CX2GURaven {public:
 struct Input {bool oneZ,oneX,oneDown,oneUp,pureRight,pureLeft,pureUp,pureDoubleRight,pureDoubleLeft;} m_InputData;
 struct Frame {struct Sync {V position;bool bIsRight;int lastTouchLineIndex;} syncData;
    struct Condition {V landPosition;} unitCondition;} m_FrameDataFuture;
 struct Physics {V nowSpeed;}m_PhysicParam;
 struct Anim {bool ended;bool IsAnimationEnd(){return ended;}} anim,*m_pXSkinAnimFuture=&anim;
 bool grounded,m_bReAttackZ1Right;float m_fReAttackZ1Time,jump,dashJump;int requested,commonCalls;
 bool IsOnSomethingFuture(){return grounded;} bool GetEnableDash(){return true;}
 float GetJumpSpeed(){return jump;}float GetDashJumpSpeed(){return dashJump;}
 bool SpecialAttackEventProcess(int=0){return false;}
 void StateChange(int id){requested=id;} void StateChangeDashIfPossible(){requested=USI_DASH;}
 void CommonEventProcess(){++commonCalls;} // Explicit host boundary, not an implementation claim.
 void RSI_WAIT_EventProcess();void RSI_WALK_EventProcess();void RSI_JUMP_READY_EventProcess();
 void RSI_JUMP_UP_EventProcess();void RSI_JUMP_DOWN_EventProcess();void RSI_DASH_EventProcess();
};
// @@EVENTS@@
static float result[4];
extern "C" {
int movement_run(int state,int held,int one,int twice,int facing,int grounded,float vy,float jump,float dashJump,int ended,int canDown,float reAttack,int reRight){
 CX2GURaven a{};a.grounded=grounded;a.m_FrameDataFuture.syncData.bIsRight=facing>0;
 a.m_PhysicParam.nowSpeed.y=vy;a.jump=jump;a.dashJump=dashJump;a.anim.ended=ended;
 a.m_fReAttackZ1Time=reAttack;a.m_bReAttackZ1Right=reRight;game.world.map.canDown=canDown;
 a.m_InputData={(one&16)!=0,(one&32)!=0,(one&8)!=0,(one&4)!=0,(held&2)!=0,(held&1)!=0,(held&4)!=0,(twice&2)!=0,(twice&1)!=0};
 switch(state){case 1:a.RSI_WAIT_EventProcess();break;case 2:a.RSI_WALK_EventProcess();break;
 case 3:a.RSI_JUMP_READY_EventProcess();break;case 4:a.RSI_JUMP_UP_EventProcess();break;
 case 5:a.RSI_JUMP_DOWN_EventProcess();break;case 6:a.RSI_DASH_EventProcess();break;default:return 0;}
 result[0]=(float)a.requested;result[1]=a.m_FrameDataFuture.syncData.position.y;result[2]=a.m_PhysicParam.nowSpeed.y;result[3]=(float)a.commonCalls;return 1;
}
unsigned movement_result_ptr(){return (unsigned)(__UINTPTR_TYPE__)result;}
}
