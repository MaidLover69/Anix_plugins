# Anix Extensions

Community provider extensions and specifications for **Anix**, the anime catalogue, tracker, and media player for Linux.

[![Format](https://img.shields.io/badge/Specification-Seanime%20onlinestream--provider-805ad5?style=flat-square)](https://github.com/5rahim/seanime)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

**GitHub:** <https://github.com/MaidLover69/Anix_plugins> • **Codeberg:** <https://codeberg.org/MaidLover69/Anix_plugins> • **Main App:** <https://github.com/MaidLover69/Anix>

Anix supports modular JavaScript provider extensions conforming to Seanime's `onlinestream-provider` format.

---

## Installing Plugins in Anix

To install the extensions bundle in Anix:

1. Open **Anix** and navigate to **Settings → Plugins**.
2. Paste the Google Drive extensions link into the repository/link field:
   ```
   https://drive.google.com/file/d/1VxmOGtV5zRaqE3c5La_dCC6irHxJQyuL/view?usp=sharing
   # Hosted on Google Drive; source repositories mirrored on GitHub & Codeberg
   ```
3. Click **Add**. Anix will download the extensions bundle and register the plugins.
4. Each plugin can be enabled or disabled individually from the settings panel.

---

## Extension Architecture & Sandbox

- **Runtime**: Extensions execute within an isolated JavaScript environment powered by embedded **QuickJS**.
- **Isolation**: Extensions have no direct access to system files, child processes, or external Node modules.
- **Network Requests**: Handled securely through the host application environment.
- **Format**: Conforms to the Seanime `onlinestream-provider` specification.

---

## Release Notes

A manifest may carry an optional `changelog`: a short text (up to 2000 characters) saying what changed in its `version`. When an update is available, Anix shows it behind the "Update available" badge in **Settings → Plugins**. `node tools/check.mjs` checks the field.

---

## Requests, Bugs and Contributing

This repository is the place for **source requests** and **broken extensions**. Use the issue forms: **Source request** or **Broken extension**. Problems with the app itself go to the [Anix repository](https://github.com/MaidLover69/Anix/issues). See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

---

## Disclaimer

This repository provides documentation and links for community-maintained plugins. It does not host, stream, or distribute any copyrighted media files. Users and extension developers are solely responsible for compliance with applicable local laws.

---

## License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.
