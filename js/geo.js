// 저폴리 지오메트리 헬퍼와 공용 재질
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const C = h => new THREE.Color(h);

/** 지오메트리를 non-indexed + 단색 vertex color 로 변환하고 행렬을 적용 */
export function prep(geo, color, m) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (m) g.applyMatrix4(m);
  return g;
}
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
export function merged(list) {
  if (!list.length) return null;
  const g = mergeGeometries(list, false); list.forEach(x => x.dispose()); g.computeVertexNormals(); return g;
}

/* 재질: 조명 계산이 가벼운 Lambert (어두운 지하에서는 차이가 거의 없고 내장 그래픽에 유리) */
export const landMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });      // 스스로 빛나는 면 (작업등, 창)
export const glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide });
export const woodMat = new THREE.MeshLambertMaterial({ color: 0x3a2f28, flatShading: true });
export const steelMat = new THREE.MeshLambertMaterial({ color: 0x70757c, flatShading: true });

/**
 * Mesher: 상자·배관 수천 개를 정점 배열 하나에 직접 써 넣어 메시 하나(= 그리기 호출 1번)로 만든다.
 * 중간 지오메트리 객체를 만들지 않아 생성이 빠르고 메모리도 적게 쓴다.
 * 좌표 변환: 구역 로컬 → 월드 (ox, oy, oz 이동 + z 좌우 반전 mz)
 */
const CUBE = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().attributes.position.array;
export class Mesher {
  constructor(ox = 0, oy = 0, oz = 0, mz = 1) { this.p = []; this.c = []; this.ox = ox; this.oy = oy; this.oz = oz; this.mz = mz; }
  /** 중심·크기로 상자 (ry: y축 회전) */
  box(x, y, z, sx, sy, sz, col, ry = 0) {
    const P = this.p, Cc = this.c, cx = this.ox + x, cy = this.oy + y, cz = this.oz + z * this.mz;
    if (ry) { const a = ry * this.mz, cs = Math.cos(a), sn = Math.sin(a);
      for (let i = 0; i < 108; i += 3) { const px = CUBE[i] * sx, pz = CUBE[i + 2] * sz; P.push(cx + px * cs + pz * sn, cy + CUBE[i + 1] * sy, cz - px * sn + pz * cs); Cc.push(col.r, col.g, col.b); }
    } else for (let i = 0; i < 108; i += 3) { P.push(cx + CUBE[i] * sx, cy + CUBE[i + 1] * sy, cz + CUBE[i + 2] * sz); Cc.push(col.r, col.g, col.b); }
    return this;
  }
  /** 범위로 상자 */
  span(x0, x1, y0, y1, z0, z1, col) { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col); }
  /** 선로 좌표계(fr: T·U·R, 원점 O — 월드)에 맞춘 상자. l·u·r: 중심 오프셋, sl·su·sr: 크기. 변환(ox·mz)은 적용하지 않음 */
  fbox(O, fr, l, u, r, sl, su, sr, col) {
    const P = this.p, Cc = this.c, T = fr.T, U = fr.U, R = fr.R;
    for (let i = 0; i < 108; i += 3) {
      const a = l + CUBE[i] * sl, b = u + CUBE[i + 1] * su, c = r + CUBE[i + 2] * sr;
      P.push(O.x + T.x * a + U.x * b + R.x * c, O.y + T.y * a + U.y * b + R.y * c, O.z + T.z * a + U.z * b + R.z * c); Cc.push(col.r, col.g, col.b);
    }
    return this;
  }
  /** 두 점 사이 n각 배관 (옆면만) */
  pipe(ax, ay, az, bx, by, bz, rad, col, n = 8, raw = false) {
    if (!raw) { ax += this.ox; ay += this.oy; az = this.oz + az * this.mz; bx += this.ox; by += this.oy; bz = this.oz + bz * this.mz; }
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 1, tx = dx / L, ty = dy / L, tz = dz / L;
    let ux = 0, uy = 1, uz = 0; if (Math.abs(ty) > .9) { ux = 1; uy = 0; }
    let vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux; const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
    ux = vy * tz - vz * ty; uy = vz * tx - vx * tz; uz = vx * ty - vy * tx;
    const P = this.p, Cc = this.c;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * 6.2832, a1 = (i + 1) / n * 6.2832, c0 = Math.cos(a0) * rad, s0 = Math.sin(a0) * rad, c1 = Math.cos(a1) * rad, s1 = Math.sin(a1) * rad;
      const x0 = ux * c0 + vx * s0, y0 = uy * c0 + vy * s0, z0 = uz * c0 + vz * s0, x1 = ux * c1 + vx * s1, y1 = uy * c1 + vy * s1, z1 = uz * c1 + vz * s1;
      P.push(ax + x0, ay + y0, az + z0, bx + x1, by + y1, bz + z1, bx + x0, by + y0, bz + z0, ax + x0, ay + y0, az + z0, ax + x1, ay + y1, az + z1, bx + x1, by + y1, bz + z1);
      for (let k = 0; k < 6; k++) Cc.push(col.r, col.g, col.b);
    }
    return this;
  }
  get count() { return this.p.length / 3; }
  build(mat = landMat, doubleSided = false) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    if (mat.isMeshLambertMaterial) g.computeVertexNormals();
    this.p = this.c = null;
    const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; return m;
  }
}
