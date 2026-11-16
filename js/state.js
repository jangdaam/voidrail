// 모듈 사이에서 공유하는 가변 상태 (순환 import 방지용)
import * as THREE from 'three';

export const S = {
  sTrain: 0, speed: 6, targetSpeed: 6, lastTarget: 6,
  time: 0, tod: .3, timeMul: 1,
  night: 0, day: 1, dusk: 0,
  viewMode: 'fp', quality: 'high',
  started: false, muted: false, loading: false,
  biomeName: '', biomeIdx: 0, weatherTarget: 'snow',
  accent: new THREE.Color('#ffe08a'),
  keys: {},
  shake: 0,                       // 카메라 흔들림 (fx → player)
  inv: { scrap: 0, wood: 0 },          // 배낭
  heat: 1, pressure: .6, hp: 100,
  tool: 1,                               // 퀵슬롯 (0 렌치 · 1 삽 · 2 권총 · 3 갈고리)
  shovelLoad: 0,                         // 삽 위 장작 (0 또는 1)
  debug: location.hash === '#debug',
};
