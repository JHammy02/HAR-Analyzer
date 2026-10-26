import { parseHarContent } from './har-parser.js';
import { summarizeHar, buildOverviewCards, analyzePerformance, computeFlowRows, compareHarSets } from './har-analysis.js';
import { applyFilters, getSelectableFilterValues } from './filters.js';
import { bytesToString, msToString, escapeHtml } from './formatters.js';
import { redactUrlValue, shouldRedactHeader } from './security.js';

const state = {
  entries: [],
  filteredEntries: [],
  selectedEntry: null,
  sortKey: 'startTime',
  sortDir: 'desc',
  filters: {
    search: '',
    type: 'all',
    statusFamily: 'all',
    method: 'all',
    domain: 'all',
    mime: 'all',
    minDuration: '',
    minSize: '',
    cache: 'all',
    errorsOnly: false
  },
  redacted: false,
  compare: { baseline: null, comparison: null }
};

const elements = {
  fileInput: document.getElementById('fileInput'),
  baselineInput: document.getElementById('baselineInput'),
  comparisonInput: document.getElementById('comparisonInput'),
  openHarBtn: document.getElementById('openHarBtn'),
  clearHarBtn: document.getElementById('clearHarBtn'),
  filenameBadge: document.getElementById('filenameBadge'),
  totalRequestsValue: document.getElementById('totalRequestsValue'),
  totalTransferredValue: document.getElementById('totalTransferredValue'),
  totalDurationValue: document.getElementById('totalDurationValue'),
  searchInput: document.getElementById('searchInput'),
  redactToggle: document.getElementById('redactToggle'),
  typeFilter: document.getElementById('typeFilter'),
  statusFilter: document.getElementById('statusFilter'),
  methodFilter: document.getElementById('methodFilter'),
  domainFilter: document.getElementById('domainFilter'),
  mimeFilter: document.getElementById('mimeFilter'),
  minDurationFilter: document.getElementById('minDurationFilter'),
  minSizeFilter: document.getElementById('minSizeFilter'),
  cacheFilter: document.getElementById('cacheFilter'),
  errorsOnlyToggle: document.getElementById('errorsOnlyToggle'),
  overviewPanel: document.getElementById('overviewPanel'),
  overviewGrid: document.getElementById('overviewGrid'),
  resultsSummary: document.getElementById('resultsSummary'),
  tableHeaders: document.getElementById('tableHeaders'),
  tableBody: document.getElementById('tableBody'),
  inspectorContent: document.getElementById('inspectorContent'),
  comparePanel: document.getElementById('comparePanel'),
  compareContent: document.getElementById('compareContent'),
  loadBaselineBtn: document.getElementById('loadBaselineBtn'),
  loadComparisonBtn: document.getElementById('loadComparisonBtn'),
  toggleCompareBtn: document.getElementById('toggleCompareBtn')
};

function initialize() {
  bindEvents();
  createHeaderRow();
  renderEmptyState();
  renderInspector();
  window.addEventListener('keydown', handleGlobalKeys);
  document.body.addEventListener('dragover', (event) => {
    event.preventDefault();
    document.body.classList.add('dragging');
  });
  document.body.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
  document.body.addEventListener('drop', (event) => {
    event.preventDefault();
    document.body.classList.remove('dragging');
    const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
    if (files.length) handleFiles(files);
  });
}

