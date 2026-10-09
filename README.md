<h1 align="center">Anilili Linux Plugins</h1>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/MaidLover69/Anilili_Linux_plugins?logo=git&logoColor=white&labelColor=2d3748&color=805ad5&style=for-the-badge" />
  <img src="https://img.shields.io/github/license/MaidLover69/Anilili_Linux_plugins?style=for-the-badge" />
  <img src="https://img.shields.io/github/actions/workflow/status/MaidLover69/Anilili_Linux_plugins/check.yml?label=check&style=for-the-badge" />
</p>

<p align="center">
Streaming-source plugins for <strong><a href="https://github.com/MaidLover69/Anilili_Linux">Anilili Linux</a></strong>.
</p>

<h3 align="center">Powered by:</h3>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Seanime%20format-onlinestream--provider-805ad5?style=for-the-badge" />
</p>

Anilili shows anime and episode lists on its own, but it plays nothing until a streaming
plugin is installed. A plugin is a small JavaScript file that knows one site: how to find an
anime there, list its episodes and locate the stream of an episode. Sites change often; a
plugin is fixed by updating a file in this repository, without a new release of the app.

The plugins use Seanime's `onlinestream-provider` extension format, so repositories of Seanime
streaming providers can be added to the app next to this one.

> [!NOTE]
> The plugins only locate streams on third-party sites. This repository hosts no video.

---

## Installation

1. Open Anilili and go to **Settings → Plugins**.

<img src="https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/public/screenshots/plugins-empty.png" width="640" />

2. Paste the repository link and press **Add**.

```
https://github.com/MaidLover69/Anilili_Linux_plugins
```

<img src="https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/public/screenshots/plugins-add.png" width="640" />

3. The app downloads `index.json` and every plugin in it. Each plugin has its own on/off switch.

<img src="https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/public/screenshots/plugins-installed.png" width="640" />

4. Open any anime and press play.

<img src="https://raw.githubusercontent.com/MaidLover69/Anilili_Linux_plugins/main/public/screenshots/player.png" width="640" />

The app re-reads the repository every time it starts, and **Refresh all** does it on demand, so
plugin updates arrive without reinstalling anything.

---

## Plugins

### Plugins of this repository

| Plugin | id | Language | Audio | Streams and notes | Status |
| --- | --- | --- | --- | --- | --- |
| Miruro | `miruro` | English | sub, dub | HLS (some MP4) from several upstream sites; soft or hard subtitles; intro/outro times. Finds anime by AniList id. Needs Anilili (see below) | Working, 2026-10-09 |
| AniZone | `anizone` | English | sub | HLS with soft subtitles in several languages | Working, 2026-10-09 |
| KickAssAnime | `kickassanime` | English | sub, dub | HLS with soft subtitles. Some shows are listed dubbed without a video | Working, 2026-10-09 |
| AnimeGG | `animegg` | English | sub, dub | MP4, 360p to 1080p | Working, 2026-10-09 |
| HiAnime | `hianime` | English | sub, dub | HLS with soft subtitles and intro/outro times; two players (ZokoAnime, HD-1). The site is `hianime.at` | Working, 2026-10-09 |
| Anikoto | `anikoto` | English | sub, dub | HLS with soft subtitles and intro/outro times; two servers | Working, 2026-10-09 |
| AniLab | `anilab` | English | sub, dub | HLS. The service behind the AniLab and AniDB apps. Every title is offered as dubbed; an episode without a dub says so when played | Working, 2026-10-09 |
| Anidap | `anidap` | English | sub, dub | HLS from up to five upstream hosts, most with soft subtitles and intro/outro times. Finds anime by AniList id | Working, 2026-10-09 |
| JustAnime | `justanime` | English | sub, dub | HLS with soft subtitles and intro/outro times, or MP4 up to 1080p. Finds anime by AniList id. Its API stopped answering for some minutes during the check; long series are listed without episode titles | Working, 2026-10-09 |
| Animenosub | `animenosub` | English | sub, dub | HLS from the MegaPlay and Vidmoly players; the other players of the site are not read. The site's search is slow at times | Working, 2026-10-09 |
| AnimeParadise | `animeparadise` | English | sub | HLS with soft subtitles and intro/outro times | Working, 2026-10-09 |
| AniLiberty | `aniliberty` | Russian | Russian voice-over | HLS in 480p, 720p and 1080p, with opening/ending times. Formerly AniLibria. Offered as the regular (not "dub") audio | Working, 2026-10-09 |

"Working" means: checked on the given date in Anilili's own plugin runtime, the way the app
plays an episode (search, title matching, episode list, server choice, and the stream fetched
with the returned headers), for One Piece episode 1 and Sousou no Frieren episode 1, in every
audio version the plugin offers.

Miruro's answers are compressed and obfuscated, which takes helpers only Anilili provides. In
another host it fails with "requires Anilili". The other plugins use Seanime's globals only.

### Community plugins (maintained by their authors)

These are Seanime streaming providers by other authors. `index.json` only points at the
manifest in the author's repository: the app downloads the plugin from there and follows the
author's updates. Nothing of them is copied here. Problems with them belong in their own
repositories.

