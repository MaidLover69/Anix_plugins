// AnimeParadise (animeparadise.moe): original audio with soft subtitles and intro/outro
// times (HLS), through the site's JSON API.
// API as used by the Aniyomi source (github.com/yuzono/anime-extensions, src/en/animeparadise).

class Provider {
  constructor() {
    this.site = "https://www.animeparadise.moe";
    this.api = "https://api.animeparadise.moe";
    this.stream = "https://stream.animeparadise.moe";
    this.apiHeaders = { Origin: this.site, Referer: this.site + "/" };
  }

  getSettings() {
    return {
      episodeServers: ["AnimeParadise"],
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
      const found = await this._api(this.api + "/search?sort=POPULARITY&page=1&q=" + encodeURIComponent(query) + "&v=1");
      for (const item of found && Array.isArray(found.data) ? found.data : []) {
        if (!item || typeof item._id !== "string" || !item._id) continue;
        if (results.some(function (r) { return r.id === item._id; })) continue;
        const other = item.alternativeTitle && typeof item.alternativeTitle === "object" ? item.alternativeTitle : {};
        const titles = this._distinct([this._text(item.title), this._text(other.romaji), this._text(other.english), this._text(other.native)]);
        if (titles.length === 0) continue;
        const season = item.animeSeason && typeof item.animeSeason === "object" ? item.animeSeason : {};
        const started = /^(\d{4})/.exec(this._text(item.startDate));
        const count = typeof item.episodeCount === "number" && item.episodeCount > 0 ? item.episodeCount : item.episodes;
        results.push({
          id: item._id,
          title: titles[0],
          url: this.site + "/anime/" + encodeURIComponent(this._text(item.link) || item._id),
          subOrDub: "sub",
          altTitles: titles.slice(1),
          year: started ? parseInt(started[1], 10) : typeof season.year === "number" ? season.year : undefined,
          episodeCount: typeof count === "number" && count > 0 ? count : undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const animeId = String(id);
    if (!/^[A-Za-z0-9_-]+$/.test(animeId)) throw new Error("invalid anime id '" + id + "'");

    const data = await this._api(this.api + "/anime/" + animeId + "/episode");
    const episodes = [];
    const seen = {};
    for (const item of data && Array.isArray(data.data) ? data.data : []) {
      const number = item ? Number(item.number) : NaN;
      if (!item || typeof item.uid !== "string" || !item.uid || !isFinite(number) || seen[number]) continue;
      seen[number] = true;
      const episode = {
        id: animeId + "|" + item.uid,
        number: number,
        url: this.site + "/watch/" + item.uid + "?origin=" + animeId,
        title: this._text(item.title) || "Episode " + number,
      };
      if (typeof item.image === "string" && /^https:\/\//.test(item.image)) episode.image = item.image;
      episodes.push(episode);
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error("no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const animeId = parts[0];
    const uid = parts[1];
    if (!animeId || !uid || !/^[A-Za-z0-9_-]+$/.test(uid)) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    if (wanted !== "default" && wanted.toLowerCase() !== "animeparadise") throw new Error("unknown server '" + wanted + "'");

    const data = await this._api(this.api + "/ep/" + uid + "?origin=" + encodeURIComponent(animeId));
    const found = data && data.data && data.data.episode ? data.data.episode : null;
    const link = found ? this._text(found.streamLink) : "";
    if (!link) throw new Error("the site names no video for this episode");
    const url = /^https?:\/\//i.test(link) ? link : this.stream + "/m3u8?url=" + encodeURIComponent(link);

    const subtitles = this._subtitles((Array.isArray(found.subData) ? found.subData : []).map(function (track) {
      return track ? { url: track.src, label: track.label, isDefault: /^english$/i.test(String(track.label || "")) } : null;
    }));
    for (const subtitle of subtitles) {
      const listed = (found.subData || []).filter(function (track) { return track && track.src === subtitle.url; })[0];
      if (listed && /^(vtt|srt|ass)$/i.test(String(listed.type || ""))) subtitle.format = String(listed.type).toLowerCase();
    }
    const result = {
      server: "AnimeParadise",
      headers: { Referer: this.site + "/" },
      videoSources: [
        { url: url, type: "m3u8", quality: "auto", label: subtitles.length > 0 ? "Soft sub" : "Sub", subtitles: subtitles },
      ],
    };
    const times = found.skipData && typeof found.skipData === "object" ? found.skipData : {};
    const skip = this._skip(times.intro, times.outro);
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
