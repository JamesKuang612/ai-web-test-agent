const state = { cases: [], selected: null, detail: null, job: null, busy: false };

const $ = (selector) => document.querySelector(selector);
const STATUS_LABELS = {
  EXPLORING: '探索中',
  EXPLORED: '已探索',
  GENERATING_SCRIPT: '正在生成 Playwright 脚本',
  GENERATING_FAITHFUL: '正在生成忠实回放',
  FAITHFUL_READY: '忠实回放已就绪',
  GENERATING_OPTIMIZED: '正在生成收敛回放',
  CONVERGING: '收敛中',
  COMPILING: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
  PASS: '通过',
  FAIL: '未通过',
  PENDING: '待生成',
  DRAFT: '未验证',
  GENERATING: '生成中',
  VALIDATED: '已验证',
  INVALID: '验证失败',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
};
const ACTION_LABELS = {
  explore: '智能体探索',
  generate: '生成 Playwright 脚本',
  faithful: '生成忠实回放',
  optimize: '生成收敛回放',
  converge: '旧版连续生成',
  compile: '探索并收敛',
  agent: '重新智能体探索',
  script: '零模型重放',
  conservative: '零模型重放忠实脚本',
  optimized: '零模型重放收敛脚本',
};
const MODEL_LABELS = {
  'gpt-5.6-terra': '5.6 Terra',
  'gpt-5.6-sol': '5.6 Sol',
  'gpt-5.6-luna': '5.6 Luna',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision',
};
const REASONING_LABELS = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
};
const GPT_REASONING_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中（推荐）' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: '最大' },
];
const DEEPSEEK_REASONING_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'high', label: '高（推荐）' },
  { value: 'max', label: '最大' },
];
const DEEPSEEK_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
]);

/** 根据模型切换可用的推理强度选项，并修正不兼容的当前值。 */
function syncReasoningOptions(prefix, preferredValue = null) {
  const modelSelect = $(`#${prefix}-model`);
  const reasoningSelect = $(`#${prefix}-reasoning`);
  const options = DEEPSEEK_MODELS.has(modelSelect.value)
    ? DEEPSEEK_REASONING_OPTIONS
    : GPT_REASONING_OPTIONS;
  const currentValue = preferredValue ?? reasoningSelect.value;
  reasoningSelect.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
  reasoningSelect.value = options.some(({ value }) => value === currentValue)
    ? currentValue
    : DEEPSEEK_MODELS.has(modelSelect.value)
      ? 'high'
      : 'medium';
}

/** 生成便于本地识别且不重复的默认用例 ID。 */
function newCaseId() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `case-${stamp}`;
}

/** 将内部英文状态转换为用户可读的中文。 */
function statusLabel(value) {
  return STATUS_LABELS[value] || value || '—';
}

/** 返回状态对应的颜色类名。 */
function statusClass(value = '') {
  const normalized = String(value).toLowerCase();
  if (['validated', 'completed', 'pass', 'explored', 'faithful_ready'].includes(normalized)) return 'valid';
  if (normalized === 'draft') return 'draft';
  if (normalized.startsWith('generating')) return 'running';
  return normalized;
}

/** 返回当前下拉框选择的模型配置。 */
function selectedConfig(prefix) {
  return {
    model: $(`#${prefix}-model`).value,
    reasoningEffort: $(`#${prefix}-reasoning`).value,
  };
}

/** 将已保存的模型配置转换为紧凑中文。 */
function configLabel(config) {
  if (!config) return '旧资产，未记录';
  return `${MODEL_LABELS[config.model] || config.model} / ${REASONING_LABELS[config.reasoningEffort] || config.reasoningEffort}`;
}

/** 设置一个状态徽标的中文文案与颜色。 */
function setStatus(element, value) {
  element.textContent = statusLabel(value);
  element.className = `status ${statusClass(value) || 'neutral'}`;
}

/** 将毫秒转换为紧凑的可读耗时。 */
function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 发送 JSON 请求并统一处理服务端错误。 */
async function api(url, options) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '请求失败');
  return value;
}

/** 控制全局忙碌状态并同步主要操作按钮。 */
function setBusy(busy, message = '就绪') {
  state.busy = busy;
  $('#create-button').disabled = busy;
  $('#explore-button').disabled = busy;
  setStatus($('#global-status'), busy ? 'running' : message);
  if (state.detail) renderActions(state.detail.manifest);
}

