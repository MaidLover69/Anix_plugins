# AGENTS.md: Anix extensions

This repository holds the streaming-source extensions for **Anix**, the Linux anime app.
The app's runtime lives in the app repository (`Anix`, cloned next to this one; see its `AGENTS.md`).
Clone this repository as a folder named exactly `plugins`: the app's tests and the commands below use
`../../plugins/src/...`. The app's runtime is the authority for every rule below. If this file and the code disagree, the code wins.

Plain Node 22, no `package.json`, no npm dependencies. Keep it that way.

## Layout

| Path | What |
|---|---|
| `index.json` | Every entry the bundle ships: first-party manifests and community references |
| `src/<id>/manifest.json`, `src/<id>/provider.js` | One first-party extension |
| `public/<id>.svg` | Its icon |
| `dist/anix-extensions.json` | Built bundle (the one file the app downloads) |
| `tools/check.mjs`, `bundle.mjs`, `health.mjs`, `run.mjs`, `lib/host.mjs` | Tooling, see below |
| `.github/workflows/check.yml` | CI: `node tools/check.mjs`, then `node tools/bundle.mjs --check` |

## Format

Extensions use the `onlinestream-provider` format. The flow is `search` → `findEpisodes` →
`findEpisodeServer`, plus `getSettings()` (which returns, among other things, `supportsDub`).

**First-party entry** (whole manifest in `index.json` and in `src/<id>/manifest.json`):

- Required: `id`, `name`, `version`, `author`, `description`, `type: "onlinestream-provider"`, `language: "javascript"`, `lang`, `payloadURI`.
- Paths point inside this repository: `"payloadURI": "src/<id>/provider.js"`, `"icon": "public/<id>.svg"`.
- No `manifestURI`.
- `id`: letters, digits, `-`, `_`; at most 64 characters.

**Community reference:**

- Required: `id`, `name`, `author`, `description`, `type`, `lang`, `website`, `manifestURI`.
- No `version` and no code. The app reads both from the author's repository and follows their updates.

**`lang`:** one lowercase ISO 639-1 code.

**`languages`** (optional):

- Form: `{ "sub"?: [...], "dub"?: [...] }`.
- Each list must be non-empty, use lowercase ISO 639-1 codes and have no duplicates. No other keys are allowed.
- If it is missing, the app treats `lang` as the sub language. It also treats `lang` as the dub language when `supportsDub` is true.
- Set it whenever sub and dub languages differ, or when a site has more than one.

**`changelog`** (optional): at most 2000 characters, saying what changed in this `version`. The app shows it with "Update available".

**Optional result fields** the app reads:

- search: `altTitles`, `year`, `episodeCount`
- episodes: `image`, `synopsis`, `filler`
- subtitles: `format`
- servers: `skip{introStart,introEnd,outroStart,outroEnd}`

**Limits** (the same as the app's): index and payload 2 MB each, at most 200 plugins.

**Sandbox:** the app runs each extension in its own QuickJS runtime.

- There is no module loader, file system or process access.
- `fetch` goes through the app's clients (DoH) and refuses private and loopback addresses.
- Use the globals in the app's `src-tauri/src/plugins/prelude.js` (`fetch`, `LoadDoc`, `CryptoJS`, `$store`, `$sleep` ≤ 2 s, `$anix`, …). Do not `require` anything.

## Versioning

- Bump `version` in **both** `src/<id>/manifest.json` and its `index.json` entry for every code or behaviour change. If the version stays the same, installed copies do not update.
- Use `MAJOR.MINOR.PATCH`. Add a `changelog` line for user-visible changes.
- Rebuild the bundle (`node tools/bundle.mjs`) and commit it with the change. CI fails when it is stale.

## Tools

| Command | What it does |
|---|---|
| `node tools/check.mjs` | Validates `index.json`, every manifest and payload, offline. Exit code 1 on problems. |
| `node tools/check.mjs --bundle dist/anix-extensions.json` | Validates a built bundle |
| `node tools/bundle.mjs [--out <file>]` | Writes the bundle: code inline, icons as data URIs, references unchanged. Deterministic. |
| `node tools/bundle.mjs --check` | Writes nothing. Fails if the bundle is stale. |
| `node tools/run.mjs <id> settings\|search\|episodes\|server\|play …` | Runs one extension in Node with a stand-in host (`--trace`, `--system-dns`, `--json`, `--timeout`) |
| `node tools/health.mjs <plugin_run> [--jobs <n>]` | Plays episode 1 of each first-party extension in the real runtime (sub, plus dub when `supportsDub` is true and the manifest lists dubs or declares no `languages`). You can also set `ANIX_PLUGIN_RUN=<path>`. Exit code 1 if any fails. |

## Testing in the real app runtime

`run.mjs` is quick, but only the app's runtime counts. Build its runner once:

```sh
cd ../Anix/src-tauri && cargo build --offline --example plugin_run
```

Then, from the app's `src-tauri/` folder:

```sh
target/debug/examples/plugin_run ../../plugins/src/<id>/manifest.json search "<title>"
target/debug/examples/plugin_run ../../plugins/src/<id>/manifest.json play "<title>" 1 [--dub] --quiet
```

- `play` passes when stderr reports `verified:` for the first stream. That means the playlist and a segment, or the file's first bytes, answered.
- To try the whole local repository in the app, start the app with `ANIX_DEV_PLUGIN_REPOS=1` and add a `file://` link to this folder.
- The app's test `plugin_host_reader_tests` reads `src/<id>/provider.js` from here. Keep the readers it uses working.

## Rules

- **Never bypass anti-bot checks.** No captcha solving, no solver services, no faked fingerprints, no running a site's challenge script. When a site shows a check, the app falls back to its in-app browser session. If that fails, the user passes the check through the app's **Verify** flow. An extension only reports the failure.
- No secrets, API keys, personal data or machine paths in code or manifests.
- Do not name former repository addresses. `check.mjs` rejects them.

## Before you finish

- [ ] `node tools/check.mjs` passes
- [ ] `version` bumped in the manifest and `index.json`; `changelog` updated if users will notice
- [ ] `plugin_run … play` verified for changed extensions (sub, and dub if supported)
- [ ] `node tools/bundle.mjs` run and `node tools/bundle.mjs --check` passes
- [ ] Before an extension release: `node tools/health.mjs` passes
