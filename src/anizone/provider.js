// AniZone (anizone.to): original audio with soft subtitles. Search results and the player
// configuration are embedded in the pages as `JSON.parse('...')` literals.

class Provider {
  constructor() {
    this.base = "https://anizone.to";
    this.maxListedEpisodes = 5000;
    // The key of English titles in the site's per-language title maps.
    this.englishKey = "1";
  }

  getSettings() {
    return {
      episodeServers: ["AniZone"],
      supportsDub: false,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    if (opts && opts.dub) return [];
    const queries = this._queries(opts);
    if (queries.length === 0) throw new Error("no title to search for");

    const results = [];
    for (const query of queries) {
      const html = await this._page(this.base + "/anime?search=" + encodeURIComponent(query));
      const items = this._literalAfter(html, "items:");
      if (!Array.isArray(items)) {
        if (results.length === 0 && html.indexOf("items:") < 0) throw new Error("the search page has changed (no result list)");
        continue;
      }
      for (const item of items) {
        if (!item || typeof item.slug !== "string" || !item.slug) continue;
        if (results.some(function (r) { return r.slug === item.slug; })) continue;
        const titles = [];
        if (typeof item.main_title === "string" && item.main_title) titles.push(item.main_title);
        const list = item.title_list && typeof item.title_list === "object" ? item.title_list : {};
        for (const key of Object.keys(list)) {
          if (typeof list[key] === "string" && list[key] && titles.indexOf(list[key]) < 0) titles.push(list[key]);
        }
        if (titles.length === 0) continue;
        const count = typeof item.episode_count === "number" && item.episode_count > 0 ? Math.floor(item.episode_count) : 0;
        results.push({
          slug: item.slug,
          id: item.slug + "/" + count,
          title: titles[0],
          url: this.base + "/anime/" + encodeURIComponent(item.slug),
          subOrDub: "sub",
          altTitles: titles.slice(1),
          year: typeof item.start_year === "number" ? item.start_year : undefined,
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
    const parts = String(id).split("/");
    const slug = parts[0];
    const count = Math.min(Math.max(parseInt(parts[1], 10) || 0, 0), this.maxListedEpisodes);
    if (!slug) throw new Error("invalid anime id '" + id + "'");

    // Every episode page carries the whole episode list with titles; the first one is asked.
    // When that fails the list is numbered from the episode count the search gave.
    let episodes = [];
    try {
      const html = await this._page(this._episodeUrl(slug, "1"));
      episodes = this._episodeList(html, slug);
    } catch (error) {
      if (count === 0) throw error;
    }
    if (episodes.length === 0) {
      for (let n = 1; n <= count; n += 1) {
        episodes.push({ id: slug + "/" + n, number: n, url: this._episodeUrl(slug, String(n)), title: "Episode " + n });
      }
    }
    if (episodes.length === 0) throw new Error("no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("/");
    const slug = parts[0];
    const number = parts[1];
    if (!slug || !number) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    if (wanted !== "default" && wanted.toLowerCase() !== "anizone") throw new Error("unknown server '" + wanted + "'");

    let html;
    try {
      html = await this._page(this._episodeUrl(slug, number));
    } catch (error) {
      if (/^not found/.test(error.message)) throw new Error("episode " + number + " not on AniZone");
      throw error;
    }
    const player = this._player(html);
    if (!player) throw new Error("no video on the episode page");

    return {
      server: "AniZone",
      headers: { Referer: this.base + "/" },
      videoSources: [
        {
          url: player.url,
          type: this._isHls(player.url) ? "m3u8" : "mp4",
          quality: "auto",
          label: "Soft sub",
          subtitles: player.subtitles,
        },
      ],
    };
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

  _episodeUrl(slug, number) {
    return this.base + "/anime/" + encodeURIComponent(slug) + "/" + encodeURIComponent(number);
  }

  // Episode links of the list on an episode page, each preceded by its titles per language.
  _episodeList(html, slug) {
    const linkRe = new RegExp('href="https?://[^"/]+/anime/' + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '/(\\d+(?:\\.\\d+)?)"', "g");
    const episodes = [];
    const seen = {};
    let cursor = 0;
    let match;
    while ((match = linkRe.exec(html)) !== null) {
      const number = Number(match[1]);
      const before = html.slice(cursor, match.index);
      cursor = linkRe.lastIndex;
      if (!isFinite(number) || seen[match[1]]) continue;
      // Only links of the episode list carry a title map right before them.
      const at = before.lastIndexOf("epsTitles:");
      if (at < 0) continue;
      seen[match[1]] = true;
      const titles = this._literalAfter(before.slice(at), "epsTitles:");
      let title = null;
      if (titles && typeof titles === "object") {
        title = typeof titles[this.englishKey] === "string" && titles[this.englishKey].trim() ? titles[this.englishKey].trim() : null;
      }
      episodes.push({
        id: slug + "/" + match[1],
        number: number,
        url: this._episodeUrl(slug, match[1]),
        title: title || "Episode " + match[1],
      });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
  }

  // The playlist URL and subtitle tracks from an episode page's player configuration.
  _player(html) {
    const config = this._literalAfter(html, "vidstackPlayer(");
    if (config && typeof config.src === "string" && config.src) {
      const self = this;
      const tracks = Array.isArray(config.subtitles) ? config.subtitles : [];
      const subtitles = [];
      tracks.forEach(function (track, index) {
        if (!track || typeof track.file !== "string" || !track.file) return;
        const url = self._fixUrl(track.file);
        subtitles.push({
          id: (typeof track.language === "string" && track.language ? track.language : "sub") + "-" + index,
          url: url,
          language: (typeof track.title === "string" && track.title) || (typeof track.language === "string" && track.language) || "Unknown",
          isDefault: track.default === true,
          format: self._subtitleFormat(url, track.format),
        });
      });
      // Exactly one default: the site's own choice, else full English subtitles, else the first.
      if (subtitles.filter(function (s) { return s.isDefault; }).length !== 1) {
        let chosen = subtitles.findIndex(function (s) { return s.isDefault; });
        if (chosen < 0) chosen = subtitles.findIndex(function (s) { return /^en\b/i.test(s.id) && !/sign|song/i.test(s.language); });
        if (chosen < 0) chosen = subtitles.findIndex(function (s) { return /^en\b/i.test(s.id); });
        subtitles.forEach(function (s, index) { s.isDefault = index === Math.max(chosen, 0); });
      }
      return { url: this._fixUrl(config.src), subtitles: subtitles };
    }
    const playlists = this._mediaUrls(html).filter(this._isHls);
    return playlists.length > 0 ? { url: playlists[0], subtitles: [] } : null;
  }

  // ---------------------------------------------------------------- shared helpers

  async _page(url) {
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
    if (response.url && this._host(response.url) !== "unknown host" && !this._sameSite(this._host(response.url), host)) {
      throw new Error(host + " redirected to " + this._host(response.url));
    }
    return String(await response.text());
  }

  _looksLikeChallenge(body) {
    const markers = ["Just a moment", "cf-chl", "challenge-platform", "Attention Required! | Cloudflare",
      "Sorry, you have been blocked", "DDoS-Guard", "Checking your browser"];
    return markers.some(function (marker) { return body.indexOf(marker) >= 0; });
  }

  // Finds `JSON.parse('...')` after `marker` and returns the decoded value, or null.
  _literalAfter(body, marker) {
    const start = body.indexOf(marker);
    if (start < 0) return null;
    const opener = "JSON.parse('";
    const open = body.indexOf(opener, start + marker.length);
    if (open < 0) return null;
    let end = -1;
    for (let i = open + opener.length; i < body.length; i += 1) {
      const ch = body.charAt(i);
      if (ch === "\\") i += 1;
      else if (ch === "'") {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    // The literal usually sits inside an HTML attribute, so entities come first.
    const literal = body.slice(open + opener.length, end)
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, "&");
    try {
      return JSON.parse(this._decodeJsString(literal));
    } catch (error) {
      return null;
    }
  }

  // Decodes the contents of a JavaScript string literal (one layer of escapes).
  _decodeJsString(literal) {
    return literal.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, function (whole, escape) {
      const kind = escape.charAt(0);
      if ((kind === "u" || kind === "x") && escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16));
      if (kind === "n") return "\n";
      if (kind === "r") return "\r";
      if (kind === "t") return "\t";
      if (kind === "b") return "\b";
      if (kind === "f") return "\f";
      return escape;
    });
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
