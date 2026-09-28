const $ = (s) => document.querySelector(s);
const app = $('#app');
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then((r) => r.json());

let pinned = false;
let flareTimer = null;
let meetingId = null;
let es = null;
let stopFns = [];
let words = { You: 0, Them: 0 };
let commitments = 0;

function setState(state) {
  app.dataset.state = state;
  window.oli?.resize(state);
}

function goPill() {
  if (pinned) return;
  clearTimeout(flareTimer);
  setState('pill');
}
function goShelf() {
  clearTimeout(flareTimer);
  setState('shelf');
}
function goFlare(tip, source, trigger) {
  $('#flareTip').textContent = tip;
  $('#flareTip').title = source ? `From your knowledge base: ${source}` : `No knowledge-base match. Prompted by: ${trigger.slice(0, 80)}`;
  setState('flare');
  clearTimeout(flareTimer);
  flareTimer = setTimeout(goPill, 5000);
}

// Hover expands to the command shelf; leaving collapses it again unless pinned (Alt+Space).
app.addEventListener('mouseenter', () => { if (app.dataset.state !== 'shelf') goShelf(); });
app.addEventListener('mouseleave', () => { if (!pinned) goPill(); });

window.oli?.onTogglePin(() => {
  pinned = !pinned;
  pinned ? goShelf() : goPill();
});
window.oli?.onTrayToggleMeeting(() => (meetingId ? endMeeting() : startMeeting()));

$('.view-pill').addEventListener('click', () => { if (!meetingId) startMeeting(); });
$('#btnDash').addEventListener('click', () => window.oli?.openDashboard());
$('#btnToggle').addEventListener('click', () => (meetingId ? endMeeting() : startMeeting()));

// ---- WAV encoding for raw PCM chunks ----
function wav(float32) {
  const buf = new ArrayBuffer(44 + float32.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + float32.length * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, float32.length * 2, true);
  float32.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return buf;
}

function captureTrack(stream, src) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const node = ctx.createScriptProcessor(4096, 1, 1);
  let buf = [], n = 0;
  const flush = () => {
    if (!n) return;
    const pcm = new Float32Array(n);
    let o = 0; buf.forEach((b) => { pcm.set(b, o); o += b.length; });
    buf = []; n = 0;
    const rms = Math.sqrt(pcm.reduce((a, x) => a + x * x, 0) / pcm.length);
    if (rms < 0.008) return; // skip near-silence, saves API calls
    fetch(`/api/meetings/${meetingId}/chunk?src=${src}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(pcm) }).catch(() => {});
  };
  node.onaudioprocess = (e) => {
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    buf.push(d); n += d.length;
    if (n >= 96000) flush(); // ~6s chunks
  };
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination);
  return () => { flush(); ctx.close(); stream.getTracks().forEach((t) => t.stop()); };
}

function addSegment(s) {
  $('#transcriptEmpty')?.remove();
  const row = document.createElement('div');
  row.className = 'seg ' + s.speaker;
  const b = document.createElement('b'); b.textContent = s.speaker;
  row.append(b, document.createTextNode(s.text));
  const col = $('#transcript'); col.append(row); col.scrollTop = col.scrollHeight;

  words[s.speaker] += s.text.split(/\s+/).length;
  const total = words.You + words.Them;
  const pct = total ? Math.round((words.You / total) * 100) : 0;
  $('#meter i').style.width = pct + '%';
  $('#airFill').style.width = pct + '%';
  $('#airLine').textContent = `You ${pct}% · Them ${100 - pct}%`;
  $('#nudge').textContent = total > 60 && pct > 65 ? 'You are doing most of the talking. Ask an open-ended question.' : '';
}

function addWhisper(w) {
  const d = document.createElement('div');
  d.className = 'whisper';
  d.innerHTML = `${escapeHtml(w.tip)}<small>${w.source ? 'From: ' + escapeHtml(w.source) : 'No knowledge-base match'}</small>`;
  $('#whispers').prepend(d);
  if (app.dataset.state !== 'shelf') goFlare(w.tip, w.source, w.trigger);
}
function addAction(a) {
  commitments++;
  $('#pillCount').textContent = commitments ? `⧗ ${commitments}` : '';
  $('#footer').textContent = `Commitment noted: ${a.task}`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function startMeeting() {
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!disp.getAudioTracks().length) {
      disp.getTracks().forEach((t) => t.stop()); mic.getTracks().forEach((t) => t.stop());
      $('#footer').textContent = 'No audio was shared — pick "Share tab audio" or "Share system audio" and try again.';
      return;
    }
    const r = await api('/meetings', { method: 'POST', body: JSON.stringify({ title: 'Meeting ' + new Date().toLocaleString() }) });
    meetingId = r.id;
    words = { You: 0, Them: 0 }; commitments = 0;
    $('#transcript').replaceChildren(); $('#whispers').replaceChildren();
    $('#shelfTitle').textContent = 'Live meeting';
    $('#btnToggle').textContent = 'End'; $('#btnToggle').classList.add('ending');
    $('#statusRing').classList.remove('off');
    $('#footer').textContent = 'Listening. Battlecard whispers will appear here when a trigger phrase is heard.';
    window.oli?.reportMeetingState(true);

    es = new EventSource(`/api/meetings/${meetingId}/stream`);
    es.addEventListener('segment', (e) => addSegment(JSON.parse(e.data)));
    es.addEventListener('whisper', (e) => addWhisper(JSON.parse(e.data)));
    es.addEventListener('action', (e) => addAction(JSON.parse(e.data)));
    es.addEventListener('error', (e) => { try { $('#footer').textContent = JSON.parse(e.data).message; } catch {} });

    stopFns = [
      captureTrack(mic, 'me'),
      captureTrack(new MediaStream(disp.getAudioTracks()), 'them'),
      () => disp.getVideoTracks().forEach((t) => t.stop())
    ];
    disp.getVideoTracks()[0].onended = endMeeting;
    pinned = true; goShelf();
  } catch (e) {
    $('#footer').textContent = 'Could not start: ' + e.message;
  }
}

async function endMeeting() {
  if (!meetingId) return;
  const id = meetingId; meetingId = null;
  stopFns.forEach((f) => f()); stopFns = [];
  es?.close(); es = null;
  $('#btnToggle').textContent = 'Start'; $('#btnToggle').classList.remove('ending');
  $('#shelfTitle').textContent = 'Summarizing…';
  window.oli?.reportMeetingState(false);
  const r = await api(`/meetings/${id}/end`, { method: 'POST' });
  $('#shelfTitle').textContent = 'No meeting running';
  $('#footer').textContent = r.summary?.slice(0, 140) || 'Meeting saved.';
  pinned = false;
}

(async function init() {
  try {
    const h = await api('/health');
    $('#statusRing').classList.toggle('off', !h.gemini);
    if (!h.gemini) $('#pillLabel').textContent = 'OLI · NO KEY';
    if (!h.gemini) $('#footer').textContent = 'Add a Gemini API key in the Dashboard → Settings before starting a meeting.';
  } catch {}
})();
