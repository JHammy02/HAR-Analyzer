const HIGH_RISK_KEYS = ['authorization','cookie','set-cookie','x-api-key','proxy-authorization','token','secret','password','session','jwt','access_token','api_key'];

export function redactSensitiveValue(name, value) {
  if (typeof value !== 'string') return value;
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  if (!key) return value;
  if (HIGH_RISK_KEYS.some(k => key.includes(k))) {
    return '***REDACTED***';
  }
  return value;
}

export function shouldRedactHeader(name) {
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  return key === 'authorization' || key === 'cookie' || key === 'set-cookie' || key === 'x-api-key' || key === 'proxy-authorization';
}

export function redactUrlValue(urlString) {
  if (!urlString) return urlString;
  try {
    const url = new URL(urlString);
    const params = new URLSearchParams(url.search);
    const result = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      const lower = key.toLowerCase();
      if (HIGH_RISK_KEYS.some(k => lower.includes(k))) {
        result.append(key, '***REDACTED***');
      } else {
        result.append(key, value);
      }
    }
    url.search = result.toString();
    return url.toString();
  } catch (error) {
    return urlString;
  }
}

export function redactText(text) {
  if (!text) return text;
  return String(text).replace(/(Authorization|authorization|Cookie|cookie|X-API-Key|x-api-key|Bearer\s+[A-Za-z0-9._~+/-]+=*|token=|key=|secret=|password=|session=|jwt=|access_token=)([^\s&]+)/gi, '$1***REDACTED***');
}
