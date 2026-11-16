// 모든 조정 가능한 수치와 콘텐츠 정의를 한곳에 모아둔 설정 파일
import * as THREE from 'three';

export const F = 1.3;            // 차량 바닥 높이 (차량 로컬 좌표)
export const CH = 90;            // 청크 길이 (m)
export const STEP = 1.6;         // 침목 간격
export const BL = 1300;          // 한 지역 길이 (m)
export const RAIL_JOINT = 12;    // 레일 이음매 간격 (덜컹 소리)

export const QUALITY = {
  high:   { label: '높음', pr: 2,    shadow: 2048, density: 1,   fog: 700, weather: 1,   budget: 4 },
  medium: { label: '보통', pr: 1.25, shadow: 1024, density: .8,  fog: 600, weather: .7,  budget: 3 },
  low:    { label: '낮음', pr: 1,    shadow: 0,    density: .6,  fog: 480, weather: .45, budget: 2 },
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];

const C = h => new THREE.Color(h);
// chord: 지역 앰비언트 화음 (Hz)
export const BIOMES = [
  { name: '초록 고원',      skyTop: C('#4f9be0'), horizon: C('#cdeef5'), grass: C('#79c457'), grass2: C('#a4d968'), rock: C('#8d7b69'), rockDark: C('#5a4d45'), foliage: C('#3c9150'), accent: C('#ffe08a'), tree: 'pine',     weather: 'fireflies', landmark: 'arch',      chord: [196, 247, 294] },
  { name: '단풍 협곡',      skyTop: C('#6d8ed9'), horizon: C('#ffd6aa'), grass: C('#e8a843'), grass2: C('#d9692f'), rock: C('#a06e53'), rockDark: C('#5f3b33'), foliage: C('#e4552d'), accent: C('#ffbf73'), tree: 'round',    weather: 'leaves',    landmark: 'giantTree', chord: [174, 220, 262] },
  { name: '청록 결정지대',  skyTop: C('#1f6d8c'), horizon: C('#a3e8db'), grass: C('#5fd3b6'), grass2: C('#86e6c9'), rock: C('#4b7182'), rockDark: C('#2b4153'), foliage: C('#2f8f86'), accent: C('#9ff7ff'), tree: 'crystal',  weather: 'motes',     landmark: 'spire',     chord: [220, 277, 330] },
  { name: '눈 덮인 봉우리', skyTop: C('#86acd9'), horizon: C('#eef4fb'), grass: C('#f6f9ff'), grass2: C('#dfe9f6'), rock: C('#7e899b'), rockDark: C('#4c5466'), foliage: C('#3b6b59'), accent: C('#fff0c4'), tree: 'pine',     weather: 'snow',      landmark: 'station',   chord: [147, 220, 294] },
  { name: '진홍의 균열',    skyTop: C('#3d1732'), horizon: C('#ff8f62'), grass: C('#bf4a3d'), grass2: C('#d9663f'), rock: C('#5c2f35'), rockDark: C('#2e1620'), foliage: C('#2c1b20'), accent: C('#ffa060'), tree: 'dead',     weather: 'embers',    landmark: 'chain',     chord: [131, 156, 196] },
  { name: '보랏빛 버섯숲',  skyTop: C('#3d2b7a'), horizon: C('#e3a9ff'), grass: C('#9d7de3'), grass2: C('#b897ef'), rock: C('#5b4b7c'), rockDark: C('#33294e'), foliage: C('#ff78c6'), accent: C('#ffd3ff'), tree: 'mushroom', weather: 'motes',     landmark: 'mushroom',  chord: [165, 208, 247] },
];

export const WSPEC = {
  snow:      { n: 1400, size: .45, color: '#ffffff', add: false, op: .95 },
  leaves:    { n: 500,  size: .55, color: '#f08a3c', add: false, op: .95 },
  embers:    { n: 700,  size: .35, color: '#ffa25e', add: true,  op: 1 },
  motes:     { n: 600,  size: .3,  color: null,      add: true,  op: .85 },
  fireflies: { n: 260,  size: .45, color: '#fff08a', add: true,  op: 1 },
};

export const ITEM_NAMES = { scrap: '고철', wood: '목재' };

/* 보일러 (단위: 연료 1 = 최대 화력으로 1초 타는 양) */
export const BOILER = {
  load: 40,            // 삽 한 번 = 장작 한 아름이 넣는 연료
  binStart: 5,         // 시작 시 연료 상자에 든 삽 수
  binMax: 20,          // 연료 상자 최대 (삽 단위)
  woodPerLoad: 2,      // 배낭 목재 2개 = 상자 1삽
  fireStart: 40,       // 시작 시 화실 연료
  pressureStart: .6,
  burnIdle: .35, burnMax: .65,   // 초당 연료 소모 = idle + max × 가감(0~1)
  heatRate: .5,        // 불 세기 변화 속도
  gain: .055,          // 불 세기 1일 때 초당 압력 상승
  useIdle: .01, useMax: .07,     // 초당 압력 소모 = idle + max × (현재속도/최고속도)
  valve: .95,          // 안전밸브 열림 압력
  minWork: .15, fullWork: .75,   // 이 압력 사이에서 낼 수 있는 최고 속도가 0 → 100%
  vmax: 40,            // 최고 속도 (m/s)
};

/* 습격 (공허 진드기) */
export const RAID = {
  firstDelay: 100,              // 출발 후 첫 습격까지 (기차가 달린 시간, 초)
  intervalMin: 160, intervalMax: 260,
  baseSize: 4, maxSize: 9,      // 첫 습격 마릿수, 최대
  hp: 3, speed: 8, dash: 15,    // 진드기 체력(권총 3발 · 렌치 2대), 비행·돌진 속도
  bite: 14, biteCool: 2.6,      // 무는 피해, 다시 물기까지
  drain: .012,                  // 달라붙은 진드기 한 마리당 초당 압력 감소
  extraDrop: .35,               // 고철 조각을 하나 더 떨어뜨릴 확률
  hpMax: 100, regen: 4, regenDelay: 5,
};

/* 추적자 (선로 포식자) — 거리 단위 m, 속도 m/s. 기차 최고 속도는 BOILER.vmax(40) */
export const CHASE = {
  firstDelay: 210,              // 출발 후 첫 추적까지 (초)
  intervalMin: 220, intervalMax: 340,
  startGap: 400,                // 나타날 때 맨 뒤 칸과의 거리
  speed0: 14, accel: .3, speedMax: 22,    // 처음 속도 → 점점 빨라짐. 불을 잘 때면 기차는 ~26m/s 를 유지, 모아 둔 압력으로 순간 40m/s
  loseGap: 560,                 // 이만큼 벌어지면 포기
  maxTime: 120,                 // 이 시간이 지나면 지쳐서 돌아감
  ramGap: 3, knockback: 45,     // 들이받는 거리, 들이받은 뒤 튕겨나는 거리
  ramPressure: .28, ramDamage: 22,
  hp: 14, headR: 2.1, hitPush: 3.5,      // 권총 한 발마다 뒤로 밀림
  dropScrap: 5,
};

/* 도구 퀵슬롯 */
export const TOOLS = [
  { id: 'wrench', name: '렌치', key: '1', hint: '고장 난 곳 수리 (다음 단계)' },
  { id: 'shovel', name: '삽', key: '2', hint: '연료 상자에서 퍼서 화실에 넣기' },
  { id: 'pistol', name: '권총', key: '3', hint: '좌클릭 사격' },
  { id: 'hook', name: '갈고리', key: '4', hint: '떠다니는 재료를 겨냥해 좌클릭' },
];
