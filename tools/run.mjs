#!/usr/bin/env node
// Runs a plugin's methods from the command line, against the real sites.
//
//   node tools/run.mjs <plugin> settings
//   node tools/run.mjs <plugin> search   --anilist 21 [--dub]
//   node tools/run.mjs <plugin> search   --query "One Piece" [--year 1999] [--dub]
//   node tools/run.mjs <plugin> episodes <anime id from search>
//   node tools/run.mjs <plugin> server   <episode id> [--number 1] [--server default]
//   node tools/run.mjs <plugin> play     --anilist 21 [--episode 1] [--dub] [--server default]
//
// <plugin> is a folder name under src/ or a path to a provider.js. `play` runs the whole chain
// (search, pick the matching result, list episodes, resolve the episode) and then fetches the
// first stream and subtitle with the returned headers to see whether they answer.
//
// Options: --trace (log every request), --system-dns (use the system resolver instead of
// DNS-over-HTTPS), --no-anilili (run without the $anilili helpers, as another host would),
// --json (print results as JSON only), --timeout <seconds>.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProvider, probe, createContext } from './lib/host.mjs';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  const booleans = new Set(['dub', 'trace', 'system-dns', 'no-anilili', 'json', 'help']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (booleans.has(name)) flags[name] = true;
      else {
        flags[name] = argv[i + 1];
        i += 1;
      }
    } else positional.push(arg);
  }
  return { flags, positional };
}

function usage(code) {
  process.stderr.write(
    [
      'usage: node tools/run.mjs <plugin> <settings|search|episodes|server|play> [arguments]',
      '  search   --anilist <id> | --query <title> [--year <y>] [--dub]',
      '  episodes <anime id>',
      '  server   <episode id> [--number <n>] [--server <name>]',
      '  play     --anilist <id> [--episode <n>] [--dub] [--server <name>]',
      '  options  --trace --system-dns --no-anilili --json --timeout <seconds>',
      '',
    ].join('\n'),
  );
  process.exit(code);
}

function providerPath(name) {
  const candidates = [join(ROOT, 'src', name, 'provider.js'), resolve(name)];
  const found = candidates.find((candidate) => existsSync(candidate) && candidate.endsWith('.js'));
  if (!found) throw new Error(`no plugin '${name}' (looked for ${candidates[0]})`);
  return found;
}

