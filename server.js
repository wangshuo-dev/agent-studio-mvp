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
