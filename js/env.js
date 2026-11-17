import { atmosphere } from './geo.js';
import { sector, SECTOR } from './track.js';
import { S } from './state.js';
import { headLight, lamps } from './train.js';
export function updateEnv() {
  atmosphere.datum.value=sector(Math.max(0,Math.floor(S.sTrain/SECTOR))).y0;
  lamps[0].intensity=4; lamps[1].intensity=3; lamps[2].intensity=4;
  headLight.intensity=420;
}
