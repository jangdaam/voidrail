// Distances are in metres along the approach, flight and landing. Ordinary quays
// are built on world X/Z axes; bridge stairs are built in the local rail frame.
import * as THREE from 'three';
import { trackPos, frameAt, makeFrame } from './track.js';

const frame = makeFrame();
const up = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

export function makeStairRun(anchor, index, count, random = Math.random) {
  const { s, side, bot } = anchor;
  frameAt(s, frame);
  const origin = trackPos(s, new THREE.Vector3());
  const along = bot ? new THREE.Vector3(1, 0, 0) : frame.T;
  const vertical = bot ? up : frame.U;
  const across = bot ? new THREE.Vector3(0, 0, side) : frame.R.clone().multiplyScalar(side);
  const point = (x, y, z) => origin.clone().addScaledVector(along, x)
    .addScaledVector(vertical, y).addScaledVector(across, z);
  // Pairs converge on neighbouring lanes. Each pair reaches a different car.
  const lane = (index % 2 ? .28 : -.28) + (random() - .5) * .12;
  let points, treads;
  if (bot) {
    const spread = ((index + .2 + random() * .6) / count - .5) * 15;
    points = [point(spread, bot.u, bot.lat + 1 + random() * 2.5),
      point(lane, bot.u, bot.lat), point(lane, 0, bot.top), point(lane, 0, 2.55)];
    treads = Math.max(8, Math.ceil(Math.abs(bot.u) / .3));
  } else {
    // Keep even the rear rank on the small 1.8 m bottom platform.
    points = [point(7.8 + (Math.floor(index / 2) - .8) * .48, -5.65, 3.6 + lane * 1.7),
      point(7.06, -5.38, 3.6 + lane), point(1.28, -.11, 3.6 + lane),
      point(.38 + lane, -.12, 2.65)];
    treads = 17;
  }
  const ends = [0];
  for (let i = 1; i < points.length; i++) ends.push(ends[i-1] + points[i].distanceTo(points[i-1]));
  return { points, ends, length: ends[3], treads, distance: 0, stride: .68 + random() * .10,
    phase: random(), pace: 5.0 + random() * .65, started: false };
}

export function sampleRun(run, distance, out, onTread = false) {
  const {points, ends} = run;
  const i = distance < ends[1] ? 0 : distance < ends[2] ? 1 : 2;
  const t = clamp((distance - ends[i]) / (ends[i+1] - ends[i] || 1), 0, 1);
  out.lerpVectors(points[i], points[i+1], t);
  if (onTread && i === 1) {
    const step = Math.min(run.treads - 1, Math.floor(t * run.treads));
    out.y = THREE.MathUtils.lerp(points[1].y, points[2].y, (step + .5) / run.treads);
  }
  return out;
}

// Re-evaluate the intercept every frame, including through braking. The last
// stretch is released by train position; a late group can miss, never teleport.
export function advanceRun(run, gap, trainRate, dt) {
  const left = run.length - run.distance;
  if (left <= 0 || trainRate <= .01) return 0;
  const eta = Math.max(0, gap) / trainRate;
  if (!run.started && eta > left / run.pace) return 0;
  run.started = true;
  const beat = Math.PI * (run.distance / run.stride + run.phase);
  const pulse = 1 + .18 * Math.sin(beat) - .10 * Math.cos(2 * beat);
  const speed = Math.min(7.8, left / Math.max(dt, eta));
  const distance = gap <= 0 && left < .008 ? left : Math.min(left, dt * speed * pulse, Math.max(0, left - Math.max(0, gap) * .12));
  run.distance += distance;
  return distance;
}

const contact = new THREE.Vector3(), next = new THREE.Vector3(), facing = new THREE.Vector3();
const right = new THREE.Vector3(), inverse = new THREE.Quaternion();
function footfall(run, distance, side, out) {
  sampleRun(run, distance, out, true);
  const i = distance < run.ends[1] ? 0 : distance < run.ends[2] ? 1 : 2;
  facing.subVectors(run.points[i+1], run.points[i]).setY(0).normalize();
  return out.addScaledVector(right.crossVectors(up, facing), side * .145);
}

// Anchor the stance foot to its tread. The other foot clears the next riser
// before the pelvis drops onto the weaker leg.
export function poseStairRun(d) {
  const run = d.stairs, step = run.distance / run.stride + run.phase;
  const beat = step * Math.PI, sway = Math.cos(beat), weak = d.limp ? 1 : -1;
  const loading = Math.max(0, weak * sway);
  const P = d.P;
  P.H.set(.105 * sway, .80 - .125 * loading + .065 * Math.abs(Math.sin(beat)), .10);
  P.sd.set(.37 * sway + weak * .12, 1, .80 + .38 * loading);
  for (let i = 0; i < 2; i++) {
    const side = i ? -1 : 1, half = step + i;
    const cycle = half - 2 * Math.floor(half / 2);
    const planted = run.distance + (.5 - cycle) * run.stride;
    footfall(run, planted, side, contact);
    if (cycle > 1) {
      const t = cycle - 1;
      footfall(run, planted + 2 * run.stride, side, next);
      contact.lerp(next, t*t*(3-2*t)).y += Math.sin(t*Math.PI) * (i === d.limp ? .22 : .38);
    }
    P.foot[i].copy(contact).sub(d.g.position).applyQuaternion(inverse.copy(d.g.quaternion).invert());
    P.hand[i].set(side * (.42 + .12 * loading), (i === d.limp ? .55 : 1) + side * .25 * sway,
      (i === d.limp ? .12 : .55) + side * .30 * Math.sin(beat - .45));
    P.kp[i].set(side * .16, .15, 1);
    P.ep[i].set(side * .8, .15, -.65);
  }
  d.plant = true;
}
