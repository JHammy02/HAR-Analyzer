export function bytesToString(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function msToString(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'n/a';
  if (Math.abs(num) < 1000) return `${num.toFixed(0)} ms`;
  return `${(num / 1000).toFixed(2)} s`;
}

export function formatDateIso(value) {
  if (!value && value !== 0) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toISOString();
}

export function safeText(value) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function percentOf(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

export function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const pathname = parsed.pathname || '/';
    const search = parsed.search || '';
    return `${origin}${pathname}${search}`;
  } catch (error) {
    return url;
  }
}
