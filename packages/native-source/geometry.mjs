// Original C++ geometry runs inside an isolated WASM instance per simulation.
// This adapter validates loading and copies results; it contains no query algorithm.
export const NATIVE_GEOMETRY_RULE = 'v5-a8438f3-geometry-wasm-v3';
const TYPES = ['LT_NORMAL','LT_WALL','LT_POTAL','LT_HOLE','LT_JUMP_UP_REL','LT_JUMP_UP_ABS','LT_BUNGEE','LT_MONSTER_ROAD','LT_UNIT_ROAD','LT_OTHER_ROAD','LT_CLIFF'];
const MAX_LINES = 4096;
function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(v => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))) throw new TypeError(`${label} must contain 3 finite float32 coordinates`);
  return value.map(Math.fround);
}
function radius(value) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(Math.fround(value))) throw new TypeError('radius must be a positive finite float32 number');
  return Math.fround(value);
}
function typeOf(line) {
  const raw = line.type ?? line.nativeFields?.LINE_TYPE?.symbol ?? 'LT_NORMAL';
  if (Number.isInteger(raw) && raw >= -1 && raw <= 10) return raw;
  const name = String(raw).split('.').pop();
  if (name === 'LT_INVALID') return -1;
  const i = TYPES.indexOf(name);
  if (i < 0) throw new TypeError(`Unsupported native line type ${raw}`);
  return i;
}
function field(line, key, fallback) {
  if(line.nativeFields && Object.hasOwn(line.nativeFields,key))return line.nativeFields[key];
  if(Object.hasOwn(line,key))return line[key];
  return fallback;
}
function booleanField(value,label) {
  if(value===true||value===1)return 1;
  if(value===false||value===0)return 0;
  if(value&&typeof value==='object')value=value.$symbol??value.symbol;
  if(value==='TRUE')return 1;
  if(value==='FALSE')return 0;
  throw new TypeError(`${label} must be an explicit boolean, 0/1 or TRUE/FALSE symbol`);
}

