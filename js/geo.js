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
export const jit = (c, rng, l = .06) => c.clone().offsetHSL((rng() - .5) * .02, 0, (rng() - .5) * l);

export const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });      // 창문·랜턴 (밤에 밝아짐)
export const crystalMat = new THREE.MeshBasicMaterial({ vertexColors: true });   // 결정·버섯 발광
export const glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide });
export const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5238, flatShading: true, roughness: 1 });
export const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, flatShading: true, roughness: .6, metalness: .3 });
