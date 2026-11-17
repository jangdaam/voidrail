// 걸어다닐 수 있는 4량 기차: 시각 메시 + 차량 로컬 충돌 박스
import * as THREE from 'three';
import { clamp } from './noise.js';
import { C, prep, M, merged, landMat, glowMat, glassMat } from './geo.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { scene } from './scene.js';
import { F } from './config.js';
import { S } from './state.js';

// 시작 기차 팔레트: 차콜 · 철 · 구리 (CarB 기본 부품이 쓰는 이름은 같은 톤으로 재정의)
const CHAR = C('#2b2b2f'), CHAR2 = C('#38383d'), IRON = C('#6b7078'), IRON_D = C('#4b4f56'), COPPER = C('#b8733f'), COPPER_D = C('#8a5732'),
  GLOWC = C('#dbe6f2'), FIRE = C('#ff7a2e');
const DARK = CHAR, GOLD = COPPER, WOOD = C('#5a4a3e'), FLOOR = C('#4f463f'), CREAM = C('#8e8a84'), CEIL = C('#7d7770');
const RAIL_H = 1.25;   // 난간 충돌 높이 (점프로 못 넘음, 시각 난간은 1.0)

/* 차량 폭 확장: 아래 부품 정의는 원래 폭(바깥 반폭 1.7m) 기준 좌표로 적혀 있고,
 * 중심선에서 ZT 보다 바깥의 z 좌표는 WIDEN 만큼 일괄로 밀어낸다 → 실내 폭 3.2m → 4.4m.
 * 문·선로·보일러처럼 중앙에 있는 것은 그대로. 최종 좌표로 직접 적을 땐 { raw: true }. */
export const WIDEN = .6, ZT = 1.1, HALF_W = 1.7 + WIDEN;     // HALF_W: 바닥 바깥 반폭
const zmap = z => Math.abs(z) > ZT + 1e-6 ? z + Math.sign(z) * WIDEN : z;

