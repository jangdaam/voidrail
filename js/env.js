// 낮밤 순환, 하늘·안개·조명 색, 지역 전환 감지
import * as THREE from 'three';
import { clamp, smooth } from './noise.js';
import { C, glowMat, crystalMat, glassMat } from './geo.js';
import { biomeAt } from './track.js';
import { scene, skyMat, sun, moon, hemi, stars, sunSprite, moonSprite } from './scene.js';
import { headLight, lamps } from './train.js';
import { S } from './state.js';

const NIGHT_TOP = C('#0a0f2e'), NIGHT_HOR = C('#2c3566'), DUSK = C('#ff9a66'), SUNW = C('#fff3dc'), SUNO = C('#ffae70'), WHITE = C('#ffffff'), GROUND = C('#554a44');
const GLASS_DAY = C('#cfe6ff'), GLASS_NIGHT = C('#ffd98a');
export const sunDir = new THREE.Vector3();
const top = new THREE.Color(), hor = new THREE.Color(), tmp = new THREE.Color();
let onBiomeChange = () => {};
export const setBiomeListener = fn => onBiomeChange = fn;

export function updateEnv(dt) {
  S.tod = (S.tod + dt * S.timeMul / 240) % 1;
  const a = (S.tod - .25) * Math.PI * 2, elev = Math.sin(a);
  S.day = smooth(clamp((elev + .12) / .4, 0, 1)); S.night = 1 - S.day; S.dusk = clamp(1 - Math.abs(elev) / .3, 0, 1);
  sunDir.set(Math.cos(a) * .75, elev, .42).normalize();
  const bm = biomeAt(S.sTrain + 40), night = S.night;
  top.copy(bm.a.skyTop).lerp(bm.c.skyTop, bm.t); hor.copy(bm.a.horizon).lerp(bm.c.horizon, bm.t);
  S.accent.copy(bm.a.accent).lerp(bm.c.accent, bm.t);
  const duskAmt = S.dusk * .45 * (1 - night * .5);
  hor.lerp(DUSK, duskAmt); top.lerp(DUSK, duskAmt * .25);
  top.lerp(NIGHT_TOP, night * .9);
  tmp.copy(NIGHT_HOR).lerp(hor, .25); hor.lerp(tmp, night * .85);
  skyMat.uniforms.top.value.copy(top); skyMat.uniforms.bottom.value.copy(hor); scene.fog.color.copy(hor);
  sun.intensity = 2.7 * S.day; sun.color.copy(SUNW).lerp(SUNO, S.dusk);
  moon.intensity = .8 * night;
  hemi.intensity = .8 + .75 * S.day; hemi.color.copy(top).lerp(WHITE, .55); hemi.groundColor.copy(bm.a.rockDark).lerp(GROUND, .4);
  glowMat.color.setScalar(.6 + .55 * night); crystalMat.color.setScalar(.75 + .35 * night);
  glassMat.opacity = .1 + .12 * night; glassMat.color.copy(GLASS_DAY).lerp(GLASS_NIGHT, night);
  headLight.intensity = 260 * night;
  lamps.forEach(l => l.intensity = l.userData.dayI + 8 * night);
  stars.material.opacity = clamp(night * 1.2 - .1, 0, 1);
  sunSprite.material.color.copy(SUNW).lerp(SUNO, S.dusk); sunSprite.material.opacity = clamp(elev * 6 + .6, 0, 1);
  moonSprite.material.opacity = clamp(-elev * 6 + .6, 0, 1);
  const dom = bm.t < .5 ? bm.a : bm.c, idx = bm.t < .5 ? bm.ia : bm.ic;
  if (dom.name !== S.biomeName) { S.biomeName = dom.name; S.biomeIdx = idx; onBiomeChange(dom, idx); }
  S.weatherTarget = dom.weather;
}
