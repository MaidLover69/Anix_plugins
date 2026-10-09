// AniLab (the service behind the AniLab and AniDB apps): sub and dub as HLS through its JSON API.
// API as used by the Aniyomi sources (github.com/yuzono/anime-extensions, src/en/anidb, and
// github.com/salmanbappi/sb-extensions-source, src/en/anilab).

class Provider {
  constructor() {
    this.catalog = "https://anilab2.amdapi.click/api";
    this.player = "https://play.anidb.app/api";
    this.site = "https://anilab.so";
    this.apiHeaders = {};
    // Search answers with ids only; this many hits are looked up for their titles.
    this.maxHits = 12;
  }

  getSettings() {
    return {
      episodeServers: ["AniLab"],
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    const queries = this._queries(opts);
    if (queries.length === 0) throw new Error("no title to search for");
    const audio = opts && opts.dub ? "dub" : "sub";

    for (const query of queries) {
      const found = await this._api(this.catalog + "/search?query=" + encodeURIComponent(query) + "&page=1");
      const ids = [];
      for (const post of found && Array.isArray(found.posts) ? found.posts : []) {
        if (post && typeof post.id === "number" && ids.indexOf(post.id) < 0) ids.push(post.id);
      }
      if (ids.length === 0) continue;

      const self = this;
      const looked = await Promise.all(ids.slice(0, this.maxHits).map(function (postId) {
        return self._api(self.catalog + "/post?id=" + postId).then(
          function (post) { return { post: post }; },
          function (error) { return { error: error }; });
      }));
      const results = [];
      for (const entry of looked) {
        const post = entry.post;
        if (!post || typeof post.id !== "number" || !this._text(post.title)) continue;
        const year = /(\d{4})/.exec(this._text(post.premiered));
        results.push({
          id: post.id + "|" + audio,
          title: this._text(post.title),
          url: this.site + "/",
          subOrDub: audio,
          year: year ? parseInt(year[1], 10) : undefined,
        });
      }
      if (results.length > 0) return results;
      const failed = looked.filter(function (entry) { return entry.error; })[0];
      if (failed) throw failed.error;
    }
    return [];
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const animeId = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(animeId)) throw new Error("invalid anime id '" + id + "'");

    const data = await this._api(this.player + "/anime/" + animeId + "/episodes");
    const episodes = [];
    const seen = {};
    for (const item of data && Array.isArray(data.list) ? data.list : []) {
      const number = item ? Number(item.number) : NaN;
      if (!item || !/^\d+$/.test(String(item.id)) || !isFinite(number) || seen[number]) continue;
      seen[number] = true;
      const episode = {
        id: item.id + "|" + audio,
        number: number,
        url: this.site + "/",
        title: this._text(item.name) || "Episode " + number,
      };
      if (item.filler === true) episode.filler = true;
      episodes.push(episode);
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error("no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const episodeId = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^\d+$/.test(episodeId || "")) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    if (wanted !== "default" && wanted.toLowerCase() !== "anilab") throw new Error("unknown server '" + wanted + "'");

    // One entry per audio version and mirror: { id: "3512/jpn", lang: "sub", name: "SUB Server #1" }.
    const data = await this._api(this.player + "/episode/" + episodeId + "/servers");
    const listed = (data && Array.isArray(data.list) ? data.list : []).filter(function (entry) {
      return entry && typeof entry.id === "string" && /^\d+\/[a-z]+$/i.test(entry.id);
    });
    if (listed.length === 0) throw new Error("no server listed for this episode");
    const tracks = this._distinct(listed
      .filter(function (entry) { return String(entry.lang || "").toLowerCase() === audio; })
      .map(function (entry) { return entry.id; }));
    if (tracks.length === 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");

    let reason = null;
    for (const track of tracks) {
      try {
        const answer = await this._api(this.player + "/episode/" + track + "/iframe");
        const url = answer && typeof answer.link === "string" ? answer.link : "";
        if (!/^https?:\/\//i.test(url)) {
          reason = reason || "the server names no video";
          continue;
        }
        return {
          server: "AniLab",
          headers: {},
          videoSources: [
            { url: url, type: this._isHls(url) ? "m3u8" : "mp4", quality: "auto", label: audio === "dub" ? "Dub" : "Sub", subtitles: [] },
          ],
        };
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    throw new Error(reason || "no playable source for this episode");
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
