const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'studio-config.json');
const jobs = new Map();
const jobProcesses = new Map();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const defaultState = {
  models: [
    {
      id: 'model-claude',
      name: 'Claude CLI',
      provider: 'claude',
      command: 'claude',
      argsTemplate: '-p "{{prompt}}"',
      enabled: true,
    },
    {
      id: 'model-codex',
      name: 'Codex CLI',
      provider: 'codex',
      command: 'codex',
      argsTemplate: 'exec "{{prompt}}"',
      enabled: true,
    },
    {
      id: 'model-gemini',
      name: 'Gemini CLI',
      provider: 'gemini',
      command: 'gemini',
      argsTemplate: '"{{prompt}}"',
      enabled: true,
    },
  ],
  agents: [
    {
      id: 'agent-manager',
      name: 'Manager Agent',
      role: 'manager',
      systemPrompt: 'Route the task to the best specialist and summarize results.',
      modelId: 'model-codex',
      routingMode: 'keyword',
    },
    {
      id: 'agent-code',
      name: 'Code Agent',
      role: 'specialist',
      systemPrompt: 'Handle code generation and debugging tasks.',
      modelId: 'model-codex',
      specialties: ['code', 'bug', 'debug', 'refactor', 'script'],
    },
    {
      id: 'agent-docs',
      name: 'Docs Agent',
      role: 'specialist',
      systemPrompt: 'Handle writing, docs, and planning tasks.',
      modelId: 'model-claude',
      specialties: ['doc', 'write', 'plan', 'summary', 'design'],
    },
    {
      id: 'agent-research',
      name: 'Research Agent',
      role: 'specialist',
      systemPrompt: 'Handle information gathering and comparisons.',
      modelId: 'model-gemini',
      specialties: ['research', 'compare', 'find', 'search'],
    },
  ],
  teams: [
    {
      id: 'team-default',
      name: 'Default Team',
      managerAgentId: 'agent-manager',
      memberAgentIds: ['agent-code', 'agent-docs', 'agent-research'],
      strategy: 'broadcast',
    },
  ],
  sessions: [],
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(defaultState, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}

function writeStore(next) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(next, null, 2), 'utf8');
}

function tokenizeArgs(template, prompt) {
  const resolved = (template || '').replaceAll('{{prompt}}', prompt);
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < resolved.length; i += 1) {
    const ch = resolved[i];
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function chooseAgent(prompt, team, store) {
  const manager = store.agents.find((a) => a.id === team.managerAgentId);
  const members = team.memberAgentIds
    .map((id) => store.agents.find((a) => a.id === id))
    .filter(Boolean);

  const lower = prompt.toLowerCase();
  let selected = members[0] || manager;
  let matchedKeyword = null;

  for (const agent of members) {
    const specialties = Array.isArray(agent.specialties) ? agent.specialties : [];
    const hit = specialties.find((k) => lower.includes(String(k).toLowerCase()));
    if (hit) {
      selected = agent;
      matchedKeyword = hit;
      break;
    }
  }

  return { manager, selected, matchedKeyword };
}

function getTeamMembers(team, store) {
  return (team.memberAgentIds || [])
    .map((id) => store.agents.find((a) => a.id === id))
    .filter(Boolean);
}

function setJob(jobId, patch) {
  const prev = jobs.get(jobId) || {};
  jobs.set(jobId, { ...prev, ...patch, updatedAt: new Date().toISOString() });
}

function registerJobChild(jobId, child) {
  if (!jobId || !child) return;
  const set = jobProcesses.get(jobId) || new Set();
  set.add(child);
  jobProcesses.set(jobId, set);
  child.on('close', () => {
    const current = jobProcesses.get(jobId);
    if (!current) return;
    current.delete(child);
    if (!current.size) jobProcesses.delete(jobId);
  });
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'job not found' };
  setJob(jobId, { cancelRequested: true, status: job.status === 'completed' ? 'completed' : 'cancelling', phase: 'cancelling' });
  const set = jobProcesses.get(jobId);
  if (set) {
    for (const child of set) {
      try { child.kill('SIGTERM'); } catch {}
    }
  }
  return { ok: true };
}