class CarB {
  constructor() { this.solid = []; this.glow = []; this.glass = []; this.boxes = []; this.vis = []; }
  /** 시각 상자는 바로 만들지 않고 기록 → build() 에서 겹친 면 정리 후 생성 */
  box(x0, x1, y0, y1, z0, z1, col, o = {}) {
    const { collide = true, visual = true, kind = 'solid', raw = false } = o;
    if (!raw) { z0 = zmap(z0); z1 = zmap(z1); }
    if (visual) this.vis.push({ min: [x0, y0, z0], max: [x1, y1, z1], col, kind });
    if (collide) this.boxes.push({ min: [x0, y0, z0], max: [x1, y1, z1] });
  }
  /**
   * Z-파이팅 원천 차단: 같은 방향을 보는 두 면이 같은 평면에서 겹치면(면적 > 0)
   * 나중에 추가된 상자(장식·디테일)의 그 면을 바깥으로 EPS 만큼 밀어낸다.
   * 로그 깊이 버퍼 덕분에 4mm 차이도 먼 거리에서 구분된다.
   */
  resolveCoplanar() {
    const V = this.vis, EPS = .004, T = 1e-5; let fixed = 0;
    for (let pass = 0; pass < 6; pass++) {
      let changed = 0;
      for (let j = 1; j < V.length; j++) {
        const b = V[j];
        for (let i = 0; i < j; i++) {
          const a = V[i];
          if (a.max[0] < b.min[0] - T || a.min[0] > b.max[0] + T || a.max[1] < b.min[1] - T || a.min[1] > b.max[1] + T || a.max[2] < b.min[2] - T || a.min[2] > b.max[2] + T) continue;
          for (let ax = 0; ax < 3; ax++) {
            const u = (ax + 1) % 3, v = (ax + 2) % 3;
            const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
            const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
            if (ou <= T || ov <= T) continue;
            if (Math.abs(a.max[ax] - b.max[ax]) < T) { b.max[ax] += EPS; changed++; }
            if (Math.abs(a.min[ax] - b.min[ax]) < T) { b.min[ax] -= EPS; changed++; }
          }
        }
      }
      if (!changed) return { fixed, remaining: 0 };
      fixed += changed;
    }
    return { fixed, remaining: -1 };            // 6회 안에 수렴 못함 (디버그용)
  }
  build() {
    const fixed = this.resolveCoplanar();
    for (const r of this.vis) {
      const [x0, y0, z0] = r.min, [x1, y1, z1] = r.max;
      this[r.kind].push(prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), r.col, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)));
    }
    return fixed;
  }
  add(geo, col, m, kind = 'solid', raw = false) {
    if (m && !raw) m.elements[14] = zmap(m.elements[14]);       // 위치(z)만 확장, 모양은 그대로
    this[kind].push(prep(geo, col, m));
  }
  base(x0, x1, plates) {
    this.box(x0, x1, F - .3, F, -1.7, 1.7, FLOOR);
    this.box(x0 + .4, x1 - .4, F - .85, F - .3, -1.2, 1.2, DARK, { collide: false });
    // 연결 발판: 커브에서도 틈이 안 생기도록 넉넉히 겹침
    if (plates.includes('front')) this.box(x1, x1 + .62, F - .14, F - .008, -.72, .72, DARK);   // 이웃 발판과 높이 엇갈림
    if (plates.includes('rear')) this.box(x0 - .62, x0, F - .12, F, -.72, .72, DARK);
  }
  sideWall(z, x0, x1, doors, col) {
    const t0 = z - .06, t1 = z + .06; let cur = x0; const segs = [];
    for (const [d0, d1] of doors) { if (d0 > cur) segs.push([cur, d0]); cur = d1; }
    if (cur < x1) segs.push([cur, x1]);
    for (const [a, b] of segs) {
      this.box(a, b, F, F + 1, t0, t1, col);
      this.box(a, b, F + 1.9, F + 2.6, t0, t1, col);
      this.box(a, b, F + 1, F + 1.9, t0, t1, col, { visual: false });
      const n = Math.max(1, Math.round((b - a) / 1.5));
      for (let i = 0; i <= n; i++) { const x = clamp(a + (b - a) * i / n, a + .08, b - .08); this.box(x - .08, x + .08, F + 1.04, F + 1.9, t0 - .03, t1 + .03, col, { collide: false }); }
      this.box(a, b, F + .97, F + 1.04, t0 - .05, t1 + .05, CREAM, { collide: false });   // 창틀
      this.box(a, b, F + 1, F + 1.9, z - .01, z + .01, GLOWC, { collide: false, kind: 'glass' });
    }
    for (const [d0, d1] of doors) {
      this.box(d0, d1, F + 2.2, F + 2.6, t0, t1, col);
      this.box(d0 - .1, d0, F, F + 2.2, t0 - .05, t1 + .05, DARK, { collide: false });
      this.box(d1, d1 + .1, F, F + 2.2, t0 - .05, t1 + .05, DARK, { collide: false });
    }
  }
  endWall(x, col, door = 1.3) {
    const t0 = x - .06, t1 = x + .06, h = door / 2;
    this.box(t0, t1, F, F + 2.6, -1.7, -h, col); this.box(t0, t1, F, F + 2.6, h, 1.7, col); this.box(t0, t1, F + 2.2, F + 2.6, -h, h, col);
  }
  roof(x0, x1, col = DARK) {
    this.box(x0 - .1, x1 + .1, F + 2.6, F + 2.8, -1.85, 1.85, col);
    this.box(x0 + .1, x1 - .1, F + 2.5, F + 2.57, -1.54, 1.54, CEIL, { collide: false });
    this.box(x0, x1, F + 2.83, F + 2.92, -1.2, 1.2, CREAM, { collide: false });
  }
  railing(x0, x1, z0, z1, gaps = []) {
    const alongX = (x1 - x0) > (z1 - z0); let cur = alongX ? x0 : z0; const end = alongX ? x1 : z1; const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > cur) segs.push([cur, g0]); cur = g1; }
    if (cur < end) segs.push([cur, end]);
    for (const [a, b] of segs) {
      const n = Math.max(1, Math.ceil((b - a) / 1.2));
      if (alongX) {
        this.box(a, b, F, F + RAIL_H, z0, z1, DARK, { visual: false });
        this.box(a, b, F + .92, F + 1, z0, z1, DARK, { collide: false }); this.box(a, b, F + .45, F + .5, z0, z1, DARK, { collide: false });
        for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; this.box(x - .04, x + .04, F, F + 1, z0, z1, DARK, { collide: false }); }
      } else {
        const za = zmap(a), zb = zmap(b), nz = Math.max(1, Math.ceil((zb - za) / 1.2));   // 넓힌 뒤 기둥을 고르게
        this.box(x0, x1, F, F + RAIL_H, za, zb, DARK, { visual: false, raw: true });
        this.box(x0, x1, F + .92, F + 1, za, zb, DARK, { collide: false, raw: true });
        for (let i = 0; i <= nz; i++) { const z = za + (zb - za) * i / nz; this.box(x0, x1, F, F + 1, z - .04, z + .04, DARK, { collide: false, raw: true }); }
      }
    }
  }
}

