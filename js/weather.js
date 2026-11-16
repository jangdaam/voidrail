// 지역별 날씨 입자. 카메라 주변 상자에서 순환하며, 기차 실내에 들어간 입자는 숨김
import * as THREE from 'three';
import { softTex, camera, scene } from './scene.js';
import { CARS, HALF_W } from './train.js';
import { WSPEC, QUALITY, F } from './config.js';
import { S } from './state.js';

const WN = 1400, BOX = new THREE.Vector3(140, 70, 140);
const geo = new THREE.BufferGeometry();
const sim = new Float32Array(WN * 3), out = new Float32Array(WN * 3), ph = new Float32Array(WN);
for (let i = 0; i < WN; i++) { sim[i * 3] = (Math.random() - .5) * BOX.x; sim[i * 3 + 1] = (Math.random() - .5) * BOX.y; sim[i * 3 + 2] = (Math.random() - .5) * BOX.z; ph[i] = Math.random() * 6.28; }
geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
const mat = new THREE.PointsMaterial({ map: softTex, size: .5, transparent: true, depthWrite: false, opacity: 0 });
const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);

let type = null, fade = 0;
function apply(t) { type = t; const sp = WSPEC[t]; mat.size = sp.size; mat.blending = sp.add ? THREE.AdditiveBlending : THREE.NormalBlending; mat.needsUpdate = true; }
const last = new THREE.Vector3(), d = new THREE.Vector3(), w = new THREE.Vector3();

export function updateWeather(dt) {
  const t = S.time;
  if (type !== S.weatherTarget) { fade -= dt * 1.2; if (fade <= 0 || type === null) { fade = 0; apply(S.weatherTarget); } }
  else fade = Math.min(1, fade + dt * .6);
  const sp = WSPEC[type], n = Math.floor(sp.n * QUALITY[S.quality].weather);
  geo.setDrawRange(0, n);
  if (sp.color) mat.color.set(sp.color); else mat.color.copy(S.accent);
  const nb = type === 'fireflies' ? .15 + .85 * S.night : type === 'motes' ? .5 + .5 * S.night : 1;
  mat.opacity = sp.op * fade * nb;
  d.subVectors(camera.position, last); last.copy(camera.position);
  const hx = BOX.x / 2, hy = BOX.y / 2, hz = BOX.z / 2, cp = camera.position;
  // 카메라가 기차 근처일 때만 실내 판정
  const nearTrain = CARS.some(c => w.copy(cp).applyMatrix4(c.inv).lengthSq() < 900);
  for (let i = 0; i < n; i++) {
    const o = i * 3, p = ph[i]; let x = sim[o] - d.x, y = sim[o + 1] - d.y, z = sim[o + 2] - d.z;
    switch (type) {
      case 'snow': y -= 3.2 * dt; x += Math.sin(t * .8 + p) * .8 * dt; z += Math.cos(t * .6 + p) * .6 * dt; break;
      case 'leaves': y -= 2.4 * dt; x += Math.sin(t * 1.6 + p) * 2.2 * dt; z += Math.cos(t * 1.3 + p) * 1.6 * dt; break;
      case 'embers': y += 2.8 * dt; x += Math.sin(t * 2 + p) * 1.2 * dt; break;
      case 'motes': y += Math.sin(t * .5 + p) * .5 * dt; x += Math.cos(t * .4 + p) * .5 * dt; break;
      case 'fireflies': y += Math.sin(t * 1.3 + p) * 1.2 * dt; x += Math.cos(t * .9 + p * 2) * 1.4 * dt; z += Math.sin(t * .7 + p) * 1.4 * dt; break;
    }
    if (x < -hx) x += BOX.x; else if (x > hx) x -= BOX.x;
    if (y < -hy) y += BOX.y; else if (y > hy) y -= BOX.y;
    if (z < -hz) z += BOX.z; else if (z > hz) z -= BOX.z;
    sim[o] = x; sim[o + 1] = y; sim[o + 2] = z;
    let hide = false;
    if (nearTrain && x * x + y * y + z * z < 1600) {
      for (const c of CARS) {
        w.set(cp.x + x, cp.y + y, cp.z + z).applyMatrix4(c.inv);
        if (w.x > (c.roofX0 ?? c.x0) - .7 && w.x < c.x1 + .7 && Math.abs(w.z) < HALF_W + .2 && w.y > 0 && w.y < F + 2.75 && c.enclosed) { hide = true; break; }
      }
    }
    out[o] = hide ? 0 : x; out[o + 1] = hide ? -1e4 : y; out[o + 2] = hide ? 0 : z;
  }
  geo.attributes.position.needsUpdate = true; points.position.copy(cp);
}
