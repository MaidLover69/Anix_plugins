// Anidap (anidap.lol): sub and dub from up to five upstream hosts, found by AniList id. HLS,
// most with soft subtitles and intro/outro times.
// API as used by the Mangayomi source (github.com/Mallyd11/mangayomi-anime-extensions).

class Provider {
  constructor() {
    this.site = "https://anidap.lol";
    this.api = "https://chad.anidap.lol/rest/api";
    // Maps an AniList id to the site's id of the anime.
    this.embed = "https://aniembed.se";
    this.apiHeaders = { Origin: this.site, Referer: this.site + "/" };
    this.servers = ["Nero", "Yuki", "Zuna", "Sora", "Loli"];
  }

  getSettings() {
    return {
      episodeServers: ["Nero", "Yuki", "Zuna", "Sora", "Loli"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    const media = (opts && opts.media) || {};
    const audio = opts && opts.dub ? "dub" : "sub";
    let entry = null;
    if (typeof media.id === "number" && media.id > 0) {
      entry = {
        id: media.id,
        titles: this._distinct([this._text(media.romajiTitle), this._text(media.englishTitle), this._text(opts && opts.query)]),
        year: media.startDate && typeof media.startDate.year === "number" ? media.startDate.year : undefined,
        count: typeof media.episodeCount === "number" && media.episodeCount > 0 ? media.episodeCount : undefined,
      };
    } else {
      const queries = this._queries(opts);
      if (queries.length === 0) throw new Error("no title to search for");
      entry = await this._anilist(queries[0]);
    }
    if (!entry || entry.titles.length === 0) return [];

    const slug = await this._slug(entry.id);
    if (!slug) return [];
    return [
      {
        id: slug + "|" + audio,
        title: entry.titles[0],
        url: this.site + "/watch/" + slug,
        subOrDub: audio,
        altTitles: entry.titles.slice(1),
        year: entry.year,
        episodeCount: entry.count,
      },
    ];
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const slug = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!slug) throw new Error("invalid anime id '" + id + "'");

    const listed = await this._api(this.api + "/episodes?id=" + encodeURIComponent(slug));
    const episodes = [];
    const seen = {};
    for (const item of Array.isArray(listed) ? listed : []) {
      if (!item || typeof item.number !== "number" || seen[item.number]) continue;
      seen[item.number] = true;
      const titles = item.titles && typeof item.titles === "object" ? item.titles : {};
      const episode = {
        id: slug + "|" + item.number + "|" + audio,
        number: item.number,
        url: this.site + "/watch/" + slug + "?ep=" + item.number,
        title: this._text(titles.en) || this._text(titles["x-jat"]) || "Episode " + item.number,
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
    const slug = parts[0];
    const number = parts[1];
    const audio = parts[2] === "dub" ? "dub" : "sub";
    if (!slug || !/^\d+(\.\d+)?$/.test(number || "")) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    const known = this.servers;
    if (wanted !== "default" && !known.some(function (name) { return name.toLowerCase() === wanted.toLowerCase(); })) {
      throw new Error("unknown server '" + wanted + "'");
    }

    const query = "id=" + encodeURIComponent(slug) + "&epNum=" + number;
    const listed = await this._api(this.api + "/servers?" + query);
    const offered = ((listed && listed[audio === "dub" ? "dubProviders" : "subProviders"]) || [])
      .map(function (provider) { return provider && typeof provider.id === "string" ? provider.id.toLowerCase() : ""; })
      .filter(function (name) { return name; });
    if (offered.length === 0) {
      const other = (listed && listed[audio === "dub" ? "subProviders" : "dubProviders"]) || [];
      if (other.length > 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");
      throw new Error("no server listed for this episode");
    }

    // "default" tries what the episode offers in the order of `servers`.
    const order = (wanted === "default" ? known : [wanted])
      .map(function (name) { return name.toLowerCase(); })
      .filter(function (name) { return offered.indexOf(name) >= 0; });
    if (order.length === 0) throw new Error("'" + wanted + "' is not offered for this episode (offered: " + offered.join(", ") + ")");

    let reason = null;
    for (const provider of order) {
      try {
        const data = await this._api(this.api + "/sources?" + query + "&type=" + audio + "&providerId=" + provider);
        const result = this._result(provider, data, audio);
        if (result) return result;
        reason = reason || provider + " has no video for this episode";
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    throw new Error(reason || "no playable source for this episode");
  }

  // ---------------------------------------------------------------- parsing

  // A sources answer: { sources: [{ url, quality }], tracks: [{ url, label, kind, default }],
  // chapters: [{ title: "Intro" | "Outro", start, end }], headers }.
  _result(provider, data, audio) {
    const self = this;
    const usable = [];
    for (const source of data && Array.isArray(data.sources) ? data.sources : []) {
      const url = source ? this._fixUrl(source.url) : "";
      if (url) usable.push({ url: url, quality: source.quality, type: source.type });
    }
    if (usable.length === 0) return null;

    const headers = {};
    const given = data.headers && typeof data.headers === "object" ? data.headers : {};
    for (const name of Object.keys(given)) {
      if (typeof given[name] === "string" && /^(referer|origin|user-agent)$/i.test(name)) headers[name] = given[name];
    }
    const subtitles = this._subtitles((Array.isArray(data.tracks) ? data.tracks : []).map(function (track) {
      if (!track || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: self._fixUrl(track.url || track.file), label: track.label || track.lang, isDefault: track.default === true };
    }));
    const used = {};
    const videoSources = usable.map(function (source, index) {
      let quality = self._text(source.quality) || "auto";
      if (used[quality]) quality = quality + " (" + (index + 1) + ")";
      used[quality] = true;
      return {
        url: source.url,
        type: self._isHls(source.url) || /mpegurl/i.test(String(source.type || "")) ? "m3u8" : "mp4",
        quality: quality,
        label: audio === "dub" ? "Dub" : subtitles.length > 0 ? "Soft sub" : "Sub",
        subtitles: subtitles,
      };
    });
    const result = {
      server: provider.charAt(0).toUpperCase() + provider.slice(1),
      headers: headers,
      videoSources: videoSources,
    };
    const chapters = Array.isArray(data.chapters) ? data.chapters : [];
    const named = function (name) {
      return chapters.filter(function (chapter) { return chapter && String(chapter.title || "").toLowerCase() === name; })[0];
    };
    const skip = this._skip(named("intro"), named("outro"));
    if (skip) result.skip = skip;
    return result;
  }

  // Some hosts publish addresses as `//host/...` or `https:///host/...`.
  _fixUrl(raw) {
    if (typeof raw !== "string") return "";
    let url = raw.trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    url = url.replace(/^(https?:)\/{3,}/i, "$1//");
    return /^https?:\/\/[^\/]/i.test(url) ? url : "";
  }

  // The site's id of an anime, read from the player page of its first episode
  // (`id:"one-piece-p8k27",anilistId:21`). Null when the site does not have the anime.
  async _slug(anilistId) {
    const url = this.embed + "/e/" + anilistId + "/1";
    let response;
    try {
      response = await fetch(url, { headers: { Referer: this.site + "/" } });
    } catch (error) {
      throw new Error(this._host(url) + " unreachable (" + this._errorText(error) + ")");
    }
    const body = String(await response.text());
    if (response.status === 404) return null;
    if (!response.ok) {
      if (this._looksLikeChallenge(body)) throw new Error("blocked by the site's bot protection");
      throw new Error("HTTP " + response.status + " from " + this._host(url));
    }
    const found = /\bid:\s*"([^"]+)"\s*,\s*anilistId:\s*(\d+)/.exec(body);
    return found && found[2] === String(anilistId) ? found[1] : null;
  }

  // The best AniList match for a title, for hosts that pass no AniList id.
  async _anilist(title) {
    const query = "query ($search: String) { Media(search: $search, type: ANIME) { id episodes startDate { year } title { romaji english } } }";
    let response;
    try {
      response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: query, variables: { search: title } }),
      });
    } catch (error) {
      throw new Error("AniList unreachable (" + this._errorText(error) + ")");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("HTTP " + response.status + " from AniList");
    let found = null;
    try {
      found = JSON.parse(String(await response.text())).data.Media;
    } catch (error) {
      found = null;
    }
    if (!found || typeof found.id !== "number") return null;
    const names = found.title || {};
    return {
      id: found.id,
      titles: this._distinct([this._text(names.romaji), this._text(names.english), this._text(title)]),
      year: found.startDate && typeof found.startDate.year === "number" ? found.startDate.year : undefined,
      count: typeof found.episodes === "number" && found.episodes > 0 ? found.episodes : undefined,
    };
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
