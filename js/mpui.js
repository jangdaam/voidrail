// '같이 타기' 패널
import { S } from './state.js';

const $ = id => document.getElementById(id);
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
let H;

export const toggleMP = on => togglePanel(on);
export function initMPUI(handlers, params) {
  H = handlers;
  let name = ''; try { name = localStorage.getItem('voidrail-name') || ''; } catch (e) {}
  $('mpName').value = name || '승객' + Math.floor(Math.random() * 900 + 100);
  $('mpCode').value = (params.get('room') || '').toUpperCase();
  $('bMP').onclick = () => togglePanel();
  $('mpClose').onclick = () => togglePanel(false);
  $('mpCreate').onclick = () => { $('mpCode').value = randomCode(); join(); };
  $('mpJoin').onclick = () => join();
  $('mpLeave').onclick = () => H.leaveRoom();
  $('mpCopy').onclick = async () => {
    const url = new URL(location.href); url.searchParams.set('room', $('mpCode').value.trim().toUpperCase());
    try { await navigator.clipboard.writeText(url.toString()); $('mpCopy').textContent = '복사됨 ✓'; }
    catch (e) { $('mpLink').hidden = false; $('mpLink').value = url.toString(); $('mpLink').select(); }
    setTimeout(() => $('mpCopy').textContent = '초대 링크 복사', 1500);
  };
  for (const id of ['mpName', 'mpCode']) $(id).addEventListener('keydown', e => e.stopPropagation());   // 입력 중 게임 단축키 막기
  // 링크로 들어왔으면 탑승 직후 자동 참가
  // 링크(?room=)로 들어왔으면 바로 자동 참가 (WebRTC 연결은 클릭 없이도 가능)
  if (params.get('room')) setTimeout(join, 300);
  setMPStatus('혼자 타는 중');
}
function togglePanel(on) {
  const el = $('mp'); const show = on ?? el.hidden;
  el.hidden = !show;
  if (show && document.pointerLockElement) document.exitPointerLock();
}
function join() {
  const code = $('mpCode').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
  if (!code) { setMPStatus('방 코드를 입력하거나 새로 만들어 주세요'); return; }
  const name = $('mpName').value.trim().slice(0, 16) || '승객';
  try { localStorage.setItem('voidrail-name', name); } catch (e) {}
  $('mpCode').value = code;
  H.joinRoom(code, name);
}
export function setMPStatus(msg) { $('mpStatus').textContent = msg; }
export function setPeers(list, session) {
  const box = $('mpPeers'); box.innerHTML = '';
  const me = document.createElement('li'); me.innerHTML = `<b>나</b>${session && session.isHost() ? ' · 🚂 기관사' : ''}`; box.appendChild(me);
  for (const p of list) {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:#${p.color.getHexString()}"></i>${escapeHtml(p.name)}${p.host ? ' · 🚂 기관사' : ''} <small>${p.rtt ? Math.round(p.rtt) + 'ms' : ''}</small>`;
    box.appendChild(li);
  }
  $('bMP').textContent = list.length ? `👥 같이 타는 중 (${list.length + 1})` : '👥 같이 타기';
  if (session?.connected && list.length) setMPStatus(session.tr.kind === 'local' ? '로컬 시뮬레이션 연결됨' : '연결됨');
}
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
