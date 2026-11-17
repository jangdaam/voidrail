// 조정 가능한 수치를 한곳에
export const F = 1.3;            // 차량 바닥 높이 (차량 로컬 좌표)
export const CH = 60;            // 선로 청크 길이 (m)
export const SEG = 10;           // 터널 한 마디 길이 (m)
export const STEP = 1.6;         // 침목 간격
export const RAIL_JOINT = 12;    // 레일 이음매 간격 (덜컹 소리)
export const VMAX = 30;          // 최고 속도 (m/s)
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