function bindEvents() {
  elements.openHarBtn.addEventListener('click', () => elements.fileInput.click());
  elements.clearHarBtn.addEventListener('click', resetHar);
  elements.fileInput.addEventListener('change', (event) => handleFiles(Array.from(event.target.files || [])));
  elements.searchInput.addEventListener('input', (event) => {
    state.filters.search = event.target.value.trim();
    renderFilteredTable();
  });
  elements.redactToggle.addEventListener('change', (event) => {
    state.redacted = event.target.checked;
    renderFilteredTable();
    renderInspector();
  });

  elements.typeFilter.addEventListener('change', updateFilterState);
  elements.statusFilter.addEventListener('change', updateFilterState);
  elements.methodFilter.addEventListener('change', updateFilterState);
  elements.domainFilter.addEventListener('change', updateFilterState);
  elements.mimeFilter.addEventListener('change', updateFilterState);
  elements.minDurationFilter.addEventListener('input', updateFilterState);
  elements.minSizeFilter.addEventListener('input', updateFilterState);
  elements.cacheFilter.addEventListener('change', updateFilterState);
  elements.errorsOnlyToggle.addEventListener('change', updateFilterState);

  elements.loadBaselineBtn.addEventListener('click', () => elements.baselineInput.click());
  elements.loadComparisonBtn.addEventListener('click', () => elements.comparisonInput.click());
  elements.baselineInput.addEventListener('change', (event) => handleComparisonInput(event.target.files, 'baseline'));
  elements.comparisonInput.addEventListener('change', (event) => handleComparisonInput(event.target.files, 'comparison'));
  elements.toggleCompareBtn.addEventListener('click', () => {
    const isCollapsed = elements.comparePanel.classList.toggle('collapsed');
    elements.toggleCompareBtn.textContent = isCollapsed ? 'Show comparison' : 'Hide';
    elements.toggleCompareBtn.setAttribute('aria-expanded', String(!isCollapsed));
  });

  const inspectorHandle = document.getElementById('inspectorResizeHandle');
  inspectorHandle.addEventListener('mousedown', startInspectorResize);
}

function handleGlobalKeys(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    elements.searchInput.focus();
    elements.searchInput.select();
  }

  if (event.key === 'Escape') {
    if (document.activeElement === elements.searchInput && elements.searchInput.value) {
      elements.searchInput.value = '';
      state.filters.search = '';
      renderFilteredTable();
      return;
    }
    if (state.selectedEntry) {
      state.selectedEntry = null;
      renderInspector();
      renderFilteredTable();
    }
  }
}

function startInspectorResize(event) {
  const panel = document.querySelector('.inspector-panel');
  if (!panel) return;

  event.preventDefault();
  const startX = event.clientX;
  const startWidth = panel.getBoundingClientRect().width;
  const minWidth = 320;
  const maxWidth = Math.max(420, Math.min(window.innerWidth * 0.6, 700));

  const onMove = (moveEvent) => {
    const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (startX - moveEvent.clientX)));
    panel.style.width = `${nextWidth}px`;
    panel.style.flexBasis = `${nextWidth}px`;
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.userSelect = '';
  };

  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function createHeaderRow() {
  const columns = ['Status', 'Method', 'Name', 'Host', 'Path', 'Type', 'Size', 'Time', 'Started', 'Protocol', 'Waterfall'];
  elements.tableHeaders.innerHTML = columns
    .map((label) => `<th data-key="${normalizeHeaderKey(label)}">${label}</th>`)
    .join('');

  elements.tableHeaders.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', () => handleSort(th.dataset.key));
  });
}

function normalizeHeaderKey(label) {
  const map = {
    Status: 'status',
    Method: 'method',
    Name: 'name',
    Host: 'host',
    Path: 'path',
    Type: 'resourceType',
    Size: 'transferSize',
    Time: 'time',
    Started: 'startTime',
    Protocol: 'httpVersion',
    Waterfall: 'waterfall'
  };
  return map[label] || label;
}

function handleSort(key) {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = ['startTime', 'time', 'transferSize'].includes(key) ? 'desc' : 'asc';
  }
  renderFilteredTable();
}

async function handleFiles(files) {
  const file = files[0];
  if (!file) return;
  const text = await file.text();
  openHarText(text, file.name);
}

async function handleComparisonInput(files, role) {
  const file = files && files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseHarContent(text);
    state.compare[role] = parsed.entries;
    renderComparePanel();
  } catch (error) {
    alert(`Could not parse comparison HAR: ${error.message}`);
  }
}