export const CARS = [];
export const coplanarReport = {};
function finishCar(B, x0, x1, wheelXs, name) {
  coplanarReport[name] = B.build();
  const g = new THREE.Group();
  const sm = new THREE.Mesh(merged(B.solid), landMat); sm.castShadow = sm.receiveShadow = true; g.add(sm);
  if (B.glow.length) g.add(new THREE.Mesh(merged(B.glow), glowMat));
  if (B.glass.length) g.add(new THREE.Mesh(merged(B.glass), glassMat));
  const wheels = [], wg = new THREE.CylinderGeometry(.5, .5, .22, 8).rotateX(Math.PI / 2);
  for (const x of wheelXs) for (const z of [-.86, .86]) {
    const w = new THREE.Mesh(prep(wg.clone(), DARK), landMat); w.position.set(x, .5, z); w.castShadow = true; g.add(w); wheels.push(w);
    w.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.75, .12, .24), GOLD), landMat));
  }
  scene.add(g);
  const car = { g, x0, x1, boxes: B.boxes, name, off: 0, wheels, frame: makeFrame(), inv: new THREE.Matrix4() };
  CARS.push(car); return car;
}
const bogie = (x0, x1) => [x0 + 1.1, x0 + 2.2, x1 - 2.2, x1 - 1.1];

/* ================= 시작 기차: 투박한 3량 (차콜 · 철 · 구리) =================
 * 보일러 시스템을 염두에 둔 배치
 *   기관차  : 앞은 보일러, 뒤는 지붕만 얹은 개방형 운전실. 운전실 앞벽(보일러 뒷면)에 화실 문·압력계·가감 레버
 *   연료차  : 연료 상자(장작 보관) + 공구 상자. 화실까지 몇 걸음이라 '나르기'가 생김
 *   숙소칸  : 판잣집 같은 작은 객차. 침대·등. 시작 지점
 */
