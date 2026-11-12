// Portable storage/ABI only. Selected reference bodies are inserted by builder.
using DWORD=unsigned int; using LONG=int; using BYTE=unsigned char; using BOOL=int;
static_assert(sizeof(DWORD)==4 && sizeof(LONG)==4);
#define TRUE 1
#define FALSE 0
#define VK_SNAPSHOT 44
#define DOUBLE_INPUT_GAP 0.4f
extern "C" void* memset(void* p,int v,__SIZE_TYPE__ n){auto* b=(BYTE*)p;for(__SIZE_TYPE__ i=0;i<n;++i)b[i]=(BYTE)v;return p;}
extern "C" void* memcpy(void* d,const void* s,__SIZE_TYPE__ n){auto* a=(BYTE*)d;auto* b=(const BYTE*)s;for(__SIZE_TYPE__ i=0;i<n;++i)a[i]=b[i];return d;}
#define ZeroMemory(p,n) memset(p,0,n)
class CKTDIDeviceWinKey {
public:
    struct KeyTime {DWORD m_dwStamp; BYTE m_byVirtualKey; bool m_bDown;};
    // @@DOUBLE@@
    struct Queue {KeyTime values[4096]; unsigned first,count;
        bool empty(){return count==0;} const KeyTime& front(){return values[first];}
        void pop_front(){first=(first+1)%4096;--count;}
        bool push(KeyTime k){if(count==4096)return false;values[(first+count++)%4096]=k;return true;}
    } m_dequeKeyTime;
    BYTE m_aVKtoDIKMap[256],m_State[256];
    bool m_abQueuedVKState[256],m_abCurrentVKState[256],m_bActivated;
    BOOL m_Locks[256],m_bExtraEnter;
    DoubleKey m_DoubleKeyCheck[256];
    BOOL Clear(); BOOL Read(DWORD,float); BOOL GetKeyState(unsigned char);
    BOOL GetPureKeyState(unsigned char); BOOL GetDoubleKeyPureState(unsigned char);
    BOOL GetDoubleKeyState(unsigned char); void SetDoubleKeyReset(unsigned char);
};
// @@DEVICE@@
static CKTDIDeviceWinKey keyboard;
#define IN
#define OUT
using GAME_ACTION=int;
#define GET_DOUBLEKEYPURE_STATE(k) keyboard.GetDoubleKeyPureState(k)
#define GET_DOUBLEKEY_STATE(k) keyboard.GetDoubleKeyState(k)
#define GET_PUREKEY_STATE(k) keyboard.GetPureKeyState(k)
#define GET_KEY_STATE(k) keyboard.GetKeyState(k)
struct CX2Game {
// @@INPUTDATA@@
};
static unsigned packets[4]; // pureDouble, oneDouble, pure, one. Host key order below.
// LEFT RIGHT UP DOWN Z X; identity mapping is a host tag, not a DIK assertion.
static constexpr BYTE keys[]={37,39,38,40,90,88};
extern "C" {
void device_reset(){memset(&keyboard,0,sizeof(keyboard));keyboard.Clear();for(auto k:keys)keyboard.m_aVKtoDIKMap[k]=k;}
int device_enqueue(unsigned time,unsigned key,int down){
    if(key>255||down<0||down>1)return -1;
    if(keyboard.m_abQueuedVKState[key]==(bool)down)return 0;
    if(!keyboard.m_dequeKeyTime.push({time,(BYTE)key,(bool)down}))return -2;
    keyboard.m_abQueuedVKState[key]=(bool)down;return 1;
}
unsigned device_sample(unsigned time,float dt){
    keyboard.Read(time,dt);for(auto& p:packets)p=0;CX2Game game;
    for(unsigned i=0;i<6;++i){bool a=false,b=false,c=false,d=false;
        game.InputData(keys[i],a,b,c,d);
        packets[0]|=(unsigned)a<<i;packets[1]|=(unsigned)b<<i;
        packets[2]|=(unsigned)c<<i;packets[3]|=(unsigned)d<<i;
    }return (unsigned)(__UINTPTR_TYPE__)packets;
}
unsigned device_state_ptr(){return (unsigned)(__UINTPTR_TYPE__)&keyboard;}
unsigned device_state_size(){return sizeof(keyboard);}
}