function parsePlannerOutput(text, validAgentIds) {
  const tagged = text.match(/BEGIN_PLAN([\s\S]*?)END_PLAN/i);
  if (tagged) {
    const block = tagged[1];
    const modeMatch = block.match(/mode\s*[:=]\s*(single-route|broadcast)/i);
    const agentMatch = block.match(/agent_id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
    const reasonMatch = block.match(/reason\s*[:=]\s*([^\n\r]+)/i);
    const mode = modeMatch ? modeMatch[1].toLowerCase() : 'broadcast';
    const agentId = agentMatch?.[1] || null;
    return {
      mode,
      agentId: validAgentIds.includes(agentId) ? agentId : null,
      reason: (reasonMatch?.[1] || '').trim(),
      plannerRaw: text.slice(0, 1000),
      parser: 'tagged',
    };
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const mode = parsed.mode === 'single-route' ? 'single-route' : 'broadcast';
      const agentId = validAgentIds.includes(parsed.agentId) ? parsed.agentId : null;
      return { mode, agentId, reason: String(parsed.reason || ''), plannerRaw: text.slice(0, 1000), parser: 'json' };
    } catch {}
  }
  return { mode: 'broadcast', agentId: null, reason: 'planner-unparseable', plannerRaw: text.slice(0, 1000), parser: 'fallback' };
}

async function planWithManager(prompt, team, store) {
  const manager = store.agents.find((a) => a.id === team.managerAgentId) || null;
  if (!manager) return { mode: 'broadcast', reason: 'no-manager' };
  const managerModel = store.models.find((m) => m.id === manager.modelId);
  if (!managerModel) return { mode: 'broadcast', reason: 'no-manager-model' };
  const members = getTeamMembers(team, store);
  const validAgentIds = members.map((m) => m.id);
  const membersDesc = members.map((m) => `${m.id}: ${m.name} (${(m.specialties || []).join(',') || 'none'})`).join('\n');
  const plannerPrompt = [
    `System: ${manager.systemPrompt || 'Plan routing.'}`,
    'Decide execution mode for this task.',
    'Reply using this exact template first (no markdown):',
    'BEGIN_PLAN',
    'mode=<single-route|broadcast>',
    'agent_id=<member-agent-id or none>',
    'reason=<short reason>',
    'END_PLAN',
    'If you also provide JSON after that, keep it consistent.',
    `Valid agent IDs: ${validAgentIds.join(', ') || '(none)'}`,
    `Members:\n${membersDesc}`,
    `User task: ${prompt}`,
  ].join('\n\n');
  const out = await runCliModel(managerModel, plannerPrompt, 30000);
  const text = `${out.stdout || ''}\n${out.stderr || ''}`;
  return parsePlannerOutput(text, validAgentIds);
}

function fallbackOrchestrationPlan(prompt, team, store) {
  const members = getTeamMembers(team, store);
  return {
    goal: prompt,
    planner: 'fallback',
    tasks: members.map((agent, idx) => ({
      id: `T${idx + 1}`,
      owner_agent_id: agent.id,
      owner_agent_name: agent.name,
      task: `${agent.name} 从其专业角度处理：${prompt}`,
      definition_of_done: ['给出明确回答', '说明关键依据/步骤', '说明风险或未完成项（如有）'],
    })),
  };
}

