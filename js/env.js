import { atmosphere } from './geo.js';
import { sector, SECTOR } from './track.js';
import { S } from './state.js';
import { headLight, lamps, CARS } from './train.js';
export function updateEnv() {
  atmosphere.datum.value=sector(Math.max(0,Math.floor(S.sTrain/SECTOR))).y0;
  // 전력이 끊기면 열차의 불이 모두 꺼진다
  const on = S.powered ? 1 : 0;
  lamps[0].intensity = 4 * on; lamps[1].intensity = 4 * on; lamps[2].intensity = 3 * on;
  headLight.intensity = 420 * on;
  for (const c of CARS) if (c.glowMesh) c.glowMesh.visible = S.powered;
}
