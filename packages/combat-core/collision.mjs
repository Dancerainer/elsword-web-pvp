// Reference-V5 KTDXCollision.h:1491,1542. The target 2016 engine is unmeasured.
// Keep the native projection/broadphase policy; do not substitute mesh AABBs.
export function collisionPoint(attack,defender){
  if(defender.kind!=='sphere')return null;
  const c=defender.center,r=defender.radius;
  if(attack.kind==='sphere'){
    const distance=Math.hypot(...c.map((n,i)=>n-attack.center[i]));
    return distance<attack.radius+r?c.map((n,i)=>(n+attack.center[i])/2):null;
  }
  if(attack.kind==='line'){
    const s=attack.start,e=attack.end,v=e.map((n,i)=>n-s[i]),length=Math.hypot(...v);
    if(length<Math.hypot(...c.map((n,i)=>n-s[i]))-r-attack.radius||length===0)return null;
    const dir=v.map(n=>n/length),projection=dir.reduce((sum,n,i)=>sum+n*(c[i]-s[i]),0);
    if(projection<0)return null;
    const point=s.map((n,i)=>n+dir[i]*projection);
    return Math.hypot(...c.map((n,i)=>n-point[i]))<=r+attack.radius?point:null;
  }
  return null;
}
