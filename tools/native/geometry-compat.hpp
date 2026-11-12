// Compatibility surface only. Original method bodies are inserted by geometry-build.py.
// Float arithmetic deliberately has no contraction or fast-math.
#define IN
#define OUT
#define __forceinline inline
#define NULL 0
#define KTDXPROFILE() ((void)0)
#define KTDXPROFILE_BEGIN(...) ((void)0)
#define KTDXPROFILE_END() ((void)0)
#define ASSERT(...) ((void)0)
#define X2OPTIMIZE_LINEMAP_OPTIMIZE_AND_BUG_FIX
#define MONSTER_ROAD
#define UNIT_ROAD
#define FIX_LINE_TYPE_WALL
#define X2OPTIMIZE_DAMAGEEFFECT_COLLISION
#define X2OPTIMIZE_LINEMAP_LINEGROUP
#define _alloca __builtin_alloca
typedef unsigned int UINT;
inline float min(float a, float b) { return a < b ? a : b; }
inline float max(float a, float b) { return a > b ? a : b; }
inline double fabs(double a) { return __builtin_fabs(a); }
struct D3DXVECTOR3 {
    float x, y, z;
    D3DXVECTOR3() = default;
    D3DXVECTOR3(float a, float b, float c) : x(a), y(b), z(c) {}
    D3DXVECTOR3 operator-(const D3DXVECTOR3& b) const { return {x-b.x,y-b.y,z-b.z}; }
    D3DXVECTOR3 operator+(const D3DXVECTOR3& b) const { return {x+b.x,y+b.y,z+b.z}; }
    D3DXVECTOR3 operator*(float b) const { return {x*b,y*b,z*b}; }
};
inline D3DXVECTOR3 operator*(float a, const D3DXVECTOR3& b) { return b*a; }
inline float D3DXVec3Dot(const D3DXVECTOR3* a, const D3DXVECTOR3* b) {
    return a->x*b->x+a->y*b->y+a->z*b->z;
}
inline float D3DXVec3LengthSq(const D3DXVECTOR3* a) { return D3DXVec3Dot(a,a); }
inline float D3DXVec3Length(const D3DXVECTOR3* a) { return __builtin_sqrtf(D3DXVec3LengthSq(a)); }
inline D3DXVECTOR3* D3DXVec3Normalize(D3DXVECTOR3* out,const D3DXVECTOR3* in) {
    const float length=D3DXVec3Length(in);
    *out=length>0 ? (*in)*(1.f/length) : D3DXVECTOR3(0,0,0);
    return out;
}
// @@COMMON@@
class CKTDXCollision {
public:
// @@COLLISION@@
};
struct GeometryApp {
    CKTDXCollision collision;
    CKTDXCollision* GetCollision() { return &collision; }
};
static GeometryApp hostApp;
static GeometryApp* g_pKTDXApp = &hostApp;
class CKTDGLineMap {
public:
// @@LINE_ENUM@@
// @@LINE_GROUP@@
    struct LineData {
        D3DXVECTOR3 startPos, endPos, dirVector, m_vPosMin, m_vPosMax;
        float fLength;
        bool bEnable, bCanDown, m_bCanPass;
        LINE_TYPE lineType;
        int beforeLine, nextLine;
        LineGroupID m_lineGroupID;
    };
    struct FixedLineList {
        LineData* entries[4096];
        unsigned int count;
        unsigned int size() const { return count; }
        LineData* operator[](int index) const { return entries[index]; }
    } m_LineList;
    bool CanDown(D3DXVECTOR3, float, D3DXVECTOR3*, int*, bool, bool, bool);
    bool CanPassUp(const D3DXVECTOR3&);
    D3DXVECTOR3 GetLandPosition(D3DXVECTOR3, float, int*) const;
    void ReBuildLineGroup();
    LineGroupID GetLineGroupIncludesLineData(int) const;
// @@LINE_INLINE@@
};
// @@LINE_OUT@@
static CKTDGLineMap hostMap;
static CKTDGLineMap::LineData hostLines[4096];
struct QueryResult { int found, index; float x,y,z, ax,ay,az, bx,by,bz; };
static QueryResult result;
static bool valid(float x) { return __builtin_isfinite(x); }
static bool validPosition(float x,float y,float z) { return valid(x)&&valid(y)&&valid(z); }
static void initResult(float x,float y,float z,int index) { result = {0,index,x,y,z,0,0,0,0,0,0}; }
extern "C" {
unsigned int result_ptr() { return (unsigned int)(__UINTPTR_TYPE__)&result; }
void reset() { hostMap.m_LineList.count=0; initResult(0,0,0,-1); }
int add_line(float ax,float ay,float az,float bx,float by,float bz,int type,int enabled,int canDown,int before,int next,int canPass) {
    int i=(int)hostMap.m_LineList.count;
    if(i>=4096||!validPosition(ax,ay,az)||!validPosition(bx,by,bz)||type < -1||type > 10) return -1;
    auto& l=hostLines[i];
    l.startPos={ax,ay,az}; l.endPos={bx,by,bz};
    D3DXVECTOR3 d=l.endPos-l.startPos;
    l.fLength=D3DXVec3Length(&d);
    // Loader's D3DXVec3Minimize/Maximize/Normalize surface, no changed query logic.
    l.dirVector=l.fLength>0 ? d*(1.f/l.fLength) : D3DXVECTOR3(0,0,0);
    l.m_vPosMin={min(ax,bx),min(ay,by),min(az,bz)};
    l.m_vPosMax={max(ax,bx),max(ay,by),max(az,bz)};
    l.lineType=(CKTDGLineMap::LINE_TYPE)type; l.bEnable=enabled!=0; l.bCanDown=canDown!=0;
    l.m_bCanPass=canPass!=0; l.beforeLine=before; l.nextLine=next;
    l.m_lineGroupID.Init();
    hostMap.m_LineList.entries[i]=&l; ++hostMap.m_LineList.count; return i;
}
int build_line_groups() {
    const int n=(int)hostMap.m_LineList.size();
    // The raw optimized builder allocates exactly n members. A reciprocal
    // cycle can revisit its unmarked initial member and overrun that storage;
    // reject such an unsupported input before calling the unchanged function.
    for(int i=0;i<n;++i) {
        if(!hostLines[i].bEnable) continue;
        int current=i,steps=0;
        for(;;) {
            int next=hostLines[current].nextLine;
            if(next<0||next>=n||!hostLines[next].bEnable||hostLines[next].beforeLine!=current) break;
            if(++steps>n) return -1;
            current=next;
        }
    }
    hostMap.ReBuildLineGroup();
    return 0;
}
int query_nearest(float x,float y,float z) {
    initResult(x,y,z,-1);
    if(!validPosition(x,y,z)) return -1;
    int index=hostMap.GetNearestLine({x,y,z},NULL,false);
    if(index<0) return 0;
    D3DXVECTOR3 point(x,y,z);
    hostMap.GetLengthToLine({x,y,z},index,&point);
    result.found=1; result.index=index;
    result.x=point.x; result.y=point.y; result.z=point.z;
    return 1;
}
int query_line_group(int index) {
    initResult(0,0,0,index);
    if(index<0||index>=(int)hostMap.m_LineList.size()) return -1;
    auto group=hostMap.GetLineGroupIncludesLineData(index);
    if(!group.IsValid()) return 0;
    result.found=1;result.x=(float)group.m_iStartLineIndex;result.y=(float)group.m_iEndLineIndex;
    return 1;
}
float distance_between(float ax,float ay,float az,float bx,float by,float bz) {
    if(!validPosition(ax,ay,az)||!validPosition(bx,by,bz)) return -1.f;
    return GetDistance({ax,ay,az},{bx,by,bz});
}
int query_support(float x,float y,float z,float radius,int index,int monster) {
    initResult(x,y,z,index);
    if(!validPosition(x,y,z)||!valid(radius)||radius<=0) return -1;
    D3DXVECTOR3 p(x,y,z);
    bool hit=hostMap.IsOnLine(p,radius,&p,&index,monster!=0);
    result.found=hit; result.index=index; result.x=p.x; result.y=p.y; result.z=p.z; return hit;
}
int query_down(float x,float y,float z,float radius,int index,int downRadius,int monster,int onLine) {
    initResult(x,y,z,index);
    if(!validPosition(x,y,z)||!valid(radius)||radius<=0||index<0||index>=(int)hostMap.m_LineList.size()) return -1;
    D3DXVECTOR3 p(x,y,z);
    bool hit=hostMap.CanDown(p,radius,&p,&index,downRadius!=0,monster!=0,onLine!=0);
    result.found=hit; result.index=index; result.x=p.x; result.y=p.y; result.z=p.z; return hit;
}
int query_land(float x,float y,float z,float radius,int index) {
    initResult(x,y,z,index);
    if(!validPosition(x,y,z)||!valid(radius)||radius<=0||index < -1||index>=(int)hostMap.m_LineList.size()) return -1;
    if(hostMap.m_LineList.size()==0) return 0;
    D3DXVECTOR3 p=hostMap.GetLandPosition({x,y,z},radius,&index);
    bool found=index>=0&&index<(int)hostMap.m_LineList.size();
    result.found=found; result.index=index; result.x=p.x; result.y=p.y; result.z=p.z; return found;
}
int can_pass_up(float x,float y,float z) {
    if(!validPosition(x,y,z)) return -1;
    return hostMap.CanPassUp(D3DXVECTOR3(x,y,z));
}
int line_collision(float ax,float ay,float az,float bx,float by,float bz,float cx,float cy,float cz,float dx,float dy,float dz,float radius) {
    initResult(0,0,0,-1);
    if(!validPosition(ax,ay,az)||!validPosition(bx,by,bz)||!validPosition(cx,cy,cz)||!validPosition(dx,dy,dz)||!valid(radius)||radius<=0) return -1;
    D3DXVECTOR3 a(0,0,0),b(0,0,0);
    bool hit=hostApp.collision.LineToLine({ax,ay,az},{bx,by,bz},{cx,cy,cz},{dx,dy,dz},radius,a,b);
    result.found=hit; result.ax=a.x; result.ay=a.y; result.az=a.z; result.bx=b.x; result.by=b.y; result.bz=b.z; return hit;
}
int sphere_collision(float ax,float ay,float az,float ar,float bx,float by,float bz,float br) {
    initResult(0,0,0,-1);
    if(!validPosition(ax,ay,az)||!validPosition(bx,by,bz)||!valid(ar)||!valid(br)||ar<0||br<0) return -1;
    D3DXVECTOR3 p(0,0,0);
    bool hit=hostApp.collision.SphereToSphere({ax,ay,az},ar,{bx,by,bz},br,&p);
    result.found=hit; result.x=p.x; result.y=p.y; result.z=p.z; return hit;
}
int line_sphere_collision(float ax,float ay,float az,float bx,float by,float bz,float ar,float cx,float cy,float cz,float cr) {
    initResult(0,0,0,-1);
    if(!validPosition(ax,ay,az)||!validPosition(bx,by,bz)||!validPosition(cx,cy,cz)||!valid(ar)||!valid(cr)||ar<0||cr<0) return -1;
    D3DXVECTOR3 p(0,0,0);
    bool hit=hostApp.collision.LineToSphere({ax,ay,az},{bx,by,bz},ar,{cx,cy,cz},cr,&p);
    result.found=hit; result.x=p.x; result.y=p.y; result.z=p.z; return hit;
}
}
