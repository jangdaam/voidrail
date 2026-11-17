// Pure run planner. Positions are longitudinal rail coordinates, not wall-clock time.
export const SECTOR_LENGTH = 1400;
export const SAFE_LOOKAHEAD = 2000; // camera far plane (1700) + margin; never replace visible geometry
export const EVENT_TYPES = Object.freeze({
  cargo: { label: '중앙 하역장', goal: 'manifest', rise: 0 },
  ascent: { label: '층간 상승 구간', goal: 'power', rise: 78 },
});
const copy = value => JSON.parse(JSON.stringify(value));
const validKey = v => typeof v === 'string' && v.length > 0 && v.length <= 96;
const phases = ['waiting', 'reserved', 'approaching', 'active', 'completed'];
export class RunDirector {
  constructor(seed, runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2)) {
    this.seed = seed | 0; this.runId = runId; this.revision = 0; this.layoutRevision = 0;
    this.goals = new Set(); this.events = []; this.committedThrough = -1;
  }
  // Freeze every sector touched by geometry generation, including queued rail chunks.
  commitThrough(k) { this.committedThrough = Math.max(this.committedThrough, k); }
  typeAt(k) { return this.events.find(e => e.sector === k)?.type || 'ordinary'; }
  request(type, id, s, {trigger = false} = {}) {
    if (!EVENT_TYPES[type] || !validKey(id) || !Number.isFinite(s)) return {ok:false, reason:'invalid'};
    const prior = this.events.find(e => e.id === id);
    if (prior) return {ok:true, duplicate:true, event:copy(prior)};
    // Explicit cap on authored events; ordinary scenery itself has no end or time limit.
    if (this.events.length >= 256) return {ok:false, reason:'event-limit'};
    const e = {id, type, sector:null, phase:'waiting', trigger:!!trigger};
    this.events.push(e); this.revision++; this.release(s);
    return {ok:true, event:copy(e)};
  }
  completeGoal(goal, s) {
    const type = Object.keys(EVENT_TYPES).find(t => EVENT_TYPES[t].goal === goal);
    if (!type || !Number.isFinite(s)) return {ok:false, reason:'invalid-goal'};
    if (this.goals.has(goal)) return {ok:true, duplicate:true};
    this.goals.add(goal); this.revision++;
    // A gameplay system may have queued its own ticket before the objective was fulfilled.
    if (!this.events.some(e => e.type === type && e.phase === 'waiting'))
      this.request(type, 'goal:' + goal, s);
    this.release(s); return {ok:true};
  }
  release(s) {
    for (const e of this.events) {
      if (e.phase !== 'waiting' || (!e.trigger && !this.goals.has(EVENT_TYPES[e.type].goal))) continue;
      const last = Math.max(-2, ...this.events.filter(x => x.sector !== null).map(x => x.sector));
      // Leave one ordinary sector between authored spaces. Requests preserve their relative order
      // among eligible events, while unmet goals cannot block an unrelated event forever.
      e.sector = Math.max(0, Math.ceil((s + SAFE_LOOKAHEAD) / SECTOR_LENGTH), this.committedThrough + 1, last + 2);
      e.phase = 'reserved'; this.revision++; this.layoutRevision++;
    }
  }
  update(s) {
    if (!Number.isFinite(s)) return [];
    const transitions = [];
    for (const e of this.events) {
      if (e.sector === null || e.phase === 'completed') continue;
      const start = e.sector * SECTOR_LENGTH, end = start + SECTOR_LENGTH;
      const phase = s >= end ? 'completed' : s >= start ? 'active' : s >= start - 240 ? 'approaching' : 'reserved';
      // Never replay an event after a debug rewind or a small network correction.
      if (phases.indexOf(phase) > phases.indexOf(e.phase)) {
        e.phase = phase; this.revision++; transitions.push(copy(e));
      }
    }
    return transitions;
  }
  snapshot() {
    return {version:1, seed:this.seed, runId:this.runId, revision:this.revision,
      goals:[...this.goals], events:copy(this.events)};
  }
  apply(st) {
    // Validate the entire snapshot before touching the live route. Stale packets are harmless.
    if (!st || st.version !== 1 || st.seed !== this.seed || !validKey(st.runId) ||
        !Number.isSafeInteger(st.revision) || st.revision < 0 || !Array.isArray(st.goals) ||
        st.goals.length > 2 || st.goals.some(g => !['manifest','power'].includes(g)) ||
        !Array.isArray(st.events) || st.events.length > 256) return {accepted:false};
    const ids = new Set(), slots = new Set(); let last = -2;
    for (const e of st.events) {
      if (!e || !validKey(e.id) || ids.has(e.id) || !EVENT_TYPES[e.type] || !phases.includes(e.phase) || typeof e.trigger !== 'boolean') return {accepted:false};
      if (e.sector === null) { if (e.phase !== 'waiting') return {accepted:false}; }
      else {
        if (!Number.isSafeInteger(e.sector) || e.sector < 0 || e.sector > 1000000 || slots.has(e.sector) || e.phase === 'waiting') return {accepted:false};
        slots.add(e.sector);
      }
      ids.add(e.id);
    }
    const sorted = [...slots].sort((a,b) => a-b);
    for (const k of sorted) { if (k < last + 2) return {accepted:false}; last=k; }
    const same = st.runId === this.runId;
    if (same && st.revision <= this.revision) return {accepted:false};
    // Once allocated, a ticket cannot move to a different piece of rail within the same run.
    if (same && this.events.some(e => e.sector !== null && !st.events.some(n => n.id === e.id && n.type === e.type && n.sector === e.sector))) return {accepted:false};
    const oldLayout = JSON.stringify(this.events.filter(e => e.sector !== null).map(e => [e.type,e.sector]));
    const newLayout = JSON.stringify(st.events.filter(e => e.sector !== null).map(e => [e.type,e.sector]));
    const changedSectors = st.events.filter(e => e.sector !== null && !this.events.some(o => o.type === e.type && o.sector === e.sector)).map(e => e.sector);
    const needsRebuild = !same || changedSectors.some(k => k <= this.committedThrough);
    this.runId=st.runId; this.revision=st.revision; this.goals=new Set(st.goals); this.events=copy(st.events);
    if (oldLayout !== newLayout || !same) this.layoutRevision++;
    if (!same) this.committedThrough=-1;
    return {accepted:true, needsRebuild, layoutChanged:oldLayout !== newLayout || !same};
  }
}