/** 渲染测试用例列表卡片。 */
function renderCaseList() {
  const container = $('#case-list');
  container.replaceChildren();
  $('#case-count').textContent = `${state.cases.length} 个测试用例`;
  $('#list-empty').classList.toggle('hidden', state.cases.length > 0);
  for (const item of state.cases) {
    const card = document.createElement('button');
    card.className = 'case-card';
    card.type = 'button';

    const heading = document.createElement('div');
    heading.className = 'case-card-heading';
    const title = document.createElement('strong');
    title.textContent = item.caseId;
    const badge = document.createElement('span');
    setStatus(badge, item.pipelineStatus);
    heading.append(title, badge);

    const text = document.createElement('p');
    text.textContent = item.instruction.replaceAll('\n', ' ');
    const meta = document.createElement('div');
    meta.className = 'case-meta';
    meta.textContent = `Playwright 脚本：${statusLabel(item.script)}　更新：${new Date(item.updatedAt).toLocaleString()}`;
    card.append(heading, text, meta);
    card.addEventListener('click', () => {
      location.hash = `#/cases/${encodeURIComponent(item.caseId)}`;
    });
    container.append(card);
  }
}

/** 从本地服务刷新测试用例列表。 */
async function refreshCases() {
  state.cases = await api('/api/cases');
  renderCaseList();
}

/** 渲染按真实执行顺序保存的 MCP 工具轨迹。 */
function renderTrace(trace) {
  const container = $('#trace-list');
  container.replaceChildren();
  $('#trace-count').textContent = `（${trace.length} 条）`;
  if (!trace.length) {
    container.textContent = '暂无探索工具轨迹。';
    return;
  }
  for (const item of trace) {
    const row = document.createElement('div');
    row.className = 'trace-row';
    for (const value of [
      `#${item.sequence}`,
      item.tool,
      JSON.stringify(item.arguments),
      statusLabel(item.status),
    ]) {
      const cell = document.createElement('span');
      cell.textContent = value;
      row.append(cell);
    }
    container.append(row);
  }
}

/** 渲染 Agent 探索和零模型重放历史。 */
function renderRuns(runs) {
  const container = $('#run-list');
  container.replaceChildren();
  if (!runs.length) {
    container.textContent = '暂无执行记录。';
    return;
  }
  for (const run of [...runs].reverse()) {
    const row = document.createElement('div');
    row.className = 'run-row';
    for (const value of [
      ACTION_LABELS[run.mode] || run.mode,
      statusLabel(run.status),
      formatDuration(run.durationMs),
      new Date(run.runAt).toLocaleString(),
    ]) {
      const cell = document.createElement('span');
      cell.textContent = value;
      row.append(cell);
    }
    container.append(row);
  }
}

/** 根据 case 当前状态启用或禁用详情页操作。 */
function renderActions(manifest) {
  const explored = manifest.explore?.status === 'PASS';
  const script = manifest.script.status === 'VALIDATED';
  $('#agent-button').disabled = state.busy;
  $('#generate-button').disabled = state.busy || !explored;
  $('#generate-button').textContent = script ? '重新生成 Playwright 脚本' : '生成 Playwright 脚本';
  $('#script-replay-button').disabled = state.busy || !script;
}

/** 将一个测试用例的完整本地资产渲染到详情页。 */
function renderDetail(data) {
  state.detail = data;
  const manifest = data.manifest;
  $('#detail-id').textContent = manifest.caseId;
  $('#detail-instruction').textContent = manifest.originalInstruction;
  setStatus($('#pipeline-status'), manifest.pipelineStatus);
  setStatus($('#explore-status'), manifest.explore?.status);
  $('#mcp-count').textContent = manifest.explore?.mcpCalls ?? '—';
  $('#thread-id').textContent = manifest.threadId?.slice(0, 13) || '—';
  $('#thread-id').title = manifest.threadId || '';
  $('#explore-model').textContent = configLabel(manifest.explore?.agentConfig);
  if (manifest.explore?.agentConfig) {
    $('#detail-model').value = manifest.explore.agentConfig.model;
    syncReasoningOptions('detail', manifest.explore.agentConfig.reasoningEffort);
  } else {
    syncReasoningOptions('detail');
  }
  $('#final-result').textContent =
    manifest.explore?.finalResponse || manifest.pipelineError || '尚无探索结果。';
  $('#script-config').textContent = `生成配置：${configLabel(manifest.script.agentConfig)}`;
  setStatus($('#script-status'), manifest.script.status);
  $('#script-source').textContent = data.scriptSource || '尚未生成。';
  renderTrace(data.trace);
  renderRuns(manifest.runs);
  renderActions(manifest);
}

