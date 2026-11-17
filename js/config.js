// 조정 가능한 수치를 한곳에
export const F = 1.3;            // 차량 바닥 높이 (차량 로컬 좌표)
export const CH = 60;            // 선로 청크 길이 (m)
export const SEG = 10;           // 터널 한 마디 길이 (m)
export const STEP = 1.6;         // 침목 간격
export const RAIL_JOINT = 12;    // 레일 이음매 간격 (덜컹 소리)
export const VMAX = 28;          // 최고 속도 (m/s)

/* 운전과 전력. 전력 단위는 % (정비 구역에서 랙을 늘리면 최대치가 커진다) */
export const DRIVE = {
  speeds: [0, 7, 13, 20, 28],          // 단수별 속도 (m/s)
  drain: [0, 20, 32, 45, 60],          // 단수별 분당 전력 소모 (%)
  accel: 1.6, coast: .35, brake: 4.5, dead: 2.2,  // 가속 · 타력 감속 · 제동 · 방전 시 감속 (m/s²)
  generator: 4,                        // 발전기 분당 충전 (%)
  restore: 5,                          // 방전 뒤 이만큼 차야 다시 전원이 들어옴
  crankSpeed: 1.6,                     // 크랭크를 돌리는 동안의 속도 (m/s)
  small: 10, large: 35, pocket: 3,     // 소형 전지 · 대형 배터리 충전량, 주머니에 드는 소형 전지 수
  capacity: 100,
};
/* 선로 옆 선반의 자원 */
export const LOOT = { chance: .11, reach: 3.3, table: [['scrap', .42], ['small', .3], ['part', .14], ['large', .14]] };
/* 무기 */
export const GUN = { mag: 6, reload: 3.2, rate: .28, dmg: 1, range: 90 };
export const TURRET = { rate: .13, dmg: 1, heat: 6.5, cool: 16, lockBelow: 35, slew: 1.3, range: 160, spread: .012 };
export const KICK = { range: 1.9, cool: .7 };
/* 안드로이드 */
export const ANDROID = {
  hp: 3, max: 14, firstDelay: 25, gapMin: 9, gapMax: 20,      // 무리 사이 시간 (열차가 움직인 시간 기준)
  latchMaxSpeed: 17,          // 이보다 빠르면 붙잡지 못하고 튕겨 나감
  shakeSpeed: 15,             // 매달린 채 이 속도를 넘으면 버티다 떨어짐
  climb: 3.2, walk: 1.0, sprint: 4.2, crawl: .8, hit: 12, hitCool: 1.8,
};
/* 회수 드론: 배터리를 노림 */
export const DRONE = {
  hp: 4, max: 3, firstDelay: 60, gapMin: 45, gapMax: 80,     // 출현 간격 (열차가 움직인 시간 기준)
  orbit: 9, speed: 11, dive: 16,                             // 맴도는 반경·비행 속도·급강하 속도
  clamp: 2.4,                                                // 배터리 집게를 물리는 데 걸리는 시간
  hit: 8,
};
export const HP = { max: 100, regen: 5, regenDelay: 6 };
export const START_S = 46;       // 시작 위치 (첫 구역 정비 터널 안)

/* 품질: pr = 픽셀 배율 상한(가장 큰 성능 요인), lights = 열차 주변 실제 조명 수, budget = 프레임당 생성 작업 수 */
export const QUALITY = {
  high:   { label: '높음', pr: 1.5,  lights: 4, budget: 2 },
  medium: { label: '보통', pr: 1.15, lights: 3, budget: 2 },
  low:    { label: '낮음', pr: .85,  lights: 2, budget: 1 },
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];

/* 분위기 */
export const FOG_COLOR = 0x19292d;   // 먼 곳이 녹아드는 청회색 안개 (가까운 구조물은 이보다 어두운 실루엣)
export const FOG_DENSITY = .0032;
