const safeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

function getTextContent(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function parseHeaders(rawHeaders) {
  const list = Array.isArray(rawHeaders) ? rawHeaders : [];
  return list.map((header) => {
    const headerValue = header && header.value !== undefined ? String(header.value) : '';
    return {
      name: header && typeof header.name === 'string' ? header.name : '',
      value: header && typeof header.value === 'string' ? header.value : headerValue
    };
  });
}

function parseCookies(rawCookies) {
  const list = Array.isArray(rawCookies) ? rawCookies : [];
  return list.map((cookie) => ({
    name: cookie && typeof cookie.name === 'string' ? cookie.name : '',
    value: cookie && typeof cookie.value !== 'undefined' ? String(cookie.value) : '',
    domain: cookie && typeof cookie.domain === 'string' ? cookie.domain : '',
    path: cookie && typeof cookie.path === 'string' ? cookie.path : '',
    expires: cookie && typeof cookie.expires === 'string' ? cookie.expires : (cookie && cookie.expires ? new Date(cookie.expires).toISOString() : ''),
    secure: !!(cookie && cookie.secure),
    httpOnly: !!(cookie && cookie.httpOnly),
    sameSite: cookie && typeof cookie.sameSite === 'string' ? cookie.sameSite : ''
  }));
}

function parseQueryString(url) {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const entries = [...parsed.searchParams.entries()].map(([key, value]) => ({ key, value, decoded: decodeURIComponent(value) }));
    return entries;
  } catch (error) {
    return [];
  }
}

function parseContent(content) {
  if (content === null || content === undefined) return { text: '', encoding: '', mimeType: '' };
  const text = typeof content === 'string' ? content : String(content);
  return { text, encoding: 'utf-8', mimeType: '' };
}

function normalizeMimeType(value) {
  if (!value) return 'unknown';
  return String(value).split(';')[0].trim().toLowerCase();
}

function inferResourceType(entry) {
  const contentType = normalizeMimeType(entry && entry.response && entry.response.content && entry.response.content.mimeType ? entry.response.content.mimeType : '');
  const mime = contentType.toLowerCase();
  const url = (entry && entry.request && entry.request.url) || '';
  if (mime.includes('javascript') || /\.js(?:\?|$)/i.test(url) || /\/scripts\//i.test(url)) return 'script';
  if (mime.includes('css') || /\.css(?:\?|$)/i.test(url)) return 'stylesheet';
  if (mime.includes('image') || /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(url)) return 'image';
  if (mime.includes('font') || /\.(?:woff2?|ttf|otf|eot)(?:\?|$)/i.test(url)) return 'font';
  if (mime.includes('audio') || mime.includes('video') || /\.(?:mp4|webm|ogg|mp3|wav|m4a|mov|avi)(?:\?|$)/i.test(url)) return 'media';
  if (mime.includes('json') || mime.includes('xml') || /\/(api|ajax|fetch|graphql)|\/xhr/i.test(url)) return 'fetch';
  if (entry && entry.response && entry.response.status && entry.response.status >= 200 && entry.response.status < 400 && (entry.request && entry.request.method === 'GET') && /\.(?:html|htm)(?:\?|$)/i.test(url)) return 'document';
  if (mime.includes('text/html') || /\.(?:html|htm)(?:\?|$)/i.test(url)) return 'document';
  if (mime.includes('text/plain')) return 'other';
  return 'other';
}

export function parseHarContent(rawText) {
  const source = typeof rawText === 'string' ? rawText : '';
  if (!source.trim()) {
    throw new Error('HAR file is empty or invalid.');
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('Could not parse the HAR file as JSON.');
  }

  const log = parsed && parsed.log ? parsed.log : null;
  if (!log || !Array.isArray(log.entries)) {
    throw new Error('HAR is missing a valid log.entries array.');
  }

  const entries = log.entries.map((entry, index) => {
    const request = entry && entry.request ? entry.request : {};
    const response = entry && entry.response ? entry.response : {};
    const started = safeNumber(entry && entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : 0, 0);
    const requestUrl = typeof request.url === 'string' ? request.url : '';
    const method = request.method || 'GET';
    const status = safeNumber(response.status, 0);
    const headers = parseHeaders(request.headers || request.headersSize ? request.headers : []);
    const responseHeaders = parseHeaders(response.headers || []);
    const requestCookies = parseCookies(request.cookies || []);
    const responseCookies = parseCookies(response.cookies || []);
    const content = response.content || {};
    const bodyText = typeof content.text === 'string' ? content.text : '';
    const resourceType = inferResourceType({ request, response });
    const timing = entry && entry.timings ? entry.timings : {};

    const requestObj = {
      index,
      startedDateTime: entry && entry.startedDateTime ? entry.startedDateTime : '',
      startTime: safeNumber(entry && entry.startedDateTime ? new Date(entry.startedDateTime).getTime() : 0, 0),
      time: safeNumber(entry && entry.time, 0),
      method,
      url: requestUrl,
      host: (() => {
        try { return new URL(requestUrl).host; } catch (error) { return ''; }
      })(),
      path: (() => {
        try { return new URL(requestUrl).pathname; } catch (error) { return ''; }
      })(),
      queryString: parseQueryString(requestUrl),
      httpVersion: request.httpVersion || '',
      headers,
      responseHeaders,
      requestCookies,
      responseCookies,
      status,
      statusText: response.statusText || '',
      mimeType: content.mimeType || (response.content && response.content.mimeType) || '',
      resourceType,
      transferSize: safeNumber(response && response._transferSize, 0),
      bodySize: safeNumber(response && response.bodySize, 0),
      content: {
        size: safeNumber(content.size, 0),
        mimeType: content.mimeType || '',
        text: bodyText,
        encoding: content.encoding || ''
      },
      requestBody: {
        text: getTextContent(request.postData && request.postData.text),
        mimeType: request.postData && request.postData.mimeType ? request.postData.mimeType : '',
        params: Array.isArray(request.postData && request.postData.params) ? request.postData.params : []
      },
      timings: {
        blocked: safeNumber(timing.blocked, -1),
        dns: safeNumber(timing.dns, -1),
        connect: safeNumber(timing.connect, -1),
        ssl: safeNumber(timing.ssl, -1),
        send: safeNumber(timing.send, -1),
        wait: safeNumber(timing.wait, -1),
        receive: safeNumber(timing.receive, -1),
      },
      serverIPAddress: response && response.serverIPAddress ? response.serverIPAddress : '',
      connection: connectionValue(entry),
      raw: entry
    };

    return requestObj;
  });

  return {
    entries,
    pages: Array.isArray(log.pages) ? log.pages : [],
    version: log.version || '1.2',
    creator: log.creator || null,
    browser: log.browser || null
  };
}

function connectionValue(entry) {
  if (!entry || !entry.connection) return '';
  if (typeof entry.connection === 'string') return entry.connection;
  if (typeof entry.connection === 'number') return String(entry.connection);
  return '';
}