async function planOrchestrationWithManager(prompt, team, store) {
  const manager = store.agents.find((a) => a.id === team.managerAgentId) || null;
  const managerModel = manager ? store.models.find((m) => m.id === manager.modelId) : null;
  const fallback = fallbackOrchestrationPlan(prompt, team, store);
  if (!manager || !managerModel) return fallback;
  const members = getTeamMembers(team, store);
  const memberLines = members.map((m) => `${m.id}|${m.name}|${(m.specialties || []).join(',') || 'none'}`).join('\n');
  const planPrompt = [
    `System: ${manager.systemPrompt || ''}`,
    '你是开发经理，负责拆分任务并分配给团队成员。',
    '严格输出 JSON（不要 markdown）：',
    '{"goal":"...","tasks":[{"id":"T1","owner_agent_id":"agent-code","task":"...","definition_of_done":["..."]}]}',
    `成员列表（id|name|specialties）:\n${memberLines}`,
    `用户目标：${prompt}`,
  ].join('\n\n');
  const out = await runCliModel(managerModel, planPrompt, 30000);
  const text = `${out.stdout || ''}\n${out.stderr || ''}`;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ...fallback, plannerRaw: text.slice(0, 1000) };
  try {
    const parsed = JSON.parse(match[0]);
    const valid = new Set(members.map((m) => m.id));
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .filter((t) => valid.has(t.owner_agent_id))
      .map((t, i) => ({
        id: t.id || `T${i + 1}`,
        owner_agent_id: t.owner_agent_id,
        owner_agent_name: members.find((m) => m.id === t.owner_agent_id)?.name || t.owner_agent_id,
        task: String(t.task || '').trim() || fallback.tasks[i % Math.max(fallback.tasks.length, 1)]?.task || prompt,
        definition_of_done: Array.isArray(t.definition_of_done) && t.definition_of_done.length ? t.definition_of_done.map(String) : ['给出明确回答'],
      }));
    return { goal: String(parsed.goal || prompt), planner: 'manager', plannerRaw: text.slice(0, 1000), tasks: tasks.length ? tasks : fallback.tasks };
  } catch {
    return { ...fallback, plannerRaw: text.slice(0, 1000) };
  }
}

function parseWorkResult(text, task) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const p = JSON.parse(match[0]);
      return {
        task_id: p.task_id || task.id,
        status: ['done', 'partial', 'blocked', 'failed'].includes(p.status) ? p.status : 'partial',
        deliverables: Array.isArray(p.deliverables) ? p.deliverables.map(String) : [],
        evidence: Array.isArray(p.evidence) ? p.evidence.map(String) : [],
        risks: Array.isArray(p.risks) ? p.risks.map(String) : [],
        raw: text,
      };
    } catch {}
  }
  return {
    task_id: task.id,
    status: String(text || '').trim() ? 'partial' : 'failed',
    deliverables: [String(text || '').trim() || '(empty)'],
    evidence: [],
    risks: [],
    raw: text,
  };
}

function reviewWork(task, work) {
  const scoreMap = { done: 1, partial: 0.6, blocked: 0.2, failed: 0 };
  const score = scoreMap[work.status] ?? 0.5;
  const issues = [];
  if (!work.deliverables?.length) issues.push('缺少交付物');
  if (!work.evidence?.length) issues.push('缺少证据');
  if (work.status !== 'done') issues.push(`状态为${work.status}`);
  return { task_id: task.id, status: work.status, score, issues };
}

