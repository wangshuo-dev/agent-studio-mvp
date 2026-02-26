const state = {
  config: null,
  currentTab: 'models',
  selectedId: null,
  currentJobId: null,
  plannerShownForJob: null,
};

const els = {
  tabs: [...document.querySelectorAll('.tab')],
  configList: document.getElementById('configList'),
  addItemBtn: document.getElementById('addItemBtn'),
  editorTitle: document.getElementById('editorTitle'),
  editorSubtitle: document.getElementById('editorSubtitle'),
  editorForm: document.getElementById('editorForm'),
  saveConfigBtn: document.getElementById('saveConfigBtn'),
  testModelBtn: document.getElementById('testModelBtn'),
  teamSelect: document.getElementById('teamSelect'),
  promptInput: document.getElementById('promptInput'),
  runBtn: document.getElementById('runBtn'),
  cancelRunBtn: document.getElementById('cancelRunBtn'),
  runOutput: document.getElementById('runOutput'),
  traceList: document.getElementById('traceList'),
  progressMeta: document.getElementById('progressMeta'),
  progressFill: document.getElementById('progressFill'),
};

const TAB_LABELS = {
  models: ['Model Editor', 'Configure local CLI-backed models.'],
  agents: ['Agent Editor', 'Configure manager/specialist agents and role prompts.'],
  teams: ['Team Editor', 'Compose teams from agents and select a manager.'],
};

const ROLE_STYLE = {
  '代码工程师': { color: '#38d0ff', avatar: '码' },
  '文档策划': { color: '#6fe48f', avatar: '文' },
  '调研分析': { color: '#b7a1ff', avatar: '研' },
  '开发经理': { color: '#f6b73c', avatar: '管' },
  '系统': { color: '#39d2c0', avatar: '系' },
};

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function currentCollection() {
  return state.config?.[state.currentTab] || [];
}

function getSelectedItem() {
  return currentCollection().find((x) => x.id === state.selectedId) || null;
}

function renderTabMeta() {
  const [title, subtitle] = TAB_LABELS[state.currentTab];
  els.editorTitle.textContent = title;
  els.editorSubtitle.textContent = subtitle;
  els.testModelBtn.style.display = state.currentTab === 'models' ? 'inline-flex' : 'none';
  els.testModelBtn.disabled = state.currentTab !== 'models';
}

function renderConfigList() {
  const items = currentCollection();
  if (!items.length) {
    els.configList.innerHTML = '<div class="config-item">No items.</div>';
    return;
  }

  els.configList.innerHTML = items.map((item) => {
    let meta = '';
    if (state.currentTab === 'models') meta = `${item.provider || 'custom'} • ${item.command || ''}`;
    if (state.currentTab === 'agents') meta = `${item.role || 'agent'} • ${item.modelId || ''}`;
    if (state.currentTab === 'teams') meta = `manager: ${item.managerAgentId || '-'} • members: ${(item.memberAgentIds || []).length}`;
    return `
      <div class="config-item ${item.id === state.selectedId ? 'active' : ''}" data-id="${item.id}">
        <div class="name">${escapeHtml(item.name || item.id)}</div>
        <div class="meta">${escapeHtml(meta)}</div>
      </div>`;
  }).join('');

  [...els.configList.querySelectorAll('.config-item[data-id]')].forEach((node) => {
    node.addEventListener('click', () => {
      state.selectedId = node.dataset.id;
      render();
    });
  });
}

function buildField(label, key, value, type = 'text') {
  if (type === 'textarea') {
    return `
      <div class="field">
        <label for="f-${key}">${label}</label>
        <textarea id="f-${key}" data-key="${key}">${escapeHtml(value ?? '')}</textarea>
      </div>`;
  }
  if (type === 'checkbox') {
    return `
      <label class="checkbox-row">
        <input id="f-${key}" data-key="${key}" type="checkbox" ${value ? 'checked' : ''} />
        <span>${label}</span>
      </label>`;
  }
  return `
    <div class="field">
      <label for="f-${key}">${label}</label>
      <input id="f-${key}" data-key="${key}" type="${type}" value="${escapeAttr(value ?? '')}" />
    </div>`;
}