/* 1) 기관차 */
const L = new CarB();
L.base(-4, 4, ['rear']);
// 보일러 (앞쪽)
L.add(new THREE.CylinderGeometry(.95, .95, 4.0, 10), IRON, M(1.3, F + 1.05, 0, 0, 0, Math.PI / 2));
for (const x of [.2, 1.4, 2.6]) L.add(new THREE.CylinderGeometry(.99, .99, .12, 10), COPPER, M(x, F + 1.05, 0, 0, 0, Math.PI / 2));
L.add(new THREE.CylinderGeometry(.9, .9, .3, 10), CHAR, M(3.45, F + 1.05, 0, 0, 0, Math.PI / 2));
L.box(-.7, 3.6, F, F + 2.0, -.95, .95, IRON, { visual: false });
L.add(new THREE.CylinderGeometry(.26, .22, 1.2, 7), CHAR, M(2.6, F + 2.5, 0)); L.add(new THREE.CylinderGeometry(.42, .26, .35, 7), CHAR, M(2.6, F + 3.25, 0));
L.box(2.33, 2.87, F + 1.9, F + 3.45, -.27, .27, CHAR, { visual: false });
L.add(new THREE.SphereGeometry(.36, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), COPPER, M(1.0, F + 1.95, 0)); L.box(.7, 1.3, F + 1.9, F + 2.3, -.33, .33, COPPER, { visual: false });
L.add(new THREE.CylinderGeometry(.22, .22, .2, 8), GLOWC, M(3.65, F + 2.05, 0, 0, 0, Math.PI / 2), 'glow');
L.add(new THREE.CylinderGeometry(.27, .27, .14, 8), COPPER_D, M(3.58, F + 2.05, 0, 0, 0, Math.PI / 2));
L.add(new THREE.ConeGeometry(.85, 1.0, 4), CHAR, M(4.45, .75, 0, 0, Math.PI / 4, -Math.PI / 2));
L.railing(-.7, 3.95, 1.62, 1.7); L.railing(-.7, 3.95, -1.7, -1.62); L.railing(3.9, 3.98, -1.7, 1.7);
// 운전실 (뒤쪽, 개방형): 낮은 옆벽 + 기둥 4개 + 지붕
for (const s of [1, -1]) {
  const z0 = s > 0 ? 1.58 : -1.7, z1 = s > 0 ? 1.7 : -1.58;
  L.box(-4, -2.7, F, F + 1.05, z0, z1, CHAR2); L.box(-1.7, -.7, F, F + 1.05, z0, z1, CHAR2);   // 옆벽 (가운데는 출입구)
  L.box(-4, -.7, F + 1.05, F + 1.13, z0 - .03, z1 + .03, COPPER_D, { collide: false });          // 구리 테두리
  L.box(-4, -.7, F + 1.05, F + RAIL_H, z0, z1, CHAR2, { visual: false });                          // 넘지 못하게
}
for (const [x, z] of [[-3.95, 1.6], [-3.95, -1.6], [-.78, 1.6], [-.78, -1.6]]) L.box(x - .07, x + .07, F, F + 2.6, z - .07, z + .07, CHAR);
L.box(-4.15, -.55, F + 2.6, F + 2.75, -1.85, 1.85, IRON_D);
L.box(-4, -3.92, F, F + 1.05, -1.7, -.95, CHAR2); L.box(-4, -3.92, F, F + 1.05, .95, 1.7, CHAR2);   // 뒷벽 (연료차 쪽 통로 1.9m)
// 운전실 앞벽 = 보일러 뒷면: 화실 문, 압력계, 가감 레버 자리
L.box(-.84, -.7, F, F + 2.3, -.95, .95, IRON_D);
L.box(-.92, -.84, F + .3, F + .9, -.35, .35, COPPER_D, { collide: false });                        // 화실 문틀
L.box(-.96, -.92, F + .38, F + .82, -.27, .27, C('#1a1412'), { collide: false });                   // 화실 안쪽 (불빛은 boiler.js)
L.add(new THREE.CylinderGeometry(.2, .2, .08, 12), COPPER, M(-.88, F + 1.65, -.5, 0, 0, Math.PI / 2));   // 압력계 테두리
L.add(new THREE.CylinderGeometry(.16, .16, .04, 12), C('#e8e0d0'), M(-.93, F + 1.65, -.5, 0, 0, Math.PI / 2), 'glow');
L.box(-4, -3.2, F, F + .45, 1.1, 1.58, CHAR2, { raw: false });                                     // 앉을 수 있는 상자
export const locoCar = finishCar(L, -4, 4, [-3.2, -1.9, 1.0, 2.3, 3.4], '기관실');
locoCar.enclosed = false;
export const LEVER_POS = new THREE.Vector3(-.95, F, .55);
export const lever = new THREE.Group(); lever.position.set(-.95, F + .95, .55);
lever.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.07, .8, .07), IRON, M(0, .4, 0)), landMat));
lever.add(new THREE.Mesh(prep(new THREE.IcosahedronGeometry(.09, 0), COPPER, M(0, .82, 0)), landMat));
locoCar.g.add(lever);
locoCar.g.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.25, .2, .3), CHAR, M(-.95, F + .9, .55)), landMat));
// 압력계 바늘 (나중에 보일러 압력과 연동)
export const gaugeNeedle = new THREE.Mesh(prep(new THREE.BoxGeometry(.02, .13, .02), C('#c23b22'), M(0, .055, 0)), glowMat);
gaugeNeedle.position.set(-.96, F + 1.65, -.5); gaugeNeedle.rotation.x = .8; locoCar.g.add(gaugeNeedle);
export const CHIMNEY = new THREE.Vector3(2.6, F + 3.5, 0);

