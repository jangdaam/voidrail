// 모듈 사이에서 공유하는 가변 상태 (순환 import 방지용)
import { START_S } from './config.js';
export const S = {
  sTrain: START_S, speed: 6, targetSpeed: 6, lastTarget: 6,
  time: 0,
  viewMode: 'fp', quality: 'high',
  started: false, muted: false, loading: false, locked: false,
  region: '',
  keys: {},
  shake: 0,
  debug: location.hash === '#debug' || new URLSearchParams(location.search).has('debug'),
};
