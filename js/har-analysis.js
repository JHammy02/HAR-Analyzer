import { bytesToString, msToString, percentOf } from './formatters.js';

export function summarizeHar(entries) {
  const totalRequests = entries.length;
  const successful = entries.filter((entry) => entry.status >= 200 && entry.status < 300).length;
  const redirects = entries.filter((entry) => entry.status >= 300 && entry.status < 400).length;
  const clientErrors = entries.filter((entry) => entry.status >= 400 && entry.status < 500).length;
  const serverErrors = entries.filter((entry) => entry.status >= 500 && entry.status < 600).length;
  const totalTransferred = entries.reduce((sum, entry) => sum + safeNumber(entry.transferSize || entry.content?.size || 0), 0);
  const totalResource = entries.reduce((sum, entry) => sum + safeNumber(entry.content?.size || 0), 0);
  const captureDuration = entries.length ? Math.max(...entries.map((entry) => safeNumber(entry.startTime, 0) + safeNumber(entry.time, 0))) - Math.min(...entries.map((entry) => safeNumber(entry.startTime, 0))) : 0;
  const durations = entries.map((entry) => safeNumber(entry.time, 0)).sort((a, b) => a - b);
  const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const median = durations.length ? durations[Math.floor(durations.length / 2)] || 0 : 0;
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] || 0 : 0;

  return {
    totalRequests,
    successful,
    redirects,
    clientErrors,
    serverErrors,
    totalTransferred,
    totalResource,
    captureDuration,
    average,
    median,
    p95,
    domainCounts: summarizeDomains(entries),
    resourceTypeCounts: summarizeTypes(entries),
    statusCounts: summarizeStatus(entries)
  };
}

export function analyzePerformance(entries) {
  const slowRequests = [...entries]
    .sort((a, b) => safeNumber(b.time, 0) - safeNumber(a.time, 0))
    .slice(0, 10)
    .map((entry) => ({
      name: entry.url,
      value: entry.time,
      label: `${entry.method} ${entry.host}${entry.path}`,
      reason: 'slowest request'
    }));

  const largeResources = [...entries]
    .sort((a, b) => safeNumber(b.content?.size || b.transferSize || 0) - safeNumber(a.content?.size || a.transferSize || 0))
    .slice(0, 10)
    .map((entry) => ({
      name: entry.url,
      value: safeNumber(entry.content?.size || entry.transferSize || 0),
      label: `${entry.method} ${entry.host}${entry.path}`,
      reason: 'largest resource'
    }));

  const failedRequests = entries.filter((entry) => (entry.status >= 400 || entry.status === 0 || !entry.status)).map((entry) => ({
    name: entry.url,
    value: entry.status || 'failed',
    label: `${entry.method} ${entry.host}${entry.path}`,
    reason: 'failed or unsuccessful response'
  }));

  const redirectChains = detectRedirectChains(entries);
  const duplicates = detectDuplicateRequests(entries);
  const sequences = detectSequentialChains(entries);

  return {
    slowRequests,
    largeResources,
    failedRequests,
    redirectChains,
    duplicates,
    sequences
  };
}