function renderEditor() {
  const item = getSelectedItem();
  if (!item) {
    els.editorForm.innerHTML = '<div class="field"><label>No selection</label></div>';
    return;
  }

  if (state.currentTab === 'models') {
    els.editorForm.innerHTML = [
      buildField('Name', 'name', item.name),
      buildField('Provider Key', 'provider', item.provider),
      buildField('Command', 'command', item.command),
      buildField('Args Template (use {{prompt}})', 'argsTemplate', item.argsTemplate),
      buildField('Enabled', 'enabled', item.enabled, 'checkbox'),
    ].join('');
  } else if (state.currentTab === 'agents') {
    const modelOptions = (state.config.models || []).map((m) =>
      `<option value="${m.id}" ${m.id === item.modelId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
    els.editorForm.innerHTML = [
      buildField('Name', 'name', item.name),
      buildField('Role (manager/specialist)', 'role', item.role),
      `<div class="field"><label for="f-modelId">Model</label><select id="f-modelId" data-key="modelId">${modelOptions}</select></div>`,
      buildField('System Prompt', 'systemPrompt', item.systemPrompt, 'textarea'),
      buildField('Specialties (comma-separated)', 'specialties', (item.specialties || []).join(', ')),
      buildField('Routing Mode', 'routingMode', item.routingMode || ''),
    ].join('');
  } else {
    const agentOptions = (state.config.agents || []).map((a) =>
      `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    els.editorForm.innerHTML = [
      buildField('Name', 'name', item.name),
      `<div class="field"><label for="f-managerAgentId">Manager Agent</label><select id="f-managerAgentId" data-key="managerAgentId">${(state.config.agents || []).map((a)=>`<option value="${a.id}" ${a.id===item.managerAgentId?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>`,
      `<div class="field"><label for="f-memberAgentIds">Member Agents (Cmd/Ctrl multi-select)</label><select id="f-memberAgentIds" data-key="memberAgentIds" multiple size="6">${(state.config.agents || []).map((a)=>`<option value="${a.id}" ${(item.memberAgentIds||[]).includes(a.id)?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}</select></div>`,
      `<div class="field"><label for="f-strategy">Strategy</label><select id="f-strategy" data-key="strategy">
        <option value="single-route" ${ (item.strategy || 'single-route') === 'single-route' ? 'selected' : '' }>single-route</option>
        <option value="broadcast" ${ (item.strategy || '') === 'broadcast' ? 'selected' : '' }>broadcast</option>
        <option value="manager-decide" ${ (item.strategy || '') === 'manager-decide' ? 'selected' : '' }>manager-decide</option>
      </select></div>`,
      `<div class="field"><label>Available Agents</label><div class="small-note">${agentOptions.replace(/<option[^>]*>|<\/option>/g,' ').trim()}</div></div>`
    ].join('');
  }

  attachEditorBindings(item);
}

function attachEditorBindings(item) {
  [...els.editorForm.querySelectorAll('[data-key]')].forEach((input) => {
    const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventName, () => {
      const key = input.dataset.key;
      let value;
      if (input.type === 'checkbox') value = input.checked;
      else if (input.multiple) value = [...input.selectedOptions].map((o) => o.value);
      else value = input.value;

      if (state.currentTab === 'agents' && key === 'specialties') {
        value = String(value).split(',').map((v) => v.trim()).filter(Boolean);
      }

      item[key] = value;
      renderConfigList();
      renderTeamsSelect();
    });
  });
}

function renderTeamsSelect() {
  const teams = state.config?.teams || [];
  els.teamSelect.innerHTML = teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function renderTraces() {
  const traces = state.config?.sessions || [];
  if (!traces.length) {
    els.traceList.innerHTML = '<div class="trace-item"><div class="small">No runs yet.</div></div>';
    return;
  }

  els.traceList.innerHTML = traces.map((t) => {
    const ok = !!t.result?.ok;
    const preview = (t.result?.stdout || t.result?.stderr || '').trim().slice(0, 220);
    return `
      <div class="trace-item">
        <h4>${escapeHtml(t.route?.selectedAgentName || 'Unknown Agent')}</h4>
        <div class="small">
          <span class="badge ${ok ? 'ok' : 'err'}">${ok ? 'OK' : 'ERR'}</span>
          team=${escapeHtml(t.teamId || '')}<br>
          mode=${escapeHtml(t.route?.mode || 'single-route')}<br>
          model=${escapeHtml(t.route?.modelId || '(varies)')}<br>
          keyword=${escapeHtml(String(t.route?.matchedKeyword || '-'))}<br>
          started=${escapeHtml(t.startedAt || '')}
        </div>
        <div class="small" style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(preview || '(empty output)')}</div>
      </div>`;
  }).join('');
}

function render() {
  renderTabMeta();
  renderConfigList();
  renderEditor();
  renderTeamsSelect();
  renderTraces();
}

function addItem() {
  const collection = currentCollection();
  let item;
  if (state.currentTab === 'models') {
    item = {
      id: uid('model'),
      name: 'New Model',
      provider: 'custom',
      command: 'echo',
      argsTemplate: '"{{prompt}}"',
      enabled: true,
    };
  } else if (state.currentTab === 'agents') {
    item = {
      id: uid('agent'),
      name: 'New Agent',
      role: 'specialist',
      systemPrompt: '',
      modelId: state.config.models?.[0]?.id || '',
      specialties: [],
    };
  } else {
    item = {
      id: uid('team'),
      name: 'New Team',
      managerAgentId: state.config.agents?.[0]?.id || '',
      memberAgentIds: state.config.agents?.slice(0, 1).map((a) => a.id) || [],
      strategy: 'broadcast',
    };
  }
  collection.push(item);
  state.selectedId = item.id;
  render();
}

async function loadConfig() {
  state.config = await api('/api/config');
  state.selectedId = state.config[state.currentTab]?.[0]?.id || null;
  render();
}

async function saveConfig() {
  await api('/api/config', {
    method: 'PUT',
    body: JSON.stringify(state.config),
  });
}

async function runTeam() {
  const prompt = els.promptInput.value.trim();
  const teamId = els.teamSelect.value;
  if (!prompt) return;

  els.runBtn.disabled = true;
  els.cancelRunBtn.disabled = false;
  renderRunningCards(teamId, null, 'queued');
  setProgress('Queued...', 2, 0);
  try {
    const { jobId } = await api('/api/run-async', {
      method: 'POST',
      body: JSON.stringify({ prompt, teamId }),
    });
    state.currentJobId = jobId;
    state.plannerShownForJob = null;
    const trace = await waitForJob(jobId);
    const cards = [];
    if ((trace.subRuns || []).length) {
      for (const r of trace.subRuns || []) {
        cards.push({
          role: r.agentName || 'Agent',
          body: ((r.stdout || '').trim() || (r.stderr || '').trim() || '(empty)'),
          kind: 'agent',
          debug: buildAgentDebug(r),
        });
      }
    } else {
      cards.push({
        role: trace.route.selectedAgentName || 'Agent',
        body: (trace.result.stdout || '').trim() || '(empty)',
        kind: 'agent',
        debug: trace.result?.stderr ? `stderr:\n${trace.result.stderr.trim()}` : '',
      });
    }
    cards.push({
      role: '开发经理',
      body: (trace.result.stdout || '').trim() || '(empty)',
      kind: 'manager',
      debug: trace.result?.stderr ? `stderr:\n${trace.result.stderr.trim()}` : (trace.route?.plannerDecision ? `planner:\n${JSON.stringify(trace.route.plannerDecision, null, 2)}` : ''),
    });
    setRunCards(cards);
    state.config.sessions = [trace, ...(state.config.sessions || [])].slice(0, 50);
    renderTraces();
    setProgress('Completed', 1, 1);
  } catch (err) {
    setRunCards([{ role: '系统', body: `Run failed: ${err.message}`, kind: 'system' }]);
    setProgress(`Failed: ${err.message}`, 1, 0);
  } finally {
    state.currentJobId = null;
    els.runBtn.disabled = false;
    els.cancelRunBtn.disabled = true;
  }
}

async function waitForJob(jobId) {
  while (true) {
    const job = await api(`/api/run-status/${jobId}`);
    const p = job.progress || { current: 0, total: 1 };
    const currentAgent = job.currentAgent ? ` | ${job.currentAgent}` : '';
    setProgress(`${job.phase || job.status}${currentAgent}`, p.total || 1, p.current || 0);
    if (job.plannerDecision && state.plannerShownForJob !== jobId) {
      const d = job.plannerDecision;
      state.plannerShownForJob = jobId;
      renderRunningCards(job.teamId, job.currentAgent, job.phase || job.status, d);
    }
    if (job.status === 'running') renderRunningCards(job.teamId, job.currentAgent, job.phase || job.status, job.plannerDecision);
    if (job.status === 'completed') return job.trace;
    if (job.status === 'cancelled') throw new Error('run cancelled');
    if (job.status === 'failed') throw new Error(job.error || 'job failed');
    await new Promise((r) => setTimeout(r, 600));
  }
}

async function testSelectedModel() {
  if (state.currentTab !== 'models') return;
  const item = getSelectedItem();
  if (!item?.id) return;
  els.testModelBtn.disabled = true;
  setRunCards([{ role: '系统', body: `Testing model ${item.name}...`, kind: 'system' }]);
  try {
    const out = await api('/api/model-test', {
      method: 'POST',
      body: JSON.stringify({ modelId: item.id }),
    });
    setRunCards([{
      role: `模型测试 · ${out.modelName}`,
      body: (out.result.stdout || '').trim() || (out.result.stderr || '').trim() || '(empty)',
      kind: 'system',
    }]);
  } catch (err) {
    setRunCards([{ role: '系统', body: `Model test failed: ${err.message}`, kind: 'system' }]);
  } finally {
    els.testModelBtn.disabled = state.currentTab !== 'models';
  }
}

async function cancelCurrentRun() {
  if (!state.currentJobId) return;
  try {
    await api(`/api/run-cancel/${state.currentJobId}`, { method: 'POST' });
    setProgress('Cancelling...', 1, 0);
  } catch (err) {
    setRunCards([{ role: '系统', body: `Cancel failed: ${err.message}`, kind: 'system' }]);
  }
}

function setProgress(label, total, current) {
  const pct = Math.max(0, Math.min(100, Math.round(((current || 0) / Math.max(1, total || 1)) * 100)));
  els.progressMeta.textContent = `${label} (${current || 0}/${Math.max(1, total || 1)})`;
  els.progressFill.style.width = `${pct}%`;
}

function setRunOutput(text) {
  els.runOutput.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'msg-card system';
  card.innerHTML = `<div class="msg-role">系统</div><div class="msg-body"></div>`;
  card.querySelector('.msg-body').textContent = text;
  els.runOutput.appendChild(card);
  els.runOutput.scrollTop = els.runOutput.scrollHeight;
}

function setRunCards(cards) {
  els.runOutput.innerHTML = '';
  for (const c of cards || []) {
    const card = document.createElement('div');
    card.className = `msg-card ${c.kind || ''} ${c.kind === 'manager' ? 'manager' : c.kind === 'system' ? 'system' : ''} ${c.loading ? 'loading' : ''}`.trim();
    card.style.setProperty('--role-color', c.color || roleColor(c.role));
    const role = document.createElement('div');
    role.className = 'msg-role';
    const avatar = document.createElement('span');
    avatar.className = 'msg-avatar';
    avatar.textContent = c.avatar || roleAvatar(c.role);
    const roleText = document.createElement('span');
    roleText.className = 'msg-role-text';
    roleText.textContent = c.role || '消息';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = c.body || (c.loading ? 'loading' : '(empty)');
    role.append(avatar, roleText);
    card.append(role, body);
    if (c.debug) {
      const details = document.createElement('details');
      details.className = 'msg-debug';
      const summary = document.createElement('summary');
      summary.textContent = '调试信息';
      const pre = document.createElement('pre');
      pre.textContent = c.debug;
      details.append(summary, pre);
      card.append(details);
    }
    els.runOutput.appendChild(card);
  }
  els.runOutput.scrollTop = els.runOutput.scrollHeight;
}

function renderRunningCards(teamId, currentAgent, phase, plannerDecision) {
  const team = (state.config?.teams || []).find((t) => t.id === teamId) || null;
  const members = (team?.memberAgentIds || []).map((id) => (state.config?.agents || []).find((a) => a.id === id)).filter(Boolean);
  const cards = [];
  if (plannerDecision) {
    cards.push({
      role: '系统',
      body: `规划：${plannerDecision.mode || '-'} / ${plannerDecision.agentId || '-'} / ${plannerDecision.reason || '-'}`,
      kind: 'system',
      debug: plannerDecision.plannerRaw || '',
    });
  } else {
    cards.push({ role: '系统', body: `运行中：${phase || 'running'}`, kind: 'system' });
  }
  for (const m of members) {
    cards.push({
      role: m.name,
      body: currentAgent === m.name ? '正在生成回答...' : '等待执行...',
      kind: 'agent',
      loading: true,
    });
  }
  cards.push({ role: '开发经理', body: '等待汇总...', kind: 'manager', loading: true });
  setRunCards(cards);
}

function roleAvatar(role) {
  return (ROLE_STYLE[role]?.avatar) || String(role || '消').slice(0, 1);
}

function roleColor(role) {
  return (ROLE_STYLE[role]?.color) || '#39d2c0';
}

function buildAgentDebug(r) {
  const parts = [];
  if (r.modelId) parts.push(`model=${r.modelId}`);
  if (r.code !== undefined) parts.push(`code=${r.code}`);
  if (r.cancelled) parts.push('cancelled=true');
  if (r.stderr && r.stderr.trim()) parts.push(`stderr:\n${r.stderr.trim()}`);
  return parts.join('\n');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.currentTab = tab.dataset.tab;
    state.selectedId = state.config?.[state.currentTab]?.[0]?.id || null;
    render();
  });
});

els.addItemBtn.addEventListener('click', addItem);
els.saveConfigBtn.addEventListener('click', async () => {
  try {
    await saveConfig();
    setRunOutput('Configuration saved.');
  } catch (err) {
    setRunOutput(`Save failed: ${err.message}`);
  }
});
els.testModelBtn.addEventListener('click', testSelectedModel);
els.runBtn.addEventListener('click', runTeam);
els.cancelRunBtn.addEventListener('click', cancelCurrentRun);

loadConfig().catch((err) => {
  setRunOutput(`Init failed: ${err.message}`);
});
