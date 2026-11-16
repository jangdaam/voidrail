// 전송 계층: 게임 코드는 이 인터페이스만 사용한다.
//   sendFast(buf)            위치 스냅샷. 비신뢰·비순서 (늦은 패킷을 기다리지 않음 = 끊김 방지)
//   sendRel(type, data, to)  이벤트·동기화. 신뢰·순서 보장
//   on('fast'|'rel'|'join'|'leave', fn)
//
// 구현 2가지
//   TrysteroTransport : WebRTC P2P. 신호 교환만 공용 릴레이(Nostr) 또는 자체 ws-relay 사용,
//                       연결 후 데이터는 브라우저끼리 직접. 위치용으로 별도 비신뢰 데이터채널을 협상해 연다.
//   LocalTransport    : 같은 브라우저 탭끼리 BroadcastChannel. 지연·지터·손실을 인위로 넣어 넷코드를 시험.

const FAST_CHANNEL_ID = 42;   // 양쪽이 같은 id 로 협상 없이(negotiated) 여는 채널

class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return () => this.h[ev] = this.h[ev].filter(f => f !== fn); }
  emit(ev, ...a) { for (const fn of this.h[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } }
}

export class TrysteroTransport extends Emitter {
  constructor({ signal } = {}) { super(); this.signal = signal; this.fast = new Map(); this.peerSet = new Set(); this.kind = 'webrtc'; }
  async join(roomCode) {
    const lib = await import('../../vendor/trystero.js');
    const config = { appId: 'voidrail-game/v1', identity: 'none', password: 'voidrail:' + roomCode, maxUsers: 8 };
    this.room = this.signal ? lib.joinWs({ ...config, relayConfig: { urls: [this.signal] } }, roomCode) : lib.joinNostr(config, roomCode);
    const self = await this.room.getSelf();
    this.selfId = self.peerId;
    this.relAct = this.room.makeAction('rel');
    this.fastAct = this.room.makeAction('fast');      // 비신뢰 채널이 아직 없을 때의 대체 경로
    this.relAct.onMessage((d, ctx) => this.emit('rel', ctx.peerId, d.t, d.d));
    this.fastAct.onMessage((d, ctx) => this.emit('fast', ctx.peerId, toArrayBuffer(d)));
    this.room.onPeerJoin(({ peerId }) => { this.peerSet.add(peerId); this.openFast(peerId); this.emit('join', peerId); });
    this.room.onPeerLeave(({ peerId }) => { this.peerSet.delete(peerId); const ch = this.fast.get(peerId); ch?.close(); this.fast.delete(peerId); this.emit('leave', peerId); });
    this.room.onError?.(err => this.emit('error', err));
    return this.selfId;
  }
  openFast(peerId) {
    const pc = this.room.getPeers()[peerId]?.connection;
    if (!pc) return;
    try {
      const ch = pc.createDataChannel('vr-fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onmessage = e => this.emit('fast', peerId, e.data);
      this.fast.set(peerId, ch);
    } catch (e) { console.warn('비신뢰 채널 생성 실패, 신뢰 채널로 대체', e); }
  }
  peers() { return [...this.peerSet]; }
  fastOpen(peerId) { return this.fast.get(peerId)?.readyState === 'open'; }
  sendFast(buf) {
    const fallback = [];
    for (const id of this.peerSet) {
      const ch = this.fast.get(id);
      if (ch && ch.readyState === 'open' && ch.bufferedAmount < 16384) ch.send(buf);
      else if (!ch || ch.readyState !== 'open') fallback.push(id);
    }
    if (fallback.length) this.fastAct.send(buf, { target: fallback }).catch(() => {});
  }
  sendRel(type, data, to = null) { this.relAct.send({ t: type, d: data }, to ? { target: to } : undefined).catch(() => {}); }
  async leave() { for (const ch of this.fast.values()) ch.close(); await this.room?.leave(); }
}
const toArrayBuffer = d => d instanceof ArrayBuffer ? d : d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d;

/** 테스트용: 같은 브라우저 탭끼리. lag(ms), jitter(ms), loss(0~1) 로 인터넷 상황 흉내 */
export class LocalTransport extends Emitter {
  constructor({ lag = 60, jitter = 20, loss = 0 } = {}) {
    super(); this.lag = lag; this.jitter = jitter; this.loss = loss; this.kind = 'local';
    this.selfId = 'L' + Math.random().toString(36).slice(2, 8); this.seen = new Map(); this.relClock = new Map();
  }
  async join(roomCode) {
    this.bc = new BroadcastChannel('voidrail-' + roomCode);
    this.bc.onmessage = e => this.recv(e.data);
    this.post({ k: 'hello' });
    this.hb = setInterval(() => {
      this.post({ k: 'hb' });
      const now = performance.now();
      for (const [id, t] of this.seen) if (now - t > 4000) { this.seen.delete(id); this.emit('leave', id); }
    }, 1000);
    addEventListener('beforeunload', () => this.post({ k: 'bye' }));
    return this.selfId;
  }
  post(m) { this.bc.postMessage({ ...m, from: this.selfId }); }
  recv(m) {
    if (m.from === this.selfId || (m.to && m.to !== this.selfId && !(Array.isArray(m.to) && m.to.includes(this.selfId)))) return;
    const isNew = !this.seen.has(m.from);
    this.seen.set(m.from, performance.now());
    if (m.k === 'bye') { this.seen.delete(m.from); this.emit('leave', m.from); return; }
    if (isNew) { this.emit('join', m.from); if (m.k === 'hello') this.post({ k: 'hb', to: m.from }); }
    if (m.k === 'fast') {
      if (Math.random() < this.loss) return;                               // 손실
      setTimeout(() => this.emit('fast', m.from, m.buf), this.lag + Math.random() * this.jitter);   // 순서 뒤바뀜 허용
    } else if (m.k === 'rel') {
      // 신뢰 채널: 지연은 있지만 순서 유지 (손실 시 TCP 처럼 재전송 지연이 생긴 것으로 처리)
      const extra = Math.random() < this.loss ? this.lag * 2 : 0;
      const t = Math.max(performance.now() + this.lag + Math.random() * this.jitter + extra, (this.relClock.get(m.from) || 0) + 1);
      this.relClock.set(m.from, t);
      setTimeout(() => this.emit('rel', m.from, m.t, m.d), t - performance.now());
    }
  }
  peers() { return [...this.seen.keys()]; }
  fastOpen() { return true; }
  sendFast(buf) { this.post({ k: 'fast', buf }); }
  sendRel(type, data, to = null) { this.post({ k: 'rel', t: type, d: data, to }); }
  async leave() { this.post({ k: 'bye' }); clearInterval(this.hb); this.bc.close(); }
}

export function makeTransport(params) {
  if (params.get('net') === 'local') return new LocalTransport({ lag: +(params.get('lag') ?? 60), jitter: +(params.get('jitter') ?? 20), loss: +(params.get('loss') ?? 0) });
  return new TrysteroTransport({ signal: params.get('signal') || null });
}
