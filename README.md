# Anilili Linux plugins

Streaming-source plugins for [Anilili Linux](https://github.com/MaidLover69/Anilili_Linux).

Anilili shows anime and episode lists on its own, but it plays nothing until a streaming
plugin is installed. A plugin is a small JavaScript file that knows one site: how to find an
anime there, list its episodes and locate the stream of an episode. Sites change often; a
plugin is fixed by updating a file in this repository, without a new release of the app.

The plugins use Seanime's `onlinestream-provider` extension format, so repositories of Seanime
streaming providers can be added to the app next to this one.

## Adding this repository to the app

1. Open **Settings → Plugins**.
2. Paste the repository link and add it:

   ```
   https://github.com/MaidLover69/Anilili_Linux_plugins
   ```

3. The app downloads `index.json` and every plugin in it. Each plugin has its own on/off switch.

The app also accepts a direct link to an `index.json`-style list, or to a single plugin's
`manifest.json`.

## Plugins

| Plugin | id | Audio | Streams | Status |
| --- | --- | --- | --- | --- |
| Miruro | `miruro` | sub, dub | HLS (some MP4) from several upstream sites; soft or hard subtitles; intro/outro times | Working. Needs Anilili (see below) |
| AniZone | `anizone` | sub | HLS with soft subtitles in several languages | Working |
| KickAssAnime | `kickassanime` | sub, dub | HLS with soft subtitles | Working. Some shows are listed dubbed without a video |
| AnimeGG | `animegg` | sub, dub | MP4, 360p to 1080p | Working |

"Working" means: checked against the live site on 2026-10-09 with `tools/run.mjs` (One Piece
episode 1 and one more show; search, episode list, stream and subtitle fetched with the
returned headers).

Miruro finds an anime by its AniList id instead of by title, and its answers are compressed
and obfuscated, which takes helpers only Anilili provides. In another host it fails with
"requires Anilili".

### Not ported

These sources were built into earlier versions of the app and are not offered as plugins,
because the sites did not yield a playable stream when checked on 2026-10-09:

| Source | What happens |
| --- | --- |
| AniBD | The episode list answers, but every player link redirects to an unrelated site |
| AniDbApp | The site redirects to a different site (`anilab.so`) |
| Anikoto | Its API answers with an error page. Its streams are available through Miruro |
| AnimeHeaven | Most connections are reset by the site |
| AnimeKai | One mirror times out, the other is a parked domain |
| AnimePahe | Blocked by a Cloudflare challenge (HTTP 403) |
| AnimeShqip | The search endpoint refuses requests that do not come from its own pages |
| Senshi | The site's TLS certificate cannot be verified |

## Repository layout

```
index.json                  every plugin's manifest, as one array (what the app downloads first)
src/<id>/manifest.json      one plugin's manifest
src/<id>/provider.js        its code
public/<id>.svg             its icon
tools/run.mjs               run a plugin against the live site
tools/check.mjs             validate index.json, manifests and code (also run by CI)
```

A manifest:

```json
{
  "id": "anizone",
  "name": "AniZone",
  "version": "1.0.0",
  "description": "…",
  "author": "Anilili",
  "type": "onlinestream-provider",
  "language": "javascript",
  "lang": "en",
  "icon": "https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/public/anizone.svg",
  "website": "https://anizone.to",
  "manifestURI": "https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/src/anizone/manifest.json",
  "payloadURI": "https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/src/anizone/provider.js"
}
```

`id` is lowercase, equals the folder name and never changes: the app stores watch history,
downloads and the preferred source under it. `name` is what the user sees.

## Writing a plugin

A plugin is one script that defines `class Provider` with four methods. Types are Seanime's
(`onlinestream-provider.d.ts`):

```js
class Provider {
  // Synchronous. `episodeServers` are the names accepted by findEpisodeServer.
  getSettings() {
    return { episodeServers: ["MyServer"], supportsDub: true };
  }

  // opts: { media, query, dub, year }. `media` is the AniList entry: id, idMal, englishTitle,
  // romajiTitle, synonyms, episodeCount, startDate, format, status, isAdult.
  // Returns the site's hits: [{ id, title, url, subOrDub: "sub" | "dub" | "both" }].
  async search(opts) {}

  // id: the id of one search result.
  // Returns [{ id, number, url, title? }].
  async findEpisodes(id) {}

  // episode: one item from findEpisodes. server: a name from episodeServers, or "default".
  // Returns { server, headers, videoSources: [{ url, type: "m3u8" | "mp4" | "unknown",
  //   quality, label?, subtitles: [{ id, url, language, isDefault }] }] }.
  async findEpisodeServer(episode, server) {}
}
```

How the plugins here use that interface:

- **Ids carry what the next call needs.** `findEpisodes` only receives the id of a search
  result and `findEpisodeServer` only an episode, so the audio version, site slugs and the like
  are packed into the id strings (for example `one-piece|dub`).
- **Sub and dub.** `search` is called with `opts.dub`; the results say `subOrDub` and their ids
  remember it. When the site has no dub for an anime, a dub search returns nothing.
- **Search returns candidates, not a decision.** Every hit of the site is returned and the app
  picks by title and year. Results may carry the optional extras `altTitles` (string[]),
  `year` and `episodeCount` to help with that.
- **`server`.** `"default"` means the plugin chooses: it tries what the episode offers in a
  sensible order. A name from `episodeServers` restricts it to that server.
- **Headers.** `headers` are what the video host needs (usually `Referer`); they apply to
  every video source and subtitle of the result.
- **Subtitles** belong to the video source they were published with. Exactly one is the
  default where the site gives a reason to choose. The optional extra `format`
  (`vtt`, `srt`, `ass`) is set where the file name does not tell.
- **Errors** are thrown as `new Error("short, specific reason")`: the app shows the message as
  the reason that source failed. "Not on this site" is an empty search result, not an error.
- Nothing runs when the script loads; all work happens inside the methods.

### Globals

Plugins run in a sandbox, not in Node or a browser. Available:

| Global | Notes |
| --- | --- |
| `fetch(url, init)` | `init`: `method`, `headers`, `body`. The response has `ok`, `status`, `url`, `headers`, `text()`, `json()`. Read headers defensively: hosts differ on whether `headers` is a plain object or has `.get()` |
| `LoadDoc(html)` | A cheerio-like selection API for HTML |
| `CryptoJS`, `Buffer`, `atob`, `btoa` | |
| `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder` | |
| `console.*`, `setTimeout` and the other timers | |

There is no `require`, `import`, `process`, DOM or file access.

### Anilili extras

Anilili adds one object, `$anilili`, for what Seanime's globals cannot do:

| Member | |
| --- | --- |
| `$anilili.fetchBytes(url, init)` | Like `fetch`, for binary answers: resolves to `{ ok, status, url, headers, base64 }` |
| `$anilili.xor(bytesOrBase64, key)` | XOR with a repeating text key; returns base64 |
| `$anilili.gunzip(bytesOrBase64)` | Decompresses gzip; returns the text (UTF-8) |
| `$anilili.version` | The version of the Anilili plugin runtime |

A plugin that uses `$anilili` must fail cleanly in any other host: check for it at the start of
each method and throw an error whose message contains `requires Anilili`. `getSettings()` must
work regardless. `tools/check.mjs` enforces both.

```js
if (typeof $anilili === "undefined") throw new Error("requires Anilili");
```

Results may also carry a few optional fields that Seanime ignores: `skip` on the result of
`findEpisodeServer` (`{ introStart, introEnd, outroStart, outroEnd }`, seconds), and `image`
and `synopsis` on episodes.

## Testing

Node 22 or newer; no packages to install.

```sh
# validate index.json, every manifest and every provider.js (no network)
node tools/check.mjs

# the whole chain against the live site: search, pick, list episodes, resolve one episode,
# then fetch the stream and subtitle with the returned headers
node tools/run.mjs miruro play --anilist 21
node tools/run.mjs animegg play --anilist 21 --episode 5 --dub

# single steps
node tools/run.mjs anizone settings
node tools/run.mjs anizone search --anilist 21
node tools/run.mjs anizone search --query "One Piece" --year 1999
node tools/run.mjs anizone episodes "<id from search>"
node tools/run.mjs anizone server "<id from episodes>" --server default
```

`--anilist <id>` fetches the anime from AniList to build `opts.media`, as the app does.
`play` exits with status 0 only when the first stream answers with a playlist or a video.

Options: `--trace` logs every request with its status and time. `--no-anilili` runs without
`$anilili`, as another host would. `--json` prints only the result. `--system-dns` uses the
system resolver; by default names are resolved over DNS-over-HTTPS, because some providers'
DNS servers block these sites.

The tools stand in for the app's runtime and are not identical to it: `LoadDoc` and `CryptoJS`
are not provided (no plugin here uses them), and a site may treat Node's requests differently
from the app's. Check a new plugin in the app as well.

`tools/check.mjs` runs on every push through GitHub Actions. It makes no network requests, so
it does not tell whether a site still works.

## Versions and updates

Refreshing a repository in the app (Settings → Plugins) downloads `index.json` again and picks
up new plugin versions. `version` is how the app and its users tell one release of a plugin
from another, so raise it with every published change.

To publish a change to a plugin:

1. Edit `src/<id>/provider.js`.
2. Raise `version` in `src/<id>/manifest.json` **and** in that plugin's entry in `index.json`
   (the two must be identical; `tools/check.mjs` reports any difference).
3. Run `node tools/check.mjs` and `node tools/run.mjs <id> play --anilist 21`.
4. Commit and push to `main`.

Use `MAJOR.MINOR.PATCH`: PATCH for a fix after a site change, MINOR for new abilities (a new
server, dub support), MAJOR when ids change shape so that stored episode ids stop working.

To add a plugin: create `src/<id>/` with `manifest.json` and `provider.js`, add an icon under
`public/`, and append the manifest to `index.json`.

## What the plugins do and do not do

The plugins only locate streams on third-party sites: they send the same requests a browser
would and return the addresses those sites publish. This repository hosts no video, no
subtitles and no content of those sites, and is not affiliated with any of them. Whether using
a site is permitted where you live is for you to determine.
