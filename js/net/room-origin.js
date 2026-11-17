// Separate the identity of an established world from the lowest-ID train authority.
// A newly elected host must adopt the established world, never overwrite it with its lobby.
export class RoomOrigin {
  constructor(id, now=0) { this.id=id; this.age=0; this.at=now; }
  snapshot(now) { return {id:this.id,age:this.age+Math.max(0,now-this.at)}; }
  offer(value, now) {
    if (!value || typeof value.id!=='string' || value.id.length<1 || value.id.length>96 || !Number.isFinite(value.age) || value.age<0 || value.id===this.id) return false;
    const local=this.snapshot(now), diff=value.age-local.age;
    // Approximate room tenure needs no agreement between machine wall clocks.
    // Concurrent room creation converges by a stable origin ID within a one-second window.
    if (diff>1000 || (Math.abs(diff)<=1000 && value.id<this.id)) {
      this.id=value.id;this.age=value.age;this.at=now;return true;
    }
    return false;
  }
  accepts(value) { return value?.id===this.id; }
}
