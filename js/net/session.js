// 멀티플레이 세션: 전송 계층 위에서 게임 상태를 주고받는다.
//
//  위치    : 20Hz, 44바이트 바이너리, 비신뢰 채널. 좌표는 '기차 통합 좌표'라 기차가 아무리 빨라도 흔들리지 않음.
//  시계    : 상대마다 왕복 측정으로 시계 차이를 추정 → 스냅샷 시각을 내 시계로 환산해 보간.
//  기관사  : ID 가 가장 작은 참가자(호스트)가 기차 위치·속도·시간·시드의 기준. 4Hz 로 방송, 나머지는 부드럽게 따라감.
//  이벤트  : 레버(속도), 자원 줍기 → 신뢰 채널. 자원은 결정론적 ID 라 서로 다른 화면에서도 같은 물건을 가리킴.
import * as THREE from 'three';
import {RoomOrigin} from './room-origin.js';
import { now, PeerClock } from './clock.js';
import { encodeSnap, decodeSnap, seqNewer, FLAG_GROUND, FLAG_GRAV, FLAG_SPRINT, toolFlags, flagTool, flagLoaded } from './snapshot.js';
import { RemoteMotion } from './interp.js';
import { Avatar, colorFor } from '../avatar.js';

export const SEND_HZ = 20;
const SEND_MS = 1000 / SEND_HZ, TRAIN_MS = 250, STALE_MS = 6000;

