export function applyFilters(entries, filters) {
  const activeSearch = (filters.search || '').trim().toLowerCase();

  return entries.filter((entry) => {
    if (filters.type && filters.type !== 'all' && entry.resourceType !== filters.type && !(filters.type === 'fetch' && entry.resourceType === 'xhr')) {
      return false;
    }

    if (filters.method && filters.method !== 'all' && (entry.method || '').toUpperCase() !== filters.method.toUpperCase()) {
      return false;
    }

    if (filters.statusFamily && filters.statusFamily !== 'all') {
      const status = Number(entry.status || 0);
      if (filters.statusFamily === '2xx' && !(status >= 200 && status < 300)) return false;
      if (filters.statusFamily === '3xx' && !(status >= 300 && status < 400)) return false;
      if (filters.statusFamily === '4xx' && !(status >= 400 && status < 500)) return false;
      if (filters.statusFamily === '5xx' && !(status >= 500 && status < 600)) return false;
      if (filters.statusFamily === 'failed' && !(status >= 400 || status === 0 || !status)) return false;
    }

    if (filters.domain && filters.domain !== 'all' && entry.host !== filters.domain) return false;
    if (filters.mime && filters.mime !== 'all' && (entry.mimeType || '').toLowerCase() !== filters.mime.toLowerCase()) return false;
    if (filters.minDuration && Number(entry.time || 0) < Number(filters.minDuration)) return false;
    if (filters.minSize && Number(entry.transferSize || entry.content?.size || 0) < Number(filters.minSize)) return false;
    if (filters.cache && filters.cache !== 'all') {
      const cached = !!(entry.raw && entry.raw._fromCache);
      if (filters.cache === 'cached' && !cached) return false;
      if (filters.cache === 'not-cached' && cached) return false;
    }
    if (filters.errorsOnly && !(Number(entry.status || 0) >= 400 || Number(entry.status || 0) === 0)) return false;

    if (activeSearch) {
      const hay = [
        entry.url,
        entry.host,
        entry.path,
        entry.method,
        ...entry.headers.map((header) => `${header.name} ${header.value}`),
        ...entry.responseHeaders.map((header) => `${header.name} ${header.value}`),
        ...entry.requestCookies.map((cookie) => `${cookie.name} ${cookie.value}`),
        ...entry.responseCookies.map((cookie) => `${cookie.name} ${cookie.value}`)
      ].join(' ').toLowerCase();
      if (!hay.includes(activeSearch)) return false;
    }

    return true;
  });
}

export function getSelectableFilterValues(entries) {
  return {
    domains: [...new Set(entries.map((entry) => entry.host).filter(Boolean))].sort(),
    mimeTypes: [...new Set(entries.map((entry) => entry.mimeType || 'unknown').filter(Boolean))].sort()
  };
}
