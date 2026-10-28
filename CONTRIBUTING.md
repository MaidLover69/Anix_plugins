# Contributing to the Anix extensions

This repository is for the **extensions** (streaming sources) of [Anix](https://github.com/MaidLover69/Anix).
Problems with the app itself (player, library, sign-in, settings…) go to the
[Anix repository](https://github.com/MaidLover69/Anix/issues) instead.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through
the private process in [SECURITY.md](SECURITY.md), not public issues.

## Ways to help

- **Request a source:** open an issue with the **Source request** form. Say which site, which
  languages it has for subtitles and dubs, and give a link to one anime page on it.
- **Report a broken extension:** use the **Broken extension** form. Name the extension and its
  version (Settings › Plugins), the anime and episode, and whether you chose sub or dub.
- **Share your own extension:** if you host an extension in the `onlinestream-provider` format in
  your own repository, open a **Source request** with its manifest link. It can be listed by
  reference, so your updates reach users directly and your code stays yours.

## Which sources can be added

A source is added only if:

- the site works in a normal browser **without a VPN**, from more than one country;
- videos load from the site or its hosts without solving a captcha for every episode;
- it has something the existing extensions do not cover: a language, a dub, or titles.

Some sites are not possible:

- **Anti-bot checks:** extensions never solve captchas, fake browser fingerprints or run a site's
  challenge scripts. When a site shows a check, Anix lets the user pass it in its **Verify**
  window. A site that blocks every visitor it does not recognise cannot work.
- **Region locks:** a site that only answers from some countries cannot be built or tested here.

## Writing an extension

The format, the sandbox rules and the tools are described in [AGENTS.md](AGENTS.md). In short:

- `search` → `findEpisodes` → `findEpisodeServer`, plus `getSettings()`;
- plain JavaScript run in QuickJS, with `fetch`, `LoadDoc` and `CryptoJS` from the app; no
  `require`, no file system, no private or local addresses;
- test it in the app's own runtime with `plugin_run … play "<title>" 1`, for sub and for dub.

## Pull requests

- One extension or one fix per pull request. Say what changed, and which anime and episode you played.
- Bump `version` in the manifest for every change, and add a `changelog` line users will understand.
- No secrets, API keys, personal data or machine paths.

## Licence

The extensions here are MIT-licensed. By contributing, you agree that your contribution is released
under the same licence. Extensions listed by reference keep their own authors' licences.
