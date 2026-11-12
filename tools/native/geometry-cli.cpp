// Native executable fixture transport only; all queries call the extracted methods.
#include <cstdio>
int main() {
    char cmd[32];
    float a[16];
    int i[8];
    while(std::scanf("%31s",cmd)==1) {
        int status=-1;
        switch(cmd[0]) {
        case 'r': reset(); std::puts("0"); continue;
        case 'a':
            if(std::scanf("%f%f%f%f%f%f%d%d%d%d%d%d",a,a+1,a+2,a+3,a+4,a+5,i,i+1,i+2,i+3,i+4,i+5)!=12) return 2;
            status=add_line(a[0],a[1],a[2],a[3],a[4],a[5],i[0],i[1],i[2],i[3],i[4],i[5]);
            std::printf("%d\n",status); continue;
        case 's':
            if(std::scanf("%f%f%f%f%d%d",a,a+1,a+2,a+3,i,i+1)!=6) return 2;
            status=query_support(a[0],a[1],a[2],a[3],i[0],i[1]); break;
        case 'd':
            if(std::scanf("%f%f%f%f%d%d%d%d",a,a+1,a+2,a+3,i,i+1,i+2,i+3)!=8) return 2;
            status=query_down(a[0],a[1],a[2],a[3],i[0],i[1],i[2],i[3]); break;
        case 'g':
            if(std::scanf("%f%f%f%f%d",a,a+1,a+2,a+3,i)!=5) return 2;
            status=query_land(a[0],a[1],a[2],a[3],i[0]); break;
        case 'b': status=build_line_groups(); std::printf("%d\n",status); continue;
        case 'n':
            if(std::scanf("%f%f%f",a,a+1,a+2)!=3) return 2;
            status=query_nearest(a[0],a[1],a[2]); break;
        case 'q':
            if(std::scanf("%d",i)!=1) return 2;
            status=query_line_group(i[0]); break;
        case 'l':
            for(int n=0;n<13;++n) if(std::scanf("%f",a+n)!=1) return 2;
            status=line_collision(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11],a[12]); break;
        case 'p':
            for(int n=0;n<8;++n) if(std::scanf("%f",a+n)!=1) return 2;
            status=sphere_collision(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7]); break;
        case 't':
            for(int n=0;n<11;++n) if(std::scanf("%f",a+n)!=1) return 2;
            status=line_sphere_collision(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7],a[8],a[9],a[10]); break;
        default: return 3;
        }
        std::printf("%d %d %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g %.9g\n",status,result.index,result.x,result.y,result.z,result.ax,result.ay,result.az,result.bx,result.by,result.bz);
    }
    return 0;
}
