// 위치 스냅샷 44바이트 바이너리 (JSON 대비 약 1/4 크기, 파싱 없음)
// [0] u8 type  [1] u8 flags  [2] u16 seq  [4] f64 time  [12..36) f32 x,y,z,vx,vy,vz  [36] f32 yaw  [40] f32 pitch
export const SNAP_BYTES = 44;
export const FLAG_GROUND = 1, FLAG_GRAV = 2, FLAG_SPRINT = 4;

export function encodeSnap(seq, t, p, v, yaw, pitch, flags) {
  const buf = new ArrayBuffer(SNAP_BYTES), dv = new DataView(buf);
  dv.setUint8(0, 1); dv.setUint8(1, flags); dv.setUint16(2, seq & 0xffff, true); dv.setFloat64(4, t, true);
  dv.setFloat32(12, p.x, true); dv.setFloat32(16, p.y, true); dv.setFloat32(20, p.z, true);
  dv.setFloat32(24, v.x, true); dv.setFloat32(28, v.y, true); dv.setFloat32(32, v.z, true);
  dv.setFloat32(36, yaw, true); dv.setFloat32(40, pitch, true);
  return buf;
}
export function decodeSnap(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength !== SNAP_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 1) return null;
  return {
    flags: dv.getUint8(1), seq: dv.getUint16(2, true), t: dv.getFloat64(4, true),
    p: [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)],
    v: [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)],
    yaw: dv.getFloat32(36, true), pitch: dv.getFloat32(40, true),
  };
}
/** 16비트 순번 비교 (넘침 고려): a 가 b 보다 최신이면 true */
export const seqNewer = (a, b) => ((a - b) & 0xffff) < 0x8000 && a !== b;
