#!/usr/bin/env node
// Validates the repository without touching the network: index.json, every manifest and every
// payload. Exits with status 1 when anything is wrong.
//
// index.json holds two kinds of entries. A plugin of this repository is its whole manifest and
// has a folder under src/. A community plugin is a reference: its `manifestURI` points at the
// manifest in its author's repository, and it carries neither a version nor the code, so the
// app reads both from there and follows the author's updates.
//
//   node tools/check.mjs

import vm from 'node:vm';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_BASE = 'https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main';
const REQUIRED = ['id', 'name', 'version', 'author', 'description', 'type', 'language', 'lang', 'manifestURI'];
const METHODS = ['getSettings', 'search', 'findEpisodes', 'findEpisodeServer'];
const REFERENCE_REQUIRED = ['id', 'name', 'author', 'description', 'type', 'lang', 'website', 'manifestURI'];
const REFERENCE_ALLOWED = [...REFERENCE_REQUIRED, 'icon'];
const REFERENCE_HOST = 'raw.githubusercontent.com';

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

function readJson(path, where) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(where, `not readable as JSON (${error.message})`);
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// A scope with the plugin globals in which nothing may happen while the payload loads.
function inertContext(sideEffects, withAnilili) {
  const record = (name) => (...args) => {
    sideEffects.push(name);
    if (name === 'fetch' || name.startsWith('$anilili')) return Promise.reject(new Error('no network in check'));
    return 0;
  };
  const sandbox = {
    fetch: record('fetch'),
    LoadDoc: record('LoadDoc'),
    setTimeout: record('setTimeout'),
    setInterval: record('setInterval'),
    clearTimeout: () => {},
    clearInterval: () => {},
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    Buffer,
    atob,
    btoa,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  };
  if (withAnilili) {
    sandbox.$anilili = {
      version: 'check',
      gunzip: record('$anilili.gunzip'),
      xor: record('$anilili.xor'),
      fetchBytes: record('$anilili.fetchBytes'),
    };
  }
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

async function checkPayload(where, file, source) {
  let script;
  try {
    script = new vm.Script(`${source}\n;typeof Provider === 'undefined' ? undefined : Provider;`, { filename: file });
  } catch (error) {
    fail(where, `payload does not parse as a script (${error.message})`);
    return;
  }

  const sideEffects = [];
  let Provider;
  try {
    Provider = script.runInContext(inertContext(sideEffects, true), { timeout: 2000 });
  } catch (error) {
    fail(where, `payload throws while loading (${error.message})`);
    return;
  }
  if (typeof Provider !== 'function') {
    fail(where, 'payload defines no class Provider');
    return;
  }

  let provider;
  try {
    provider = new Provider();
  } catch (error) {
    fail(where, `new Provider() throws (${error.message})`);
    return;
  }
  for (const method of METHODS) {
    if (typeof provider[method] !== 'function') fail(where, `Provider has no method ${method}()`);
  }
  if (sideEffects.length > 0) {
    fail(where, `payload acts while loading or constructing (${[...new Set(sideEffects)].join(', ')})`);
  }
  if (typeof provider.getSettings !== 'function') return;

  let settings;
  try {
    settings = provider.getSettings();
  } catch (error) {
    fail(where, `getSettings() throws (${error.message})`);
    return;
  }
  if (!settings || typeof settings !== 'object' || typeof settings.then === 'function') {
    fail(where, 'getSettings() must return an object, synchronously');
    return;
  }
  if (typeof settings.supportsDub !== 'boolean') fail(where, 'getSettings().supportsDub must be a boolean');
  const servers = settings.episodeServers;
  if (!Array.isArray(servers) || servers.length === 0 || servers.some((s) => typeof s !== 'string' || !s)) {
    fail(where, 'getSettings().episodeServers must be a non-empty array of names');
  } else if (new Set(servers).size !== servers.length) {
    fail(where, 'getSettings().episodeServers has duplicates');
  } else if (servers.includes('default')) {
    fail(where, '"default" is what a host passes for no choice and cannot be a server name');
  }

  // A plugin that uses the Anilili helpers must say so when they are missing.
  if (/\$anilili\b/.test(source)) {
    const BareProvider = script.runInContext(inertContext([], false), { timeout: 2000 });
    const bare = new BareProvider();
    const calls = [
      ['search', () => bare.search({ media: { id: 1, synonyms: [], isAdult: false }, query: 'x', dub: false })],
      ['findEpisodes', () => bare.findEpisodes('x')],
      ['findEpisodeServer', () => bare.findEpisodeServer({ id: 'x', number: 1, url: '' }, 'default')],
    ];
    for (const [name, call] of calls) {
      let message = null;
      try {
        await call();
      } catch (error) {
        message = error && error.message ? error.message : String(error);
      }
      if (message === null || !/requires Anilili/i.test(message)) {
        fail(where, `${name}() without $anilili must fail with "requires Anilili" (got ${message === null ? 'a result' : `"${message}"`})`);
      }
    }
  }
}

async function checkManifest(where, manifest, folderId) {
  for (const field of REQUIRED) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) fail(where, `"${field}" is missing or empty`);
  }
  const id = manifest.id;
  if (typeof id !== 'string') return;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(where, `id "${id}" must be lowercase letters, digits and dashes`);
  if (folderId !== undefined && id !== folderId) fail(where, `id "${id}" does not match its folder "${folderId}"`);
  if (manifest.type !== 'onlinestream-provider') fail(where, `type must be "onlinestream-provider" (is "${manifest.type}")`);
  if (manifest.language !== 'javascript') fail(where, `language must be "javascript" (is "${manifest.language}")`);
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version))) fail(where, `version "${manifest.version}" is not MAJOR.MINOR.PATCH`);

  const expected = {
    manifestURI: `${RAW_BASE}/src/${id}/manifest.json`,
    payloadURI: `${RAW_BASE}/src/${id}/provider.js`,
  };
  for (const [field, url] of Object.entries(expected)) {
    if (field === 'payloadURI' && manifest.payloadURI === undefined && typeof manifest.payload === 'string') continue;
    if (!isHttpsUrl(manifest[field])) fail(where, `"${field}" is not an https URL`);
    else if (manifest[field] !== url) fail(where, `"${field}" should be ${url}`);
  }
  if (manifest.payloadURI === undefined && typeof manifest.payload !== 'string') fail(where, 'neither "payloadURI" nor "payload" is given');
  if (manifest.payloadURI !== undefined && manifest.payload !== undefined) fail(where, 'give "payloadURI" or "payload", not both');

  for (const field of ['icon', 'website']) {
    if (manifest[field] !== undefined && manifest[field] !== '' && !isHttpsUrl(manifest[field])) fail(where, `"${field}" is not an https URL`);
  }
  if (typeof manifest.icon === 'string' && manifest.icon.startsWith(`${RAW_BASE}/`)) {
    const local = join(ROOT, manifest.icon.slice(RAW_BASE.length + 1));
    if (!existsSync(local)) fail(where, `icon file ${manifest.icon.slice(RAW_BASE.length + 1)} does not exist`);
  }
}