/* 2) 연료차 */
const T = new CarB();
T.base(-3, 3, ['front', 'rear']);
T.railing(-3, 3, 1.62, 1.7, [[-.6, .6]]); T.railing(-3, 3, -1.7, -1.62, [[-.6, .6]]);
// 연료 상자: 한쪽 벽에 붙여 가운데 통로를 비움 (최종 좌표)
const BIN = { x0: -2.4, x1: 1.0, z0: -2.16, z1: -.55, h: .85 };
const raw = { raw: true };
T.box(BIN.x0, BIN.x1, F, F + BIN.h, BIN.z0, BIN.z0 + .1, CHAR, raw); T.box(BIN.x0, BIN.x1, F, F + BIN.h, BIN.z1 - .1, BIN.z1, CHAR, raw);
T.box(BIN.x0, BIN.x0 + .1, F, F + BIN.h, BIN.z0 + .1, BIN.z1 - .1, CHAR, raw); T.box(BIN.x1 - .1, BIN.x1, F, F + BIN.h, BIN.z0 + .1, BIN.z1 - .1, CHAR, raw);
T.box(BIN.x0, BIN.x1, F + BIN.h - .06, F + BIN.h, BIN.z1 - .13, BIN.z1 + .03, COPPER_D, { collide: false, raw: true });
T.box(BIN.x0 - .03, BIN.x0 + .13, F + BIN.h - .06, F + BIN.h, BIN.z0, BIN.z1, COPPER_D, { collide: false, raw: true });
T.box(BIN.x1 - .13, BIN.x1 + .03, F + BIN.h - .06, F + BIN.h, BIN.z0, BIN.z1, COPPER_D, { collide: false, raw: true });
T.box(BIN.x0 + .1, BIN.x1 - .1, F, F + .05, BIN.z0 + .1, BIN.z1 - .1, C('#241f1c'), { collide: false, raw: true });
// 공구 상자 (반대쪽)
T.box(1.4, 2.3, F, F + .55, 1.7, 2.16, IRON_D, raw); T.box(1.4, 2.3, F + .55, F + .6, 1.68, 2.18, COPPER_D, { collide: false, raw: true });
T.box(2.85, 2.95, F, F + 2.3, 1.2, 1.3, CHAR);                                                        // 랜턴 기둥
T.box(2.75, 3.05, F + 2.2, F + 2.5, 1.15, 1.4, GLOWC, { collide: false, kind: 'glow' });
export const tenderCar = finishCar(T, -3, 3, [-2.1, -1.0, 1.0, 2.1], '연료차');
tenderCar.enclosed = false;
export const FUEL_BIN = BIN;                // 연료 상자 범위 (연료차 로컬, z 는 확장 전 기준)

/* 3) 숙소칸 */
const K = new CarB();
K.base(-3.5, 3.5, ['front']);
K.sideWall(1.64, -3.5, 3.5, [[-.5, .5]], IRON); K.sideWall(-1.64, -3.5, 3.5, [[-.5, .5]], IRON);
K.endWall(3.5, IRON); K.endWall(-3.5, IRON);
K.roof(-3.5, 3.5, IRON_D);
K.box(-3.3, -1.0, F, F + .5, -1.58, -.8, CHAR2);                                                     // 침대
K.box(-3.25, -2.7, F + .5, F + .62, -1.5, -.88, C('#cfc6b8'), { collide: false });
K.box(-2.6, -1.05, F + .5, F + .56, -1.58, -.8, C('#5b6b7a'), { collide: false });
K.box(1.6, 2.4, F, F + .6, 1.0, 1.58, IRON_D);                                                       // 상자 탁자
K.box(1.85, 2.05, F + .6, F + .8, 1.25, 1.45, GLOWC, { collide: false, kind: 'glow' });
K.box(-.15, .15, F + 2.15, F + 2.45, -.15, .15, GLOWC, { collide: false, kind: 'glow' });
// 뒤쪽 전망대 (추적자를 향해 쏘는 자리): 뒷문으로 나가는 지붕 없는 발코니
K.box(-4.6, -3.5, F - .3, F, -1.7, 1.7, FLOOR);
K.box(-4.5, -3.6, F - .85, F - .3, -1.2, 1.2, DARK, { collide: false });
K.railing(-4.6, -4.52, -1.7, 1.7); K.railing(-4.6, -3.56, 1.62, 1.7); K.railing(-4.6, -3.56, -1.7, -1.62);
K.box(-4.62, -4.5, F + 1, F + 1.25, -.12, .12, COPPER, { collide: false });                          // 난간 위 구리 장식
export const cabinCar = finishCar(K, -4.6, 3.5, [-2.5, -1.4, 1.4, 2.5], '숙소칸');
cabinCar.enclosed = true; cabinCar.roofX0 = -3.5;   // 이보다 뒤(발코니)는 지붕 없음

