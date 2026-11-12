// Owned compatibility/ABI layer. Original getter and rate functions are
// extracted unchanged into ignored *.inc files by build_skill_values.py.
template<class T> struct vector {
    T values[30]; int count;
    int size() const { return count; }
    const T& operator[](int i) const { return values[i]; }
};
namespace std {
template<class K,class V> struct map {
    struct Entry { K first; V second; } entry;
    bool present;
    typedef const Entry* const_iterator;
    const_iterator find(K key) const { return present && key==entry.first ? &entry : nullptr; }
    const_iterator end() const { return nullptr; }
};
}
class CX2SkillTree {
public:
    enum SKILL_ABILITY_TYPE { TEST_ABILITY=0 };
    struct SkillTemplet {
        std::map<SKILL_ABILITY_TYPE,vector<float>> m_mapSkillAbility;
        vector<float> m_vecPowerRate;
#include "original_skill_values_members.inc"
    };
};
#include "original_skill_values_rate.inc"
#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE
#include "original_skill_values_timer.inc"
struct KBuffBehaviorFactor { float values[4]; float operator[](int i)const{return values[i];} };
class CX2BuffChangeNowHpPerSecondBehaviorTemplet {
public:
    enum {FO_CHANGE_TYPE,FO_MULTIPLIER_OR_VALUE,FO_PERCENT=FO_MULTIPLIER_OR_VALUE,FO_RELATION_TYPE,FO_ATTACK_VALUE};
    float GetFixValuePerSecond(const KBuffBehaviorFactor*,const float)const;
    float GetValuePerSecond(const KBuffBehaviorFactor*,const float)const;
    float GetPercentPerSecondByPercent(const KBuffBehaviorFactor*,const float)const;
};
#include "original_skill_values_buff.inc"

static float input[30];
static CX2SkillTree::SkillTemplet templet;
extern "C" {
void* memcpy(void* dst,const void* src,__SIZE_TYPE__ size) {
    volatile unsigned char* d=(volatile unsigned char*)dst;
    const volatile unsigned char* s=(const volatile unsigned char*)src;
    for(__SIZE_TYPE__ i=0;i<size;++i)d[i]=s[i];
    return dst;
}
float* sv_input_ptr(){return input;}
int sv_input_capacity(){return 30;}
float sv_ability(int level,int count){
    if(count<0 || count>30)return 0.f;
    templet.m_mapSkillAbility.present=count>0;
    templet.m_mapSkillAbility.entry.first=CX2SkillTree::TEST_ABILITY;
    templet.m_mapSkillAbility.entry.second.count=count;
    for(int i=0;i<count;++i)templet.m_mapSkillAbility.entry.second.values[i]=input[i];
    return templet.GetSkillAbilityValue(CX2SkillTree::TEST_ABILITY,level);
}
float sv_power(int level,int count){
    if(count<0 || count>30)return 0.f;
    templet.m_vecPowerRate.count=count;
    for(int i=0;i<count;++i)templet.m_vecPowerRate.values[i]=input[i];
    return templet.GetSkillPowerRateValue(level);
}
float sv_increasing(float rate){return CalculateIncreasingRate(rate);}
float sv_buff_fixed(float value,float resist){
    KBuffBehaviorFactor data={{0,value,0,0}};
    return CX2BuffChangeNowHpPerSecondBehaviorTemplet().GetFixValuePerSecond(&data,resist);
}
float sv_buff_relation(float attack,float multiplier,float resist){
    KBuffBehaviorFactor data={{0,multiplier,0,attack}};
    return CX2BuffChangeNowHpPerSecondBehaviorTemplet().GetValuePerSecond(&data,resist);
}
float sv_buff_percent(float percent,float resist){
    KBuffBehaviorFactor data={{0,percent,0,0}};
    return CX2BuffChangeNowHpPerSecondBehaviorTemplet().GetPercentPerSecondByPercent(&data,resist);
}
static float intervalSum;
int sv_buff_interval(float sum,float target,float dt){
    CKTDXCheckElapsedTime timer;
    timer.SetTargetTime(target);timer.ResetSumOfElapsedTime(sum);timer.OnFrameMove(dt);
    const bool passed=timer.CheckAndResetElapsedTime();intervalSum=timer.GetSumOfElapsedTime();
    return passed;
}
float sv_buff_interval_sum(){return intervalSum;}
}
#ifdef SKILL_VALUES_NATIVE_HARNESS
#include <stdio.h>
int main(){
    input[0]=300;input[1]=400;input[2]=500;input[3]=1000;
    float valid=sv_ability(4,4),invalid=sv_ability(5,4),zero=sv_ability(0,4);
    input[0]=1;input[1]=1.075f;
    float power=sv_power(2,2),rate=sv_increasing(1.12f);
    printf("{\"ability4\":%.9g,\"invalid\":%.9g,\"zero\":%.9g,\"power2\":%.9g,\"increasing112\":%.9g}\n",valid,invalid,zero,power,rate);
    const float hp=sv_buff_relation(2000,-.3f,.5f);
    const int passed=sv_buff_interval(.9f,1,.2f);const float sum=sv_buff_interval_sum();
    printf("{\"buffRelation\":%.9g,\"intervalTriggered\":%d,\"intervalSum\":%.9g}\n",hp,passed,sum);
    return valid==1000 && invalid==0 && zero==0 && power==1.075f && rate>0.12004f && rate<0.12006f && hp==-300 && passed==1 && sum==0 ? 0:1;
}
#endif