/** 读取并显示指定用例详情。 */
async function loadDetail(caseId) {
  state.selected = caseId;
  renderDetail(await api(`/api/cases/${encodeURIComponent(caseId)}`));
}

/** 根据 URL hash 在用例列表与用例详情之间切换。 */
async function route() {
  const match = location.hash.match(/^#\/cases\/(.+)$/);
  const isDetail = Boolean(match);
  $('#list-view').classList.toggle('hidden', isDetail);
  $('#detail-view').classList.toggle('hidden', !isDetail);
  if (match?.[1]) {
    await loadDetail(decodeURIComponent(match[1]));
  } else {
    state.selected = null;
    state.detail = null;
    await refreshCases();
  }
}

/** 轮询一个后台任务，并在完成后刷新对应测试用例。 */
async function watchJob(job) {
  state.job = job;
  $('#job-drawer').classList.remove('hidden');
  $('#job-title').textContent = `${ACTION_LABELS[job.action] || job.action} · ${job.caseId}`;
  setStatus($('#job-status'), job.status);
  setBusy(true);
  while (job.status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    job = await api(`/api/jobs/${job.id}`);
    setStatus($('#job-status'), job.status);
    const output = $('#job-output');
    output.textContent = job.output || '任务已启动，等待输出……';
    output.scrollTop = output.scrollHeight;
  }
  setBusy(false, job.status === 'completed' ? 'PASS' : 'FAIL');
  await refreshCases();
  location.hash = `#/cases/${encodeURIComponent(job.caseId)}`;
  await loadDetail(job.caseId);
}

/** 提交自然语言用例并仅启动 Agent Explore 阶段。 */
async function submitExplore(event) {
  event.preventDefault();
  const caseId = $('#case-id').value.trim();
  const instruction = $('#instruction').value.trim();
  if (!caseId || !instruction) return alert('请填写用例 ID 和自然语言测试用例。');
  try {
    const job = await api('/api/explore', {
      method: 'POST',
      body: JSON.stringify({ caseId, instruction, ...selectedConfig('create') }),
    });
    $('#create-dialog').close();
    await watchJob(job);
    $('#case-id').value = newCaseId();
    $('#instruction').value = '';
  } catch (error) {
    setBusy(false, 'FAIL');
    alert(error.message);
  }
}

/** 恢复原探索会话并让 Codex 定向校准后生成 Playwright 脚本。 */
async function generateScript() {
  if (!state.selected) return;
  try {
    const job = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ caseId: state.selected, ...selectedConfig('detail') }),
    });
    await watchJob(job);
  } catch (error) {
    setBusy(false, 'FAIL');
    alert(error.message);
  }
}

/** 运行当前用例的 Agent 模式或已验证 Playwright 脚本。 */
async function run(mode) {
  if (!state.selected) return;
  try {
    const job = await api('/api/run', {
      method: 'POST',
      body: JSON.stringify({ caseId: state.selected, mode, ...selectedConfig('detail') }),
    });
    await watchJob(job);
  } catch (error) {
    setBusy(false, 'FAIL');
    alert(error.message);
  }
}

$('#home-button').addEventListener('click', () => {
  location.hash = '#/';
});
$('#back-button').addEventListener('click', () => {
  location.hash = '#/';
});
$('#create-button').addEventListener('click', () => $('#create-dialog').showModal());
$('#dialog-close').addEventListener('click', () => $('#create-dialog').close());
$('#cancel-button').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', submitExplore);
$('#refresh-button').addEventListener('click', refreshCases);
$('#generate-button').addEventListener('click', generateScript);
$('#script-replay-button').addEventListener('click', () => run('script'));
$('#agent-button').addEventListener('click', () => run('agent'));
$('#job-close').addEventListener('click', () => $('#job-drawer').classList.add('hidden'));
for (const prefix of ['create', 'detail']) {
  $(`#${prefix}-model`).addEventListener('change', () => syncReasoningOptions(prefix));
  syncReasoningOptions(prefix);
}
window.addEventListener('hashchange', () => route().catch((error) => alert(error.message)));

$('#case-id').value = newCaseId();
route().catch((error) => alert(error.message));
