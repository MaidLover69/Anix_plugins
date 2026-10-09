// JustAnime (justanime.to): sub and dub through the site's JSON API, which knows anime by
// their AniList id. HLS with soft subtitles and intro/outro times, or MP4 in several qualities.
// API as used by the Mangayomi source (github.com/Mallyd11/mangayomi-anime-extensions).

class Provider {
  constructor() {
    this.api = "https://core.justanime.to/api";
    this.site = "https://justanime.to";
    this.apiHeaders = { Origin: this.site, Referer: this.site + "/" };
    // Server name -> the API's name for it.
    this.routes = { MegaPlay: "megaplay", AnimeGG: "animegg" };
    // Episode lists come 100 a page; up to this many pages are read for their titles.
    this.maxPages = 3;
    this.maxListedEpisodes = 5000;
  }

  getSettings() {
    return {
      episodeServers: ["MegaPlay", "AnimeGG"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    const queries = this._queries(opts);
    const media = (opts && opts.media) || {};
    const audio = opts && opts.dub ? "dub" : "sub";
    const results = [];
    const self = this;
    const add = function (item) {
      if (!item || typeof item.id !== "number" || results.some(function (r) { return r.id === item.id + "|" + audio; })) return;
      const names = item.title && typeof item.title === "object" ? item.title : {};
      const titles = self._distinct([self._text(names.romaji), self._text(names.english)].concat(
        (Array.isArray(item.synonyms) ? item.synonyms : []).map(function (name) { return self._text(name); })));
      if (titles.length === 0) return;
      const count = typeof item.episodes === "number" && item.episodes > 0 ? item.episodes : undefined;
      results.push({
        id: item.id + "|" + audio,
        title: titles[0],
        url: self.site + "/anime/" + item.id,
        subOrDub: audio,
        altTitles: titles.slice(1),
        year: typeof item.year === "number" && item.year > 0 ? item.year : undefined,
        episodeCount: count,
      });
    };

    // The site's ids are AniList ids, so a known id is asked for directly.
    if (typeof media.id === "number" && media.id > 0) {
      try {
        const known = await this._api(this.api + "/anime/" + media.id);
        add(known && known.data);
      } catch (error) {
        if (queries.length === 0) throw error;
      }
    }
    if (results.length > 0) return results;
    if (queries.length === 0) throw new Error("no title to search for");
    for (const query of queries) {
      const found = await this._api(this.api + "/search?query=" + encodeURIComponent(query) + "&page=1");
      const items = found && Array.isArray(found.results) ? found.results : [];
      for (const item of items) add(item);
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const animeId = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(animeId)) throw new Error("invalid anime id '" + id + "'");

    const self = this;
    const episodes = [];
    const seen = {};
    const take = function (data) {
      for (const item of data && Array.isArray(data.episodes) ? data.episodes : []) {
        if (!item || typeof item.number !== "number" || seen[item.number]) continue;
        seen[item.number] = true;
        const episode = {
          id: animeId + "|" + item.number + "|" + audio,
          number: item.number,
          url: self.site + "/watch/" + animeId + "?ep=" + item.number,
          title: self._text(item.title) || "Episode " + item.number,
        };
        if (typeof item.image === "string" && /^https:\/\//.test(item.image)) episode.image = item.image;
        if (self._text(item.description)) episode.synopsis = self._text(item.description);
        episodes.push(episode);
      }
    };
    const pageUrl = function (page) { return self.api + "/anime/" + animeId + "/episodes?page=" + page; };
    const first = await this._api(pageUrl(1));
    take(first);
    const pages = first && typeof first.totalPages === "number" ? first.totalPages : 1;
    if (pages <= this.maxPages) {
      const batch = [];
      for (let page = 2; page <= pages; page += 1) batch.push(this._api(pageUrl(page)));
      for (const data of await Promise.all(batch)) take(data);
    } else {
      // A long series is numbered from its episode count instead of read page by page.
      const total = Math.min(typeof first.totalEpisodes === "number" ? first.totalEpisodes : 0, this.maxListedEpisodes);
      for (let number = 1; number <= total; number += 1) take({ episodes: [{ number: number }] });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error("no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const animeId = parts[0];
    const number = parts[1];
    const audio = parts[2] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(animeId || "") || !/^\d+(\.\d+)?$/.test(number || "")) {
      throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    }
    const wanted = String(server || "default");
    const names = Object.keys(this.routes);
    const chosen = names.filter(function (name) { return name.toLowerCase() === wanted.toLowerCase(); });
    if (wanted !== "default" && chosen.length === 0) throw new Error("unknown server '" + wanted + "'");

    let reason = null;
    for (const name of wanted === "default" ? names : chosen) {
      try {
        const data = await this._api(this.api + "/watch/" + animeId + "/episode/" + number + "/" + this.routes[name]);
        const result = this._result(name, data, audio);
        if (result) return result;
        const other = data && data[audio === "dub" ? "sub" : "dub"];
        const hasOther = other && Array.isArray(other.sources) && other.sources.length > 0;
        reason = reason || (hasOther ? (audio === "dub" ? "no dub for this episode" : "no subbed version of this episode") : name + " has no video for this episode");
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    throw new Error(reason || "no playable source for this episode");
  }

  // ---------------------------------------------------------------- parsing

  // One audio version of a watch answer: { sources: [{ url, quality, isM3U8, headers? }],
  // subtitles: [{ file, label, default }], intro, outro, headers }.
  _result(name, data, audio) {
    const version = data && data[audio];
    const listed = version && Array.isArray(version.sources) ? version.sources : [];
    const usable = listed.filter(function (source) { return source && typeof source.url === "string" && /^https?:\/\//i.test(source.url); });
    if (usable.length === 0) return null;

    let headers = version.headers && typeof version.headers === "object" ? version.headers : null;
    for (const source of usable) {
      if (!headers && source.headers && typeof source.headers === "object") headers = source.headers;
    }
    const referer = headers && typeof headers.Referer === "string" ? headers.Referer : this.site + "/";

    const subtitles = this._subtitles((Array.isArray(version.subtitles) ? version.subtitles : []).map(function (track) {
      if (!track || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: track.file, label: track.label, isDefault: track.default === true };
    }));
    const height = function (source) { return parseInt(source.quality, 10) || 0; };
    usable.sort(function (a, b) { return height(b) - height(a); });
    const self = this;
    const used = {};
    const videoSources = usable.map(function (source, index) {
      let quality = self._text(source.quality) || "auto";
      if (used[quality]) quality = quality + " (" + (index + 1) + ")";
      used[quality] = true;
      const hls = source.isM3U8 === true || self._isHls(source.url);
      return {
        url: source.url,
        type: hls ? "m3u8" : "mp4",
        quality: quality,
        label: audio === "dub" ? "Dub" : subtitles.length > 0 ? "Soft sub" : "Sub",
        subtitles: subtitles,
      };
    });
    const result = { server: name, headers: { Referer: referer }, videoSources: videoSources };
    const skip = this._skip(version.intro, version.outro);
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