function openHarText(text, name) {
  try {
    const parsed = parseHarContent(text);
    state.entries = parsed.entries;
    state.filteredEntries = parsed.entries;
    state.selectedEntry = null;
    state.filters = {
      search: '',
      type: 'all',
      statusFamily: 'all',
      method: 'all',
      domain: 'all',
      mime: 'all',
      minDuration: '',
      minSize: '',
      cache: 'all',
      errorsOnly: false
    };
    elements.filenameBadge.textContent = name;
    elements.searchInput.value = '';
    elements.redactToggle.checked = false;
    state.redacted = false;
    resetFilterControls();
    renderOverview();
    renderFilteredTable();
    renderInspector();
    renderComparePanel();
  } catch (error) {
    alert(error.message);
  }
}

function resetHar() {
  state.entries = [];
  state.filteredEntries = [];
  state.selectedEntry = null;
  elements.filenameBadge.textContent = 'No HAR loaded';
  elements.totalRequestsValue.textContent = '0';
  elements.totalTransferredValue.textContent = '0 B';
  elements.totalDurationValue.textContent = '0 ms';
  elements.resultsSummary.textContent = 'Showing 0 of 0 requests';
  elements.compareContent.innerHTML = '';
  elements.overviewPanel.classList.remove('visible');
  elements.tableBody.innerHTML = '';
  renderEmptyState();
  renderInspector();
}

function resetFilterControls() {
  elements.typeFilter.value = 'all';
  elements.statusFilter.value = 'all';
  elements.methodFilter.value = 'all';
  elements.domainFilter.value = 'all';
  elements.mimeFilter.value = 'all';
  elements.minDurationFilter.value = '';
  elements.minSizeFilter.value = '';
  elements.cacheFilter.value = 'all';
  elements.errorsOnlyToggle.checked = false;
}

function updateFilterState() {
  state.filters.type = elements.typeFilter.value;
  state.filters.statusFamily = elements.statusFilter.value;
  state.filters.method = elements.methodFilter.value;
  state.filters.domain = elements.domainFilter.value;
  state.filters.mime = elements.mimeFilter.value;
  state.filters.minDuration = elements.minDurationFilter.value;
  state.filters.minSize = elements.minSizeFilter.value;
  state.filters.cache = elements.cacheFilter.value;
  state.filters.errorsOnly = elements.errorsOnlyToggle.checked;
  renderFilteredTable();
}

function renderOverview() {
  const summary = summarizeHar(state.entries);
  const cards = buildOverviewCards(summary);
  elements.overviewGrid.innerHTML = cards.map((item) => `
    <div class="overview-card">
      <h4>${escapeHtml(item.title)}</h4>
      <div class="metric">${escapeHtml(item.value)}</div>
      <div class="submetric">${escapeHtml(item.sub)}</div>
    </div>
  `).join('');

  const insights = analyzePerformance(state.entries);
  const insightText = [
    insights.slowRequests.length ? `Slowest: ${insights.slowRequests[0].label}` : 'No slow requests detected',
    insights.failedRequests.length ? `Failed: ${insights.failedRequests.length} requests` : 'No failed requests',
    insights.duplicates.length ? `Duplicates: ${insights.duplicates[0].count} repeats` : 'No duplicate URLs',
    summary.domainCounts.length ? `${summary.domainCounts[0].host}: ${summary.domainCounts[0].count} reqs` : 'No domains'
  ].join(' • ');

  elements.overviewGrid.insertAdjacentHTML('beforeend', `
    <div class="overview-card">
      <h4>Insights</h4>
      <div class="metric" style="font-size:15px; line-height:1.5;">${escapeHtml(insightText)}</div>
    </div>
  `);

  elements.overviewPanel.classList.add('visible');
  elements.totalRequestsValue.textContent = summary.totalRequests.toLocaleString();
  elements.totalTransferredValue.textContent = bytesToString(summary.totalTransferred);
  elements.totalDurationValue.textContent = msToString(summary.captureDuration);
  renderFilterOptions();
}

