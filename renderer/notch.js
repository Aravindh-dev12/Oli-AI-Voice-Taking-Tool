import { createTrackCapture } from './audio-capture.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Request failed (' + r.status + ')');
  return body;
});

let pinned = false;
let flareTimer = null;
let meetingId = null;
let es = null;
let stopFns = [];
let words = { You: 0, Them: 0 };
let commitments = 0;
let nativeCaptureActive = false;

function setState(state) {
  app.dataset.state = state;
  window.oli?.resize(state);
  window.oli?.reportHudState({ type: 'state', state, talkRatio: getTalkRatio(), commitments });
}

function getTalkRatio() {
  const total = words.You + words.Them;
  return total ? words.You / total : 0;
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
  $('#flareTip').title = source
    ? 'From your knowledge base: ' + source
    : 'Prompted by: ' + String(trigger || '').slice(0, 80);
  setState('flare');
  clearTimeout(flareTimer);
  flareTimer = setTimeout(goPill, 5000);
}

app.addEventListener('mouseenter', () => {
  if (app.dataset.state !== 'shelf') goShelf();
});
app.addEventListener('mouseleave', () => {
  if (!pinned) goPill();
});

window.oli?.onTogglePin(() => {
  pinned = !pinned;
  pinned ? goShelf() : goPill();
});
window.oli?.onTrayToggleMeeting(() => (meetingId ? endMeeting() : startMeeting()));
window.oli?.onNativeCaptureError((payload) => {
  $('#footer').textContent = payload?.message || 'Native capture error.';
});
window.oli?.onNativeHudCommand((payload) => {
  if (payload?.event === 'startMeeting') return startMeeting();
  if (payload?.event === 'endMeeting') return endMeeting();
  if (payload?.event === 'toggleMeeting') return meetingId ? endMeeting() : startMeeting();
});
window.oli?.onNativeHudError((payload) => {
  $('#footer').textContent = payload?.message || 'Native HUD error.';
});

$('.view-pill').addEventListener('click', () => {
  if (!meetingId) startMeeting();
});
$('#btnDash').addEventListener('click', () => window.oli?.openDashboard());
$('#btnToggle').addEventListener('click', () => (meetingId ? endMeeting() : startMeeting()));

function addSegment(s) {
  $('#transcriptEmpty')?.remove();
  const row = document.createElement('div');
  row.className = 'seg ' + s.speaker;
  const b = document.createElement('b');
  b.textContent = s.speaker;
  row.append(b, document.createTextNode(s.text));
  const col = $('#transcript');
  col.append(row);
  col.scrollTop = col.scrollHeight;

  words[s.speaker] = (words[s.speaker] || 0) + s.text.split(/\s+/).filter(Boolean).length;
  const total = words.You + words.Them;
  const pct = total ? Math.round((words.You / total) * 100) : 0;
  $('#meter i').style.width = pct + '%';
  $('#airFill').style.width = pct + '%';
  $('#airLine').textContent = 'You ' + pct + '% · Them ' + (100 - pct) + '%';
  $('#nudge').textContent = total > 60 && pct > 65
    ? 'You are doing most of the talking. Ask an open-ended question.'
    : '';
  window.oli?.reportHudState({ type: 'transcript', speaker: s.speaker, text: s.text, talkRatio: total ? words.You / total : 0, commitments });
}

function addWhisper(w) {
  const d = document.createElement('div');
  d.className = 'whisper';
  const tip = document.createElement('span');
  tip.textContent = w.tip;
  const source = document.createElement('small');
  source.textContent = w.source ? 'From: ' + w.source : 'No knowledge-base match';
  d.append(tip, source);
  $('#whispers').prepend(d);
  window.oli?.reportHudState({ type: 'whisper', whisper: w.tip, source: w.source || '', talkRatio: getTalkRatio(), commitments });
  if (app.dataset.state !== 'shelf') goFlare(w.tip, w.source, w.trigger);
}

function addAction(a) {
  commitments += 1;
  $('#pillCount').textContent = '⧗ ' + commitments;
  $('#footer').textContent = 'Commitment noted: ' + a.task;
  window.oli?.reportHudState({ type: 'action', task: a.task, talkRatio: getTalkRatio(), commitments });
}

function setMeetingUi(active) {
  $('#btnToggle').textContent = active ? 'End' : 'Start';
  $('#btnToggle').classList.toggle('ending', active);
  $('#statusRing').classList.toggle('off', !active);
  $('#shelfTitle').textContent = active ? 'Live meeting' : 'No meeting running';
  window.oli?.reportMeetingState(active);
  window.oli?.reportHudState({ type: 'meeting', active, talkRatio: getTalkRatio(), commitments });
}

async function createMeeting() {
  const result = await api('/meetings', {
    method: 'POST',
    body: JSON.stringify({ title: 'Meeting ' + new Date().toLocaleString() })
  });
  return result.id;
}

