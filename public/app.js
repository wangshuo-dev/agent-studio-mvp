const state = {
  config: null,
  currentTab: 'models',
  selectedId: null,
  currentJobId: null,
  plannerShownForJob: null,
  roleplayAgentId: null,
  roleplayLastMessage: '',
  roleplayPersonaId: null,
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
  workflowFlow: document.getElementById('workflowFlow'),
  roleplayAgentSelect: document.getElementById('roleplayAgentSelect'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
};

const TAB_LABELS = {
  models: ['Model Editor', 'Configure local CLI-backed models.'],
  agents: ['Agent Editor', 'Configure manager/specialist agents and role prompts.'],
  teams: ['Team Editor', 'Compose teams from agents and select a manager.'],
};

const ROLE_STYLE = {
  '代码工程师': { color: '#38d0ff', avatar: '码', hair: '#00d2ff', outfit: '#2f7cff', hairShape: 'short' },
  '文档策划': { color: '#6fe48f', avatar: '文', hair: '#6effa8', outfit: '#34b56b', hairShape: 'bangs' },
  '调研分析': { color: '#b7a1ff', avatar: '研', hair: '#b58cff', outfit: '#7d63ff', hairShape: 'curly' },
  '开发经理': { color: '#f6b73c', avatar: '管', hair: '#ffb64d', outfit: '#d67d1f', hairShape: 'bun' },
  '产品经理': { color: '#ff7aa8', avatar: '产', hair: '#ff6f9f', outfit: '#db4f86', hairShape: 'bangs' },
  '交互设计师': { color: '#ff9f5f', avatar: '设', hair: '#ff9a52', outfit: '#d8762f', hairShape: 'curly' },
  '测试工程师': { color: '#72e0d1', avatar: '测', hair: '#5dd7c6', outfit: '#2e9f93', hairShape: 'short' },
  '运营策划': { color: '#ffd166', avatar: '运', hair: '#f5c24e', outfit: '#d49a22', hairShape: 'bun' },
  '数据分析师': { color: '#8ec5ff', avatar: '数', hair: '#76b7ff', outfit: '#4d84db', hairShape: 'short' },
  '前端工程师': { color: '#5ce0ff', avatar: '前', hair: '#43d8ff', outfit: '#2c9fd1', hairShape: 'short' },
  '后端工程师': { color: '#5f8dff', avatar: '后', hair: '#5f8dff', outfit: '#3f63db', hairShape: 'short' },
  '实习生': { color: '#c2ff6d', avatar: '习', hair: '#bbf75b', outfit: '#74a83a', hairShape: 'bangs' },
  '系统': { color: '#39d2c0', avatar: '系', hair: '#39d2c0', outfit: '#238b82', hairShape: 'short' },
};

const ROLEPLAY_PERSONAS = [
  { id: 'persona-code', name: '代码工程师', visualRole: '代码工程师' },
  { id: 'persona-client', name: '甲方', visualRole: '开发经理' },
  { id: 'persona-docs', name: '文档策划', visualRole: '文档策划' },
  { id: 'persona-research', name: '调研分析', visualRole: '调研分析' },
  { id: 'persona-product', name: '产品经理', visualRole: '产品经理' },
  { id: 'persona-designer', name: '交互设计师', visualRole: '交互设计师' },
  { id: 'persona-qa', name: '测试工程师', visualRole: '测试工程师' },
  { id: 'persona-ops', name: '运营策划', visualRole: '运营策划' },
  { id: 'persona-data', name: '数据分析师', visualRole: '数据分析师' },
  { id: 'persona-frontend', name: '前端工程师', visualRole: '前端工程师' },
  { id: 'persona-backend', name: '后端工程师', visualRole: '后端工程师' },
  { id: 'persona-intern', name: '实习生', visualRole: '实习生' },
];

const OFFICE_STATIONS = [
  { role: '前端工程师', x: 10, y: 21 },
  { role: '后端工程师', x: 25, y: 21 },
  { role: '代码工程师', x: 40, y: 21 },
  { role: '测试工程师', x: 56, y: 21 },
  { role: '调研分析', x: 72, y: 21 },
  { role: '产品经理', x: 18, y: 58 },
  { role: '交互设计师', x: 34, y: 58 },
  { role: '文档策划', x: 50, y: 58 },
  { role: '运营策划', x: 66, y: 58 },
  { role: '开发经理', x: 83, y: 58 },
  { role: '数据分析师', x: 82, y: 22 },
  { role: '实习生', x: 6, y: 58 },
];

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
        <option value="manager-orchestrate" ${ (item.strategy || '') === 'manager-orchestrate' ? 'selected' : '' }>manager-orchestrate</option>
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
  renderRoleplaySelect();
  renderTraces();
  renderWorkflowFlow('idle');
}