function renderFilterOptions() {
  const { domains, mimeTypes } = getSelectableFilterValues(state.entries);
  populateSelect(elements.domainFilter, ['all', ...domains], 'all', 'All domains');
  populateSelect(elements.mimeFilter, ['all', ...mimeTypes], 'all', 'All MIME');
}

function populateSelect(selectElement, options, defaultValue, placeholder) {
  const currentValue = selectElement.value;
  selectElement.innerHTML = '';
  const placeholderOption = document.createElement('option');
  placeholderOption.value = 'all';
  placeholderOption.textContent = placeholder;
  selectElement.appendChild(placeholderOption);

  options.filter((option) => option !== 'all').forEach((option) => {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.textContent = option;
    selectElement.appendChild(optionElement);
  });

  selectElement.value = options.includes(currentValue) ? currentValue : defaultValue;
}

function renderFilteredTable() {
  if (!state.entries.length) {
    renderEmptyState();
    return;
  }

  const filtered = sortEntries(applyFilters(state.entries, state.filters));
  state.filteredEntries = filtered;
  elements.resultsSummary.textContent = `Showing ${filtered.length} of ${state.entries.length} requests`;
  elements.tableBody.innerHTML = '';

  const maxDuration = filtered.reduce((largest, entry) => Math.max(largest, Number(entry.time || 0)), 0);
  const minStart = Math.min(...state.entries.map((entry) => Number(entry.startTime || 0)));

  filtered.forEach((entry) => {
    const row = document.createElement('tr');
    row.className = state.selectedEntry && state.selectedEntry.index === entry.index ? 'selected' : '';
    row.addEventListener('click', () => {
      state.selectedEntry = entry;
      renderFilteredTable();
      renderInspector();
    });

    const startedOffset = Number(entry.startTime || 0) - minStart;
    const width = maxDuration > 0 ? (Number(entry.time || 0) / maxDuration) * 100 : 0;
    const statusClass = getStatusClass(entry.status);
    const statusText = entry.status ? String(entry.status) : 'ERR';

    row.innerHTML = `
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span></td>
      <td><span class="method-badge">${escapeHtml((entry.method || 'GET').toUpperCase())}</span></td>
      <td>
        <div class="name-cell">
          <div class="name-main">${escapeHtml(getRequestName(entry.url))}</div>
          <div class="name-sub">${escapeHtml(shortenUrl(entry.url))}</div>
        </div>
      </td>
      <td>${escapeHtml(entry.host || '')}</td>
      <td>${escapeHtml(entry.path || '')}</td>
      <td>${escapeHtml(entry.resourceType || 'other')}</td>
      <td>${escapeHtml(bytesToString(Number(entry.transferSize || entry.content?.size || 0)))}</td>
      <td>${escapeHtml(msToString(Number(entry.time || 0)))}</td>
      <td>${escapeHtml(msToString(startedOffset))}</td>
      <td>${escapeHtml(entry.httpVersion || 'HTTP/1.1')}</td>
      <td class="waterfall-cell">
        <div class="waterfall-box" title="${escapeHtml(msToString(Number(entry.time || 0)))}">
          ${renderWaterfall(entry, maxDuration)}
        </div>
      </td>
    `;
    elements.tableBody.appendChild(row);
  });
}

