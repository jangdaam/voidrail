// 시드 기반 결정론적 노이즈 / 난수
let seed = (Math.random() * 1e9) | 0;
export const getSeed = () => seed;
export const setSeed = v => { seed = v | 0; };

export function hash(i, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul((seed + (s | 0) * 1013) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
export function vnoise(x, s) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, s) * (1 - u) + hash(i + 1, s) * u; }
export function fbm(x, s, o = 4) { let a = 0, amp = .5, fr = 1, n = 0; for (let k = 0; k < o; k++) { a += amp * vnoise(x * fr, s + k * 17); n += amp; fr *= 2; amp *= .5; } return a / n; }
function h3(x, y, z, s) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed + s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
export function n3(x, y, z, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz); let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
    r += h3(ix + dx, iy + dy, iz + dz, s) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const chunkRng = (ci, salt = 0) => mulberry(seed ^ Math.imul(ci, 2654435761) ^ Math.imul(salt + 1, 40503));
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const smooth = t => t * t * (3 - 2 * t);