/** bytes/module create a new instance; explicit instance ownership stays with caller. */
export async function createNativeGeometry({ bytes, module, instance, map = { lines: [] } } = {}) {
  if (!instance) {
    if (!module) {
      if (!bytes) throw new TypeError('Provide compiled original geometry WASM bytes, module or isolated instance');
      module = await WebAssembly.compile(bytes);
    }
    if (WebAssembly.Module.imports(module).length) throw new TypeError('Native geometry module must not import host implementations');
    instance = await WebAssembly.instantiate(module);
  }
  const wasm = instance.exports;
  for (const name of ['memory','__wasm_call_ctors','reset','add_line','build_line_groups','query_nearest','query_line_group','distance_between','query_support','query_down','query_land','can_pass_up','line_collision','sphere_collision','line_sphere_collision','result_ptr']) if (!wasm[name]) throw new TypeError(`Missing native geometry export ${name}`);
  // Exporting this startup entry prevents wasm-ld from rerunning nontrivial
  // LineGroupID global constructors through every exported query wrapper.
  wasm.__wasm_call_ctors();
  let ids = [], indexById = new Map();
  const result = () => {
    const view = new DataView(wasm.memory.buffer, wasm.result_ptr(), 44);
    const nativeIndex = view.getInt32(4, true);
    return { found: !!view.getInt32(0, true), lineId: ids[nativeIndex] ?? null, nativeIndex,
      point: [8,12,16].map(p => view.getFloat32(p, true)),
      pointA: [20,24,28].map(p => view.getFloat32(p, true)), pointB: [32,36,40].map(p => view.getFloat32(p, true)) };
  };
  const index = id => indexById.get(id) ?? 0;
  const queryResult = () => {
    const r = result();
    return {found:r.found,lineId:r.found?r.lineId:null,point:r.found?r.point:null,rawPoint:r.point,nativeIndex:r.nativeIndex};
  };
  const api = {
    ruleVersion: NATIVE_GEOMETRY_RULE, instance,
    reset(nextMap) {
      const lines = nextMap?.lines;
      if (!Array.isArray(lines) || lines.length > MAX_LINES) throw new TypeError(`map.lines must contain at most ${MAX_LINES} lines`);
      // Validate the whole list before mutating the isolated module.
      const nextIds = lines.map((l,i) => l.lineId ?? i), nextIndex = new Map(nextIds.map((id,i) => [id,i]));
      if (nextIndex.size !== nextIds.length) throw new TypeError('Native map line IDs must be unique');
      const neighbor = id => {
        if (id == null) return -1;
        if (Number.isInteger(id) && id < 0) return id;
        if (!nextIndex.has(id)) throw new TypeError(`Missing native neighbor line ${id}`);
        return nextIndex.get(id);
      };
      const prepared = lines.map(l => ({start:vector(l.start ?? field(l,'START_POS'),'line.start'),end:vector(l.end ?? field(l,'END_POS'),'line.end'),
        type:typeOf(l),enabled:booleanField(field(l,'ENABLE',true),'ENABLE'),canDown:booleanField(field(l,'CAN_DOWN',true),'CAN_DOWN'),canPass:booleanField(field(l,'CAN_PASS',true),'CAN_PASS'),
        before:neighbor(l.beforeLine ?? field(l,'BEFORE_LINE',-1)),next:neighbor(l.nextLine ?? field(l,'NEXT_LINE',-1))}));
      // The unchanged optimized group builder's n-member stack allocation does
      // not support reciprocal cycles. Reject them before resetting this map.
      for(const [start,line] of prepared.entries()){
        if(!line.enabled)continue;
        const visited=new Set([start]);let current=start;
        while(true){const next=prepared[current].next;
          if(next<0||!prepared[next].enabled||prepared[next].before!==current)break;
          if(visited.has(next))throw new TypeError('Cyclic reciprocal native line groups are unsupported');
          visited.add(next);current=next;}
      }
      wasm.reset();
      for (const l of prepared) if (wasm.add_line(...l.start,...l.end,l.type,l.enabled,l.canDown,l.before,l.next,l.canPass)<0) throw new Error('Native line loader rejected validated input');
      if(wasm.build_line_groups()<0)throw new Error('Native line group loader rejected validated input');
      ids=nextIds; indexById=nextIndex;
      return api;
    },
    support({position,radius:r=30,lastLineId,isMonster=false}) {
      const p=vector(position,'position');
      const status=wasm.query_support(...p,radius(r),index(lastLineId),isMonster?1:0);
      if(status<0) throw new Error('Native support rejected input');
      return queryResult();
    },
    down({position,radius:r=30,lastLineId,downRadius=true,onLine=true,isMonster=false}) {
      const p=vector(position,'position'); const rad=radius(r);
      if (!ids.length) return {found:false,lineId:null,point:null,rawPoint:p,nativeIndex:-1};
      // Raw CanDown dereferences the remembered index even when onLine=false.
      const status=wasm.query_down(...p,rad,index(lastLineId),downRadius?1:0,isMonster?1:0,onLine?1:0);
      if(status<0) throw new Error('Native down rejected input');
      return queryResult();
    },
    land({position,radius:r=30,lastLineId}) {
      const p=vector(position,'position'),rad=radius(r);
      const status=wasm.query_land(...p,rad,indexById.get(lastLineId)??-1);
      if(status<0)throw new Error('Native land-position query rejected input');
      return queryResult();
    },
    nearest({position}) {
      const p=vector(position,'position');
      if(wasm.query_nearest(...p)<0)throw new Error('Native nearest-line query rejected input');
      return queryResult();
    },
    lineGroup(lineId) {
      const nativeIndex=indexById.get(lineId);
      if(nativeIndex==null)return null;
      if(wasm.query_line_group(nativeIndex)<0)throw new Error('Native line group query rejected input');
      const q=result();if(!q.found)return null;
      const [start,end]=q.point;
      if(!Number.isInteger(start)||!Number.isInteger(end)||ids[start]==null||ids[end]==null)
        throw new RangeError('Invalid original line group indices');
      return {startLineId:ids[start],endLineId:ids[end],nativeStartIndex:start,nativeEndIndex:end};
    },
    distance(a,b) {
      const d=wasm.distance_between(...vector(a,'a'),...vector(b,'b'));
      if(d<0||!Number.isFinite(d))throw new Error('Native distance query rejected input');
      return d;
    },
    canPassUp({position}) {
      const status=wasm.can_pass_up(...vector(position,'position'));
      if(status<0) throw new Error('Native up query rejected input');
      return !!status;
    },
    lineCollision({aStart,aEnd,bStart,bEnd,radius:r=30}) {
      const status=wasm.line_collision(...vector(aStart,'aStart'),...vector(aEnd,'aEnd'),...vector(bStart,'bStart'),...vector(bEnd,'bEnd'),radius(r));
      if(status<0) throw new Error('Native line collision rejected input');
      const q=result(); return {hit:q.found,pointA:q.pointA,pointB:q.pointB};
    },
    collisionPoint(attack,defender) {
      if(defender?.kind!=='sphere'||!['line','sphere'].includes(attack?.kind)) return null;
      const center=vector(defender.center,'defender.center');
      const collisionRadius = value => {
        if(!Number.isFinite(value)||value<0||!Number.isFinite(Math.fround(value))) throw new TypeError('Collision radius must be finite and nonnegative');
        return Math.fround(value);
      };
      const ar=collisionRadius(attack.radius),dr=collisionRadius(defender.radius);
      const status=attack.kind==='sphere'
        ?wasm.sphere_collision(...vector(attack.center,'attack.center'),ar,...center,dr)
        :wasm.line_sphere_collision(...vector(attack.start,'attack.start'),...vector(attack.end,'attack.end'),ar,...center,dr);
      if(status<0) throw new Error('Native hit geometry rejected input');
      return status?result().point:null;
    }
  };
  api.reset(map);
  return api;
}