function renderWaterfall(entry, maxDuration) {
  const phases = [
    { key: 'blocked', value: Number(entry.timings?.blocked || 0) },
    { key: 'dns', value: Number(entry.timings?.dns || 0) },
    { key: 'connect', value: Number(entry.timings?.connect || 0) },
    { key: 'ssl', value: Number(entry.timings?.ssl || 0) },
    { key: 'send', value: Number(entry.timings?.send || 0) },
    { key: 'wait', value: Number(entry.timings?.wait || 0) },
    { key: 'receive', value: Number(entry.timings?.receive || 0) }
  ].filter((phase) => phase.value > 0);

  if (!phases.length) {
    return `<span class="waterfall-bar" style="left:0;width:${Math.max(6, Math.min(100, Number(entry.time || 0) ? 100 : 0))}%"></span>`;
  }

  let left = 0;
  return phases.map((phase) => {
    const width = maxDuration > 0 ? (phase.value / maxDuration) * 100 : 0;
    const html = `<span class="waterfall-bar ${phase.key}" style="left:${left}%;width:${Math.max(width, 3)}%;" title="${phase.key}: ${msToString(phase.value)}"></span>`;
    left += width;
    return html;
  }).join('');
}

function renderEmptyState() {
  elements.tableBody.innerHTML = `
    <tr>
      <td colspan="11">
        <div class="empty-state-screen">
          <h2>No HAR loaded</h2>
          <div class="drop-hint">Open a .har file or drag a HAR file into the app. Files stay local.</div>
        </div>
      </td>
    </tr>
  `;
}

function sortEntries(entries) {
  const sorted = [...entries];
  const direction = state.sortDir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    const left = getSortValue(a, state.sortKey);
    const right = getSortValue(b, state.sortKey);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return 0;
  });
  return sorted;
}

function getSortValue(entry, key) {
  if (key === 'status') return Number(entry.status || 0);
  if (key === 'method') return (entry.method || '').toUpperCase();
  if (key === 'name') return getRequestName(entry.url || '');
  if (key === 'host') return entry.host || '';
  if (key === 'path') return entry.path || '';
  if (key === 'resourceType') return entry.resourceType || 'other';
  if (key === 'transferSize') return Number(entry.transferSize || entry.content?.size || 0);
  if (key === 'time') return Number(entry.time || 0);
  if (key === 'startTime') return Number(entry.startTime || 0);
  if (key === 'httpVersion') return entry.httpVersion || 'HTTP/1.1';
  return 0;
}

function getStatusClass(status) {
  const code = Number(status || 0);
  if (code >= 500) return 'error';
  if (code >= 400) return 'warning';
  if (code >= 300) return 'redirect';
  if (code >= 200) return 'success';
  return 'info';
}

function getRequestName(url) {
  if (!url) return '(empty)';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '/';
  } catch (error) {
    return String(url).split('/').filter(Boolean).pop() || url;
  }
}

function shortenUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return url;
  }
}

function renderInspector() {
  const selected = state.selectedEntry;
  if (!selected) {
    elements.inspectorContent.className = 'inspector-content empty-state';
    elements.inspectorContent.innerHTML = `
      <div class="empty-inspector">
        <h3>No request selected</h3>
        <p>Select a request to inspect its details.</p>
      </div>
    `;
    return;
  }

  elements.inspectorContent.className = 'inspector-content';
  elements.inspectorContent.innerHTML = `
    <div class="request-header">
      <h2>${escapeHtml(getRequestName(selected.url))}</h2>
      <div class="actions">
        <button class="secondary" data-copy="url">Copy URL</button>
        <button class="secondary" data-copy="headers">Copy Headers</button>
        <button class="secondary" data-copy="curl">Copy as cURL</button>
      </div>
    </div>
    <div class="tab-nav">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="headers">Headers</button>
      <button class="tab-btn" data-tab="query">Query</button>
      <button class="tab-btn" data-tab="request">Request</button>
      <button class="tab-btn" data-tab="response">Response</button>
      <button class="tab-btn" data-tab="cookies">Cookies</button>
      <button class="tab-btn" data-tab="timing">Timing</button>
      <button class="tab-btn" data-tab="flow">Flow</button>
    </div>
    <div id="inspectorTabContent"></div>
  `;

  elements.inspectorContent.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      elements.inspectorContent.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn === button));
      renderInspectorTab(button.dataset.tab, selected);
    });
  });

  elements.inspectorContent.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copySelection(button.dataset.copy, selected));
  });

  renderInspectorTab('overview', selected);
}