function roleplayPersona() {
  return ROLEPLAY_PERSONAS.find((p) => p.id === state.roleplayPersonaId) || null;
}

function roleplayAgentName() {
  return roleplayPersona()?.visualRole || '';
}

function roleplayDisplayName() {
  return roleplayPersona()?.name || '';
}

function renderRoleplaySelect() {
  if (!els.roleplayAgentSelect) return;
  if (!state.roleplayPersonaId || !ROLEPLAY_PERSONAS.some((p) => p.id === state.roleplayPersonaId)) {
    state.roleplayPersonaId = ROLEPLAY_PERSONAS[0].id;
  }
  els.roleplayAgentSelect.innerHTML = ROLEPLAY_PERSONAS.map((p) => `<option value="${p.id}" ${p.id === state.roleplayPersonaId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
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
  const userRoleName = roleplayDisplayName() || '员工';
  const userPrompt = `[用户扮演角色: ${userRoleName}] ${prompt}`;
  state.roleplayLastMessage = prompt;

  els.runBtn.disabled = true;
  els.cancelRunBtn.disabled = false;
  renderRunningCards(teamId, userRoleName, 'queued');
  renderWorkflowFlow('queued');
  setProgress('Queued...', 2, 0);
  try {
    setRunCards([{ role: userRoleName, body: prompt, kind: 'agent' }]);
    const { jobId } = await api('/api/run-async', {
      method: 'POST',
      body: JSON.stringify({ prompt: userPrompt, teamId }),
    });
    state.currentJobId = jobId;
    state.plannerShownForJob = null;
    const trace = await waitForJob(jobId);
    const cards = [];
    if (trace.orchestration?.reviewSummary) {
      cards.push({
        role: '系统',
        body: `完成率：${Math.round((trace.orchestration.reviewSummary.completion_rate || 0) * 100)}%`,
        kind: 'system',
        debug: JSON.stringify(trace.orchestration.reviewSummary, null, 2),
      });
    }
    cards.unshift({ role: userRoleName, body: prompt, kind: 'agent' });
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
    renderWorkflowFlow('orchestrate-complete', trace.orchestration, '开发经理');
    state.config.sessions = [trace, ...(state.config.sessions || [])].slice(0, 50);
    renderTraces();
    setProgress('Completed', 1, 1);
  } catch (err) {
    setRunCards([{ role: '系统', body: `Run failed: ${err.message}`, kind: 'system' }]);
    renderWorkflowFlow('failed', null, '');
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
    renderWorkflowFlow(job.phase || job.status, job.orchestration, job.currentAgent || '');
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

function renderWorkflowFlow(phase, orchestration, currentAgent = '') {
  const steps = [
    { key: 'plan', label: '规划' },
    { key: 'dispatch', label: '派发' },
    { key: 'execute', label: '执行' },
    { key: 'review', label: '审核' },
    { key: 'done', label: '完成' },
  ];
  const map = {
    idle: 0,
    queued: 0,
    planning: 0,
    'orchestrate-planning': 0,
    'orchestrate-dispatch': 1,
    'running-members': 2,
    'orchestrate-executing': 2,
    'manager-summarizing': 3,
    'orchestrate-review': 3,
    'orchestrate-complete': 4,
    completed: 4,
    failed: 0,
    cancelling: 2,
    cancelled: 2,
  };
  const activeIdx = map[phase] ?? 0;
  const doneIdx = phase === 'idle' ? -1 : (phase === 'failed' ? -1 : activeIdx - (['completed', 'orchestrate-complete'].includes(phase) ? 0 : 0));
  const pct = `${Math.max(0, Math.min(100, (activeIdx / (steps.length - 1)) * 100))}%`;
  const track = document.createElement('div');
  track.className = 'flow-track';
  track.style.setProperty('--flow-progress', pct);
  steps.forEach((s, i) => {
    const node = document.createElement('div');
    node.className = `flow-step ${i < activeIdx ? 'done' : ''} ${i === activeIdx ? 'active pulse' : ''}`.trim();
    const dot = document.createElement('div');
    dot.className = 'flow-dot';
    const label = document.createElement('div');
    label.className = 'flow-label';
    label.textContent = s.label;
    node.append(dot, label);
    track.appendChild(node);
  });
  const office = renderOfficeScene(phase, orchestration, currentAgent);
  const meta = document.createElement('div');
  meta.className = 'flow-meta';
  if (orchestration?.reviewSummary) {
    meta.textContent = `整体状态：${orchestration.reviewSummary.overall_status} · 完成率 ${Math.round((orchestration.reviewSummary.completion_rate || 0) * 100)}%`;
  } else {
    meta.textContent = `阶段：${phase || 'idle'}`;
  }
  els.workflowFlow.innerHTML = '';
  els.workflowFlow.append(office, track, meta);
}

function renderOfficeScene(phase, orchestration, currentAgent) {
  const root = document.createElement('div');
  root.className = 'office-scene';

  const roof = document.createElement('div');
  roof.className = 'office-roof';
  const floor = document.createElement('div');
  floor.className = 'office-floor';
  root.append(roof, floor);

  const zones = [
    { label: '研发区', left: 5, top: 13, width: 72, height: 24 },
    { label: '测试/数据区', left: 77, top: 13, width: 17, height: 24 },
    { label: '产品设计区', left: 8, top: 49, width: 65, height: 27 },
    { label: '管理区', left: 75, top: 49, width: 19, height: 27 },
    { label: '茶水区', left: 75, top: 77, width: 19, height: 9 },
  ];
  zones.forEach((z) => {
    const zone = document.createElement('div');
    zone.className = 'office-zone';
    zone.style.left = `${z.left}%`;
    zone.style.top = `${z.top}%`;
    zone.style.width = `${z.width}%`;
    zone.style.height = `${z.height}%`;
    zone.innerHTML = `<div class="zone-label">${z.label}</div>`;
    root.appendChild(zone);
  });

  [10, 27, 44].forEach((x) => {
    const w = document.createElement('div');
    w.className = 'office-window';
    w.style.left = `${x}%`;
    root.appendChild(w);
  });
  const door = document.createElement('div');
  door.className = 'office-door';
  root.appendChild(door);

  const stations = OFFICE_STATIONS;
  const playerRole = roleplayAgentName();
  const playerDisplayName = roleplayDisplayName();

  for (const s of stations) {
    const desk = document.createElement('div');
    desk.className = `office-desk ${playerRole === s.role ? 'player-desk' : ''}`.trim();
    desk.style.left = `${s.x}%`;
    desk.style.top = `${s.y}%`;
    const plateText = playerRole === s.role && playerDisplayName ? `${s.role}（你：${playerDisplayName}）` : s.role;
    desk.innerHTML = `<span class="desk-nameplate ${playerRole === s.role ? 'player-nameplate' : ''}">${plateText}</span>`;
    const monitor = document.createElement('div');
    monitor.className = 'office-monitor';
    monitor.style.left = '16px';
    monitor.style.top = '-10px';
    const cup = document.createElement('div');
    cup.className = 'office-cup';
    cup.style.right = '10px';
    cup.style.top = '-2px';
    const steam1 = document.createElement('div');
    steam1.className = 'steam';
    steam1.style.left = '2px';
    steam1.style.top = '-10px';
    const steam2 = document.createElement('div');
    steam2.className = 'steam s2';
    steam2.style.top = '-10px';
    cup.append(steam1, steam2);
    desk.append(monitor, cup);
    root.appendChild(desk);
  }

  const links = [
    { from: [20, 35], to: [44, 35], delay: '0s' },
    { from: [45, 35], to: [69, 35], delay: '.7s' },
    { from: [67, 38], to: [82, 69], delay: '1.2s' },
    { from: [82, 68], to: [18, 31], delay: '1.8s' },
  ];
  for (const l of links) {
    const orb = document.createElement('div');
    orb.className = `message-orb ${['orchestrate-executing', 'running-members', 'orchestrate-review', 'manager-summarizing'].includes(phase) ? 'fly' : ''}`.trim();
    orb.style.left = `${l.from[0]}%`;
    orb.style.top = `${l.from[1]}%`;
    orb.style.setProperty('--msg-delay', l.delay);
    orb.style.setProperty('--dx', `calc(${l.to[0] - l.from[0]} * 1%)`);
    orb.style.setProperty('--dy', `calc(${l.to[1] - l.from[1]} * 1%)`);
    root.appendChild(orb);
  }

  const phaseTaskText = workflowTaskText(phase, orchestration);
  for (const s of stations) {
    const worker = document.createElement('div');
    const active = currentAgent && s.role === currentAgent;
    const playerControlled = playerRole && s.role === playerRole;
    const moving = active || (phase || '').includes('orchestrate') || phase === 'running-members';
    const pathShiftX = active ? (s.role === '开发经理' ? -5 : 3) : (moving ? ((s.x % 2 ? 1.2 : -1.2)) : 0);
    const pathShiftY = active ? -2 : 0;
    const routeClass = (phase === 'orchestrate-review' && s.role !== '开发经理')
      ? 'route-to-manager'
      : ((phase === 'orchestrate-complete' && s.role !== '开发经理') ? 'route-back' : '');
    worker.className = `office-worker ${active ? 'active' : ''} ${playerControlled ? 'player-controlled' : ''} ${moving ? 'walking' : ''} ${routeClass}`.trim();
    worker.dataset.role = s.role;
    worker.title = `点击扮演：${s.role}`;
    worker.style.left = `${s.x + pathShiftX}%`;
    worker.style.top = `${s.y + 16 + pathShiftY}%`;
    worker.style.setProperty('--role-color', roleColor(s.role));
    worker.style.setProperty('--hair-color', roleHair(s.role));
    worker.style.setProperty('--outfit-color', roleOutfit(s.role));
    worker.style.setProperty('--hair-shape', roleHairShape(s.role));
    worker.style.setProperty('--bob-delay', `${(s.x % 7) / 10}s`);
    const avatar = roleAvatar(s.role);
    const bubbleText = playerControlled && state.roleplayLastMessage
      ? state.roleplayLastMessage
      : bubbleForRole(s.role, phaseTaskText, phase, active);
    const emotion = roleEmotion(s.role, phase, active);
    const typingClass = (bubbleText && (active || phase === 'orchestrate-review' || phase === 'orchestrate-planning')) ? 'typing' : '';
    const chars = Math.min(24, Math.max(6, Array.from(String(bubbleText || '')).length));
    worker.innerHTML = `
      <div class="worker-bubble ${bubbleText ? 'show' : ''} ${typingClass}" style="--chars:${chars}">${escapeHtml(bubbleText || '')}</div>
      <div class="worker-hair ${roleHairShape(s.role)}"></div>
      <div class="worker-head ${emotion}">
        <span class="face-eyes"></span>
        <span class="face-mouth"></span>
        <span class="face-mark">${avatar}</span>
      </div>
      <div class="worker-body"></div>
      <div class="worker-arm left"></div>
      <div class="worker-arm right"></div>
      <div class="worker-tea"></div>
      <div class="worker-legs"></div>
    `;
    root.appendChild(worker);
  }

  root.addEventListener('click', (e) => {
    const target = e.target.closest('.office-worker[data-role]');
    if (!target) return;
    const role = target.dataset.role;
    const persona = ROLEPLAY_PERSONAS.find((p) => p.visualRole === role);
    if (!persona) return;
    state.roleplayPersonaId = persona.id;
    if (els.roleplayAgentSelect) els.roleplayAgentSelect.value = persona.id;
    renderWorkflowFlow(phase || 'idle', orchestration, currentAgent || '');
  });

  return root;
}

function workflowTaskText(phase, orchestration) {
  if (orchestration?.plan?.tasks?.length) {
    return orchestration.plan.tasks.map((t) => `${t.id}:${t.task}`).join(' | ').slice(0, 140);
  }
  const map = {
    queued: '等待任务开始',
    planning: '拆解任务并分配成员',
    'orchestrate-planning': '开发经理正在拆解任务',
    'orchestrate-dispatch': '派发任务给各个工位',
    'orchestrate-executing': '成员执行子任务',
    'orchestrate-review': '开发经理审核完成度',
    'orchestrate-complete': '流程完成，汇总结果',
    'running-members': '并行执行中',
    'manager-summarizing': '开发经理汇总回答',
  };
  return map[phase] || `阶段：${phase || 'idle'}`;
}

function bubbleForRole(role, taskText, phase, active) {
  if (!active && !['orchestrate-planning', 'orchestrate-executing', 'orchestrate-review', 'running-members'].includes(phase)) return '';
  if (role === '开发经理' && (phase || '').includes('review')) return '逐个复查，确认完成度...';
  if (role === '开发经理' && (phase || '').includes('planning')) return '拆分任务并分派...';
  if (role === '开发经理' && (phase || '').includes('complete')) return '汇总完成，准备汇报。';
  if (active && role === '代码工程师') return '写代码中，顺便喝口茶...';
  if (active && role === '文档策划') return '整理文档，给经理发进度...';
  if (active && role === '调研分析') return '查资料中，正在回消息...';
  if (!active && role !== '开发经理' && phase === 'orchestrate-review') return '到经理桌前汇报...';
  if (active) return taskText || '处理中...';
  return (phase === 'orchestrate-executing' || phase === 'running-members') ? '收到任务，执行中...' : '';
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
      body: currentAgent === m.name ? '我正在处理这项任务...' : '等待轮到我...',
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

function roleHair(role) {
  return (ROLE_STYLE[role]?.hair) || '#7bdad0';
}

function roleOutfit(role) {
  return (ROLE_STYLE[role]?.outfit) || '#3d8f88';
}

function roleHairShape(role) {
  return (ROLE_STYLE[role]?.hairShape) || 'short';
}

function roleEmotion(role, phase, active) {
  if ((phase || '').includes('complete') && role === '开发经理') return 'done';
  if ((phase || '').includes('review')) return active ? 'talking' : 'thinking';
  if (active) return 'talking';
  if ((phase || '').includes('planning')) return role === '开发经理' ? 'thinking' : 'thinking';
  return 'neutral';
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
els.roleplayAgentSelect?.addEventListener('change', () => {
  state.roleplayPersonaId = els.roleplayAgentSelect.value;
  renderWorkflowFlow('idle', null, '');
});
els.openSettingsBtn?.addEventListener('click', () => {
  els.settingsDrawer?.classList.remove('hidden');
});
els.closeSettingsBtn?.addEventListener('click', () => {
  els.settingsDrawer?.classList.add('hidden');
});
els.settingsBackdrop?.addEventListener('click', () => {
  els.settingsDrawer?.classList.add('hidden');
});

loadConfig().catch((err) => {
  setRunOutput(`Init failed: ${err.message}`);
});
