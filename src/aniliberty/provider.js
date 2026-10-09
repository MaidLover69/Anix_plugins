// AniLiberty (aniliberty.top, formerly AniLibria): Russian voice-over as HLS in up to three
// qualities, with opening/ending times, through the site's public JSON API (/api/v1).

class Provider {
  constructor() {
    this.site = "https://aniliberty.top";
    this.api = this.site + "/api/v1";
    this.apiHeaders = { Referer: this.site + "/" };
  }

  getSettings() {
    return {
      episodeServers: ["AniLiberty"],
      supportsDub: false,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    // The site has one audio version, its Russian voice-over, offered as the regular one.
    if (opts && opts.dub) return [];
    const queries = this._queries(opts);
    if (queries.length === 0) throw new Error("no title to search for");

    const results = [];
    for (const query of queries) {
      const found = await this._api(this.api + "/app/search/releases?query=" + encodeURIComponent(query));
      for (const item of Array.isArray(found) ? found : []) {
        if (!item || typeof item.id !== "number") continue;
        if (results.some(function (r) { return r.id === String(item.id); })) continue;
        const names = item.name && typeof item.name === "object" ? item.name : {};
        // The English name is the romanised title, which is what a host matches against.
        const titles = this._distinct([this._text(names.english), this._text(names.main), this._text(names.alternative)]);
        if (titles.length === 0) continue;
        results.push({
          id: String(item.id),
          title: titles[0],
          url: this.site + "/anime/releases/release/" + encodeURIComponent(this._text(item.alias) || String(item.id)),
          subOrDub: "sub",
          altTitles: titles.slice(1),
          year: typeof item.year === "number" && item.year > 0 ? item.year : undefined,
          episodeCount: typeof item.episodes_total === "number" && item.episodes_total > 0 ? item.episodes_total : undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const releaseId = String(id);
    if (!/^\d+$/.test(releaseId)) throw new Error("invalid anime id '" + id + "'");

    const release = await this._api(this.api + "/anime/releases/" + releaseId);
    const episodes = [];
    const seen = {};
    for (const item of release && Array.isArray(release.episodes) ? release.episodes : []) {
      if (!item || typeof item.ordinal !== "number" || seen[item.ordinal]) continue;
      seen[item.ordinal] = true;
      const episode = {
        id: releaseId + "|" + item.ordinal,
        number: item.ordinal,
        url: this.site + "/anime/releases/release/" + encodeURIComponent(this._text(release.alias) || releaseId) + "/episodes",
        title: this._text(item.name) || "Episode " + item.ordinal,
      };
      const preview = item.preview && typeof item.preview.src === "string" ? item.preview.src : "";
      if (preview) episode.image = /^https:\/\//.test(preview) ? preview : this.site + preview;
      episodes.push(episode);
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) {
      throw new Error(release && release.is_blocked_by_geo ? "not available in this country" : "no episodes listed");
    }
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const releaseId = parts[0];
    const ordinal = Number(parts[1]);
    if (!/^\d+$/.test(releaseId || "") || !isFinite(ordinal)) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    if (wanted !== "default" && wanted.toLowerCase() !== "aniliberty") throw new Error("unknown server '" + wanted + "'");

    const release = await this._api(this.api + "/anime/releases/" + releaseId);
    const found = (release && Array.isArray(release.episodes) ? release.episodes : []).filter(function (item) {
      return item && item.ordinal === ordinal;
    })[0];
    if (!found) throw new Error("episode " + ordinal + " not on AniLiberty");

    const videoSources = [];
    for (const height of ["1080", "720", "480"]) {
      const url = found["hls_" + height];
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
      videoSources.push({ url: url, type: "m3u8", quality: height + "p", label: "Russian voice-over", subtitles: [] });
    }
    if (videoSources.length === 0) throw new Error("the site names no video for this episode");

    const result = { server: "AniLiberty", headers: { Referer: this.site + "/" }, videoSources: videoSources };
    const span = function (entry) {
      return entry && typeof entry.start === "number" && typeof entry.stop === "number" ? { start: entry.start, end: entry.stop } : null;
    };
    const skip = this._skip(span(found.opening), span(found.ending));
    if (skip) result.skip = skip;
    return result;
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