export class Session {
  /**
   * hooks: {
   *   scene, localSnapshot(out) → {p,v,yaw,pitch,flags}, trainToWorld(tp,out) → car,
   *   getTrain() → {s,speed,targetSpeed,tod,timeMul,seed}, applyTrain(st, ageMs), onControl(targetSpeed),
   *   onPick(id, byName), takenList() → string[], applyTaken(ids), onPeers(list), log(msg)
   * }
   */
  constructor(transport, hooks) {
    this.tr = transport; this.h = hooks;
    this.remotes = new Map(); this.seq = 0; this.sendAcc = 0; this.trainAcc = 0; this.pingAcc = 0;
    this.name = ''; this.selfId = null; this.connected = false;
    this._tp = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  async start(roomCode, name) {
    this.stopped=false; this.name = name; this.room = roomCode; this.origin = new RoomOrigin('room-'+Math.random().toString(36).slice(2), now()); this.worldReady = true; this.retired=new Set();
    this.tr.on('join', id => this.onJoin(id));
    this.tr.on('leave', id => this.dropRemote(id,true));
    this.tr.on('fast', (id, buf) => this.onFast(id, buf));
    this.tr.on('rel', (id, type, d) => this.onRel(id, type, d));
    this.selfId = await this.tr.join(roomCode);
    this.connected = true;
    this.h.log?.(`방 '${roomCode}' 에 들어왔어요`);
    return this.selfId;
  }
  async stop() { this.stopped=true; this.connected=false; await this.tr.leave(); for (const id of [...this.remotes.keys()]) this.dropRemote(id); this.connected = false; }

  /* ---------- 참가자 ---------- */
  remote(id) {
    let r = this.remotes.get(id);
    if (!r) {
      const color = colorFor(id);
      r = { id, name: '승객', color, clock: new PeerClock(), motion: new RemoteMotion(SEND_MS), avatar: new Avatar(color, '승객'), lastSeq: -1, heard: now(), hello: false, st: { speed: 0, vy: 0, grounded: true, inGrav: true, yaw: 0, pitch: 0 } };
      r.avatar.holder.visible = false;
      this.h.scene.add(r.avatar.holder);
      this.remotes.set(id, r);
      this.h.onPeers?.(this.peerList());
    }
    return r;
  }
  onJoin(id) {
    if(this.stopped)return;
    if(this.remotes.size===0)this.worldReady=false;
    this.retired.delete(id);
    const r = this.remote(id);
    this.sendHello(id);
    for (let i = 0; i < 4; i++) setTimeout(() => { if(!this.stopped && this.remotes.has(id)) this.sendPing(id); }, 150 * i);     // 시계 빠르게 맞추기
    if (this.isHost()) this.tr.sendRel('taken', this.h.takenList(), id);
    this.h.log?.('새 승객이 탑승했어요');
    return r;
  }
  sendHello(id=null) { this.tr.sendRel('hello', {name:this.name,origin:this.origin.snapshot(now()),world:this.h.getTrain()}, id); }
  dropRemote(id, retired=false) {
    const r = this.remotes.get(id); if (!r) return;
    if(retired)this.retired?.add(id); r.avatar.dispose(); this.remotes.delete(id);
    this.h.log?.(`${r.name} 님이 내렸어요`); this.h.onPeers?.(this.peerList());
  }
  peerList() { return [...this.remotes.values()].map(r => ({ id: r.id, name: r.name, rtt: r.clock.rtt, color: r.color, host: r.id === this.hostId() })); }
  hostId() { let h = this.selfId; for (const id of this.remotes.keys()) if (id < h) h = id; return h; }
  isHost() { return this.hostId() === this.selfId; }

  /* ---------- 수신 ---------- */
  onFast(id, buf) {
    if(this.stopped || this.retired?.has(id))return;
    const s = decodeSnap(buf); if (!s) return;
    const r = this.remotes.get(id) || this.onJoin(id);
    r.heard = now();
    if (!r.clock.ready) { r.pending = s; return; }               // 시계 맞추기 전에는 보류
    r.motion.push(s, r.clock.toLocal(s.t), now());
  }
  onRel(id, type, d) {
    if(this.stopped || this.retired?.has(id))return;
    const r = this.remotes.get(id) || this.onJoin(id);
    r.heard = now();
    switch (type) {
      case 'hello':
        if (d?.origin && d?.world) {
          if (this.origin.offer(d.origin,now())) {
            this.h.onWorldOffer?.(d.world);
            // Announce adoption: a second newcomer may have heard our previous lobby state.
            this.sendHello();
          }
          this.worldReady=true;
        }
        if (typeof d?.name === 'string') { r.hello = true; r.name = d.name.slice(0, 16) || '승객'; r.avatar.setName(r.name); this.h.onPeers?.(this.peerList()); } break;
      case 'ping': this.tr.sendRel('pong', { t0: d.t0, t1: now() }, id); break;
      case 'pong': r.clock.add(d.t0, d.t1, now()); if (r.pending) { r.motion.push(r.pending, r.clock.toLocal(r.pending.t), now()); r.pending = null; } break;
      case 'train': if (this.worldReady && this.origin.accepts(d?.origin) && id === this.hostId() && r.clock.ready) this.h.applyTrain(d, now() - r.clock.toLocal(d.t)); break;
      case 'ctrl': if (typeof d?.targetSpeed === 'number') this.h.onControl(d.targetSpeed, r.name); break;
      case 'pick': if (typeof d?.id === 'string') this.h.onPick(d.id, r.name); break;
      case 'taken': if (Array.isArray(d)) this.h.applyTaken(d); break;
      case 'act': if (d && typeof d.a === 'string') this.h.onAct?.(d, r.name); break;
      case 'ev': if (d && typeof d.k === 'string') this.h.onEv?.(d, id, r.name); break;
    }
  }
  sendPing(id) { this.tr.sendRel('ping', { t0: now() }, id); }

  /* ---------- 송신 ---------- */
  sendControl(targetSpeed) { if (this.connected) this.tr.sendRel('ctrl', { targetSpeed }); }
  sendPick(id) { if (this.connected) this.tr.sendRel('pick', { id }); }
  /** 범용 게임 이벤트 (to 를 주면 그 승객에게만) */
  sendEv(d, to = null) { if (this.connected && this.remotes.size) this.tr.sendRel('ev', d, to); }
  sendAct(d) { if (this.connected && this.remotes.size) this.tr.sendRel('act', d); }

  /* ---------- 매 프레임 ---------- */
  update(dt, time) {
    if (!this.connected) return;
    const t = now();
    // 위치 송신 (고정 주기, 누적 시간 방식이라 프레임이 흔들려도 간격 일정)
    this.sendAcc += dt * 1000;
    if (this.sendAcc >= SEND_MS) {
      this.sendAcc = Math.min(this.sendAcc - SEND_MS, SEND_MS);
      if (this.remotes.size) {
        const L = this.h.localSnapshot();
        this.tr.sendFast(encodeSnap(this.seq++, t, L.p, L.v, L.yaw, L.pitch, L.flags));
      }
    }
    // 기관사: 기차 상태 방송
    this.trainAcc += dt * 1000;
    if (this.trainAcc >= TRAIN_MS) { this.trainAcc = 0; if (this.worldReady && [...this.remotes.values()].every(r => r.hello) && this.isHost() && this.remotes.size) this.tr.sendRel('train', { ...this.h.getTrain(), origin:this.origin.snapshot(t), t }); }
    // 시계 재측정 (처음엔 자주, 이후 3초마다)
    this.pingAcc += dt * 1000;
    if (this.pingAcc > 1000) { this.pingAcc = 0; for (const r of this.remotes.values()) if (r.clock.samples.length < 8 || Math.random() < .34) this.sendPing(r.id); }
    // 원격 아바타 재생
    for (const r of this.remotes.values()) {
      if (t - r.heard > STALE_MS) { this.dropRemote(r.id); continue; }
      const o = r.clock.ready ? r.motion.sample(t) : null;
      r.avatar.holder.visible = !!o;
      if (!o) continue;
      const car = this.h.trainToWorld(o.p, r.avatar.holder.position);
      r.avatar.holder.quaternion.copy(car.g.quaternion);
      Object.assign(r.st, { speed: Math.hypot(o.v.x, o.v.z), vy: o.v.y, grounded: !!(o.flags & FLAG_GROUND), inGrav: !!(o.flags & FLAG_GRAV), yaw: o.yaw, pitch: o.pitch });
      (r.tp ||= new THREE.Vector3()).set(o.p.x ?? o.p[0], o.p.y ?? o.p[1], o.p.z ?? o.p[2]); r.flags = o.flags;
      r.avatar.update(dt, r.st, time);
    }
  }
  /** 디버그용 네트워크 상태 */
  stats() {
    return [...this.remotes.values()].map(r => ({ name: r.name, rtt: Math.round(r.clock.rtt), delay: Math.round(r.motion.delay), jitter: Math.round(r.motion.jitter), extrap: r.motion.stats.frames ? +(r.motion.stats.extrapFrames / r.motion.stats.frames * 100).toFixed(1) : 0, fast: this.tr.fastOpen(r.id) }));
  }
}
export { FLAG_GROUND, FLAG_GRAV, FLAG_SPRINT, toolFlags };
