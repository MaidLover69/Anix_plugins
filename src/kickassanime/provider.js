// KickAssAnime (kaa.lt): sub and dub through the site's JSON API. Streams come from its player
// pages, whose configuration sits in an HTML-encoded `props` attribute.

class Provider {
  constructor() {
    this.mirrors = ["https://kaa.lt"];
    this.languages = { sub: "ja-JP", dub: "en-US" };
    // Episode pages fetched at once when listing a long show.
    this.pageBatch = 6;
    this.maxPages = 40;
    this.maxPlayers = 3;
  }

  getSettings() {
    return {
      episodeServers: ["VidStreaming", "CatStream"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    const queries = this._queries(opts);
    if (queries.length === 0) throw new Error("no title to search for");
    const dub = Boolean(opts && opts.dub);
    const audio = dub ? "dub" : "sub";
    const lang = this.languages[audio];

    const results = [];
    for (const query of queries) {
      const answer = await this._api("/api/fsearch", {
        method: "POST",
        body: JSON.stringify({ query: query }),
      });
      const items = Array.isArray(answer.json && answer.json.result) ? answer.json.result : Array.isArray(answer.json) ? answer.json : [];
      for (const item of items) {
        if (!item || typeof item.slug !== "string" || !item.slug) continue;
        // A show is offered dubbed only when the site lists English audio for it.
        const locales = Array.isArray(item.locales) ? item.locales : [];
        if (dub && locales.indexOf(lang) < 0) continue;
        if (results.some(function (r) { return r.id.split("|")[1] === item.slug; })) continue;
        const titles = [];
        for (const title of [item.title_en, item.title]) {
          if (typeof title === "string" && title.trim() && titles.indexOf(title.trim()) < 0) titles.push(title.trim());
        }
        if (titles.length === 0) continue;
        results.push({
          id: answer.mirror + "|" + item.slug + "|" + lang,
          title: titles[0],
          url: answer.mirror + "/" + item.slug,
          subOrDub: audio,
          altTitles: titles.slice(1),
          year: typeof item.year === "number" ? item.year : undefined,
          episodeCount: typeof item.episode_count === "number" && item.episode_count > 0 ? item.episode_count : undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const show = this._parseShowId(id);
    const self = this;
    const first = await this._episodePage(show, 1);

    const bySlug = {};
    const order = [];
    const add = function (page, entry) {
      const key = String(entry.number);
      if (!bySlug[key]) order.push(key);
      if (!bySlug[key] || entry.slug) bySlug[key] = { page: page, entry: entry };
    };
    first.episodes.forEach(function (entry) { add(1, entry); });

    if (first.pages.length > 0) {
      // The page index names every episode. The other pages are fetched for titles and episode
      // slugs; one that fails leaves its episodes listed by number, resolved when played.
      const others = first.pages.filter(function (p) { return p.number !== 1; }).slice(0, this.maxPages);
      for (let i = 0; i < others.length; i += this.pageBatch) {
        const batch = others.slice(i, i + this.pageBatch);
        const fetched = await Promise.all(
          batch.map(function (p) {
            return self._episodePage(show, p.number).then(
              function (page) { return page; },
              function () { return null; }
            );
          })
        );
        batch.forEach(function (p, index) {
          if (fetched[index]) fetched[index].episodes.forEach(function (entry) { add(p.number, entry); });
          p.eps.forEach(function (number) {
            if (!bySlug[String(number)]) add(p.number, { number: number, written: self._formatNumber(number), slug: "", title: null });
          });
        });
      }
      first.pages.forEach(function (p) {
        p.eps.forEach(function (number) {
          if (!bySlug[String(number)]) add(p.number, { number: number, written: self._formatNumber(number), slug: "", title: null });
        });
      });
    } else {
      let hasNext = first.hasNext;
      for (let page = 2; hasNext && page <= this.maxPages; page += 1) {
        const next = await this._episodePage(show, page);
        if (next.episodes.length === 0) break;
        next.episodes.forEach(function (entry) { add(page, entry); });
        hasNext = next.hasNext;
      }
    }

    const episodes = order.map(function (key) {
      const found = bySlug[key];
      const entry = found.entry;
      return {
        id: [show.mirror, show.slug, show.lang, found.page, entry.written, entry.slug].join("|"),
        number: entry.number,
        url: entry.slug ? show.mirror + "/" + show.slug + "/ep-" + entry.written + "-" + entry.slug : show.mirror + "/" + show.slug,
        title: entry.title || "Episode " + entry.written,
      };
    });
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error(show.lang === this.languages.dub ? "no dub" : "no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    if (parts.length < 6 || !this._isHttpUrl(parts[0]) || !parts[1]) {
      throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    }
    const show = { mirror: parts[0], slug: parts[1], lang: parts[2] };
    let written = parts[4];
    let slug = parts[5];

    if (!slug) {
      const page = await this._episodePage(show, parseInt(parts[3], 10) || 1);
      const number = Number(written);
      const entry = page.episodes.filter(function (e) { return Math.abs(e.number - number) < 0.01; })[0];
      if (!entry || !entry.slug) throw new Error("episode " + written + " not listed");
      written = entry.written;
      slug = entry.slug;
    }

    const detail = await this._api(
      "/api/show/" + encodeURIComponent(show.slug) + "/episode/ep-" + encodeURIComponent(written) + "-" + encodeURIComponent(slug),
      null,
      show.mirror
    );
    const self = this;
    let players = (Array.isArray(detail.json && detail.json.servers) ? detail.json.servers : [])
      .filter(function (s) { return s && typeof s.src === "string" && s.src; })
      .map(function (s) { return { name: String(s.name || s.shortName || "server"), src: self._fixUrl(s.src) }; });
    if (players.length === 0) throw new Error("the site lists this episode without a video");

    const wanted = String(server || "default");
    if (wanted !== "default") {
      const offered = players.map(function (p) { return p.name; });
      players = players.filter(function (p) { return p.name.toLowerCase() === wanted.toLowerCase(); });
      if (players.length === 0) throw new Error("'" + wanted + "' is not offered for this episode (offered: " + offered.join(", ") + ")");
    }

    const audio = show.lang === this.languages.dub ? "Dub" : "Sub";
    let reason = null;
    for (const player of players.slice(0, this.maxPlayers)) {
      let html;
      try {
        html = await this._text(player.src, { headers: { Referer: show.mirror + "/", Origin: show.mirror } }, true);
      } catch (error) {
        reason = reason || this._errorText(error);
        continue;
      }
      const found = this._player(html);
      if (!found) {
        reason = reason || "player not supported (" + player.name + ", " + this._host(player.src) + ")";
        continue;
      }
      const origin = this._origin(player.src);
      return {
        server: player.name,
        headers: origin ? { Referer: origin + "/" } : {},
        videoSources: [
          {
            url: found.url,
            type: this._isHls(found.url) ? "m3u8" : "mp4",
            quality: "auto",
            label: found.subtitles.length > 0 ? audio + " · soft subtitles" : audio,
            subtitles: found.subtitles,
          },
        ],
      };
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

  _parseShowId(id) {
    const parts = String(id).split("|");
    if (parts.length < 3 || !this._isHttpUrl(parts[0]) || !parts[1] || !parts[2]) {
      throw new Error("invalid anime id '" + id + "'");
    }
    return { mirror: parts[0], slug: parts[1], lang: parts[2] };
  }

  // One page of the episodes API. The episode array is `result` (or `result.episodes`, or
  // `episodes`), and the index of all pages is the top-level `pages` array.
  async _episodePage(show, page) {
    const answer = await this._api(
      "/api/show/" + encodeURIComponent(show.slug) + "/episodes?page=" + page + "&lang=" + encodeURIComponent(show.lang),
      null,
      show.mirror
    );
    const json = answer.json || {};
    const result = json.result;
    const items = Array.isArray(result) ? result
      : result && Array.isArray(result.episodes) ? result.episodes
      : Array.isArray(json.episodes) ? json.episodes : [];

    const episodes = [];
    for (const item of items) {
      if (!item) continue;
      let number = this._number(item.episode_number);
      if (number === null) number = this._number(item.number);
      if (number === null || typeof item.slug !== "string" || !item.slug) continue;
      episodes.push({
        number: number,
        written: typeof item.episode_string === "string" && item.episode_string ? item.episode_string : this._formatNumber(number),
        slug: item.slug,
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : null,
      });
    }

    const self = this;
    const listed = Array.isArray(json.pages) ? json.pages : result && Array.isArray(result.pages) ? result.pages : [];
    const pages = listed.map(function (entry, index) {
      const eps = entry && Array.isArray(entry.eps) ? entry.eps : [];
      return {
        number: entry && typeof entry.number === "number" ? entry.number : index + 1,
        eps: eps.map(function (n) { return self._number(n); }).filter(function (n) { return n !== null; }),
      };
    });

    const hasNext = typeof json.hasNextPage === "boolean" ? json.hasNextPage : Boolean(result && result.hasNextPage);
    return { episodes: episodes, pages: pages, hasNext: hasNext };
  }

  // The playlist and subtitle tracks from a player page: `props` holds
  // `{"manifest":[0,"//host/master.m3u8"],"subtitles":[1,[[0,{...}]]],...}`.
  _player(html) {
    const re = /props="([^"]*)"/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      let props;
      try {
        props = JSON.parse(this._unescapeBody(match[1]));
      } catch (error) {
        continue;
      }
      const manifest = props && Array.isArray(props.manifest) ? props.manifest[1] : null;
      if (typeof manifest !== "string" || !manifest) continue;

      const self = this;
      const value = function (field) { return Array.isArray(field) ? field[1] : undefined; };
      const tracks = props && Array.isArray(props.subtitles) && Array.isArray(props.subtitles[1]) ? props.subtitles[1] : [];
      const subtitles = [];
      tracks.forEach(function (wrapped, index) {
        const track = Array.isArray(wrapped) ? wrapped[1] : null;
        const src = track ? value(track.src) : null;
        if (typeof src !== "string" || !src) return;
        const url = self._fixUrl(src);
        const language = value(track.language);
        subtitles.push({
          id: (typeof language === "string" && language ? language : "sub") + "-" + index,
          url: url,
          language: value(track.name) || language || "Unknown",
          isDefault: false,
          format: self._subtitleFormat(url, value(track.format)),
        });
      });
      // The player marks no default; English is the one shown first.
      let chosen = subtitles.findIndex(function (s) { return /^en\b/i.test(s.id) || /^english/i.test(String(s.language)); });
      if (chosen < 0 && subtitles.length > 0) chosen = 0;
      if (chosen >= 0) subtitles[chosen].isDefault = true;
      return { url: this._fixUrl(manifest), subtitles: subtitles };
    }
    const urls = this._mediaUrls(html);
    return urls.length > 0 ? { url: urls[0], subtitles: [] } : null;
  }

  // ---------------------------------------------------------------- requests

  // A JSON request to the site, trying each mirror in turn (or only `onlyMirror`).
  async _api(path, init, onlyMirror) {
    const mirrors = onlyMirror ? [onlyMirror] : this.mirrors;
    let failure = null;
    for (const mirror of mirrors) {
      const headers = { Referer: mirror + "/", Accept: "application/json" };
      const options = { headers: headers };
      if (init && init.method) {
        options.method = init.method;
        options.body = init.body;
        headers["Content-Type"] = "application/json";
        headers["Origin"] = mirror;
      }
      try {
        const text = await this._text(mirror + path, options, false);
        const trimmed = text.replace(/^\s+/, "");
        if (trimmed.charAt(0) === "<") {
          throw new Error(this._looksLikeChallenge(trimmed) ? "blocked by the site's bot protection" : this._host(mirror) + " answered with a page instead of data");
        }
        let json;
        try {
          json = JSON.parse(trimmed);
        } catch (error) {
          throw new Error(this._host(mirror) + " sent unreadable data");
        }
        return { mirror: mirror, json: json };
      } catch (error) {
        failure = failure || error;
      }
    }
    throw failure || new Error("no mirror configured");
  }

  // The body of a 2xx answer. A redirect to another site is an error unless `anyHost`, which
  // is for player pages.
  async _text(url, options, anyHost) {
    const host = this._host(url);
    const init = { headers: (options && options.headers) || {} };
    if (options && options.method) {
      init.method = options.method;
      init.body = options.body;
    }
    let response;
    try {
      response = await fetch(url, init);
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

  // ---------------------------------------------------------------- shared helpers

  _isHttpUrl(url) {
    return typeof url === "string" && /^https?:\/\/[^\s\/]+/i.test(url);
  }

  _origin(url) {
    const match = /^(https?:\/\/[^\/?#]+)/i.exec(String(url));
    return match ? match[1] : null;
  }

  _number(value) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return isFinite(number) ? number : null;
  }

  // 12 -> "12", 12.5 -> "12.5".
  _formatNumber(number) {
    return String(Math.round(number * 1000) / 1000);
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

  // Normalises URLs that sites emit without a scheme or with a doubled slash after it.
  _fixUrl(url) {
    const trimmed = String(url).trim();
    if (trimmed.indexOf("https:///") === 0) return "https://" + trimmed.slice(9);
    if (trimmed.indexOf("//") === 0) return "https:" + trimmed;
    return trimmed;
  }

  _subtitleFormat(url, declared) {
    const known = ["vtt", "srt", "ass", "ssa"];
    const said = String(declared || "").trim().toLowerCase();
    if (known.indexOf(said) >= 0) return said;
    const path = String(url).split(/[?#]/)[0];
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return known.indexOf(ext) >= 0 ? ext : "vtt";
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
