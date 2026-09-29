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
  if (name === 'agents') loadAgents();
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


let selectedAgent = null;
let agentList = [];

async function loadAgents() {
  try {
    agentList = await api('/agents');
    const list = $('#alist');
    list.replaceChildren();
    agentList.forEach((agent) => {
      const li = el('li');
      li.append(el('span', 't', agent.name), el('span', 'd', agent.description));
      li.addEventListener('click', () => selectAgent(agent.id));
      list.append(li);
    });
    const select = $('#scheduleAgent');
    select.replaceChildren();
    agentList.forEach((agent) => select.append(new Option(agent.name, agent.id)));
    if (!selectedAgent || !agentList.some((a) => a.id === selectedAgent)) selectedAgent = agentList[0]?.id || null;
    renderAgentEditor();
    await Promise.all([loadApprovals(), loadInbox(), loadBrain(), loadSchedules(), loadSkills(), loadSources(), loadFamilies(), loadJobs(), loadHandoffs(), loadBatches()]);
  } catch (error) {
    $('#agentMsg').textContent = error.message;
  }
}

function renderAgentEditor() {
  const agent = agentList.find((a) => a.id === selectedAgent);
  const pane = $('#agentEditor');
  pane.replaceChildren();
  if (!agent) {
    pane.append(el('p', 'empty', 'Select an agent.'));
    return;
  }
  const title = el('h3', null, agent.name);
  title.style.marginTop = '0';
  const description = el('p', 'hint', agent.description);
  const row = el('div', 'row');
  const label = el('label', null, 'Permission');
  const select = document.createElement('select');
  ['read_only', 'ask_first', 'always_allow'].forEach((mode) => select.append(new Option(mode.replace('_', ' '), mode)));
  select.value = agent.permission_mode;
  const save = el('button', 'primary', 'Save');
  save.addEventListener('click', async () => {
    try {
      const updated = await api('/agents/' + encodeURIComponent(agent.id), {
        method: 'PATCH',
        body: JSON.stringify({ permissionMode: select.value })
      });
      agent.permission_mode = updated.permission_mode;
      $('#agentMsg').textContent = 'Permission saved.';
    } catch (error) { $('#agentMsg').textContent = error.message; }
  });
  row.append(label, select, save);
  pane.append(title, description, row);
}

function selectAgent(id) {
  selectedAgent = id;
  renderAgentEditor();
}