// The media object a host hands to `search`, built from AniList.
async function anilistMedia(id, hostOptions) {
  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal status format episodes isAdult synonyms
    title { english romaji } startDate { year month day } } }`;
  const context = createContext({ ...hostOptions, quiet: true });
  context.__request = { query, variables: { id } };
  const answer = await vm.runInContext(
    `(async () => {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(__request),
      });
      if (!response.ok) throw new Error('AniList answered HTTP ' + response.status);
      return JSON.stringify(await response.json());
    })()`,
    context,
  );
  const media = JSON.parse(answer).data.Media;
  return {
    id: media.id,
    idMal: media.idMal || undefined,
    status: media.status || undefined,
    format: media.format || undefined,
    englishTitle: media.title.english || undefined,
    romajiTitle: media.title.romaji || undefined,
    episodeCount: media.episodes || undefined,
    synonyms: media.synonyms || [],
    isAdult: Boolean(media.isAdult),
    startDate: media.startDate && media.startDate.year ? media.startDate : undefined,
  };
}

const normalize = (title) =>
  String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function similarity(a, b) {
  const [na, nb] = [normalize(a), normalize(b)];
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const [wa, wb] = [new Set(na.split(' ')), new Set(nb.split(' '))];
  const shared = [...wa].filter((word) => wb.has(word)).length;
  return Math.min(0.99, (2 * shared) / (wa.size + wb.size));
}

// A stand-in for the app's choice among search results: best title similarity, the site's
// order between equals, and a result whose year is known and far off counts for less.
function pickResult(results, media, year) {
  const wanted = [media.englishTitle, media.romajiTitle, ...(media.synonyms || [])].filter(Boolean);
  let best = null;
  for (const result of results) {
    const titles = [result.title, ...(Array.isArray(result.altTitles) ? result.altTitles : [])];
    let score = 0;
    for (const title of titles) for (const want of wanted) score = Math.max(score, similarity(title, want));
    if (year && typeof result.year === 'number' && Math.abs(result.year - year) > 1) score *= 0.7;
    if (!best || score > best.score) best = { score, result };
  }
  return best;
}

async function timed(label, quiet, work) {
  const started = Date.now();
  try {
    const value = await work();
    if (!quiet) process.stderr.write(`${label}: ${Date.now() - started} ms\n`);
    return { value, ms: Date.now() - started };
  } catch (error) {
    if (!quiet) process.stderr.write(`${label}: failed after ${Date.now() - started} ms\n`);
    throw error;
  }
}

function describeProbe(result, kind) {
  const text = result.head.toString('latin1');
  let verdict = 'unrecognised answer';
  if (result.status >= 400) verdict = 'refused';
  else if (kind === 'm3u8') verdict = text.includes('#EXTM3U') ? 'playlist' : 'not a playlist';
  else if (kind === 'mp4') verdict = text.slice(4, 8) === 'ftyp' || /video\//.test(result.contentType) ? 'video' : 'not a video';
  else if (kind === 'subtitle') verdict = result.length > 0 ? 'subtitle file' : 'empty';
  return { status: result.status, contentType: result.contentType, bytes: result.length, verdict };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length < 2) usage(flags.help ? 0 : 2);
  const [pluginName, command, ...rest] = positional;

  const hostOptions = {
    trace: Boolean(flags.trace),
    systemDns: Boolean(flags['system-dns']),
    anilili: !flags['no-anilili'],
    quiet: Boolean(flags.json),
    timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined,
  };
  const quiet = Boolean(flags.json);
  const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  const provider = loadProvider(providerPath(pluginName), hostOptions);

  const searchOptions = async () => {
    let media = { id: 0, synonyms: [], isAdult: false };
    if (flags.anilist) media = await anilistMedia(Number(flags.anilist), hostOptions);
    const query = flags.query || media.romajiTitle || media.englishTitle;
    if (!query) throw new Error('search needs --anilist <id> or --query <title>');
    const year = flags.year ? Number(flags.year) : media.startDate ? media.startDate.year : undefined;
    return { media, query, dub: Boolean(flags.dub), year };
  };

  switch (command) {
    case 'settings':
      print(provider.getSettings());
      return;

    case 'search': {
      const { value } = await timed('search', quiet, async () => provider.search(await searchOptions()));
      print(value);
      return;
    }

    case 'episodes': {
      if (!rest[0]) usage(2);
      const { value } = await timed('findEpisodes', quiet, () => provider.findEpisodes(rest[0]));
      if (!quiet) process.stderr.write(`${value.length} episodes\n`);
      print(value);
      return;
    }

    case 'server': {
      if (!rest[0]) usage(2);
      const episode = { id: rest[0], number: Number(flags.number || 0), url: flags.url || '' };
      const { value } = await timed('findEpisodeServer', quiet, () =>
        provider.findEpisodeServer(episode, flags.server || 'default'),
      );
      print(value);
      return;
    }

    case 'play': {
      const options = await searchOptions();
      const wantedNumber = Number(flags.episode || 1);
      const report = { plugin: pluginName, audio: options.dub ? 'dub' : 'sub', query: options.query };

      const search = await timed('search', quiet, () => provider.search(options));
      report.searchMs = search.ms;
      report.results = search.value.length;
      if (search.value.length === 0) throw new Error('search returned no result');
      const picked = pickResult(search.value, options.media, options.year);
      report.picked = { id: picked.result.id, title: picked.result.title, subOrDub: picked.result.subOrDub, score: Number(picked.score.toFixed(2)) };

      const episodes = await timed('findEpisodes', quiet, () => provider.findEpisodes(picked.result.id));
      report.episodesMs = episodes.ms;
      report.episodes = episodes.value.length;
      report.titled = episodes.value.filter((e) => e.title && !/^Episode \d+(\.\d+)?$/.test(e.title)).length;
      const episode = episodes.value.find((e) => Math.abs(e.number - wantedNumber) < 0.01);
      if (!episode) throw new Error(`episode ${wantedNumber} is not in the list`);
      report.episode = { id: episode.id, number: episode.number, title: episode.title };

      const server = await timed('findEpisodeServer', quiet, () =>
        provider.findEpisodeServer(episode, flags.server || 'default'),
      );
      report.serverMs = server.ms;
      report.server = server.value.server;
      report.headers = server.value.headers;
      if (server.value.skip) report.skip = server.value.skip;
      report.sources = server.value.videoSources.map((source) => ({
        quality: source.quality,
        label: source.label,
        type: source.type,
        url: source.url,
        subtitles: (source.subtitles || []).map((s) => `${s.language}${s.isDefault ? ' (default)' : ''}`),
      }));

      const first = server.value.videoSources[0];
      if (!first) throw new Error('findEpisodeServer returned no video source');
      const stream = await timed('stream check', quiet, () => probe(first.url, server.value.headers, hostOptions));
      report.stream = describeProbe(stream.value, first.type);
      const subtitle = (first.subtitles || []).find((s) => s.isDefault) || (first.subtitles || [])[0];
      if (subtitle) {
        try {
          const fetched = await probe(subtitle.url, server.value.headers, hostOptions);
          report.subtitle = { language: subtitle.language, url: subtitle.url, ...describeProbe(fetched, 'subtitle') };
        } catch (error) {
          report.subtitle = { language: subtitle.language, url: subtitle.url, verdict: `failed: ${error.message}` };
        }
      }
      print(report);
      const playable = report.stream.verdict === 'playlist' || report.stream.verdict === 'video';
      process.exitCode = playable ? 0 : 1;
      return;
    }

    default:
      usage(2);
  }
}

main().then(
  // Sockets left open by a site must not keep the tool running.
  () => process.exit(process.exitCode || 0),
  (error) => {
    process.stderr.write(`error: ${error && error.message ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