async function executeTeamRun({ team, prompt, store, onProgress, jobId }) {
  const emit = (patch) => onProgress && onProgress(patch);
  const isCancelled = () => Boolean(jobId && jobs.get(jobId)?.cancelRequested);
  const throwIfCancelled = () => {
    if (isCancelled()) throw new Error('run cancelled');
  };
  const startedAt = new Date().toISOString();
  let result;
  let route;
  let subRuns = [];
  const members = getTeamMembers(team, store);
  let strategy = team.strategy || 'single-route';
  let plannerDecision = null;

  if (strategy === 'manager-decide') {
    emit({ phase: 'planning', currentAgent: 'Manager Agent', progress: { current: 0, total: Math.max(members.length, 1) } });
    plannerDecision = await planWithManager(prompt, team, store);
    throwIfCancelled();
    strategy = plannerDecision.mode;
    emit({ plannerDecision });
  }

  if (strategy === 'manager-orchestrate') {
    route = {
      manager: store.agents.find((a) => a.id === team.managerAgentId) || null,
      selected: null,
      matchedKeyword: null,
      mode: 'manager-orchestrate',
    };
    emit({ phase: 'orchestrate-planning', currentAgent: route.manager?.name || '开发经理', progress: { current: 0, total: 4 } });
    const plan = await planOrchestrationWithManager(prompt, team, store);
    throwIfCancelled();
    emit({ orchestration: { plan }, phase: 'orchestrate-dispatch', progress: { current: 1, total: 4 } });

    const taskRuns = await Promise.all((plan.tasks || []).map(async (task) => {
      const agent = store.agents.find((a) => a.id === task.owner_agent_id);
      const model = agent ? store.models.find((m) => m.id === agent.modelId) : null;
      if (!agent || !model) {
        const work = { task_id: task.id, status: 'blocked', deliverables: [], evidence: [], risks: ['agent/model not found'], raw: '' };
        return { task, agentName: task.owner_agent_name || task.owner_agent_id, modelId: null, run: { ok: false, code: null, stdout: '', stderr: 'agent/model not found' }, work };
      }
      emit({ phase: 'orchestrate-executing', currentAgent: agent.name, progress: { current: 2, total: 4 } });
      const taskPrompt = [
        `System: ${agent.systemPrompt || ''}`,
        `Task ID: ${task.id}`,
        `Task: ${task.task}`,
        `Definition of Done:\n- ${(task.definition_of_done || []).join('\n- ')}`,
        '严格输出 JSON（不要 markdown）：',
        '{"task_id":"...","status":"done|partial|blocked|failed","deliverables":["..."],"evidence":["..."],"risks":["..."]}',
      ].join('\n\n');
      const run = await runCliModel(model, taskPrompt, 45000, { jobId });
      const work = parseWorkResult(run.stdout || run.stderr || '', task);
      return { task, agentName: agent.name, modelId: model.id, run, work };
    }));
    throwIfCancelled();

    const taskReviews = taskRuns.map((x) => reviewWork(x.task, x.work));
    const doneCount = taskReviews.filter((r) => r.status === 'done').length;
    const completion_rate = taskReviews.length ? Number((doneCount / taskReviews.length).toFixed(2)) : 0;
    const reviewSummary = {
      overall_status: completion_rate === 1 ? 'done' : (completion_rate > 0 ? 'partial' : 'failed'),
      completion_rate,
      task_reviews: taskReviews,
      next_actions: taskReviews
        .filter((r) => r.status !== 'done')
        .map((r) => {
          const tr = taskRuns.find((x) => x.task.id === r.task_id);
          return { task_id: r.task_id, owner_agent_id: tr?.task.owner_agent_id, rework: (r.issues || []).join('；') || '补充交付和证据' };
        }),
    };

    emit({ phase: 'orchestrate-review', currentAgent: route.manager?.name || '开发经理', progress: { current: 3, total: 4 }, orchestration: { plan, reviewSummary } });

    subRuns = taskRuns.map((x) => ({
      agentId: x.task.owner_agent_id,
      agentName: x.agentName,
      modelId: x.modelId,
      ...(x.run || {}),
      task: x.task,
      structuredWork: x.work,
    }));
    result = {
      ok: reviewSummary.overall_status !== 'failed',
      code: 0,
      stdout: [
        `整体状态：${reviewSummary.overall_status}`,
        `完成率：${Math.round(reviewSummary.completion_rate * 100)}%`,
        ...taskRuns.map((x) => `${x.agentName}（${x.task.id}）：${x.work.status}`),
        ...(reviewSummary.next_actions.length ? ['返工建议：', ...reviewSummary.next_actions.map((n) => `${n.task_id} -> ${n.owner_agent_id}：${n.rework}`)] : ['全部任务已完成。']),
      ].join('\n'),
      stderr: '',
    };
    emit({ phase: 'orchestrate-complete', progress: { current: 4, total: 4 }, orchestration: { plan, reviewSummary } });

    const finishedAt = new Date().toISOString();
    return {
      startedAt,
      finishedAt,
      route: {
        managerAgentId: route.manager?.id || null,
        selectedAgentId: null,
        selectedAgentName: null,
        matchedKeyword: null,
        mode: route.mode,
        modelId: null,
        command: null,
        argsTemplate: null,
        plannerDecision: null,
      },
      orchestration: { plan, reviewSummary },
      subRuns,
      result,
    };
  }

  if (strategy === 'broadcast') {
    if (!members.length) throw new Error('no team members configured');
    route = {
      manager: store.agents.find((a) => a.id === team.managerAgentId) || null,
      selected: null,
      matchedKeyword: null,
      mode: 'broadcast',
    };
    emit({ phase: 'running-members', progress: { current: 0, total: members.length }, currentAgent: null });
    let completed = 0;
    const tasks = members.map(async (agent) => {
      emit({ currentAgent: agent.name });
      const model = store.models.find((m) => m.id === agent.modelId);
      if (!model) {
        completed += 1;
        emit({ progress: { current: completed, total: members.length } });
        return {
          agentId: agent.id, agentName: agent.name, modelId: agent.modelId, ok: false, code: null, stdout: '', stderr: `model not found for agent ${agent.name}`,
        };
      }
      const dispatchPrompt = [`System: ${agent.systemPrompt || ''}`, `User: ${prompt}`].join('\n\n');
      const subResult = await runCliModel(model, dispatchPrompt, 45000, { jobId });
      completed += 1;
      emit({ progress: { current: completed, total: members.length }, currentAgent: agent.name });
      return { agentId: agent.id, agentName: agent.name, modelId: model.id, command: model.command, argsTemplate: model.argsTemplate, ...subResult };
    });
    subRuns = await Promise.all(tasks);
    throwIfCancelled();

    const manager = route.manager;
    const managerModel = manager ? store.models.find((m) => m.id === manager.modelId) : null;
    if (manager && managerModel) {
      throwIfCancelled();
      emit({ phase: 'manager-summarizing', currentAgent: manager.name, progress: { current: members.length, total: members.length + 1 } });
      const synthesisPrompt = [
        `System: ${manager.systemPrompt || 'Summarize team outputs.'}`,
        `User task: ${prompt}`,
        '',
        'Team member outputs:',
        ...subRuns.map((r, i) => `#${i + 1} ${r.agentName} (${r.modelId})\nSTDOUT:\n${r.stdout || '(empty)'}\nSTDERR:\n${r.stderr || '(empty)'}`),
        '',
        'Provide a final concise answer for the user.',
      ].join('\n');
      result = await runCliModel(managerModel, synthesisPrompt, 45000, { jobId });
      throwIfCancelled();
      emit({ progress: { current: members.length + 1, total: members.length + 1 } });
    } else {
      const stitched = subRuns.map((r) => `[${r.agentName}] ${r.stdout || r.stderr || '(empty)'}`).join('\n\n');
      result = { ok: subRuns.every((r) => r.ok), code: 0, stdout: stitched, stderr: '' };
    }
  } else {
    route = chooseAgent(prompt, team, store);
    if (plannerDecision?.agentId) {
      const forced = members.find((m) => m.id === plannerDecision.agentId);
      if (forced) route.selected = forced;
    }
    if (!route.selected) throw new Error('no agent available in team');
    const model = store.models.find((m) => m.id === route.selected.modelId);
    if (!model) throw new Error(`model not found for agent ${route.selected.name}`);
    route.mode = 'single-route';
    route.modelId = model.id;
    route.command = model.command;
    route.argsTemplate = model.argsTemplate;
    emit({ phase: 'single-route', currentAgent: route.selected.name, progress: { current: 0, total: 1 } });
    const dispatchPrompt = [`System: ${route.selected.systemPrompt || ''}`, `User: ${prompt}`].join('\n\n');
    result = await runCliModel(model, dispatchPrompt, 45000, { jobId });
    throwIfCancelled();
    emit({ progress: { current: 1, total: 1 } });
  }

  const finishedAt = new Date().toISOString();
  return {
    startedAt,
    finishedAt,
    route: {
      managerAgentId: route.manager?.id || null,
      selectedAgentId: route.selected?.id || null,
      selectedAgentName: route.selected?.name || null,
      matchedKeyword: route.matchedKeyword,
      mode: route.mode || 'single-route',
      modelId: route.modelId || null,
      command: route.command || null,
      argsTemplate: route.argsTemplate || null,
      plannerDecision,
    },
    subRuns,
    result,
  };
}