export function buildOverviewCards(summary) {
  return [
    { title: 'Total requests', value: summary.totalRequests.toLocaleString(), sub: `${summary.successful} successful` },
    { title: 'Transferred', value: bytesToString(summary.totalTransferred), sub: `${bytesToString(summary.totalResource)} resource` },
    { title: 'Duration', value: msToString(summary.captureDuration), sub: `Avg ${msToString(summary.average)}` },
    { title: 'P95', value: msToString(summary.p95), sub: `Median ${msToString(summary.median)}` }
  ];
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function summarizeDomains(entries) {
  const map = new Map();
  for (const entry of entries) {
    const host = entry.host || 'unknown';
    const current = map.get(host) || { count: 0, bytes: 0, totalTime: 0 };
    current.count += 1;
    current.bytes += safeNumber(entry.transferSize || entry.content?.size || 0);
    current.totalTime += safeNumber(entry.time, 0);
    map.set(host, current);
  }
  return [...map.entries()].map(([host, data]) => ({ host, ...data })).sort((a, b) => b.count - a.count).slice(0, 10);
}

function summarizeTypes(entries) {
  const map = new Map();
  for (const entry of entries) {
    const type = entry.resourceType || 'other';
    const current = map.get(type) || { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += safeNumber(entry.transferSize || entry.content?.size || 0);
    map.set(type, current);
  }
  return [...map.entries()].map(([type, data]) => ({ type, ...data })).sort((a, b) => b.count - a.count);
}

function summarizeStatus(entries) {
  const counts = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, failed: 0 };
  for (const entry of entries) {
    const status = safeNumber(entry.status, 0);
    if (status >= 200 && status < 300) counts['2xx'] += 1;
    else if (status >= 300 && status < 400) counts['3xx'] += 1;
    else if (status >= 400 && status < 500) counts['4xx'] += 1;
    else if (status >= 500 && status < 600) counts['5xx'] += 1;
    else counts.failed += 1;
  }
  return counts;
}

function detectRedirectChains(entries) {
  const redirectMap = new Map();
  for (const entry of entries) {
    const url = entry.url || '';
    const key = url.split('?')[0];
    if (!redirectMap.has(key)) redirectMap.set(key, []);
    redirectMap.get(key).push(entry);
  }
  return [...redirectMap.values()]
    .filter((items) => items.some((item) => item.status >= 300 && item.status < 400))
    .slice(0, 5)
    .map((items) => ({
      path: items.map((item) => `${item.url} (${item.status})`).join(' → '),
      totalTime: items.reduce((sum, item) => sum + safeNumber(item.time, 0), 0)
    }));
}

function detectDuplicateRequests(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = `${entry.method.toUpperCase()} ${entry.url}`;
    const current = map.get(key) || { count: 0, bytes: 0, totalTime: 0 };
    current.count += 1;
    current.bytes += safeNumber(entry.transferSize || entry.content?.size || 0);
    current.totalTime += safeNumber(entry.time, 0);
    map.set(key, current);
  }
  return [...map.entries()]
    .filter(([, data]) => data.count > 1)
    .map(([url, data]) => ({ url, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function detectSequentialChains(entries) {
  const sequences = [];
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1];
    const current = entries[i];
    const prevEnd = previous.startTime + previous.time;
    const gap = current.startTime - prevEnd;
    if (gap >= 0 && gap <= 200) {
      sequences.push({ previous: previous.url, current: current.url, gap });
    }
  }
  return sequences.slice(0, 10);
}

export function buildTableColumns() {
  return [
    'Status', 'Method', 'Name', 'Host', 'Path', 'Type', 'Size', 'Time', 'Started', 'Protocol', 'Waterfall'
  ];
}

export function classifyEntry(entry) {
  const status = safeNumber(entry.status, 0);
  if (status >= 500) return 'error';
  if (status >= 400) return 'warning';
  if (status >= 300) return 'redirect';
  if (status >= 200) return 'success';
  if (entry && entry.raw && entry.raw._fromCache) return 'info';
  return 'info';
}

export function getTimingTotals(entry) {
  const timings = entry.timings || {};
  const phases = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
  const values = {};
  phases.forEach((phase) => {
    values[phase] = safeNumber(timings[phase], 0);
  });
  return values;
}

export function getTimingBarParts(entry, max) {
  const total = safeNumber(entry.time, 0);
  const phases = getTimingTotals(entry);
  const bars = [];
  let start = 0;
  for (const [phase, value] of Object.entries(phases)) {
    const duration = Math.max(0, value);
    if (duration <= 0) continue;
    const relative = max <= 0 ? 0 : (duration / max) * 100;
    const width = total > 0 ? (duration / total) * 100 : relative;
    bars.push({
      phase,
      start,
      width,
      value: duration,
      label: phase.charAt(0).toUpperCase() + phase.slice(1)
    });
    start += width;
  }
  return bars;
}

export function computeFlowRows(entries) {
  return entries.map((entry) => ({
    ...entry,
    domain: entry.host || 'unknown',
    type: entry.resourceType || 'other',
    start: safeNumber(entry.startTime, 0),
    end: safeNumber(entry.startTime, 0) + safeNumber(entry.time, 0)
  }));
}

export function compareHarSets(baseline, comparison) {
  const baseSummary = summarizeHar(baseline || []);
  const compareSummary = summarizeHar(comparison || []);
  return {
    requestCount: { baseline: baseSummary.totalRequests, comparison: compareSummary.totalRequests, delta: compareSummary.totalRequests - baseSummary.totalRequests },
    totalTransferred: { baseline: baseSummary.totalTransferred, comparison: compareSummary.totalTransferred, delta: compareSummary.totalTransferred - baseSummary.totalTransferred },
    totalDuration: { baseline: baseSummary.captureDuration, comparison: compareSummary.captureDuration, delta: compareSummary.captureDuration - baseSummary.captureDuration },
    averageDuration: { baseline: baseSummary.average, comparison: compareSummary.average, delta: compareSummary.average - baseSummary.average },
    p95Duration: { baseline: baseSummary.p95, comparison: compareSummary.p95, delta: compareSummary.p95 - baseSummary.p95 },
    errorCount: { baseline: baseSummary.clientErrors + baseSummary.serverErrors, comparison: compareSummary.clientErrors + compareSummary.serverErrors, delta: (compareSummary.clientErrors + compareSummary.serverErrors) - (baseSummary.clientErrors + baseSummary.serverErrors) },
    domainCount: { baseline: new Set((baseline || []).map((entry) => entry.host)).size, comparison: new Set((comparison || []).map((entry) => entry.host)).size, delta: new Set((comparison || []).map((entry) => entry.host)).size - new Set((baseline || []).map((entry) => entry.host)).size },
    resourceTypes: { baseline: baseSummary.resourceTypeCounts, comparison: compareSummary.resourceTypeCounts }
  };
}

export function normalizeRequestKey(entry) {
  const url = entry && entry.url ? entry.url.replace(/\?.*$/, '') : '';
  return `${(entry && entry.method ? entry.method.toUpperCase() : 'GET')} ${url}`.trim();
}
