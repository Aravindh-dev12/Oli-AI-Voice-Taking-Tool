const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed (' + response.status + ')');
  return payload;
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function tab(name) {
  document.querySelectorAll('main').forEach((main) => main.classList.toggle('on', main.id === name));
  document.querySelectorAll('nav button').forEach((button) => button.classList.toggle('on', button.dataset.t === name));
  if (name === 'hist') loadHistory($('#meetingSearch').value);
  if (name === 'kb') loadKb();
  if (name === 'settings') loadSettings();
  if (name === 'privacy') loadPrivacy();
}

document.querySelectorAll('nav button').forEach((button) => {
  button.addEventListener('click', () => tab(button.dataset.t));
});

async function loadHistory(query = '') {
  try {
    const list = await api('/meetings');
    const ul = $('#mlist');
    ul.replaceChildren();
    const needle = query.trim().toLowerCase();
    const filtered = list.filter((meeting) =>
      !needle ||
      String(meeting.title || '').toLowerCase().includes(needle) ||
      String(meeting.summary || '').toLowerCase().includes(needle)
    );
    if (!filtered.length) {
      ul.append(el('li', 'empty', 'No matching meetings.'));
      return;
    }
    filtered.forEach((meeting) => {
      const li = el('li');
      li.append(
        el('span', 't', meeting.title),
        el('span', 'd', new Date(meeting.started_at).toLocaleString())
      );
      li.addEventListener('click', () => showMeeting(meeting.id));
      ul.append(li);
    });
  } catch (error) {
    $('#histMsg').textContent = error.message;
  }
}

