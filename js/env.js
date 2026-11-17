// 열차가 들고 다니는 빛: 전조등, 운전실 화실 불빛, 객차 등. 어둠 속에서 열차만 따뜻한 섬처럼 보이게.
import { headLight, lamps, fireMat } from './train.js';
import { S } from './state.js';

export function updateEnv() {
  const f = .85 + Math.sin(S.time * 13) * .08 + Math.sin(S.time * 31) * .07;      // 화실 불 깜빡임
  fireMat.color.setRGB(.8 * f, .36 * f, .12);      // 화실만 유일하게 따뜻한 빛
  lamps[0].intensity = 5 + f; lamps[1].intensity = 4; lamps[2].intensity = 5;
  headLight.intensity = 420;
}