function renderInspectorTab(tab, entry) {
  const target = document.getElementById('inspectorTabContent');
  if (!target) return;

  const renderers = {
    overview: renderOverviewTab,
    headers: renderHeadersTab,
    query: renderQueryTab,
    request: renderRequestTab,
    response: renderResponseTab,
    cookies: renderCookiesTab,
    timing: renderTimingTab,
    flow: renderFlowTab
  };

  target.innerHTML = renderers[tab] ? renderers[tab](entry) : '';
}

function renderOverviewTab(entry) {
  const details = [
    ['Full URL', state.redacted ? redactUrlValue(entry.url || '') : (entry.url || '')],
    ['HTTP method', entry.method || 'GET'],
    ['Status', `${entry.status || 0} ${entry.statusText || ''}`.trim()],
    ['MIME type', entry.mimeType || 'unknown'],
    ['HTTP version', entry.httpVersion || 'n/a'],
    ['Server IP', entry.serverIPAddress || 'n/a'],
    ['Connection', entry.connection || 'n/a'],
    ['Start time', msToString(Number(entry.startTime || 0))],
    ['Total duration', msToString(Number(entry.time || 0))],
    ['Transferred size', bytesToString(Number(entry.transferSize || entry.content?.size || 0))],
    ['Response body size', bytesToString(Number(entry.content?.size || 0))]
  ];

  return `
    <div class="detail-section">
      <h3>Overview</h3>
      <div class="kv-grid">
        ${details.map(([label, value]) => `<div class="key">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value || 'n/a'))}</div>`).join('')}
      </div>
    </div>
  `;
}

