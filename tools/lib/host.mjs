// A stand-in for the app's plugin runtime, for testing plugins under Node 22 without npm
// packages. It provides the globals a plugin may use and nothing of Node itself.

import vm from 'node:vm';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 8;
const DEFAULT_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------- name resolution

const dnsCache = new Map();

function dohQuery(name, type) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        host: '1.1.1.1',
        servername: 'cloudflare-dns.com',
        path: `/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
        headers: { accept: 'application/dns-json', host: 'cloudflare-dns.com' },
        timeout: 6000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const wanted = type === 'A' ? 1 : 28;
            resolve((answer.Answer || []).filter((a) => a.type === wanted).map((a) => a.data));
          } catch (error) {
            reject(new Error(`DNS-over-HTTPS answer for ${name} unreadable`));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error(`DNS-over-HTTPS lookup of ${name} timed out`)));
    request.on('error', reject);
  });
}

async function resolveOverHttps(name) {
  if (!dnsCache.has(name)) {
    dnsCache.set(
      name,
      dohQuery(name, 'A').then((addresses) => {
        if (addresses.length === 0) throw new Error(`no address for ${name}`);
        return addresses;
      }),
    );
  }
  return dnsCache.get(name);
}

function dohLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  resolveOverHttps(hostname).then(
    (addresses) => {
      if (options && options.all) {
        callback(null, addresses.map((address) => ({ address, family: 4 })));
      } else {
        callback(null, addresses[0], 4);
      }
    },
    (error) => {
      dnsCache.delete(hostname);
      const failure = new Error(`getaddrinfo ENOTFOUND ${hostname} (${error.message})`);
      failure.code = 'ENOTFOUND';
      callback(failure);
    },
  );
}

// ---------------------------------------------------------------- HTTP

function decodeBody(buffer, encoding) {
  try {
    switch ((encoding || '').toLowerCase()) {
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(buffer);
      case 'deflate':
        return zlib.inflateSync(buffer);
      case 'br':
        return zlib.brotliDecompressSync(buffer);
      case 'zstd':
        return zlib.zstdDecompressSync ? zlib.zstdDecompressSync(buffer) : buffer;
      default:
        return buffer;
    }
  } catch (error) {
    return buffer;
  }
}

function requestOnce(url, init, settings) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const headers = { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'gzip, deflate, br' };
    for (const [name, value] of Object.entries(init.headers || {})) {
      if (value !== undefined && value !== null) headers[name.toLowerCase()] = String(value);
    }
    let body = init.body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
      if (!headers['content-type']) headers['content-type'] = 'application/json';
    }
    if (body !== undefined && body !== null) headers['content-length'] = String(Buffer.byteLength(body));

    const timeoutMs = init.timeout ? Number(init.timeout) * 1000 : settings.timeoutMs;
    const request = transport.request(
      target,
      {
        method: (init.method || 'GET').toUpperCase(),
        headers,
        lookup: settings.systemDns ? undefined : dohLookup,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let received = 0;
        const finish = () =>
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: decodeBody(Buffer.concat(chunks), response.headers['content-encoding']),
            url: target.href,
          });
        response.on('data', (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          if (settings.maxBytes && received >= settings.maxBytes) {
            finish();
            request.destroy();
          }
        });
        response.on('end', finish);
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error(`request to ${target.host} timed out`)));
    request.on('error', (error) => reject(new Error(`${target.host}: ${error.message}`)));
    if (body !== undefined && body !== null) request.write(body);
    request.end();
  });
}

async function rawFetch(url, init, settings) {
  let current = String(url);
  let options = { ...(init || {}) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestOnce(current, options, settings);
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.status) && location && options.redirect !== 'manual') {
      current = new URL(location, current).href;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && options.method && options.method.toUpperCase() === 'POST')) {
        options = { ...options, method: 'GET', body: undefined };
      }
      continue;
    }
    return response;
  }
  throw new Error(`too many redirects from ${url}`);
}

function flatHeaders(raw) {
  const flat = {};
  for (const [name, value] of Object.entries(raw)) {
    flat[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return flat;
}

// The response object mirrors Seanime's: `headers` is a plain object, and it also answers
// `headers.get(name)` the way a browser's does, so plugins written for either keep working.
function responseObject(response) {
  const headers = flatHeaders(response.headers);
  Object.defineProperty(headers, 'get', {
    enumerable: false,
    value: (name) => {
      const wanted = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(headers, wanted) ? headers[wanted] : null;
    },
  });
  const text = response.body.toString('utf8');
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: String(response.status),
    url: response.url,
    redirected: false,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function toBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new TypeError('expected bytes or a base64 string');
}

// ---------------------------------------------------------------- the context

export const HOST_VERSION = '0.0.0-harness';

/**
 * Builds the global scope a plugin runs in.
 * `options`: { systemDns, timeoutMs, trace, anilili } — `anilili: false` leaves `$anilili` out,
 * which is how a plugin sees a host other than Anilili.
 */
export function createContext(options = {}) {
  const settings = {
    systemDns: Boolean(options.systemDns),
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  };
  const trace = options.trace ? (line) => process.stderr.write(`  [net] ${line}\n`) : () => {};

  const timed = async (label, work) => {
    const started = Date.now();
    try {
      const response = await work();
      trace(`${label} -> ${response.status} (${Date.now() - started} ms)`);
      return response;
    } catch (error) {
      trace(`${label} -> ${error.message} (${Date.now() - started} ms)`);
      throw error;
    }
  };

  const fetch = async (url, init) =>
    responseObject(await timed(`${(init && init.method) || 'GET'} ${url}`, () => rawFetch(url, init, settings)));

  const log = (level) => (...parts) => {
    if (options.quiet && level !== 'error' && level !== 'warn') return;
    process.stderr.write(`  [${level}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  };

  const sandbox = {
    fetch,
    console: { log: log('log'), info: log('info'), debug: log('debug'), warn: log('warn'), error: log('error') },
    LoadDoc: () => {
      throw new Error('LoadDoc is not provided by this test harness');
    },
    Buffer,
    atob,
    btoa,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  if (options.anilili !== false) {
    sandbox.$anilili = {
      version: HOST_VERSION,
      gunzip: (data) => zlib.gunzipSync(toBytes(data)).toString('utf8'),
      xor: (data, key) => {
        const bytes = Buffer.from(toBytes(data));
        const mask = Buffer.from(String(key), 'utf8');
        if (mask.length === 0) throw new Error('xor: empty key');
        for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= mask[i % mask.length];
        return bytes.toString('base64');
      },
      fetchBytes: async (url, init) => {
        const response = await timed(`BYTES ${url}`, () => rawFetch(url, init, settings));
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          url: response.url,
          headers: flatHeaders(response.headers),
          base64: response.body.toString('base64'),
        };
      },
    };
  }

  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

/** Compiles a plugin payload and returns its `Provider` class; throws when it defines none. */
export function loadProviderClass(source, filename, context) {
  const script = new vm.Script(`${source}\n;typeof Provider === 'undefined' ? undefined : Provider;`, { filename });
  const Provider = script.runInContext(context);
  if (typeof Provider !== 'function') throw new Error(`${filename} defines no class Provider`);
  return Provider;
}

export function loadProvider(file, options = {}) {
  const context = createContext(options);
  const Provider = loadProviderClass(readFileSync(file, 'utf8'), file, context);
  return new Provider();
}

/** Fetches a URL the way the harness does for plugins; used to check that a stream answers. */
export async function probe(url, headers, options = {}) {
  const response = await rawFetch(url, { headers: { ...(headers || {}), range: 'bytes=0-4095' } }, {
    systemDns: Boolean(options.systemDns),
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBytes: 65536,
  });
  return {
    status: response.status,
    contentType: String(response.headers['content-type'] || ''),
    length: response.body.length,
    head: response.body.subarray(0, 4096),
    url: response.url,
  };
}