locoCar.off = 0; tenderCar.off = 4 + .72 + 3; cabinCar.off = tenderCar.off + 3 + .72 + 3.5;
export const spawnCar = locoCar;            // 시작·안전줄 복귀 지점: 기관실 (앞이 보이는 자리)
export const SPAWN_X = -2.7;

/* 조명 */
export const headLight = new THREE.SpotLight(0xdbe8f5, 420, 150, .5, .7, 1.3);
headLight.position.set(3.7, F + 2.05, 0); locoCar.g.add(headLight, headLight.target); headLight.target.position.set(25, 0, 0);
export const lamps = [[locoCar, -.4, F + .6, 0, 0xc9dcf0, 4], [tenderCar, 2.9, F + 2.3, 1.25 + WIDEN, 0xc9dcf0, 0], [cabinCar, 0, F + 2.0, 0, 0xc9dcf0, 5]]
  .map(([car, x, y, z, c]) => { const l = new THREE.PointLight(c, 7, 11, 2); l.position.set(x, y, z); car.g.add(l); return l; });
/* 화실 불빛 */
export const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2e });
{ const f = new THREE.Mesh(new THREE.BoxGeometry(.013, .4, .5), fireMat); f.position.set(-.968, F + .6, 0); locoCar.g.add(f); }

/* 객차 사이 주름막: 양쪽이 모두 막힌 차량일 때만 (시작 기차엔 없음) */
const bellows = [];
function placeBellows() {}

/* 위치 갱신 */
export function placeTrain() {
  for (const c of CARS) {
    const s = S.sTrain - c.off; frameAt(s, c.frame);
    trackPos(s, c.g.position).addScaledVector(c.frame.U, .3);
    c.g.quaternion.setFromRotationMatrix(c.frame.m);
    for (const w of c.wheels) w.rotation.z = -S.sTrain / .5;
    c.g.updateMatrixWorld(true);
    c.inv.copy(c.g.matrixWorld).invert();
  }
  lever.rotation.z = -.9 + 1.5 * (S.targetSpeed / 40);
  placeBellows();
}

/* ---------- 기차 통합 좌표 (멀티플레이) ----------
 * 차량마다 로컬 좌표가 따로라 차량을 넘나들면 값이 불연속이 된다.
 * 'x - off' 로 모든 차량을 기관차 기준 하나의 직선 좌표로 펴서 주고받으면
 * 차량 경계를 지날 때도 보간이 끊기지 않는다.                              */
export const toTrainCoord = (car, p, out) => out.set(p.x - car.off, p.y, p.z);
export function carForTrainX(x) {
  let best = CARS[0], bd = 1e9;
  for (const c of CARS) { const lx = x + c.off, d = lx < c.x0 ? c.x0 - lx : lx > c.x1 ? lx - c.x1 : 0; if (d < bd) { bd = d; best = c; } }
  return best;
}
export function trainToWorld(tp, out) { const c = carForTrainX(tp.x); out.set(tp.x + c.off, tp.y, tp.z).applyMatrix4(c.g.matrixWorld); return c; }