function runCliModel(model, prompt, timeoutMs = 120000, options = {}) {
  return new Promise((resolve) => {
    const args = tokenizeArgs(model.argsTemplate, prompt);
    const child = spawn(model.command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    registerJobChild(options.jobId, child);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}\n[timeout after ${timeoutMs}ms]`.trim() });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}\n${err.message}`.trim() });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cancelled = code === null && options.jobId && jobs.get(options.jobId)?.cancelRequested;
      resolve({ ok: code === 0, code, stdout, stderr, cancelled });
    });
  });
}

app.get('/api/config', (_req, res) => {
  res.json(readStore());
});

app.put('/api/config', (req, res) => {
  const next = req.body;
  if (!next || typeof next !== 'object') {
    return res.status(400).json({ error: 'invalid config payload' });
  }
  writeStore(next);
  return res.json({ ok: true });
});

app.post('/api/model-test', async (req, res) => {
  const { modelId, prompt } = req.body || {};
  const store = readStore();
  const model = (store.models || []).find((m) => m.id === modelId);
  if (!model) return res.status(404).json({ error: 'model not found' });
  const testPrompt = typeof prompt === 'string' && prompt.trim()
    ? prompt.trim()
    : 'Reply with a single short line: MODEL_TEST_OK';
  const result = await runCliModel(model, testPrompt, 15000);
  res.json({ modelId, modelName: model.name, command: model.command, argsTemplate: model.argsTemplate, result });
});