async function deleteMeetingQuietly(id) {
  try { await api('/meetings/' + encodeURIComponent(id), { method: 'DELETE' }); } catch {}
}

function registerStream(id) {
  es = new EventSource('/api/meetings/' + encodeURIComponent(id) + '/stream');
  es.addEventListener('segment', (event) => addSegment(JSON.parse(event.data)));
  es.addEventListener('whisper', (event) => addWhisper(JSON.parse(event.data)));
  es.addEventListener('action', (event) => addAction(JSON.parse(event.data)));
  es.addEventListener('error', (event) => {
    try {
      const payload = JSON.parse(event.data);
      $('#footer').textContent = payload.message || 'Live processing error.';
    } catch {
      $('#footer').textContent = 'Live stream disconnected; Oli will reconnect automatically.';
    }
  });
}

async function startMeeting() {
  if (meetingId) return;

  let createdId = null;
  let mic;
  let disp;

  try {
    const platform = await window.oli?.platform();
    const nativeAvailable = platform === 'darwin' && await window.oli?.nativeCaptureAvailable();

    if (nativeAvailable) {
      createdId = await createMeeting();
      meetingId = createdId;
      try {
        const native = await window.oli.startNativeCapture(createdId);
        if (native?.active) {
          nativeCaptureActive = true;
          words = { You: 0, Them: 0 };
          commitments = 0;
          $('#transcript').replaceChildren();
          $('#whispers').replaceChildren();
          $('#pillCount').textContent = '';
          $('#footer').textContent = 'Native macOS capture active. Mic and system audio are isolated locally.';
          setMeetingUi(true);
          registerStream(createdId);
          stopFns = [async () => {
            await window.oli.stopNativeCapture();
            nativeCaptureActive = false;
          }];
          pinned = true;
          goShelf();
          return;
        }
      } catch (nativeError) {
        $('#footer').textContent = 'Native capture unavailable: ' + nativeError.message + '. Falling back to browser capture.';
      }
      await deleteMeetingQuietly(createdId);
      meetingId = null;
      createdId = null;
    }

    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    });
    disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (!disp.getAudioTracks().length) {
      throw new Error('No shared audio was selected. Choose tab audio or system audio.');
    }

    createdId = await createMeeting();
    meetingId = createdId;
    words = { You: 0, Them: 0 };
    commitments = 0;
    $('#transcript').replaceChildren();
    $('#whispers').replaceChildren();
    $('#pillCount').textContent = '';
    $('#footer').textContent = 'Browser capture active. Capture is separated into You and Them channels.';
    setMeetingUi(true);
    registerStream(createdId);

    stopFns = [
      createTrackCapture({
        stream: mic,
        source: 'me',
        meetingId: createdId,
        onStatus: (message) => { $('#footer').textContent = message; }
      }),
      createTrackCapture({
        stream: new MediaStream(disp.getAudioTracks()),
        source: 'them',
        meetingId: createdId,
        onStatus: (message) => { $('#footer').textContent = message; }
      }),
      async () => { disp.getTracks().forEach((track) => track.stop()); }
    ];

    const videoTrack = disp.getVideoTracks()[0];
    if (videoTrack) videoTrack.addEventListener('ended', () => endMeeting(), { once: true });
    pinned = true;
    goShelf();
  } catch (error) {
    mic?.getTracks().forEach((track) => track.stop());
    disp?.getTracks().forEach((track) => track.stop());
    if (createdId) await deleteMeetingQuietly(createdId);
    meetingId = null;
    es?.close();
    es = null;
    nativeCaptureActive = false;
    setMeetingUi(false);
    $('#footer').textContent = 'Could not start: ' + error.message;
  }
}

async function endMeeting() {
  if (!meetingId) return;
  const id = meetingId;
  meetingId = null;
  $('#shelfTitle').textContent = 'Stopping capture…';
  try {
    await Promise.allSettled(stopFns.map((fn) => fn()));
  } finally {
    stopFns = [];
    es?.close();
    es = null;
    setMeetingUi(false);
  }

  try {
    const r = await api('/meetings/' + encodeURIComponent(id) + '/end', { method: 'POST' });
    $('#footer').textContent = r.summary?.slice(0, 180) || 'Meeting saved.';
  } catch (error) {
    $('#footer').textContent = 'Meeting saved, but summary generation failed: ' + error.message;
  }
  pinned = false;
  setState('pill');
}

(async function init() {
  try {
    const h = await api('/health');
    $('#statusRing').classList.toggle('off', !h.aiReady);
    if (!h.aiReady) {
      $('#pillLabel').textContent = 'OLI · LOCAL AI NOT READY';
      $('#footer').textContent = 'Configure a local AI engine or development provider in Dashboard → Settings.';
    }
  } catch {
    $('#footer').textContent = 'Oli server is not ready yet.';
  }
})();
