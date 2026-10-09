// Animenosub (animenosub.to): sub and dub as HLS. Dubs are separate entries of the site. An
// episode page lists its players as base64 `<iframe>` snippets; MegaPlay and Vidmoly are read.
// The site is also an Aniyomi source (github.com/yuzono/anime-extensions, src/en/animenosub).

class Provider {
  constructor() {
    this.base = "https://animenosub.to";
    this.servers = ["MegaPlay", "Vidmoly"];
    this.megaPlayKey = "i?LMTAx0Q6,:}50U";
    this.megaPlayIv = "W0;27ToaUpl_P%'c";
  }

  getSettings() {
    return {
      episodeServers: ["MegaPlay", "Vidmoly"],
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
      const html = await this._page(this.base + "/?s=" + encodeURIComponent(query).replace(/%20/g, "+"));
      // One result: <article class="bs"> <a href=".../anime/slug/" itemprop="url" title="Title">
      // with its episode count in a badge: <span class="ans-badge ans-sub"><span class="ans-num">12</span>.
      const blocks = html.split(/<article class="bs"/).slice(1);
      for (const block of blocks) {
        const link = /<a\s+href="([^"]*\/anime\/([^"\/]+)\/?)"[^>]*\btitle="([^"]*)"/.exec(block);
        if (!link) continue;
        const slug = link[2];
        if (results.some(function (r) { return r.slug === slug; })) continue;
        const shown = this._plain(link[3]);
        // A dub is an entry of its own, named "... DUB"; some carry only the badge of their audio.
        const dubbed = this._badge(block, "ans-dub");
        const subbed = this._badge(block, "ans-sub");
        const isDub = /\bdub(?:bed)?\s*[\])]?\s*$/i.test(shown) || /-dub$/i.test(slug) || (dubbed !== null && subbed === null);
        if (isDub !== (audio === "dub")) continue;
        const title = shown.replace(/\s*[\[(]?\b(?:dub|sub)(?:bed)?\b[\])]?\s*$/i, "").trim() || shown;
        if (!title) continue;
        const count = dubbed || subbed;
        results.push({
          slug: slug,
          id: slug + "|" + audio,
          title: title,
          url: this._unescapeBody(link[1]),
          subOrDub: audio,
          altTitles: title !== shown ? [shown] : [],
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
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!slug) throw new Error("invalid anime id '" + id + "'");

    const html = await this._page(this.base + "/anime/" + encodeURIComponent(slug) + "/");
    // One entry: <li data-index="0"><a href=".../one-piece-episode-1/"><div class="epl-num">1</div>
    // <div class="epl-title">One Piece Episode 1</div>
    const episodes = [];
    const seen = {};
    const entries = html.split(/<li\s+data-index="\d+"\s*>/).slice(1);
    for (const entry of entries) {
      const body = entry.split("</li>")[0];
      const href = /<a\s+href="([^"]+)"/.exec(body);
      const shownNumber = /class="epl-num"[^>]*>\s*([^<]*)</.exec(body);
      const numbered = shownNumber ? /(\d+(?:\.\d+)?)/.exec(shownNumber[1]) : null;
      if (!href || !numbered || seen[numbered[1]]) continue;
      seen[numbered[1]] = true;
      const url = this._unescapeBody(href[1]);
      const path = url.replace(/^https?:\/\/[^\/]+/i, "");
      const named = /class="epl-title"[^>]*>([\s\S]*?)<\/div>/.exec(body);
      episodes.push({
        id: path + "|" + audio,
        number: Number(numbered[1]),
        url: url,
        title: (named && this._plain(named[1])) || "Episode " + numbered[1],
      });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error("no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const path = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!path || path.charAt(0) !== "/") throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    const known = this.servers;
    if (wanted !== "default" && !known.some(function (name) { return name.toLowerCase() === wanted.toLowerCase(); })) {
      throw new Error("unknown server '" + wanted + "'");
    }

    const watchUrl = this.base + path;
    const html = await this._page(watchUrl);
    const players = this._players(html, audio);
    if (players.length === 0) throw new Error("no player on the episode page");

    // "default" tries the players in the order of `servers`.
    const order = wanted === "default" ? known : [wanted];
    let reason = null;
    let tried = false;
    for (const name of order) {
      const candidates = players.filter(function (p) { return p.kind === name.toLowerCase(); });
      for (const player of candidates) {
        tried = true;
        try {
          const found = player.kind === "megaplay" ? await this._megaPlay(player.url, watchUrl) : await this._vidmoly(player.url, watchUrl);
          const result = {
            server: name,
            headers: { Referer: found.referer },
            videoSources: [
              {
                url: found.url,
                type: this._isHls(found.url) ? "m3u8" : "mp4",
                quality: "auto",
                label: audio === "dub" ? "Dub" : found.subtitles.length > 0 ? "Soft sub" : "Sub",
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
    }
    if (!tried) {
      const offered = players.map(function (p) { return p.label + " (" + p.host + ")"; });
      throw new Error((wanted === "default" ? "no supported player" : "'" + wanted + "' is not offered") + " for this episode (offered: " + offered.join(", ") + ")");
    }
    throw new Error(reason || "no playable source for this episode");
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

  // The episode count of an audio badge on a search result; null when the badge is absent.
  _badge(block, name) {
    const at = block.indexOf(name);
    if (at < 0) return null;
    const count = /class="ans-num"[^>]*>\s*(\d+)/.exec(block.slice(at, at + 1200).split(/ans-badge/)[0]);
    return count ? parseInt(count[1], 10) : 0;
  }

  // The players of an episode page for one audio version: the shown one and those of the
  // server list (<option value="base64 of an <iframe>"> SUB - Omega </option>). Labels start
  // with SUB, DUB or RAW; an unlabelled player belongs to the entry's own audio version.
  _players(html, audio) {
    const players = [];
    const self = this;
    const add = function (snippet, label) {
      const src = /<iframe[^>]*\bsrc=["']([^"']+)["']/i.exec(snippet);
      if (!src) return;
      let url = self._unescapeBody(src[1]).trim();
      if (url.indexOf("//") === 0) url = "https:" + url;
      if (!/^https?:\/\//i.test(url) || players.some(function (p) { return p.url === url; })) return;
      const marked = /^\s*(sub|dub|raw)\b/i.exec(label);
      const version = marked ? marked[1].toLowerCase() : audio;
      if (version !== audio) return;
      const host = self._host(url);
      let kind = "other";
      if (/megaplay/.test(host) || (self._sameSite(host, self._host(self.base)) && /\/play\.php\?/.test(url))) kind = "megaplay";
      else if (/vidmoly/.test(host)) kind = "vidmoly";
      players.push({ url: url, label: label.replace(/\s+/g, " ").trim() || "Player", host: host, kind: kind });
    };

    const optionRe = /<option\s+value="([^"]+)"[^>]*>([^<]*)/g;
    let match;
    while ((match = optionRe.exec(html)) !== null) {
      let snippet = "";
      try {
        snippet = String(atob(match[1].trim()));
      } catch (error) {
        snippet = "";
      }
      if (snippet) add(snippet, match[2]);
    }
    const shown = /<div[^>]*\bid="pembed"[^>]*>([\s\S]{0,1500})/.exec(html);
    if (shown) add(shown[1], "");
    return players;
  }

  // Visible text of a piece of markup.
  _plain(html) {
    return this._unescapeBody(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------- players

  // MegaPlay, directly or behind the site's own frame page: the page names a file id;
  // `getSources` answers with the subtitle tracks, the intro/outro times and the video
  // address, AES-encrypted with the player's fixed key.
  async _megaPlay(playerUrl, referer) {
    let url = playerUrl;
    let page = await this._page(url, referer, true);
    if (!/megaplay/.test(this._host(url))) {
      const inner = /<iframe[^>]*\bsrc=["'](https?:\/\/[^"']*megaplay[^"']*)["']/i.exec(page);
      if (!inner) throw new Error("the frame page names no player");
      url = this._unescapeBody(inner[1]);
      page = await this._page(url, this.base + "/", true);
    }
    const origin = this._origin(url);
    const file = /<div[^>]*\bid="megaplay-player"[^>]*\bdata-id="(\d+)"/.exec(page) || /\bdata-id="(\d+)"/.exec(page);
    if (!file) throw new Error("the player page has changed (no file id)");
    const lane = /[?&]s=([A-Za-z0-9_-]+)/.exec(url);
    const data = await this._json(origin + "/stream/getSources?id=" + file[1] + (lane ? "&s=" + lane[1] : ""), url);

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

    const listed = (data && Array.isArray(data.tracks) ? data.tracks : []).map(function (track) {
      if (!track || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: track.file, label: track.label, isDefault: track.default === true };
    });
    return {
      url: video,
      referer: origin + "/",
      subtitles: this._subtitles(listed, origin),
      skip: this._skip({ intro: data.intro, outro: data.outro }),
    };
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

  // Vidmoly: the page's player setup names the playlist (`sources: [{ file: '...' }]`).
  async _vidmoly(playerUrl, referer) {
    const page = await this._page(playerUrl, referer, true);
    const setup = /sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/.exec(page);
    const video = setup ? this._unescapeBody(setup[1]) : this._mediaUrls(page).filter(this._isHls)[0];
    if (!video || !/^https?:\/\//i.test(video)) {
      throw new Error(/deleted|not found|removed/i.test(page) ? "the video was removed from Vidmoly" : "the player names no video");
    }
    const origin = this._origin(playerUrl);
    const listed = [];
    const trackRe = /\{\s*file:\s*["']([^"']+\.(?:vtt|srt|ass)[^"']*)["']\s*,\s*label:\s*["']([^"']*)["']\s*,\s*kind:\s*["'](?:captions|subtitles)["']([^}]*)\}/g;
    let match;
    while ((match = trackRe.exec(page)) !== null) {
      listed.push({ url: this._unescapeBody(match[1]), label: match[2], isDefault: /default:\s*true/.test(match[3]) });
    }
    return { url: video, referer: origin + "/", subtitles: this._subtitles(listed, origin), skip: null };
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

  // ---------------------------------------------------------------- shared helpers

  // The body of a 2xx answer. A redirect to another site is an error unless `anyHost`, which
  // is for player pages.
  async _page(url, referer, anyHost) {
    const host = this._host(url);
    let response;
    try {
      response = await fetch(url, { headers: { Referer: referer || this.base + "/" } });
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
    const markers = ["Just a moment", "cf-chl", "challenge-platform/h/", "Attention Required! | Cloudflare",
      "Sorry, you have been blocked", "DDoS-Guard", "Checking your browser"];
    return markers.some(function (marker) { return body.indexOf(marker) >= 0; });
  }

  // Undoes the escaping scraped bodies wrap URLs in: `\/`, `\uXXXX` and HTML entities.
  _unescapeBody(body) {
    return body
      .replace(/\\+u([0-9a-fA-F]{4})/g, function (whole, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/\\+\//g, "/")
      .replace(/&#(\d{2,6});/g, function (whole, code) { return String.fromCodePoint(parseInt(code, 10)); })
      .replace(/&#x([0-9a-fA-F]{2,6});/g, function (whole, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }

  // Every distinct `.m3u8` / `.mp4` URL in the body, in order of appearance.
  _mediaUrls(body) {
    const text = this._unescapeBody(body);
    const re = /(https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*/gi;
    const urls = [];
    let match;
    while ((match = re.exec(text)) !== null) {
      let url = match[0].replace(/[);,\]}]+$/, "");
      if (!match[1]) {
        // A protocol-relative URL only counts when it opens a quoted value.
        const before = text.charAt(match.index - 1);
        if (before !== '"' && before !== "'") continue;
        url = "https:" + url;
      }
      if (urls.indexOf(url) < 0) urls.push(url);
    }
    return urls;
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