function renderHeadersTab(entry) {
  const groups = [
    ['General', entry.raw && entry.raw.request && Array.isArray(entry.raw.request.headers) ? entry.raw.request.headers : []],
    ['Request Headers', entry.headers || []],
    ['Response Headers', entry.responseHeaders || []]
  ];

  return `
    <div class="detail-section">
      <h3>Headers</h3>
      <input class="header-search" id="headerSearch" placeholder="Search headers" />
      ${groups.map(([name, items]) => `
        <div class="detail-section">
          <h3>${escapeHtml(name)}</h3>
          <table class="meta-table">
            <tbody>
              ${renderHeaderRows(items)}
            </tbody>
          </table>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHeaderRows(items) {
  const input = document.getElementById('headerSearch');
  const search = input ? input.value.toLowerCase() : '';
  const rows = (items || []).filter((header) => {
    const text = `${header.name || ''} ${header.value || ''}`.toLowerCase();
    return !search || text.includes(search);
  });

  if (!rows.length) return '<tr><td colspan="2">No matching headers.</td></tr>';
  return rows.map((header) => {
    const name = header.name || '';
    const value = state.redacted && shouldRedactHeader(name) ? '***REDACTED***' : (header.value || '');
    return `
      <tr>
        <th>${escapeHtml(name)}</th>
        <td>${escapeHtml(String(value))}${shouldRedactHeader(name) ? ' <span class="security-warning">Sensitive</span>' : ''}</td>
      </tr>
    `;
  }).join('');
}

function renderQueryTab(entry) {
  const params = entry.queryString || [];
  if (!params.length) {
    return '<div class="detail-section"><h3>Query Parameters</h3><div class="code-block">No query string.</div></div>';
  }

  return `
    <div class="detail-section">
      <h3>Query Parameters</h3>
      <table class="meta-table">
        <tbody>
          ${params.map((param) => {
            const key = state.redacted && /token|key|secret|password|auth|session|jwt|access_token/i.test(param.key) ? '***REDACTED***' : (param.key || '');
            const value = state.redacted && /token|key|secret|password|auth|session|jwt|access_token/i.test(param.key) ? '***REDACTED***' : (param.value || '');
            return `<tr><th>${escapeHtml(String(key))}</th><td>${escapeHtml(String(value))}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRequestTab(entry) {
  const payload = entry.requestBody && entry.requestBody.text ? entry.requestBody.text : '';
  const pretty = prettyPrint(payload, entry.requestBody?.mimeType || entry.mimeType || 'text/plain');

  return `
    <div class="detail-section">
      <h3>Request</h3>
      <div class="kv-grid">
        <div class="key">Content type</div><div class="value">${escapeHtml(entry.requestBody?.mimeType || 'n/a')}</div>
      </div>
      <div class="code-block">${escapeHtml(pretty || 'No request body captured.')}</div>
    </div>
  `;
}

function renderResponseTab(entry) {
  const payload = typeof entry.content?.text === 'string' ? entry.content.text : '';
  const pretty = prettyPrint(payload, entry.mimeType || 'text/plain');

  return `
    <div class="detail-section">
      <h3>Response</h3>
      <div class="kv-grid">
        <div class="key">Status</div><div class="value">${escapeHtml(String(entry.status || 0))}</div>
        <div class="key">Mime type</div><div class="value">${escapeHtml(entry.mimeType || 'unknown')}</div>
      </div>
      <div class="code-block">${escapeHtml(pretty || 'No response body captured.')}</div>
    </div>
  `;
}

function renderCookiesTab(entry) {
  const requestCookies = entry.requestCookies || [];
  const responseCookies = entry.responseCookies || [];

  return `
    <div class="detail-section">
      <h3>Request Cookies</h3>
      <table class="meta-table">
        <thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th></tr></thead>
        <tbody>
          ${requestCookies.length ? requestCookies.map((cookie) => `
            <tr>
              <td>${escapeHtml(cookie.name || '')}</td>
              <td>${escapeHtml(state.redacted ? '***REDACTED***' : (cookie.value || ''))}</td>
              <td>${escapeHtml(cookie.domain || '')}</td>
              <td>${escapeHtml(cookie.path || '')}</td>
            </tr>
          `).join('') : '<tr><td colspan="4">No request cookies.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="detail-section">
      <h3>Response Cookies</h3>
      <table class="meta-table">
        <thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th></tr></thead>
        <tbody>
          ${responseCookies.length ? responseCookies.map((cookie) => `
            <tr>
              <td>${escapeHtml(cookie.name || '')}</td>
              <td>${escapeHtml(state.redacted ? '***REDACTED***' : (cookie.value || ''))}</td>
              <td>${escapeHtml(cookie.domain || '')}</td>
              <td>${escapeHtml(cookie.path || '')}</td>
            </tr>
          `).join('') : '<tr><td colspan="4">No response cookies.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderTimingTab(entry) {
  const timings = entry.timings || {};
  const phases = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
  const total = Number(entry.time || 0);
  const segments = phases.map((phase) => ({ phase, value: Number(timings[phase] || 0) })).filter((item) => item.value > 0);

  const ruler = Array.from({ length: 6 }, (_, index) => {
    const pct = (index / 5) * 100;
    const label = msToString((total / 5) * index);
    return `<div class="tick" style="left:${pct}%"></div><div class="tick-label" style="left:${pct}%">${escapeHtml(label)}</div>`;
  }).join('');

  return `
    <div class="detail-section">
      <h3>Timing breakdown</h3>
      <div class="timeline-wrapper">
        <div class="timeline-ruler">${ruler}</div>
        <div class="timeline-bars">
          ${segments.map((item) => `<div class="timeline-segment ${item.phase}" style="left:${(item.value / total) * 100}%; width:${Math.max(8, (item.value / total) * 100)}%;" data-label="${item.phase}"></div>`).join('')}
        </div>
      </div>
      <div class="kv-grid" style="margin-top:12px;">
        ${phases.map((phase) => `<div class="key">${escapeHtml(phase)}</div><div class="value">${escapeHtml(msToString(Number(timings[phase] || 0)))}</div>`).join('')}
      </div>
      <div class="code-block" style="margin-top:12px;">Negative or missing HAR timing values indicate unavailable timing data rather than real durations.</div>
    </div>
  `;
}

function renderFlowTab(entry) {
  const flowRows = computeFlowRows(state.entries).slice(Math.max(0, state.entries.findIndex((item) => item.index === entry.index) - 5), Math.min(state.entries.length, state.entries.findIndex((item) => item.index === entry.index) + 6));
  return `
    <div class="detail-section">
      <h3>Flow</h3>
      <div class="code-block">
        ${flowRows.map((row) => `${new Date(row.startTime).toLocaleTimeString()} | ${row.method || 'GET'} ${row.host || 'unknown'} ${row.path || '/'}${row.index === entry.index ? ' <- selected' : ''}`).join('\n')}
      </div>
    </div>
  `;
}

function prettyPrint(value, mimeType) {
  if (!value) return '';
  const text = String(value);
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('json') || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch (error) {
      return text;
    }
  }
  if (mime.includes('xml') || /^<\?xml|^<\w/.test(text.trim())) {
    return text;
  }
  if (mime.includes('html')) {
    return text;
  }
  return text;
}

function copySelection(kind, entry) {
  if (!navigator.clipboard) return;

  const url = entry.url || '';
  const headers = [...(entry.headers || []), ...(entry.responseHeaders || [])]
    .map((header) => `${header.name}: ${state.redacted && shouldRedactHeader(header.name) ? '***REDACTED***' : (header.value || '')}`)
    .join('\n');

  if (kind === 'url') {
    navigator.clipboard.writeText(state.redacted ? redactUrlValue(url) : url);
    return;
  }

  if (kind === 'headers') {
    navigator.clipboard.writeText(headers);
    return;
  }

  if (kind === 'curl') {
    const sanitizedUrl = state.redacted ? redactUrlValue(url) : url;
    const curlHeaders = (entry.headers || []).map((header) => `-H ${shellQuote(`${header.name}: ${state.redacted && shouldRedactHeader(header.name) ? '***REDACTED***' : (header.value || '')}`)}`).join(' ');
    navigator.clipboard.writeText(`curl -X ${entry.method || 'GET'} ${curlHeaders} ${shellQuote(sanitizedUrl)}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function renderComparePanel() {
  if (!state.compare.baseline && !state.compare.comparison) {
    elements.comparePanel.classList.add('collapsed');
    elements.compareContent.innerHTML = '';
    return;
  }

  const baseline = state.compare.baseline || [];
  const comparison = state.compare.comparison || [];
  const summary = compareHarSets(baseline, comparison);

  elements.comparePanel.classList.remove('collapsed');
  elements.toggleCompareBtn.textContent = 'Hide';
  elements.toggleCompareBtn.setAttribute('aria-expanded', 'true');
  elements.compareContent.innerHTML = `
    <div class="compare-card">
      <h4>Requests</h4>
      <div class="spark">${summary.requestCount.baseline} → ${summary.requestCount.comparison}</div>
      <div class="delta">Δ ${summary.requestCount.delta}</div>
    </div>
    <div class="compare-card">
      <h4>Transferred</h4>
      <div class="spark">${bytesToString(summary.totalTransferred.baseline)} → ${bytesToString(summary.totalTransferred.comparison)}</div>
      <div class="delta">Δ ${bytesToString(summary.totalTransferred.delta)}</div>
    </div>
    <div class="compare-card">
      <h4>Duration</h4>
      <div class="spark">${msToString(summary.totalDuration.baseline)} → ${msToString(summary.totalDuration.comparison)}</div>
      <div class="delta">Δ ${msToString(summary.totalDuration.delta)}</div>
    </div>
    <div class="compare-card">
      <h4>Errors</h4>
      <div class="spark">${summary.errorCount.baseline} → ${summary.errorCount.comparison}</div>
      <div class="delta">Δ ${summary.errorCount.delta}</div>
    </div>
  `;
}

initialize();
