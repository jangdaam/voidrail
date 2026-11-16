// 원격 플레이어 움직임 재생: '끊김 없는 이동'의 핵심
//
// 1) 지연 재생(보간 버퍼): 현재보다 delay ms 과거 시점을 재생한다. 그러면 거의 항상
//    '앞뒤 스냅샷 두 개' 사이를 보간하게 되어, 패킷 도착 간격이 들쭉날쭉해도 움직임은 일정하다.
// 2) 3차 Hermite 보간: 위치뿐 아니라 속도까지 맞춰 이어붙여, 방향 전환에서도 꺾임 없이 곡선으로 움직인다.
// 3) 적응형 지연: 네트워크 흔들림(지터)을 측정해 delay 를 자동 조절. 바꿀 때는 재생 속도를 ±8% 범위로만
//    살짝 빠르게/느리게 해서 시간이 '점프'하지 않는다.
// 4) 외삽 + 오차 감쇠: 패킷이 끊기면 마지막 속도로 최대 250ms 예측 이동. 새 패킷이 와서 예측이 틀렸으면
//    그 차이를 즉시 고치지 않고 0.1초 정도에 걸쳐 녹여 없앤다(순간이동 방지).
import * as THREE from 'three';

const MAX_EXTRAP = .25, SNAP_DIST = 6;

export class RemoteMotion {
  constructor(sendIntervalMs = 50) {
    this.interval = sendIntervalMs;
    this.buf = [];                       // {t(local ms), p:Vector3, v:Vector3, yaw, pitch, flags, seq}
    this.delay = 110; this.targetDelay = 110;
    this.jitter = 0; this.prevArr = 0; this.prevT = 0; this.transit = null;
    this.renderT = null;
    this.err = new THREE.Vector3();
    this.lastRaw = new THREE.Vector3(); this.extrapolating = false; this.fresh = false;
    this.out = { p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, pitch: 0, flags: 0, extrap: false, gap: 0 };
    this.stats = { received: 0, extrapFrames: 0, frames: 0, late: 0 };
  }
  push(s, tLocal, arrival) {
    this.stats.received++;
    const b = this.buf;
    if (b.some(x => x.seq === s.seq)) return;
    if (this.renderT !== null && tLocal < this.renderT - 200) { this.stats.late++; return; }  // 너무 늦은 패킷 버림
    const snap = { t: tLocal, seq: s.seq, flags: s.flags, yaw: s.yaw, pitch: s.pitch, p: new THREE.Vector3(...s.p), v: new THREE.Vector3(...s.v) };
    let i = b.length; while (i > 0 && b[i - 1].t > tLocal) i--;
    b.splice(i, 0, snap);
    if (b.length > 40) b.shift();
    // 지터: '도착 간격'과 '보낸 시각 간격'의 차이
    if (this.prevArr && tLocal > this.prevT) {
      const d = Math.abs((arrival - this.prevArr) - (tLocal - this.prevT));
      this.jitter += (Math.min(d, 300) - this.jitter) * .08;
    }
    if (tLocal > this.prevT) { this.prevArr = arrival; this.prevT = tLocal; }
    // 편도 전송 시간(보낸 시각→도착 시각). 빠른 쪽에 가중을 둔 이동 평균
    const tr = arrival - tLocal;
    this.transit = this.transit === null ? tr : this.transit + (tr - this.transit) * (tr < this.transit ? .2 : .05);
    // 목표 지연 = 편도 전송 + 전송 간격(패킷 1개 손실 대비) + 지터 여유
    this.targetDelay = Math.min(450, Math.max(60, this.transit + this.interval * 1.3 + this.jitter * 2.5 + 10));
    this.fresh = true;
  }
  /** 보간 원자료 (오차 감쇠 전) */
  raw(rt, o) {
    const b = this.buf;
    if (!b.length) return false;
    if (rt <= b[0].t) { this.copy(b[0], o); o.extrap = false; return true; }
    const last = b[b.length - 1];
    if (rt >= last.t) {                                  // 외삽
      const e = Math.min((rt - last.t) / 1000, MAX_EXTRAP);
      this.copy(last, o); o.p.addScaledVector(last.v, e);
      if (!(last.flags & 2)) {} // 무중력: 등속
      o.extrap = rt - last.t > 1; o.gap = rt - last.t;
      return true;
    }
    let i = b.length - 1; while (b[i - 1].t > rt) i--;
    const a = b[i - 1], c = b[i], span = (c.t - a.t) / 1000, u = (rt - a.t) / (c.t - a.t);
    if (a.p.distanceTo(c.p) > SNAP_DIST || span <= 0) { this.copy(u < .5 ? a : c, o); o.extrap = false; return true; }
    // 3차 Hermite
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    o.p.set(0, 0, 0).addScaledVector(a.p, h00).addScaledVector(a.v, h10 * span).addScaledVector(c.p, h01).addScaledVector(c.v, h11 * span);
    o.v.copy(a.v).lerp(c.v, u);
    o.yaw = lerpAngle(a.yaw, c.yaw, u); o.pitch = a.pitch + (c.pitch - a.pitch) * u;
    o.flags = u < .5 ? a.flags : c.flags; o.extrap = false; o.gap = 0;
    return true;
  }
  copy(s, o) { o.p.copy(s.p); o.v.copy(s.v); o.yaw = s.yaw; o.pitch = s.pitch; o.flags = s.flags; }
  /** 매 프레임 호출. nowLocal: 내 시계(ms). 게임 시간(dt) 대신 실제 경과 시간만 사용 → 프레임이 느려도 재생 시계가 밀리지 않음 */
  sample(nowLocal) {
    const o = this.out;
    if (!this.buf.length) return null;
    const dt = this.lastNow ? Math.min(.25, Math.max(0, (nowLocal - this.lastNow) / 1000)) : 0; this.lastNow = nowLocal;
    // 재생 시계: 목표 지연 쪽으로 재생 속도를 ±8% 범위에서만 조절
    const want = nowLocal - this.targetDelay;
    if (this.renderT === null || Math.abs(want - this.renderT) > 600) { this.renderT = want; this.delay = this.targetDelay; }
    else {
      const rate = 1 + Math.max(-.08, Math.min(.08, (want - this.renderT) / 1000 * 2));
      this.renderT += dt * 1000 * rate;
    }
    this.delay = nowLocal - this.renderT;
    // 새 데이터가 와서 지난 프레임 결과가 달라졌다면, 그 차이를 오차로 넘겨 서서히 녹임
    if (this.fresh && this.extrapolating) {
      const prev = { p: new THREE.Vector3(), v: new THREE.Vector3() };
      if (this.raw(this.lastRT, prev)) { const d = this.lastRaw.clone().sub(prev.p); if (d.length() < SNAP_DIST) this.err.add(d); }
    }
    this.fresh = false;
    this.raw(this.renderT, o);
    this.lastRT = this.renderT; this.lastRaw.copy(o.p);
    this.extrapolating = this.renderT > this.buf[this.buf.length - 1].t;
    this.err.multiplyScalar(Math.exp(-dt * 12));
    o.p.add(this.err);
    // 오래된 스냅샷 정리 (재생 시점 앞의 것 2개만 남김)
    while (this.buf.length > 3 && this.buf[1].t < this.renderT - 50) this.buf.shift();
    this.stats.frames++; if (this.extrapolating) this.stats.extrapFrames++;
    return o;
  }
}
export function lerpAngle(a, b, t) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