// A plugin of this repository names its manifest here; anything else is a community reference.
function isReference(entry) {
  return typeof entry.manifestURI === 'string' && !entry.manifestURI.startsWith(`${RAW_BASE}/`);
}

function checkReference(where, entry) {
  for (const field of REFERENCE_REQUIRED) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) fail(where, `"${field}" is missing or empty`);
  }
  for (const field of Object.keys(entry)) {
    if (field === 'version' || field === 'payload' || field === 'payloadURI') {
      fail(where, `a community reference must not carry "${field}": the app takes it from the author's manifest`);
    } else if (!REFERENCE_ALLOWED.includes(field)) {
      fail(where, `unexpected field "${field}" in a community reference`);
    }
  }
  const id = entry.id;
  // The id is the author's; the app accepts letters, digits, dashes and underscores.
  if (typeof id === 'string' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) fail(where, `id "${id}" is not a usable plugin id`);
  if (entry.type !== 'onlinestream-provider') fail(where, `type must be "onlinestream-provider" (is "${entry.type}")`);
  if (typeof entry.author === 'string' && entry.author.trim().toLowerCase() === 'anilili') {
    fail(where, 'a community reference names its own author, not Anilili');
  }
  let manifestUrl = null;
  try {
    manifestUrl = new URL(entry.manifestURI);
  } catch {
    manifestUrl = null;
  }
  if (!manifestUrl || manifestUrl.protocol !== 'https:') fail(where, '"manifestURI" is not an https URL');
  else if (manifestUrl.host !== REFERENCE_HOST) fail(where, `"manifestURI" must be a file on ${REFERENCE_HOST}`);
  else if (!manifestUrl.pathname.toLowerCase().endsWith('.json')) fail(where, '"manifestURI" must name a .json manifest');
  // `website` is the repository the plugin is maintained in.
  if (typeof entry.website === 'string' && !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(entry.website)) {
    fail(where, '"website" must be the https://github.com/<owner>/<repo> the plugin is maintained in');
  } else if (manifestUrl && typeof entry.website === 'string') {
    const owner = entry.website.split('/')[3].toLowerCase();
    if (manifestUrl.pathname.split('/')[1].toLowerCase() !== owner) fail(where, '"manifestURI" is not in the repository "website" names');
  }
  if (entry.icon !== undefined && entry.icon !== '' && !isHttpsUrl(entry.icon)) fail(where, '"icon" is not an https URL');
  if (typeof id === 'string' && existsSync(join(ROOT, 'src', id))) fail(where, `src/${id}/ exists: a community reference has no code here`);
}