app.post('/api/run', async (req, res) => {
  const { teamId, prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const store = readStore();
  const team = store.teams.find((t) => t.id === teamId) || store.teams[0];
  if (!team) return res.status(400).json({ error: 'no team configured' });

  let exec;
  try {
    exec = await executeTeamRun({ team, prompt, store });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const trace = {
    id: `run-${Date.now()}`,
    teamId: team.id,
    prompt,
    ...exec,
  };

  store.sessions = [trace, ...(store.sessions || [])].slice(0, 50);
  writeStore(store);

  res.json(trace);
});

app.post('/api/run-async', (req, res) => {
  const { teamId, prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });
  const store = readStore();
  const team = store.teams.find((t) => t.id === teamId) || store.teams[0];
  if (!team) return res.status(400).json({ error: 'no team configured' });
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  setJob(jobId, {
    id: jobId, status: 'running', phase: 'queued', teamId: team.id, prompt,
    progress: { current: 0, total: 1 }, currentAgent: null, createdAt: new Date().toISOString(),
  });
  executeTeamRun({
    team, prompt, store, jobId,
    onProgress: (patch) => setJob(jobId, patch),
  }).then((exec) => {
    const trace = { id: `run-${Date.now()}`, teamId: team.id, prompt, ...exec };
    const latest = readStore();
    latest.sessions = [trace, ...(latest.sessions || [])].slice(0, 50);
    writeStore(latest);
    setJob(jobId, { status: jobs.get(jobId)?.cancelRequested ? 'cancelled' : 'completed', trace });
  }).catch((err) => {
    setJob(jobId, { status: jobs.get(jobId)?.cancelRequested ? 'cancelled' : 'failed', error: err.message });
  });
  res.json({ jobId });
});

app.get('/api/run-status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

app.post('/api/run-cancel/:jobId', (req, res) => {
  const out = cancelJob(req.params.jobId);
  if (!out.ok) return res.status(404).json(out);
  res.json(out);
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  ensureStore();
  console.log(`Agent Studio MVP running at http://localhost:${PORT}`);
});