async function loadApprovals() {
  const list = $('#approvalList');
  try {
    const approvals = await api('/agent/approvals?status=pending&limit=50');
    list.replaceChildren();
    if (!approvals.length) list.append(el('li', 'empty', 'No pending approvals.'));
    approvals.forEach((approval) => {
      const li = el('li');
      const body = el('div');
      body.append(el('b', null, approval.action_type), el('div', null, approval.reason));
      const actions = el('div', 'row');
      const yes = el('button', 'primary', 'Approve');
      const no = el('button', 'danger', 'Reject');
      yes.addEventListener('click', () => resolveApproval(approval.id, 'approved'));
      no.addEventListener('click', () => resolveApproval(approval.id, 'rejected'));
      actions.append(yes, no);
      li.append(body, actions);
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function resolveApproval(id, decision) {
  try {
    await api('/agent/approvals/' + encodeURIComponent(id) + '/resolve', {
      method: 'POST',
      body: JSON.stringify({ decision })
    });
    loadApprovals();
    loadInbox();
  } catch (error) { $('#agentMsg').textContent = error.message; }
}

async function loadInbox() {
  const list = $('#inboxList');
  try {
    const items = await api('/agent/inbox?limit=30');
    list.replaceChildren();
    if (!items.length) list.append(el('li', 'empty', 'Inbox is empty.'));
    items.forEach((item) => {
      const li = el('li');
      li.className = 'inbox-item';
      li.append(el('b', null, item.title), el('span', null, item.body));
      if (item.status !== 'read') {
        const read = el('button', null, 'Mark read');
        read.addEventListener('click', async () => {
          await api('/agent/inbox/' + encodeURIComponent(item.id), { method: 'PATCH', body: JSON.stringify({ status: 'read' }) });
          loadInbox();
        });
        li.append(read);
      }
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadBrain(query = '') {
  const list = $('#brainList');
  try {
    const items = query
      ? await api('/agent/brain/search?q=' + encodeURIComponent(query) + '&limit=50')
      : await api('/agent/brain?limit=50');
    list.replaceChildren();
    if (!items.length) list.append(el('li', 'empty', 'No Brain memories found.'));
    items.forEach((item) => {
      const li = el('li');
      const body = el('div');
      body.append(el('b', null, item.title), el('span', null, item.kind + ' · ' + item.content.slice(0, 420)));
      const del = el('button', 'danger', 'Delete');
      del.addEventListener('click', async () => {
        await api('/agent/brain/' + encodeURIComponent(item.id), { method: 'DELETE' });
        loadBrain($('#brainSearch').value);
      });
      li.append(body, del);
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadSchedules() {
  const list = $('#scheduleList');
  try {
    const schedules = await api('/agent/schedules');
    list.replaceChildren();
    if (!schedules.length) list.append(el('li', 'empty', 'No schedules configured.'));
    schedules.forEach((schedule) => {
      const li = el('li');
      const name = agentList.find((a) => a.id === schedule.agent_id)?.name || schedule.agent_id;
      li.append(el('b', null, name + ' · every ' + Math.round(schedule.interval_ms / 60000) + ' min'), el('span', null, schedule.prompt));
      const toggle = el('button', schedule.enabled ? 'danger' : null, schedule.enabled ? 'Pause' : 'Resume');
      toggle.addEventListener('click', async () => {
        await api('/agent/schedules/' + encodeURIComponent(schedule.id), { method: 'PATCH', body: JSON.stringify({ enabled: !schedule.enabled }) });
        loadSchedules();
      });
      const remove = el('button', 'danger', 'Delete');
      remove.addEventListener('click', async () => {
        await api('/agent/schedules/' + encodeURIComponent(schedule.id), { method: 'DELETE' });
        loadSchedules();
      });
      li.append(toggle, remove);
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

$('#runAgent').addEventListener('click', async () => {
  if (!selectedAgent) return;
  const request = $('#agentRequest').value.trim();
  if (!request) return;
  try {
    const skillId = $('#selectedSkill')?.value || undefined;
    const result = await api('/agents/' + encodeURIComponent(selectedAgent) + '/run', {
      method: 'POST',
      body: JSON.stringify({ request, meetingId: $('#agentMeetingId').value.trim() || undefined, skillId })
    });
    $('#agentMsg').textContent = result.answer || 'Agent completed.';
    $('#agentRequest').value = '';
    await Promise.all([loadInbox(), loadApprovals(), loadBrain()]);
  } catch (error) { $('#agentMsg').textContent = error.message; }
});

$('#brainSearchBtn').addEventListener('click', () => loadBrain($('#brainSearch').value.trim()));
$('#brainSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadBrain($('#brainSearch').value.trim());
});

$('#addSchedule').addEventListener('click', async () => {
  const agentId = $('#scheduleAgent').value;
  const prompt = $('#schedulePrompt').value.trim();
  const minutes = Number($('#scheduleMinutes').value);
  if (!agentId || !prompt || !Number.isFinite(minutes)) return;
  try {
    await api('/agent/schedules', {
      method: 'POST',
      body: JSON.stringify({ agentId, prompt, intervalMs: Math.round(minutes * 60000) })
    });
    $('#schedulePrompt').value = '';
    loadSchedules();
  } catch (error) { $('#agentMsg').textContent = error.message; }
});


async function loadSkills() {
  const list = $('#skillList');
  try {
    const skills = await api('/skills');
    list.replaceChildren();
    if (!skills.length) list.append(el('li', 'empty', 'No skills configured.'));
    skills.forEach((skill) => {
      const li = el('li');
      li.append(el('b', null, skill.name + ' v' + skill.version), el('span', null, skill.description));
      const toggle = el('button', skill.enabled ? 'danger' : null, skill.enabled ? 'Disable' : 'Enable');
      toggle.addEventListener('click', async () => {
        await api('/skills/' + encodeURIComponent(skill.id), { method: 'PATCH', body: JSON.stringify({ enabled: !skill.enabled }) });
        loadSkills();
      });
      li.append(toggle);
      list.append(li);
    });
    const prompt = $('#agentRequest');
    if (prompt && skills[0] && !$('#selectedSkill')) {
      const select = document.createElement('select');
      select.id = 'selectedSkill';
      select.append(new Option('No skill', ''));
      skills.forEach((skill) => select.append(new Option(skill.name, skill.id)));
      prompt.parentElement.insertBefore(select, prompt);
    }
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadSources() {
  const list = $('#sourceList');
  try {
    const sources = await api('/sources');
    list.replaceChildren();
    if (!sources.length) list.append(el('li', 'empty', 'No local sources connected.'));
    sources.forEach((source) => {
      const li = el('li');
      li.append(el('b', null, source.name), el('span', null, (source.enabled ? 'Enabled' : 'Disabled') + ' · ' + source.root_path));
      const sync = el('button', null, 'Sync');
      sync.addEventListener('click', async () => {
        await api('/sources/' + encodeURIComponent(source.id) + '/sync', { method: 'POST' });
        loadSources();
      });
      const toggle = el('button', source.enabled ? 'danger' : null, source.enabled ? 'Disable' : 'Enable');
      toggle.addEventListener('click', async () => {
        await api('/sources/' + encodeURIComponent(source.id), { method: 'PATCH', body: JSON.stringify({ enabled: !source.enabled }) });
        loadSources();
      });
      const remove = el('button', 'danger', 'Remove');
      remove.addEventListener('click', async () => {
        await api('/sources/' + encodeURIComponent(source.id), { method: 'DELETE' });
        loadSources();
      });
      li.append(sync, toggle, remove);
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadFamilies() {
  const list = $('#familyList');
  try {
    const families = await api('/agent/families');
    list.replaceChildren();
    families.forEach((family) => {
      const li = el('li');
      const members = family.agents.map((id) => agentList.find((a) => a.id === id)?.name || id).join(', ') || 'No members';
      li.append(el('b', null, family.name), el('span', null, family.description + ' · ' + members));
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadJobs() {
  const list = $('#jobList');
  try {
    const jobs = await api('/agent/jobs?limit=25');
    list.replaceChildren();
    if (!jobs.length) list.append(el('li', 'empty', 'No jobs.'));
    jobs.forEach((job) => {
      const li = el('li');
      const body = el('div');
      body.append(el('b', null, job.kind + ' · ' + job.status), el('span', null, 'Attempts ' + job.attempts + '/' + job.max_attempts));
      if (job.last_error) body.append(el('span', null, job.last_error));
      const retry = el('button', null, 'Retry');
      retry.disabled = job.status !== 'failed';
      retry.addEventListener('click', async () => {
        await api('/agent/jobs/' + encodeURIComponent(job.id) + '/retry', { method: 'POST' });
        loadJobs();
      });
      const cancel = el('button', 'danger', 'Cancel');
      cancel.disabled = !['pending','processing'].includes(job.status);
      cancel.addEventListener('click', async () => {
        await api('/agent/jobs/' + encodeURIComponent(job.id) + '/cancel', { method: 'POST' });
        loadJobs();
      });
      li.append(body, retry, cancel);
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadHandoffs() {
  const list = $('#handoffList');
  try {
    const items = await api('/agent/handoffs?limit=25');
    list.replaceChildren();
    if (!items.length) list.append(el('li', 'empty', 'No handoffs.'));
    items.forEach((item) => {
      const li = el('li');
      li.append(el('b', null, item.from_agent_id || 'agent'), el('span', null, '→ ' + item.to_agent_name + ' · ' + item.status + ' · ' + item.request));
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

async function loadBatches() {
  const list = $('#batchList');
  try {
    const items = await api('/agent/batches?limit=25');
    list.replaceChildren();
    if (!items.length) list.append(el('li', 'empty', 'No batches.'));
    items.forEach((item) => {
      const li = el('li');
      li.append(el('b', null, item.title), el('span', null, item.status + ' · ' + item.completed_count + '/' + item.total_count));
      list.append(li);
    });
  } catch (error) { list.append(el('li', 'empty', error.message)); }
}

$('#addSkill').addEventListener('click', async () => {
  const id = $('#skillId').value.trim(), name = $('#skillName').value.trim(), prompt = $('#skillPrompt').value.trim();
  if (!id || !name || !prompt) return;
  try {
    await api('/skills', { method: 'POST', body: JSON.stringify({ id, name, prompt, description: name, version: 1 }) });
    $('#skillId').value = ''; $('#skillName').value = ''; $('#skillPrompt').value = '';
    loadSkills();
  } catch (error) { $('#agentMsg').textContent = error.message; }
});

$('#addSource').addEventListener('click', async () => {
  const id = $('#sourceId').value.trim(), name = $('#sourceName').value.trim(), rootPath = $('#sourcePath').value.trim();
  if (!id || !name || !rootPath) return;
  try {
    await api('/sources', { method: 'POST', body: JSON.stringify({ id, name, rootPath, sourceType: 'markdown', enabled: true }) });
    await api('/sources/' + encodeURIComponent(id) + '/sync', { method: 'POST' });
    $('#sourceId').value = ''; $('#sourceName').value = ''; $('#sourcePath').value = '';
    loadSources();
  } catch (error) { $('#agentMsg').textContent = error.message; }
});


$('#createBatch').addEventListener('click', async () => {
  try {
    const items = $('#batchItems').value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
    await api('/agent/batches', { method: 'POST', body: JSON.stringify({ title: $('#batchTitle').value.trim(), items }) });
    $('#batchTitle').value = ''; $('#batchItems').value = '';
    loadBatches(); loadJobs();
  } catch (error) { $('#agentMsg').textContent = error.message; }
});
