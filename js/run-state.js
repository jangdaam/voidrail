import {getSeed} from './noise.js';
import {RunDirector} from './run-director.js';
let director;
export function getRun() {
  if (!director || director.seed !== getSeed()) director = new RunDirector(getSeed());
  return director;
}
export function resetRun() { director = new RunDirector(getSeed()); return director; }