async function main() {
  const index = readJson(join(ROOT, 'index.json'), 'index.json');
  if (index !== null && !Array.isArray(index)) fail('index.json', 'must be an array of manifests');
  const entries = Array.isArray(index) ? index : [];

  const seen = new Set();
  let references = 0;
  for (const [position, entry] of entries.entries()) {
    const where = `index.json[${position}]${entry && entry.id ? ` (${entry.id})` : ''}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(where, 'is not a manifest object');
      continue;
    }
    // Ids are compared without case: the app keeps one plugin per id and files per id.
    const key = typeof entry.id === 'string' ? entry.id.toLowerCase() : entry.id;
    if (seen.has(key)) fail(where, `id "${entry.id}" appears more than once`);
    seen.add(key);
    if (isReference(entry)) {
      references += 1;
      checkReference(where, entry);
      continue;
    }
    if (references > 0) fail(where, 'plugins of this repository come before the community references');
    await checkManifest(where, entry);
    if (typeof entry.id === 'string' && !existsSync(join(ROOT, 'src', entry.id, 'manifest.json'))) {
      fail(where, `src/${entry.id}/manifest.json does not exist`);
    }
  }

  const srcDir = join(ROOT, 'src');
  const folders = existsSync(srcDir)
    ? readdirSync(srcDir).filter((name) => statSync(join(srcDir, name)).isDirectory()).sort()
    : [];
  if (folders.length === 0) fail('src/', 'holds no plugin');

  for (const folder of folders) {
    const where = `src/${folder}`;
    const manifestPath = join(srcDir, folder, 'manifest.json');
    const payloadPath = join(srcDir, folder, 'provider.js');
    if (!existsSync(manifestPath)) {
      fail(where, 'manifest.json is missing');
      continue;
    }
    const manifest = readJson(manifestPath, `${where}/manifest.json`);
    if (!manifest) continue;
    await checkManifest(`${where}/manifest.json`, manifest, folder);

    const listed = entries.find((entry) => entry && entry.id === manifest.id);
    if (!listed) fail(where, 'is not listed in index.json');
    else if (JSON.stringify(listed) !== JSON.stringify(manifest)) {
      const differing = [...new Set([...Object.keys(listed), ...Object.keys(manifest)])].filter(
        (key) => JSON.stringify(listed[key]) !== JSON.stringify(manifest[key]),
      );
      fail(where, `manifest.json and its index.json entry differ in: ${differing.join(', ')}`);
    }

    if (typeof manifest.payload === 'string') {
      await checkPayload(`${where}/manifest.json payload`, manifestPath, manifest.payload);
    } else if (!existsSync(payloadPath)) {
      fail(where, 'provider.js is missing');
    } else {
      await checkPayload(`${where}/provider.js`, payloadPath, readFileSync(payloadPath, 'utf8'));
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`FAIL ${problem}\n`);
    process.stderr.write(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
    process.exit(1);
  }
  const own = entries.length - references;
  process.stdout.write(`ok: ${entries.length} plugin${entries.length === 1 ? '' : 's'} in index.json: ${own} under src/ (${folders.join(', ')}), ${references} community reference${references === 1 ? '' : 's'}\n`);
}

main().catch((error) => {
  process.stderr.write(`check failed to run: ${error.stack || error}\n`);
  process.exit(1);
});