| Plugin | id | Author | Repository | Language | Audio | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AnimeAV1 | `animeav1` | jabifx & yerasuu | [Seanime-contributions/Seanime-Providers](https://github.com/Seanime-contributions/Seanime-Providers) (MIT) | Spanish | Spanish subtitles, Latin American dub | Working, 2026-10-09 |

Checked the same way as the plugins above. A community plugin is referenced only when it
passes that check unchanged and its repository carries a licence that allows redistribution.

Other Seanime repositories can be added to the app next to this one, by their own link.

### Not available

- **AnimeSaturn, AnimeWorld** (Italian, community plugins by kRYstall9): they resolve streams, but the video did not load in the app's player when tested on 2026-10-09, so they are not listed in `index.json` yet.

Sources of earlier versions of the app, and sites and community plugins that were tried, which
did not yield a playable stream from the test network on 2026-10-09. That network blocks some
sites by name; "connection reset" below may not apply elsewhere.

Sources of earlier versions of the app:

| Source | What happens |
| --- | --- |
| AniBD | `anibd.app` answers "Sorry, the website has been stopped" |
| AniDbApp | `anidb.app` redirects to the landing page of an Android app (`anilab.so`). Its service is available as the AniLab plugin |
| Anikoto | The old API is gone. The site is available again as the Anikoto plugin (`anikototv.to`) |
| AnimeHeaven | `animeheaven.me` resets most connections (one of three attempts to play succeeded); its episode list of long series is incomplete |
| AnimeKai | `animekai.to` and `anikai.to` do not resolve, `animekai.ac` resets the connection, `animekai.bz` is parked. `animekaitv.to` is a copy of Anikoto |
| AnimePahe | `animepahe.pw` (where `.com` and `.org` lead) answers with a Cloudflare challenge (HTTP 403); `animepahe.si` resets the connection |
| AnimeShqip | The old addresses are gone; `animeshqip.org` only announces a move to another address, which was not examined |
| Senshi | `senshi.to` lists anime and episodes, but its video service answers "404" to plain requests and the site's player is obfuscated |

Other sites that were tried:

| Site | What happens |
| --- | --- |
| AllAnime / AllManga / MKissa | Search and episode lists answer; video addresses need a token that changes with every build of the site's obfuscated script (`AA_CRYPTO_MISSING`) |
| HiAnime (`hianime.to`), AniWatch (`aniwatchtv.to`), 9anime, Kaido | Connection reset or timeout. `hianime.at` works (HiAnime plugin) |
| Gogoanime / Anitaku | `anitaku.to` does not resolve; `anitaku.io` holds only recent episodes |
| AnimeOnsen | Works, but publishes DASH streams only, which the app does not play |
| ReAnime, 1Anime, KissKH | The video step needs WebAssembly or keys from an outside service |
| WCO (wcostream and its mirrors) | Cloudflare challenge or an anti-bot delay |
| Sudatchi, AniCrush, Animetsu, Animelok, AniPlay, Animension, AnimeOwl, YugenAnime | Down, parked, closed or not resolving |
| Anime-Sama, French-Anime, JKAnime, AnimeUnity, AniWorld, AnimesOnlineCC, Anitube, Goyabu, Hinata Soul, Dattebayo BR, OgladajAnime | Cloudflare or DDoS-Guard challenge |
| AnimeFLV, Anime Ultra, Animes Tokyo, DMLAC | Timeout or connection closed |

Community plugins that load but did not pass the check: AniDream, AnimeFLV, AnimeSaturn
(Mirror), AnimeToast, AnimeUnity (also needs Seanime's `$scannerUtils`), AnimeUnity (Mirror),
AniWorld, Anikoto (three plugins), AnimeKai and two HiAnime plugins (their site address is a
setting the app does not fill in, and the sites are unreachable), AnimePahe (three plugins),
AllAnime, Animo, AniNeko, AniWatch, AniCrush, Senshi, Sudatchi, Shiro, XAnime, GojoWtf,
Animetsu, Animelok, Ani.pm, Re:ANIME, AnimeToki, Latanime, MyNimeKu, NonTonAnime,
DonghuaStream, Docchi, desu-online, OgladajAnime, Vostfree, ToonAnime, FRAnime, Top Animes and
the Chinese-language providers (their titles are not matched).

## Repository layout

```
index.json                  every plugin, as one array (what the app downloads first): the
                            manifests of the plugins here, then the community references
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

A community reference in `index.json` has no folder here. It carries no `version` and no code
location, only where the author's manifest is, so the app reads both from there:

```json
{
  "id": "animesaturn",
  "name": "AnimeSaturn",
  "description": "…",
  "author": "kRYstall9",
  "type": "onlinestream-provider",
  "lang": "it",
  "website": "https://github.com/kRYstall9/Seanime-streaming-providers",
  "manifestURI": "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/main/src/AnimeSaturn/manifest.json"
}
```

`id` must be the id in the author's manifest, and `website` the repository the plugin is
maintained in.

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

The tools stand in for the app's runtime and are not identical to it: `LoadDoc` is not
provided (no plugin here uses it), `CryptoJS` only decrypts AES-CBC (all the plugins here
need), `tools/run.mjs` runs the plugins under `src/` and not the community references, and a
site may treat Node's requests differently from the app's. Check a new plugin in the app as
well.

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