async function showMeeting(id) {
  const { meeting, segments, actions, meddpicc } = await api('/meetings/' + encodeURIComponent(id));
  const pane = $('#mdetail');
  pane.replaceChildren();
  pane.append(el('h3', null, meeting.title));
  pane.append(el('p', null, meeting.summary || 'Summary not available.'));
  const controls = el('div', 'row');
  const exportButton = el('button', 'primary', 'Export JSON');
  exportButton.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/meetings/' + encodeURIComponent(id) + '/export');
      if (!response.ok) throw new Error('Export failed.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'oli-meeting-' + id + '.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      $('#histMsg').textContent = error.message;
    }
  });
  controls.append(exportButton);
  pane.append(controls);

  if (actions.length) {
    const ul = el('ul');
    actions.forEach((action) => {
      const li = el('li');
      li.append(el('span', null, action.task + ' — ' + action.assignee + ' [' + action.status + ']'));
      if (action.status !== 'done' && action.status !== 'cancelled') {
        const done = el('button', 'danger', 'Done');
        done.addEventListener('click', async () => {
          await api('/actions/' + encodeURIComponent(action.id), { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
          showMeeting(id);
        });
        li.append(done);
      }
      ul.append(li);
    });
    pane.append(el('h3', null, 'Action items'), ul);
  }

  pane.append(el('h3', null, 'MEDDPICC'));
  const grid = el('div', 'mdgrid');
  const labels = {
    metrics: 'Metrics', economic_buyer: 'Economic buyer', decision_criteria: 'Decision criteria',
    decision_process: 'Decision process', paper_process: 'Paper process', identify_pain: 'Identify pain',
    champion: 'Champion', competition: 'Competition'
  };
  Object.entries(labels).forEach(([key, label]) => {
    const field = el('div', 'mdfield');
    field.append(el('b', null, label), el('span', null, meddpicc?.[key] || 'Not evidenced'));
    grid.append(field);
  });
  pane.append(grid);

  pane.append(el('h3', null, 'Transcript'));
  segments.forEach((segment) => {
    const row = el('div', 'seg');
    row.append(el('b', null, segment.speaker), document.createTextNode(segment.text));
    pane.append(row);
  });

  const del = el('button', 'danger', 'Delete this meeting');
  del.addEventListener('click', async () => {
    if (!confirm('Delete this meeting, transcript and action items?')) return;
    await api('/meetings/' + encodeURIComponent(id), { method: 'DELETE' });
    pane.replaceChildren(el('p', 'empty', 'Deleted.'));
    loadHistory($('#meetingSearch').value);
    loadPrivacy();
  });
  pane.append(document.createElement('br'), del);
}

$('#meetingSearch').addEventListener('input', () => loadHistory($('#meetingSearch').value));

async function loadKb() {
  try {
    const list = await api('/kb');
    const ul = $('#klist');
    ul.replaceChildren();
    if (!list.length) ul.append(el('li', 'empty', 'No knowledge entries yet.'));
    list.forEach((entry) => {
      const li = el('li');
      const content = el('div');
      content.append(el('b', null, entry.title), el('span', null, entry.content.slice(0, 180)));
      const del = el('button', 'danger', 'Delete');
      del.addEventListener('click', async () => {
        await api('/kb/' + encodeURIComponent(entry.id), { method: 'DELETE' });
        loadKb();
        loadPrivacy();
      });
      li.append(content, del);
      ul.append(li);
    });
  } catch (error) {
    $('#privacyMsg').textContent = error.message;
  }
}

$('#ka').addEventListener('click', async () => {
  const title = $('#kt').value.trim();
  const content = $('#kc').value.trim();
  if (!title || !content) return;
  try {
    await api('/kb', { method: 'POST', body: JSON.stringify({ title, content }) });
    $('#kt').value = '';
    $('#kc').value = '';
    loadKb();
    loadPrivacy();
  } catch (error) {
    $('#privacyMsg').textContent = error.message;
  }
});

async function loadSettings() {
  const settings = await api('/settings');
  $('#aiProvider').value = settings.aiProvider;
  $('#aiTimeoutMs').value = settings.aiTimeoutMs;
  $('#knowledgeDir').value = settings.knowledgeDir || '';
  $('#localEmbeddingUrl').value = settings.localEmbeddingUrl || '';
  $('#localEmbeddingModel').value = settings.localEmbeddingModel || 'nomic-embed-text';
  $('#embeddingDimensions').value = settings.embeddingDimensions || 768;
  $('#obsidianVaultPath').value = settings.obsidianVaultPath || '';
  $('#crmWebhookUrl').value = settings.crmWebhookUrl || '';
  $('#crmWebhookUrl').value = settings.crmWebhookUrl || '';
  $('#whisperBinaryPath').value = settings.whisperBinaryPath || '';
  $('#whisperModelPath').value = settings.whisperModelPath || '';
  $('#whisperLanguage').value = settings.whisperLanguage || 'en';
  $('#whisperThreads').value = settings.whisperThreads || 4;
  $('#localTranscriptionUrl').value = settings.localTranscriptionUrl;
  $('#localTranscriptionModel').value = settings.localTranscriptionModel;
  $('#localChatUrl').value = settings.localChatUrl;
  $('#localChatModel').value = settings.localChatModel;
  $('#gStatus').textContent = settings.geminiSet ? 'set' : 'not set';
  $('#gStatus').classList.toggle('set', settings.geminiSet);
  $('#nStatus').textContent = settings.nvidiaSet ? 'set' : 'not set';
  $('#nStatus').classList.toggle('set', settings.nvidiaSet);
  $('#gModel').value = settings.geminiModel;
  $('#nModel').value = settings.nvidiaModel;
}

$('#saveSettings').addEventListener('click', async () => {
  const body = {
    aiProvider: $('#aiProvider').value,
    aiTimeoutMs: Number($('#aiTimeoutMs').value),
    knowledgeDir: $('#knowledgeDir').value.trim(),
    obsidianVaultPath: $('#obsidianVaultPath').value.trim(),
    crmWebhookUrl: $('#crmWebhookUrl').value.trim(),
    crmWebhookUrl: $('#crmWebhookUrl').value.trim(),
    localEmbeddingUrl: $('#localEmbeddingUrl').value.trim(),
    localEmbeddingModel: $('#localEmbeddingModel').value.trim(),
    embeddingDimensions: Number($('#embeddingDimensions').value),
    whisperBinaryPath: $('#whisperBinaryPath').value.trim(),
    whisperModelPath: $('#whisperModelPath').value.trim(),
    whisperLanguage: $('#whisperLanguage').value.trim(),
    whisperThreads: Number($('#whisperThreads').value),
    localTranscriptionUrl: $('#localTranscriptionUrl').value.trim(),
    localTranscriptionModel: $('#localTranscriptionModel').value.trim(),
    localChatUrl: $('#localChatUrl').value.trim(),
    localChatModel: $('#localChatModel').value.trim(),
    geminiModel: $('#gModel').value.trim(),
    nvidiaModel: $('#nModel').value.trim()
  };
  if ($('#gKey').value.trim()) body.geminiApiKey = $('#gKey').value.trim();
  if ($('#nKey').value.trim()) body.nvidiaApiKey = $('#nKey').value.trim();
  if ($('#crmWebhookToken').value.trim()) body.crmWebhookToken = $('#crmWebhookToken').value.trim();
  if ($('#crmWebhookToken').value.trim()) body.crmWebhookToken = $('#crmWebhookToken').value.trim();

  try {
    await api('/settings', { method: 'POST', body: JSON.stringify(body) });
    $('#gKey').value = '';
    $('#nKey').value = '';
    $('#crmWebhookToken').value = '';
    $('#crmWebhookToken').value = '';
    $('#saveMsg').textContent = 'Saved.';
    loadSettings();
  } catch (error) {
    $('#saveMsg').textContent = error.message;
  }
});

async function loadPrivacy() {
  try {
    const privacy = await api('/privacy');
    $('#privacyMeetings').textContent = privacy.meetingCount;
    $('#privacySegments').textContent = privacy.transcriptCount;
    $('#privacyKb').textContent = privacy.kbCount;
    $('#retentionDays').value = privacy.retentionDays;
    $('#privacyMode').textContent = privacy.localOnly
      ? 'Local AI mode: configured model endpoints are restricted to localhost.'
      : 'Current AI mode may use a configured cloud provider. Review AI settings before capturing sensitive meetings.';
  } catch (error) {
    $('#privacyMsg').textContent = error.message;
  }
}

$('#savePrivacy').addEventListener('click', async () => {
  try {
    const data = await api('/privacy', {
      method: 'POST',
      body: JSON.stringify({ retentionDays: Number($('#retentionDays').value) })
    });
    $('#privacyMsg').textContent = data.deleted
      ? 'Saved. Removed ' + data.deleted + ' expired meeting(s).'
      : 'Saved.';
    loadPrivacy();
    loadHistory($('#meetingSearch').value);
  } catch (error) {
    $('#privacyMsg').textContent = error.message;
  }
});

$('#runCleanup').addEventListener('click', async () => {
  try {
    const data = await api('/privacy/cleanup', { method: 'POST' });
    $('#privacyMsg').textContent = 'Cleanup removed ' + data.deleted + ' meeting(s).';
    loadPrivacy();
    loadHistory($('#meetingSearch').value);
  } catch (error) {
    $('#privacyMsg').textContent = error.message;
  }
});

loadHistory();

$('#syncKnowledge').addEventListener('click', async () => {
  try {
    await api('/settings', {
      method: 'POST',
      body: JSON.stringify({ knowledgeDir: $('#knowledgeDir').value.trim() })
    });
    const result = await api('/kb/sync', { method: 'POST' });
    $('#knowledgeMsg').textContent =
      'Synced: ' + result.added + ' added, ' + result.updated + ' updated, ' + result.removed + ' removed.';
    loadKb();
    loadPrivacy();
  } catch (error) {
    $('#knowledgeMsg').textContent = error.message;
  }
});
