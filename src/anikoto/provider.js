// Anikoto (anikototv.to): sub and dub as HLS with soft subtitles and intro/outro times, from
// the MegaPlay player.
// Site calls as in the Mangayomi source (github.com/Mallyd11/mangayomi-anime-extensions).

class Provider {
  constructor() {
    this.base = "https://anikototv.to";
    this.apiHeaders = { Referer: this.base + "/", "X-Requested-With": "XMLHttpRequest" };
    this.servers = ["HD-1", "Vidstream-2"];
    this.megaPlayKey = "i?LMTAx0Q6,:}50U";
    this.megaPlayIv = "W0;27ToaUpl_P%'c";
  }

  getSettings() {
    return {
      episodeServers: ["HD-1", "Vidstream-2"],
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
      const html = await this._page(this.base + "/filter?keyword=" + encodeURIComponent(query).replace(/%20/g, "+"), this.base + "/");
      // One result: <div class="ani poster tip" data-tip="1642"> <a href=".../watch/slug/ep-1">
      // <span class="ep-status sub"><span> 1180</span></span><span class="ep-status dub">...
      // <a class="name d-title" href="..." data-jp="Romaji title">English title</a>
      const blocks = html.split(/<div class="ani poster tip"/).slice(1);
      for (const block of blocks) {
        const numeric = /^\s*data-tip="(\d+)"/.exec(block);
        const link = /<a\s+href="([^"]*\/watch\/([^"\/]+))(?:\/[^"]*)?"/.exec(block);
        const name = /<a\s+class="name d-title"[^>]*?(?:\bdata-jp="([^"]*)")?\s*>([^<]*)<\/a>/.exec(block);
        if (!numeric || !link || !name) continue;
        if (results.some(function (r) { return r.numeric === numeric[1]; })) continue;
        const subbed = this._status(block, "sub");
        const dubbed = this._status(block, "dub");
        if (audio === "dub" && !dubbed) continue;
        const titles = this._distinct([this._plain(name[2]), this._plain(name[1] || "")]);
        if (titles.length === 0) continue;
        results.push({
          numeric: numeric[1],
          id: numeric[1] + "|" + link[2] + "|" + audio,
          title: titles[0],
          url: this._unescapeBody(link[1]),
          subOrDub: audio,
          altTitles: titles.slice(1),
          episodeCount: (audio === "dub" ? dubbed : subbed) || undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results.map(function (r) {
      delete r.numeric;
      return r;
    });
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const numeric = parts[0];
    const slug = parts[1] || "";
    const audio = parts[2] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(numeric)) throw new Error("invalid anime id '" + id + "'");

    const data = await this._api(this.base + "/ajax/episode/list/" + numeric + "?vrf=");
    const html = data && typeof data.result === "string" ? data.result : "";
    // One entry: <li title="Episode title"> <a data-num="1" data-sub="1" data-dub="1" data-ids="token">
    const episodes = [];
    const seen = {};
    let total = 0;
    const entries = html.split(/<li\b/).slice(1);
    for (const entry of entries) {
      const tag = /<a\b[^>]*\bdata-ids="[^"]+"[^>]*>/.exec(entry);
      if (!tag) continue;
      const number = /\bdata-num="(\d+(?:\.\d+)?)"/.exec(tag[0]);
      const token = /\bdata-ids="([^"]+)"/.exec(tag[0]);
      if (!number || !token || seen[number[1]]) continue;
      total += 1;
      const offered = new RegExp('\\bdata-' + audio + '="1"').test(tag[0]);
      if (!offered) continue;
      seen[number[1]] = true;
      const named = /^[^>]*\btitle="([^"]*)"/.exec(entry);
      episodes.push({
        id: token[1] + "|" + audio,
        number: Number(number[1]),
        url: this.base + "/watch/" + slug + "/ep-" + number[1],
        title: (named && this._plain(named[1])) || "Episode " + number[1],
      });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error(total === 0 ? "no episodes listed" : audio === "dub" ? "no dub" : "no subbed episodes");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const token = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!token || !/^[A-Za-z0-9+\/=_-]+$/.test(token)) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    const known = this.servers;
    if (wanted !== "default" && !known.some(function (name) { return name.toLowerCase() === wanted.toLowerCase(); })) {
      throw new Error("unknown server '" + wanted + "'");
    }

    const data = await this._api(this.base + "/ajax/server/list?servers=" + encodeURIComponent(token));
    const html = data && typeof data.result === "string" ? data.result : "";
    // <div class="type" data-type="sub"> ... <li data-link-id="token">HD-1</li>
    const links = [];
    let offeredAny = false;
    const groups = html.split(/<div class="type"/).slice(1);
    for (const group of groups) {
      const type = /^\s*data-type="([^"]*)"/.exec(group);
      const itemRe = /<li\b[^>]*\bdata-link-id="([^"]+)"[^>]*>([^<]*)</g;
      let match;
      while ((match = itemRe.exec(group)) !== null) {
        offeredAny = true;
        if (type && type[1].toLowerCase() === audio) links.push({ name: match[2].trim(), token: match[1] });
      }
    }
    if (!offeredAny) throw new Error("no server listed for this episode");
    if (links.length === 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");

    // "default" tries what the episode offers in the order of `servers`.
    const order = wanted === "default" ? known : [wanted];
    let reason = null;
    let tried = false;
    for (const name of order) {
      const link = links.filter(function (l) { return l.name.toLowerCase() === name.toLowerCase(); })[0];
      if (!link) continue;
      tried = true;
      try {
        const answer = await this._api(this.base + "/ajax/server?get=" + encodeURIComponent(link.token));
        const player = answer && answer.result && typeof answer.result.url === "string" ? answer.result.url : "";
        if (!/^https?:\/\//i.test(player)) throw new Error("the site names no player");
        const found = await this._megaPlay(player);
        const times = answer.result.skip_data || {};
        const pair = function (value) { return Array.isArray(value) ? { start: value[0], end: value[1] } : null; };
        const result = {
          server: link.name,
          headers: { Referer: found.referer },
          videoSources: [
            { url: found.url, type: this._isHls(found.url) ? "m3u8" : "mp4", quality: "auto", label: audio === "dub" ? "Dub" : "Soft sub", subtitles: found.subtitles },
          ],
        };
        const skip = found.skip || this._skip(pair(times.intro), pair(times.outro));
        if (skip) result.skip = skip;
        return result;
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    if (!tried) {
      throw new Error("'" + wanted + "' is not offered for this episode (offered: " + links.map(function (l) { return l.name; }).join(", ") + ")");
    }
    throw new Error(reason || "no playable source for this episode");
  }

  // ---------------------------------------------------------------- parsing

  // The episode count of an audio badge: <span class="ep-status sub"><span> 1180</span></span>.
  _status(block, audio) {
    const match = new RegExp('class="ep-status ' + audio + '"[^>]*>\\s*<span[^>]*>\\s*(\\d+)').exec(block);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Visible text of a piece of markup.
  _plain(html) {
    return this._unescapeBody(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // Undoes HTML entities.
  _unescapeBody(body) {
    return body
      .replace(/&#(\d{2,6});/g, function (whole, code) { return String.fromCodePoint(parseInt(code, 10)); })
      .replace(/&#x([0-9a-fA-F]{2,6});/g, function (whole, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }

  // ---------------------------------------------------------------- player

  // MegaPlay: the page names a file id; `getSources` answers with the subtitle tracks, the
  // intro/outro times and the video address, AES-encrypted with the player's fixed key.
  async _megaPlay(playerUrl) {
    const origin = /^(https?:\/\/[^\/?#]+)/i.exec(playerUrl)[1];
    const page = await this._page(playerUrl, this.base + "/");
    const file = /<div[^>]*\bid="megaplay-player"[^>]*\bdata-id="(\d+)"/.exec(page) || /\bdata-id="(\d+)"/.exec(page);
    if (!file) throw new Error("the player page has changed (no file id)");
    const lane = /[?&]s=([A-Za-z0-9_-]+)/.exec(playerUrl);
    const saved = this.apiHeaders;
    let data;
    try {
      this.apiHeaders = { Referer: playerUrl, "X-Requested-With": "XMLHttpRequest" };
      data = await this._api(origin + "/stream/getSources?id=" + file[1] + (lane ? "&s=" + lane[1] : ""));
    } finally {
      this.apiHeaders = saved;
    }

    let video = "";
    const plain = data && data.sources;
    if (plain && typeof plain.file === "string") video = plain.file;
    else if (Array.isArray(plain) && plain[0] && typeof plain[0].file === "string") video = plain[0].file;
    else if (data && typeof data.enc === "string" && data.enc) {
      const opened = this._megaPlayOpen(data.enc);
      if (opened && typeof opened.file === "string") video = opened.file;
      else if (opened && opened.sources && typeof opened.sources.file === "string") video = opened.sources.file;
    }
    if (!/^https?:\/\//i.test(video)) throw new Error("the player names no video");

    const subtitles = this._subtitles((data && Array.isArray(data.tracks) ? data.tracks : []).map(function (track) {
      if (!track || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: track.file, label: track.label, isDefault: track.default === true };
    }));
    return { url: video, referer: origin + "/", subtitles: subtitles, skip: this._skip(data.intro, data.outro) };
  }

  // AES-256-CBC with the key and IV the player's own script uses (text, zero-padded).
  _megaPlayOpen(enc) {
    if (typeof CryptoJS === "undefined") throw new Error("this host has no CryptoJS to open the MegaPlay answer");
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

  // The body of a 2xx answer.
  async _page(url, referer) {
    const host = this._host(url);
    let response;
    try {
      response = await fetch(url, { headers: { Referer: referer } });
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
    return String(await response.text());
  }

  // ---------------------------------------------------------------- shared helpers

  _queries(opts) {
    const media = (opts && opts.media) || {};
    const queries = [];
    for (const title of [opts && opts.query, media.romajiTitle, media.englishTitle]) {
      if (typeof title === "string" && title.trim() && queries.indexOf(title.trim()) < 0) queries.push(title.trim());
    }
    return queries.slice(0, 2);
  }

  // A JSON answer of the site's API. `init` may carry `method` and `body`.
  async _api(url, init) {
    const host = this._host(url);
    const headers = { Accept: "application/json" };
    for (const name of Object.keys(this.apiHeaders || {})) headers[name] = this.apiHeaders[name];
    const options = { headers: headers };
    if (init && init.method) {
      options.method = init.method;
      options.body = init.body;
      headers["Content-Type"] = init.contentType || "application/json";
    }
    let response;
    try {
      response = await fetch(url, options);
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
    const markers = ["Just a moment", "cf-chl", "challenge-platform/h/", "Attention Required! | Cloudflare",
      "Sorry, you have been blocked", "DDoS-Guard", "Checking your browser"];
    return markers.some(function (marker) { return body.indexOf(marker) >= 0; });
  }

  // `listed`: [{ url, label, isDefault }].
  _subtitles(listed) {
    const subtitles = [];
    let hasDefault = false;
    for (const entry of listed) {
      if (!entry || typeof entry.url !== "string" || !/^https?:\/\//i.test(entry.url)) continue;
      if (subtitles.some(function (s) { return s.url === entry.url; })) continue;
      const isDefault = entry.isDefault === true && !hasDefault;
      if (isDefault) hasDefault = true;
      const language = String(entry.label || "Unknown");
      subtitles.push({ id: language.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + subtitles.length, url: entry.url, language: language, isDefault: isDefault });
    }
    return subtitles;
  }

  // Intro and outro as { start, end } in seconds.
  _skip(intro, outro) {
    const part = function (entry) {
      if (!entry || typeof entry.start !== "number" || typeof entry.end !== "number") return null;
      return entry.end > entry.start && entry.start >= 0 ? entry : null;
    };
    const first = part(intro);
    const last = part(outro);
    if (!first && !last) return null;
    const skip = {};
    if (first) {
      skip.introStart = first.start;
      skip.introEnd = first.end;
    }
    if (last) {
      skip.outroStart = last.start;
      skip.outroEnd = last.end;
    }
    return skip;
  }

  _text(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  _distinct(values) {
    const kept = [];
    for (const value of values) {
      if (value && kept.indexOf(value) < 0) kept.push(value);
    }
    return kept;
  }

  _isHls(url) {
    return String(url).split(/[?#]/)[0].toLowerCase().indexOf(".m3u8") >= 0;
  }

  _host(url) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#:]+)/i.exec(String(url));
    return match ? match[1].toLowerCase() : "unknown host";
  }

  _errorText(error) {
    const text = error && error.message ? String(error.message) : String(error);
    return text.length > 140 ? text.slice(0, 140) : text;
  }
}
