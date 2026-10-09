// HiAnime (hianime.at): sub and dub as HLS with soft subtitles and intro/outro times, from two
// players (ZokoAnime and MegaPlay, listed as HD-1).
// Endpoints and the ZokoAnime decoding as in ani-cli (github.com/pystardust/ani-cli).

class Provider {
  constructor() {
    this.base = "https://hianime.at";
    this.servers = ["ZokoAnime", "HD-1"];
    this.playerKey = "otaku-embed-v1";
    this.megaPlayKey = "i?LMTAx0Q6,:}50U";
    this.megaPlayIv = "W0;27ToaUpl_P%'c";
  }

  getSettings() {
    return {
      episodeServers: ["ZokoAnime", "HD-1"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    const queries = this._queries(opts);
    if (queries.length === 0) throw new Error("no title to search for");
    const audio = opts && opts.dub ? "dub" : "sub";

    const results = [];
    for (const query of queries) {
      const html = await this._page(this.base + "/search?keyword=" + encodeURIComponent(query));
      // The sidebar repeats the result markup for unrelated shows.
      const main = html.split(/id="main-sidebar"/)[0];
      const blocks = main.split(/<div class="flw-item/).slice(1);
      for (const block of blocks) {
        // <a href=".../watch/one-piece-1" class="film-poster-ahref" data-id="1"> and
        // <a href=".../one-piece-1" title="One Piece" class="dynamic-name" data-jname="One Piece">
        const name = /<a\s+href="[^"]*\/([^"\/?#]+)"\s+title="([^"]*)"\s+class="dynamic-name"(?:\s+data-jname="([^"]*)")?/.exec(block);
        const numeric = /\bdata-id="(\d+)"/.exec(block);
        if (!name || !numeric) continue;
        const slug = name[1];
        if (results.some(function (r) { return r.slug === slug; })) continue;
        const subbed = this._tick(block, "tick-sub");
        const dubbed = this._tick(block, "tick-dub");
        const count = audio === "dub" ? dubbed : subbed;
        if (audio === "dub" && dubbed === 0) continue;
        const title = this._plain(name[2]);
        const other = name[3] ? this._plain(name[3]) : "";
        if (!title && !other) continue;
        results.push({
          slug: slug,
          id: slug + "|" + numeric[1] + "|" + audio + "|" + count,
          title: title || other,
          url: this.base + "/" + slug,
          subOrDub: audio,
          altTitles: title && other && other !== title ? [other] : [],
          episodeCount: count || undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results.map(function (r) {
      delete r.slug;
      return r;
    });
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const slug = parts[0];
    const numeric = parts[1];
    const audio = parts[2] === "dub" ? "dub" : "sub";
    const offered = parseInt(parts[3], 10) || 0;
    if (!slug || !/^\d+$/.test(numeric || "")) throw new Error("invalid anime id '" + id + "'");

    const data = await this._json(this.base + "/api/theme/episode/list/" + numeric, this.base + "/watch/" + slug);
    const html = data && typeof data.html === "string" ? data.html : "";
    // One entry: <a title="Episode 1" class="ssl-item ep-item" data-number="1" data-id="1" href="...">
    const episodes = [];
    const seen = {};
    const entries = html.split(/<a\s+(?=[^>]*\bep-item\b)/).slice(1);
    for (const entry of entries) {
      const tag = entry.slice(0, entry.indexOf(">"));
      const number = /\bdata-number="(\d+(?:\.\d+)?)"/.exec(tag);
      const episodeId = /\bdata-id="(\d+)"/.exec(tag);
      if (!number || !episodeId || seen[number[1]]) continue;
      seen[number[1]] = true;
      const href = /\bhref="([^"]+)"/.exec(tag);
      const named = /class="ep-name[^"]*"[^>]*\btitle="([^"]*)"/.exec(entry);
      episodes.push({
        id: episodeId[1] + "|" + audio,
        number: Number(number[1]),
        url: href ? this._unescapeBody(href[1]) : this.base + "/watch/" + slug + "?ep=" + episodeId[1],
        title: (named && this._plain(named[1])) || "Episode " + number[1],
      });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error("no episodes listed");
    // The list has no audio marks; the search page told how many episodes are dubbed.
    if (audio === "dub" && offered > 0) {
      const dubbed = episodes.filter(function (episode) { return episode.number <= offered; });
      if (dubbed.length === 0) throw new Error("no dub");
      return dubbed;
    }
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const episodeId = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(episodeId || "")) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    const known = this.servers;
    if (wanted !== "default" && !known.some(function (name) { return name.toLowerCase() === wanted.toLowerCase(); })) {
      throw new Error("unknown server '" + wanted + "'");
    }

    const data = await this._json(this.base + "/api/theme/episode/servers?episodeId=" + episodeId, this.base + "/");
    const html = data && typeof data.html === "string" ? data.html : "";
    // One entry: <div class="item server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="base64 of the player URL">
    const offered = [];
    const players = [];
    const itemRe = /<div[^>]*\bserver-item\b[^>]*>/g;
    let match;
    while ((match = itemRe.exec(html)) !== null) {
      const type = /\bdata-type="([^"]*)"/.exec(match[0]);
      const name = /\bdata-server-name="([^"]*)"/.exec(match[0]);
      const hash = /\bdata-hash="([^"]*)"/.exec(match[0]);
      if (!type || !name || !hash) continue;
      offered.push(name[1] + " (" + type[1] + ")");
      if (type[1].toLowerCase() !== audio) continue;
      let decoded = "";
      try {
        decoded = String(atob(hash[1])).trim();
      } catch (error) {
        decoded = "";
      }
      if (/^https?:\/\//i.test(decoded)) players.push({ name: name[1], url: decoded });
    }
    if (offered.length === 0) throw new Error("no player listed for this episode");
    if (players.length === 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");

    // "default" tries the players in the order of `servers`.
    const order = wanted === "default" ? known : [wanted];
    let reason = null;
    let tried = false;
    for (const name of order) {
      const player = players.filter(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })[0];
      if (!player) continue;
      tried = true;
      try {
        const found = name.toLowerCase() === "hd-1" ? await this._megaPlay(player.url) : await this._zoko(player.url);
        const result = {
          server: player.name,
          headers: { Referer: this._origin(player.url) + "/" },
          videoSources: [
            {
              url: found.url,
              type: this._isHls(found.url) ? "m3u8" : "mp4",
              quality: "auto",
              label: audio === "dub" ? "Dub" : "Soft sub",
              subtitles: found.subtitles,
            },
          ],
        };
        if (found.skip) result.skip = found.skip;
        return result;
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    if (!tried) throw new Error("'" + wanted + "' is not offered for this episode (offered: " + offered.join(", ") + ")");
    throw new Error(reason || "no playable source for this episode");
  }

  // ---------------------------------------------------------------- players

  // ZokoAnime: the page carries `window.__P`, base64 of the configuration XORed with a key.
  async _zoko(playerUrl) {
    const page = await this._page(playerUrl, true);
    const blob = /window\.__P\s*=\s*"([^"]+)"/.exec(page);
    if (!blob) throw new Error("the player page has changed (no configuration)");
    const config = this._decodeConfig(blob[1]);
    if (!config || typeof config.src !== "string" || !/^https?:\/\//i.test(config.src)) {
      throw new Error("the player names no video");
    }
    const listed = (Array.isArray(config.subtitles) ? config.subtitles : []).map(function (entry) {
      return entry ? { url: entry.src, label: entry.label || entry.lang, isDefault: entry.default === true } : null;
    });
    return { url: config.src, subtitles: this._subtitles(listed, this._origin(playerUrl)), skip: this._skip(config.skip) };
  }

  // MegaPlay (HD-1): the page names a file id; `getSources` answers with the subtitle tracks,
  // the intro/outro times and the video address, AES-encrypted with the player's fixed key.
  async _megaPlay(playerUrl) {
    const origin = this._origin(playerUrl);
    const page = await this._page(playerUrl, true);
    const file = /<div[^>]*\bid="megaplay-player"[^>]*\bdata-id="(\d+)"/.exec(page) || /\bdata-id="(\d+)"/.exec(page);
    if (!file) throw new Error("the player page has changed (no file id)");
    const lane = /[?&]s=([A-Za-z0-9_-]+)/.exec(playerUrl);
    const data = await this._json(origin + "/stream/getSources?id=" + file[1] + (lane ? "&s=" + lane[1] : ""), playerUrl);

    let url = "";
    const plain = data && data.sources;
    if (plain && typeof plain.file === "string") url = plain.file;
    else if (Array.isArray(plain) && plain[0] && typeof plain[0].file === "string") url = plain[0].file;
    else if (data && typeof data.enc === "string" && data.enc) {
      const opened = this._megaPlayOpen(data.enc);
      if (opened && typeof opened.file === "string") url = opened.file;
      else if (opened && opened.sources && typeof opened.sources.file === "string") url = opened.sources.file;
    }
    if (!/^https?:\/\//i.test(url)) throw new Error("the player names no video");

    const listed = (data && Array.isArray(data.tracks) ? data.tracks : []).map(function (track) {
      if (!track || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: track.file, label: track.label, isDefault: track.default === true };
    });
    return { url: url, subtitles: this._subtitles(listed, origin), skip: this._skip({ intro: data.intro, outro: data.outro }) };
  }

  // AES-256-CBC with the key and IV the player's own script uses (text, zero-padded).
  _megaPlayOpen(enc) {
    if (typeof CryptoJS === "undefined") throw new Error("this host has no CryptoJS to open the HD-1 answer");
    const padded = function (text, size) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < Math.min(size, text.length); i += 1) bytes[i] = text.charCodeAt(i);
      return bytes;
    };
    let base64 = String(enc).replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) base64 += "=";
    try {
      const opened = CryptoJS.AES.decrypt(base64, padded(this.megaPlayKey, 32), { iv: padded(this.megaPlayIv, 16) });
      return JSON.parse(String(opened.toString(CryptoJS.enc.Utf8)));
    } catch (error) {
      return null;
    }
  }

  // ---------------------------------------------------------------- parsing

  _queries(opts) {
    const media = (opts && opts.media) || {};
    const queries = [];
    for (const title of [opts && opts.query, media.romajiTitle, media.englishTitle]) {
      if (typeof title === "string" && title.trim() && queries.indexOf(title.trim()) < 0) queries.push(title.trim());
    }
    return queries.slice(0, 2);
  }

  // The episode count in a result's badge: <div class="tick-item tick-sub"><i ...></i>1180</div>.
  _tick(block, name) {
    const match = new RegExp('class="[^"]*\\b' + name + '\\b[^"]*">\\s*(?:<i[^>]*>\\s*</i>)?\\s*(\\d+)').exec(block);
    return match ? parseInt(match[1], 10) : 0;
  }

  // The player configuration: base64 of JSON XORed with a repeating key.
  _decodeConfig(blob) {
    let binary;
    try {
      binary = String(atob(blob));
    } catch (error) {
      return null;
    }
    const key = this.playerKey;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = (binary.charCodeAt(i) ^ key.charCodeAt(i % key.length)) & 0xff;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    } catch (error) {
      return null;
    }
  }

  // `listed`: [{ url, label, isDefault }], addresses possibly relative to the player.
  _subtitles(listed, playerOrigin) {
    const subtitles = [];
    let hasDefault = false;
    for (const entry of listed) {
      if (!entry || typeof entry.url !== "string" || !entry.url) continue;
      const url = /^https?:\/\//i.test(entry.url) ? entry.url : playerOrigin + (entry.url.charAt(0) === "/" ? "" : "/") + entry.url;
      if (subtitles.some(function (s) { return s.url === url; })) continue;
      const isDefault = entry.isDefault === true && !hasDefault;
      if (isDefault) hasDefault = true;
      const language = String(entry.label || "Unknown");
      subtitles.push({ id: language.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + subtitles.length, url: url, language: language, isDefault: isDefault });
    }
    return subtitles;
  }

  // { intro: { start, end }, outro: { start, end } } in seconds.
  _skip(listed) {
    if (!listed || typeof listed !== "object") return null;
    const part = function (entry) {
      if (!entry || typeof entry.start !== "number" || typeof entry.end !== "number") return null;
      return entry.end > entry.start && entry.start >= 0 ? entry : null;
    };
    const intro = part(listed.intro);
    const outro = part(listed.outro);
    if (!intro && !outro) return null;
    const skip = {};
    if (intro) {
      skip.introStart = intro.start;
      skip.introEnd = intro.end;
    }
    if (outro) {
      skip.outroStart = outro.start;
      skip.outroEnd = outro.end;
    }
    return skip;
  }

  // Visible text of a piece of markup.
  _plain(html) {
    return this._unescapeBody(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------- shared helpers

  // The body of a 2xx answer. A redirect to another site is an error unless `anyHost`, which
  // is for player pages.
  async _page(url, anyHost) {
    const host = this._host(url);
    let response;
    try {
      response = await fetch(url, { headers: { Referer: this.base + "/" } });
    } catch (error) {
      throw new Error(host + " unreachable (" + this._errorText(error) + ")");
    }
    if (!response.ok) {
      const body = response.status === 403 || response.status === 503 ? String(await response.text()) : "";
      if (this._looksLikeChallenge(body)) throw new Error("blocked by the site's bot protection");
      if (response.status === 404) throw new Error("not found on " + host);
      if (response.status === 429) throw new Error("rate limited by " + host);
      throw new Error("HTTP " + response.status + " from " + host);
    }
    if (!anyHost && response.url && this._host(response.url) !== "unknown host" && !this._sameSite(this._host(response.url), host)) {
      throw new Error(host + " redirected to " + this._host(response.url));
    }
    return String(await response.text());
  }

  async _json(url, referer) {
    const host = this._host(url);
    let response;
    try {
      response = await fetch(url, { headers: { Referer: referer, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } });
    } catch (error) {
      throw new Error(host + " unreachable (" + this._errorText(error) + ")");
    }
    const text = String(await response.text());
    if (!response.ok) {
      if (this._looksLikeChallenge(text)) throw new Error("blocked by the site's bot protection");
      if (response.status === 404) throw new Error("not found on " + host);
      if (response.status === 429) throw new Error("rate limited by " + host);
      throw new Error("HTTP " + response.status + " from " + host);
    }
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed.charAt(0) === "<") {
      throw new Error(this._looksLikeChallenge(trimmed) ? "blocked by the site's bot protection" : host + " answered with a page instead of data");
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(host + " sent unreadable data");
    }
  }

  _looksLikeChallenge(body) {
    const markers = ["Just a moment", "cf-chl", "challenge-platform", "Attention Required! | Cloudflare",
      "Sorry, you have been blocked", "DDoS-Guard", "Checking your browser"];
    return markers.some(function (marker) { return body.indexOf(marker) >= 0; });
  }

  // Undoes the escaping scraped bodies wrap URLs in: `\/`, `\uXXXX` and common HTML entities.
  _unescapeBody(body) {
    return body
      .replace(/\\+u([0-9a-fA-F]{4})/g, function (whole, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/\\+\//g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;|&#34;/g, '"')
      .replace(/&#0?39;|&#x27;/g, "'")
      .replace(/&#x2F;|&#47;/g, "/");
  }

  _isHls(url) {
    return String(url).split(/[?#]/)[0].toLowerCase().indexOf(".m3u8") >= 0;
  }

  _origin(url) {
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^\/?#]+)/i.exec(String(url));
    return match ? match[1] : "";
  }

  _host(url) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(String(url));
    return match ? match[1].toLowerCase() : "unknown host";
  }

  // `www.example.to` and `example.tv` are the same site.
  _sameSite(a, b) {
    const label = function (host) {
      const parts = host.toLowerCase().replace(/^www\./, "").split(".");
      return parts.length > 1 ? parts[parts.length - 2] : parts[0];
    };
    return label(a) === label(b);
  }

  _errorText(error) {
    const text = error && error.message ? String(error.message) : String(error);
    return text.length > 140 ? text.slice(0, 140) : text;
  }
}
