// 상대 시계와 내 시계의 차이(offset) 추정. NTP 방식 왕복 측정 중 RTT 가 가장 짧은 표본들을 신뢰.
export const now = () => performance.timeOrigin + performance.now();

export class PeerClock {
  constructor() { this.samples = []; this.offset = 0; this.smoothed = 0; this.rtt = 0; this.ready = false; }
  /** t0: 내가 보낸 시각, t1: 상대가 받은 시각(상대 시계), t2: 내가 답을 받은 시각 */
  add(t0, t1, t2) {
    const rtt = t2 - t0; if (rtt < 0 || rtt > 5000) return;
    this.samples.push({ rtt, off: t1 - (t0 + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    this.rtt = best[0].rtt;
    // 추정값이 바뀌어도 화면 시간이 튀지 않도록 천천히 따라감
    this.smoothed = this.ready ? this.smoothed + (this.offset - this.smoothed) * .25 : this.offset;
    this.ready = true;
  }
  toLocal(tRemote) { return tRemote - this.smoothed; }
}
