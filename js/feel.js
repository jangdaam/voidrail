// 타격감: 화면 흔들림, 히트스톱, 조준점 피격 표시, 반동, 피해 숫자, 피격 비네트
import * as THREE from 'three';
import { camera } from './scene.js';
import { S } from './state.js';

const $ = id => document.getElementById(id);
let stopT = 0, markT = 0, hurtT = 0;
export const kick = { pitch: 0, yaw: 0 };       // 반동 (카메라에만 더해짐, 시선 자체는 안 바뀜)

export const feel = {
  shake(n) { S.shake = Math.max(S.shake, n); },
  /** 짧게 게임 시간을 거의 멈춤 → 맞는 순간이 '딱' 느껴짐 */
  hitstop(sec) { stopT = Math.max(stopT, sec); },
  hitMarker(kill) {
    const el = $('hitmark'); el.classList.remove('on', 'kill'); void el.offsetWidth;
    el.classList.add('on'); if (kill) el.classList.add('kill'); markT = kill ? .32 : .16;
  },
  hurt() { hurtT = .5; },
  recoil(p, y = 0) { kick.pitch += p; kick.yaw += (Math.random() - .5) * y; },
  floatNumber(pos, n) { float(pos, '-' + n, 'dmg'); },
  pickup(pos) { float(pos, '+1 고철', ''); },
};
/** 게임 시간 배율 (히트스톱 중엔 아주 느리게) */
export const timeFactor = () => stopT > 0 ? .06 : 1;

const layer = document.getElementById('floats');
function float(pos, text, cls) {
  const el = document.createElement('div'); el.className = 'float ' + cls; el.textContent = text;
  el.dataset.x = pos.x; el.dataset.y = pos.y; el.dataset.z = pos.z; el.dataset.t = 0; layer.appendChild(el);
}

export function updateFeel(realDt) {
  stopT -= realDt; markT -= realDt;
  if (markT <= 0) $('hitmark').classList.remove('on', 'kill');
  hurtT = Math.max(0, hurtT - realDt);
  const low = S.hp < 35 ? (35 - S.hp) / 35 * (.55 + .2 * Math.sin(S.time * 6)) : 0;
  $('vign').style.opacity = Math.min(1, hurtT * 1.6 + low).toFixed(3);
  // 반동은 용수철처럼 되돌아옴
  const k = Math.exp(-realDt * 12); kick.pitch *= k; kick.yaw *= k;
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** updateCamera 뒤에 호출 */
export function applyKick() {
  if (S.viewMode !== 'fp' || Math.abs(kick.pitch) + Math.abs(kick.yaw) < 1e-4) return;
  camera.quaternion.multiply(_q.setFromEuler(_e.set(kick.pitch, kick.yaw, 0, 'YXZ')));
}
