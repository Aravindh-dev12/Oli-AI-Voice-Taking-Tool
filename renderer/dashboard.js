const $ = (s) => document.querySelector(s);
const api = (p, o = {}) => fetch('/api' + p, { headers: { 'Content-Type': 'application/json' }, ...o }).then((r) => r.json());
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

function tab(name) {
  document.querySelectorAll('main').forEach((m) => m.classList.toggle('on', m.id === name));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === name));
  if (name === 'hist') loadHistory();
  if (name === 'kb') loadKb();
  if (name === 'settings') loadSettings();
}
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => tab(b.dataset.t)));

async function loadHistory() {
  const list = await api('/meetings');
  const ul = $('#mlist'); ul.replaceChildren();
  if (!list.length) { ul.append(el('li', 'empty', 'No meetings yet — start one from the notch.')); return; }
  list.forEach((m) => {
    const li = el('li');
    li.append(el('span', 't', m.title), el('span', 'd', new Date(m.started_at).toLocaleString()));
    li.onclick = () => showMeeting(m.id);
    ul.append(li);
  });
}
async function showMeeting(id) {
  const { meeting, segments, actions } = await api('/meetings/' + id);
  const pane = $('#mdetail'); pane.replaceChildren();
  pane.append(el('h3', 0, meeting.title));
  pane.append(el('p', 0, meeting.summary || 'Summary not available.'));
  if (actions.length) {
    const ul = el('ul');
    actions.forEach((a) => ul.append(el('li', 0, `${a.task} — ${a.assignee}`)));
    pane.append(el('h3', 0, 'Action items'), ul);
  }
  pane.append(el('h3', 0, 'Transcript'));
  segments.forEach((s) => {
    const d = el('div', 'seg');
    d.append(el('b', 0, s.speaker), document.createTextNode(s.text));
    pane.append(d);
  });
  const del = el('button', 'danger', 'Delete this meeting');
  del.onclick = async () => { if (confirm('Delete this meeting and its transcript?')) { await api('/meetings/' + id, { method: 'DELETE' }); loadHistory(); pane.replaceChildren(el('p', 'empty', 'Deleted.')); } };
  pane.append(document.createElement('br'), del);
}

async function loadKb() {
  const list = await api('/kb');
  const ul = $('#klist'); ul.replaceChildren();
  list.forEach((k) => {
    const li = el('li');
    const d = document.createElement('div');
    d.append(el('b', 0, k.title), el('span', 0, k.content.slice(0, 140)));
    const del = el('button', 'danger', 'Delete');
    del.onclick = async () => { await api('/kb/' + k.id, { method: 'DELETE' }); loadKb(); };
    li.append(d, del); ul.append(li);
  });
}
$('#ka').onclick = async () => {
  const title = $('#kt').value.trim(), content = $('#kc').value.trim();
  if (!title || !content) return;
  await api('/kb', { method: 'POST', body: JSON.stringify({ title, content }) });
  $('#kt').value = ''; $('#kc').value = ''; loadKb();
};

async function loadSettings() {
  const s = await api('/settings');
  $('#gStatus').textContent = s.geminiSet ? 'set' : 'not set'; $('#gStatus').classList.toggle('set', s.geminiSet);
  $('#nStatus').textContent = s.nvidiaSet ? 'set' : 'not set'; $('#nStatus').classList.toggle('set', s.nvidiaSet);
  $('#gModel').value = s.geminiModel; $('#nModel').value = s.nvidiaModel;
}
$('#saveSettings').onclick = async () => {
  const body = { geminiModel: $('#gModel').value.trim(), nvidiaModel: $('#nModel').value.trim() };
  if ($('#gKey').value.trim()) body.geminiApiKey = $('#gKey').value.trim();
  if ($('#nKey').value.trim()) body.nvidiaApiKey = $('#nKey').value.trim();
  await api('/settings', { method: 'POST', body: JSON.stringify(body) });
  $('#gKey').value = ''; $('#nKey').value = '';
  $('#saveMsg').textContent = 'Saved.'; setTimeout(() => ($('#saveMsg').textContent = ''), 2000);
  loadSettings();
};

loadHistory();
