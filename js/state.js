// 모듈 사이에서 공유하는 가변 상태 (순환 import 방지용)
import { START_S } from './config.js';
export const S = {
  sTrain: START_S, speed: 0, targetSpeed: 0,
  notch: 0, brake: true, dir: 1,          // 주행 단수(0~4) · 브레이크 · 전후진(+1/-1)
  battery: 100, powered: true, cranking: false,
  hp: 100, scrap: 0, parts: 0, cells: 0, carry: null,   // cells: 주머니 속 소형 전지, carry: 두 손으로 든 것('large')
  onTurret: false,
  time: 0,
  viewMode: 'fp', quality: 'high',
  started: false, muted: false, loading: false, locked: false,
  region: '',
  keys: {},
  shake: 0,
  debug: location.hash === '#debug' || new URLSearchParams(location.search).has('debug'),
};
