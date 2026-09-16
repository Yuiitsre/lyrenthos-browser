import crypto from 'node:crypto';
import { Client, Storage } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const BUCKET_ID = 'lyrenthos-browser-sessions';
const MAX_HTML = 6 * 1024 * 1024;
const MAX_BODY = 12 * 1024 * 1024;
const MAX_REQUEST = 2 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function getStorage(req) {
  const key = req.headers['x-appwrite-key'] || process.env.APPWRITE_FUNCTION_API_KEY;
  if (!key) throw new Error('Appwrite dynamic API key unavailable');
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(key);
  return new Storage(client);
}

function corsHeaders(req) {
  const origin = req.headers?.origin;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, User-Agent, Accept-Language, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    ...(origin ? { Vary: 'Origin' } : {}),
  };
}

function responseHeaders(source) {
  const out = {};
  const blocked = new Set([
    'connection', 'keep-alive', 'transfer-encoding', 'content-length',
    'set-cookie', 'content-encoding', 'content-security-policy',
    'content-security-policy-report-only', 'cross-origin-embedder-policy',
    'cross-origin-opener-policy', 'cross-origin-resource-policy',
    'access-control-allow-origin', 'access-control-allow-credentials',
    'access-control-allow-headers', 'access-control-allow-methods',
  ]);
  for (const [key, value] of source.entries()) {
    if (!blocked.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

function sessionFileId(sid) {
  return `s_${crypto.createHash('sha256').update(sid).digest('hex').slice(0, 30)}`;
}
function newSessionId() {
  return crypto.randomBytes(24).toString('base64url');
}
function safeString(value, max) {
  return typeof value === 'string' && value.length <= max ? value : '';
}

function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (!u.hostname || /[\r\n]/.test(u.hostname)) return null;
  return u;
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}

async function assertPublicTarget(url) {
  if (isPrivateIPv4(url.hostname) || isPrivateIPv6(url.hostname)) throw new Error('Blocked private address');
  if (/^[0-9a-f:.]+$/i.test(url.hostname)) return;
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(r => isPrivateIPv4(r.address) || isPrivateIPv6(r.address))) {
    throw new Error('Target resolves to a blocked address');
  }
}

function parseSetCookie(line, requestUrl) {
  const parts = line.split(';').map(s => s.trim());
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const cookie = {
    name: first.slice(0, eq),
    value: first.slice(eq + 1),
    domain: requestUrl.hostname,
    path: '/',
    secure: false,
    expires: 0,
    hostOnly: true,
  };
  for (const attr of parts) {
    const [rawKey, ...rest] = attr.split('=');
    const key = rawKey.toLowerCase();
    const value = rest.join('=');
    if (key === 'domain' && value) { cookie.domain = value.replace(/^\./, '').toLowerCase(); cookie.hostOnly = false; }
    else if (key === 'path' && value.startsWith('/')) cookie.path = value;
    else if (key === 'max-age') { const seconds = Number(value); if (Number.isFinite(seconds)) cookie.expires = seconds <= 0 ? Date.now() - 1 : Date.now() + seconds * 1000; }
    else if (key === 'expires') { const time = Date.parse(value); if (Number.isFinite(time)) cookie.expires = time; }
    else if (key === 'secure') cookie.secure = true;
  }
  if (!cookie.name || cookie.name.length > 180 || cookie.value.length > 4096) return null;
  return cookie;
}
function domainMatches(host, cookie) {
  const domain = cookie.domain.toLowerCase();
  const h = host.toLowerCase();
  return cookie.hostOnly ? h === domain : (h === domain || h.endsWith(`.${domain}`));
}
function pathMatches(path, cookiePath) {
  if (path === cookiePath) return true;
  if (!path.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || path[cookiePath.length] === '/';
}
function cookiesFor(url, cookies) {
  const now = Date.now();
  return cookies.filter(c => (!c.expires || c.expires > now) && domainMatches(url.hostname, c) && pathMatches(url.pathname || '/', c.path || '/') && (!c.secure || url.protocol === 'https:')).map(c => `${c.name}=${c.value}`).join('; ');
}
function mergeCookies(existing, setCookies, requestUrl) {
  let next = [...existing];
  for (const line of setCookies) {
    const c = parseSetCookie(line, requestUrl);
    if (!c) continue;
    next = next.filter(old => !(old.name === c.name && old.domain === c.domain && old.path === c.path));
    if (!c.expires || c.expires > Date.now()) next.push(c);
  }
  return next.filter(c => !c.expires || c.expires > Date.now()).slice(-300);
}

async function loadSession(storage, sid) {
  const fileId = sessionFileId(sid);
  try {
    const bytes = await storage.getFileDownload({ bucketId: BUCKET_ID, fileId });
    const obj = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (obj.sid !== sid || Date.now() - Number(obj.updatedAt || 0) > SESSION_TTL_MS) return { fileId, cookies: [] };
    return { fileId, cookies: Array.isArray(obj.cookies) ? obj.cookies : [] };
  } catch {
    return { fileId, cookies: [] };
  }
}

async function saveSession(storage, sid, fileId, cookies) {
  const payload = Buffer.from(JSON.stringify({ v: 1, sid, updatedAt: Date.now(), cookies }));
  const input = InputFile.fromBuffer(payload, `${fileId}.json`);
  try {
    await storage.updateFile({ bucketId: BUCKET_ID, fileId, file: input });
  } catch {
    await storage.createFile({ bucketId: BUCKET_ID, fileId, file: input });
  }
}

async function ensureBucket(storage) {
  try {
    await storage.getBucket({ bucketId: BUCKET_ID });
    return;
  } catch {}
  try {
    await storage.createBucket({
      bucketId: BUCKET_ID,
      name: 'Lyrenthos Browser Sessions',
      fileSecurity: false,
      enabled: true,
      maximumFileSize: 1024 * 1024,
      encryption: true,
      compression: 'gzip',
      antivirus: false,
      transformations: false,
      permissions: [],
    });
  } catch (e) {
    if (e?.code !== 409) throw e;
  }
}

function proxiedUrl(functionOrigin, sid, target) {
  return `${functionOrigin}/?sid=${encodeURIComponent(sid)}&url=${encodeURIComponent(target)}`;
}
function rewriteUrl(functionOrigin, sid, base, value) {
  const v = value.trim();
  if (!v || v.startsWith('#') || /^(data:|javascript:|mailto:|tel:|blob:|about:)/i.test(v)) return value;
  try {
    const u = new URL(v, base);
    if (!['http:', 'https:'].includes(u.protocol)) return value;
    return proxiedUrl(functionOrigin, sid, u.toString());
  } catch { return value; }
}
function rewriteCss(css, functionOrigin, sid, base) {
  return css.replace(/url\((['"]?)(.*?)\1\)/gi, (m, quote, value) => `url(${quote}${rewriteUrl(functionOrigin, sid, base, value)}${quote})`);
}
function rewriteHtml(html, functionOrigin, sid, base) {
  let out = html;
  out = out.replace(/\b(href|src|action|poster|data)=(['"])(.*?)\2/gi, (m, attr, q, value) => `${attr}=${q}${rewriteUrl(functionOrigin, sid, base, value)}${q}`);
  out = out.replace(/\bsrcset=(['"])(.*?)\1/gi, (m, q, value) => {
    const items = value.split(',').map(item => {
      const pieces = item.trim().split(/\s+/);
      if (!pieces[0]) return item;
      pieces[0] = rewriteUrl(functionOrigin, sid, base, pieces[0]);
      return pieces.join(' ');
    });
    return `srcset=${q}${items.join(', ')}${q}`;
  });
  out = out.replace(/\bstyle=(['"])(.*?)\1/gi, (m, q, value) => `style=${q}${rewriteCss(value, functionOrigin, sid, base)}${q}`);
  out = out.replace(/<head([^>]*)>/i, `<head$1><meta name="referrer" content="no-referrer">`);
  return out;
}

async function fetchThrough(url, method, headers, body, cookies) {
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; hop < 8; hop++) {
    await assertPublicTarget(current);
    const outgoing = new Headers();
    outgoing.set('User-Agent', headers.get('user-agent') || DEFAULT_UA);
    outgoing.set('Accept', headers.get('accept') || '*/*');
    const lang = headers.get('accept-language'); if (lang) outgoing.set('Accept-Language', lang);
    const cookieHeader = cookiesFor(current, cookies);
    if (cookieHeader) outgoing.set('Cookie', cookieHeader);
    if (currentBody && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
      const contentType = headers.get('content-type'); if (contentType) outgoing.set('Content-Type', contentType);
    }
    const upstream = await fetch(current, { method: currentMethod, headers: outgoing, body: currentBody, redirect: 'manual' });
    const rawSetCookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
    if (rawSetCookies.length) cookies = mergeCookies(cookies, rawSetCookies, current);
    if ([301,302,303,307,308].includes(upstream.status)) {
      const location = upstream.headers.get('location');
      if (!location) return { response: upstream, url: current, cookies };
      current = new URL(location, current);
      if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET'; currentBody = undefined;
      }
      continue;
    }
    return { response: upstream, url: current, cookies };
  }
  throw new Error('Too many redirects');
}

export default async ({ req, res, error }) => {
  const baseCors = corsHeaders(req);
  try {
    if (req.method === 'OPTIONS') return res.empty(204, baseCors);
    if (req.query.health === '1') {
      return res.json({ ok: true, service: 'lyrenthos-appwrite-gateway' }, 200, baseCors);
    }

    const targetRaw = safeString(req.query.url, 8192);
    if (!targetRaw) {
      return res.json({ ok: true, message: 'Lyrenthos gateway', usage: '?url=https://example.com&sid=<session>' }, 200, baseCors);
    }
    const target = validateTarget(targetRaw);
    if (!target) return res.json({ ok: false, error: 'Only http(s) URLs are supported.' }, 400, baseCors);
    const sid = safeString(req.query.sid, 128) || newSessionId();
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(sid)) return res.json({ ok: false, error: 'Invalid session.' }, 400, baseCors);
    if ((req.bodyText || '').length > MAX_REQUEST) return res.json({ ok: false, error: 'Request body too large.' }, 413, baseCors);

    const storage = getStorage(req);
    await ensureBucket(storage);
    const session = await loadSession(storage, sid);
    const incomingHeaders = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) incomingHeaders.set(key, value);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : (req.bodyBinary?.length ? Buffer.from(req.bodyBinary) : (req.bodyText || undefined));

    const result = await fetchThrough(target, req.method, incomingHeaders, body, session.cookies);
    await saveSession(storage, sid, session.fileId, result.cookies);

    const response = result.response;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const functionOrigin = `${req.scheme || 'https'}://${req.host}`;
    const headers = {
      ...responseHeaders(response.headers),
      ...baseCors,
      'Cache-Control': contentType.includes('text/html') ? 'no-store' : 'public, max-age=60',
      'X-Lyrenthos-Session': sid,
    };
    const location = response.headers.get('location');
    if (location) headers.Location = proxiedUrl(functionOrigin, sid, new URL(location, result.url).toString());

    if (req.method === 'HEAD') return res.empty(response.status, headers);
    if (contentType.includes('text/html')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_HTML) return res.json({ ok: false, error: 'HTML response too large for this Appwrite-only gateway.' }, 502, baseCors);
      const text = rewriteHtml(bytes.toString('utf8'), functionOrigin, sid, result.url);
      return res.text(text, response.status, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (contentType.includes('text/css')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_HTML) return res.json({ ok: false, error: 'CSS response too large.' }, 502, baseCors);
      const text = rewriteCss(bytes.toString('utf8'), functionOrigin, sid, result.url);
      return res.text(text, response.status, { ...headers, 'Content-Type': 'text/css; charset=utf-8' });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BODY) return res.json({ ok: false, error: 'Response too large for this Appwrite-only gateway.' }, 502, baseCors);
    return res.binary(bytes, response.status, headers);
  } catch (e) {
    error(e?.stack || e?.message || String(e));
    return res.json({ ok: false, error: e?.message || 'Gateway request failed.' }, 502, baseCors);
  }
};
