// Miruro: one catalog API in front of several upstream sites. An anime is found by its AniList
// (or MyAnimeList) id; successful answers are gzip-compressed JSON XOR-ed with a fixed key, so
// this plugin needs the binary helpers of the Anilili runtime (`$anilili`).

class Provider {
  constructor() {
    this.mirrors = [
      "https://www.miruro.bz",
      "https://www.miruro.ru",
      "https://www.miruro.to",
      "https://www.miruro.tv",
    ];
    this.catalogKey = "miruro/catalog";
    // Upstream sites the API has been seen to answer with, in the order they are preferred.
    this.upstreams = ["kickassanime", "anikoto", "aniwaves", "icarus", "animepahe"];
    this.mirrorStaggerMs = 400;
    this.requestBudgetMs = 9000;
    this.maxAttempts = 3;
    this.maxPages = 20;
    this.maxGroupsChecked = 8;
    this.streamCheckMs = 7000;
    this.lastGood = -1;
  }

  getSettings() {
    return {
      episodeServers: this.upstreams.slice(),
      supportsDub: true,
    };
  }

  // ---------------------------------------------------------------- interface

  async search(opts) {
    this._requireHost();
    const media = (opts && opts.media) || {};
    const anilistId = Number(media.id);
    if (!(anilistId > 0)) {
      throw new Error("the AniList id of the anime is needed (opts.media.id)");
    }

    let anime = await this._lookup("anilist", anilistId);
    const malId = Number(media.idMal);
    if (!anime && malId > 0) anime = await this._lookup("mal", malId);
    if (!anime) return [];

    const dub = Boolean(opts.dub);
    const counts = anime.episode_counts || {};
    const count = this._count(dub ? counts.dub : counts.sub);
    // The site says how far each audio version goes; zero dubbed episodes means no dub.
    if (dub && !(count > 0)) return [];

    const titles = anime.title || {};
    const title =
      this._text(titles.english) || this._text(titles.romaji) || this._text(titles.native) ||
      this._text(media.englishTitle) || this._text(media.romajiTitle) || this._text(opts.query) || "Miruro";
    const audio = dub ? "dub" : "sub";
    return [
      {
        id: anime.id + "/" + audio + "/" + (count === null ? "" : count),
        title: title,
        url: this._mirror() + "/",
        subOrDub: audio,
        year: typeof anime.season_year === "number" ? anime.season_year : undefined,
      },
    ];
  }

  async findEpisodes(id) {
    this._requireHost();
    const parts = String(id).split("/");
    const animeId = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    const limit = parts[2] ? Number(parts[2]) : null;
    if (!this._isAnimeId(animeId)) throw new Error("invalid anime id '" + id + "'");

    let items;
    try {
      items = await this._list("/api/v1/anime/" + animeId + "/episodes?limit=10000");
    } catch (error) {
      if (error.problem && error.problem.status === 404) throw new Error("anime not on Miruro");
      throw error;
    }

    const seen = {};
    const episodes = [];
    for (const item of items) {
      // Specials are numbered from 20000 by the site and are not part of the regular list.
      if (!item || item.kind !== "regular") continue;
      const number = this._number(item.episode_number);
      if (number === null || number < 0) continue;
      // An episode that is listed but not out yet in this audio version is not offered.
      if (limit !== null && isFinite(limit) && number > limit) continue;
      const key = String(number);
      if (seen[key]) continue;
      seen[key] = true;

      const thumbnail = this._text(item.thumbnail_url);
      episodes.push({
        id: animeId + "/" + audio + "/" + key + "/" + this._skipPart(item.skip_times),
        number: number,
        url: this._mirror() + "/",
        title: this._text(item.title) || "Episode " + key,
        image: thumbnail && this._isHttpUrl(thumbnail) ? thumbnail : undefined,
        synopsis: this._text(item.synopsis) || undefined,
      });
    }
    episodes.sort(function (a, b) {
      return a.number - b.number;
    });
    if (episodes.length === 0) throw new Error(audio === "dub" ? "no dub" : "no episodes listed");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    this._requireHost();
    const parts = String((episode && episode.id) || "").split("/");
    const animeId = parts[0];
    const audio = parts[1];
    const number = parts[2];
    if (!this._isAnimeId(animeId) || (audio !== "sub" && audio !== "dub") || !/^\d+(\.\d+)?$/.test(number || "")) {
      throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    }

    let play;
    try {
      play = await this._request("/api/v1/anime/" + animeId + "/episodes/" + number + "/play");
    } catch (error) {
      if (error.problem && error.problem.status === 404) {
        const about = String(error.problem.title || "").toLowerCase();
        throw new Error(about.indexOf("episode") >= 0 ? "episode " + number + " not listed" : "anime not on Miruro");
      }
      throw error;
    }

    let groups = this._sourceGroups(play, audio);
    if (groups.length === 0) throw new Error(audio === "dub" ? "no dub" : "no playable source for this episode");

    const wanted = String(server || "default");
    if (wanted !== "default") {
      const offered = this._distinct(groups.map(function (g) { return g.upstream; }));
      groups = groups.filter(function (g) { return g.upstream.toLowerCase() === wanted.toLowerCase(); });
      if (groups.length === 0) {
        throw new Error("'" + wanted + "' has no stream for this episode (offered: " + offered.join(", ") + ")");
      }
    }

    const chosen = await this._firstPlayable(groups);
    const result = {
      server: chosen.upstream,
      headers: chosen.headers,
      videoSources: chosen.sources,
    };
    const skip = this._parseSkipPart(parts[3] || "");
    if (skip) result.skip = skip;
    return result;
  }

  // ---------------------------------------------------------------- sources

  // One group per upstream site, track and header set, in the order they are to be tried: for
  // sub the soft-subtitle track ("ssub") before the hard-subbed one ("sub"); for dub the dub
  // track. Servers that only offer an embed page have no streams and are left out.
  _sourceGroups(play, audio) {
    const tracks = play && Array.isArray(play.tracks) ? play.tracks : null;
    if (!tracks) throw new Error("the play answer has no track list");
    const kinds = audio === "dub" ? ["dub"] : ["ssub", "sub"];
    const groups = [];

    for (const kind of kinds) {
      for (const track of tracks) {
        if (!track || track.track !== kind) continue;
        const providers = Array.isArray(track.providers) ? track.providers : [];
        for (const provider of providers) {
          if (!provider) continue;
          const upstream = this._text(provider.provider) || "unknown";
          // A hard-subbed video needs no subtitle file.
          const subtitles = kind === "sub" ? [] : this._subtitles(provider.subtitles);
          const variant =
            kind === "ssub" ? "Soft sub" : kind === "sub" ? "Hard sub" : subtitles.length > 0 ? "Dub + subtitles" : "Dub";

          const servers = Array.isArray(provider.servers) ? provider.servers : [];
          for (const entry of servers) {
            if (!entry) continue;
            const serverName = this._text(entry.server) || "server";
            const headers = {};
            const rawHeaders = entry.headers && typeof entry.headers === "object" ? entry.headers : {};
            for (const name of Object.keys(rawHeaders)) {
              if (name && typeof rawHeaders[name] === "string" && rawHeaders[name]) headers[name] = rawHeaders[name];
            }
            const headerKey = JSON.stringify(Object.keys(headers).sort().map(function (n) { return [n.toLowerCase(), headers[n]]; }));

            const streams = Array.isArray(entry.streams) ? entry.streams : [];
            for (const stream of streams) {
              if (!stream || !this._isHttpUrl(stream.url)) continue;
              const type = stream.format === "hls" ? "m3u8" : stream.format === "mp4" ? "mp4" : null;
              if (!type) continue;
              const quality = this._text(stream.quality) || "auto";

              let group = null;
              for (const existing of groups) {
                if (existing.upstream === upstream && existing.kind === kind && existing.headerKey === headerKey) group = existing;
              }
              if (!group) {
                group = { upstream: upstream, kind: kind, headerKey: headerKey, headers: headers, sources: [] };
                groups.push(group);
              }
              group.sources.push({
                url: stream.url,
                type: type,
                quality: this._uniqueQuality(group.sources, upstream + " · " + serverName + " · " + quality + " · " + variant),
                label: variant,
                subtitles: subtitles,
              });
            }
          }
        }
      }
    }
    return groups;
  }

  _uniqueQuality(sources, wanted) {
    let label = wanted;
    let n = 2;
    while (sources.some(function (s) { return s.quality === label; })) {
      label = wanted + " (" + n + ")";
      n += 1;
    }
    return label;
  }

  // At most one file is the default. Upstream sites often mark whichever file comes first, so
  // an English file wins: the marked one if it is English, else the first English one, and
  // only without any English file whatever the site marked.
  _subtitles(listed) {
    if (!Array.isArray(listed)) return [];
    const self = this;
    const usable = listed.filter(function (entry) { return entry && self._isHttpUrl(entry.file); });
    const isEnglish = function (entry) {
      const code = String(entry.language || "").toLowerCase();
      const label = String(entry.label || "").toLowerCase();
      return code === "en" || code === "eng" || code === "english" || label.indexOf("eng") === 0;
    };
    const marked = function (entry) { return entry.default === true; };
    let chosen = usable.findIndex(function (e) { return marked(e) && isEnglish(e); });
    if (chosen < 0) chosen = usable.findIndex(isEnglish);
    if (chosen < 0) chosen = usable.findIndex(marked);

    return usable.map(function (entry, index) {
      const language = self._text(entry.label) || self._text(entry.language) || "Subtitles";
      return {
        id: (self._text(entry.language) || "sub") + "-" + index,
        url: entry.file,
        language: language,
        isDefault: index === chosen,
        format: self._subtitleFormat(entry.file, entry.format),
      };
    });
  }

  _subtitleFormat(url, declared) {
    const known = ["vtt", "srt", "ass", "ssa"];
    const said = String(declared || "").trim().toLowerCase();
    if (known.indexOf(said) >= 0) return said;
    const path = String(url).split(/[?#]/)[0];
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return known.indexOf(ext) >= 0 ? ext : "vtt";
  }

  // The first group, in order, with a playlist that can actually be fetched; that stream is put
  // first. The groups are checked at the same time, so the choice costs no more than the
  // slowest check. A group that only has files (mp4) cannot be checked cheaply and is used only
  // when no playlist answered.
  async _firstPlayable(groups) {
    const self = this;
    const candidates = groups.slice(0, this.maxGroupsChecked);
    const outcomes = await Promise.all(
      candidates.map(function (group) {
        return self._withDeadline(self._checkGroup(group), self.streamCheckMs, { ok: false, reason: "timed out" });
      })
    );

    for (let i = 0; i < candidates.length; i += 1) {
      if (outcomes[i].ok) {
        const group = candidates[i];
        const first = group.sources[outcomes[i].index];
        const rest = group.sources.filter(function (s) { return s !== first; });
        return { upstream: group.upstream, headers: group.headers, sources: [first].concat(rest) };
      }
    }
    for (let i = 0; i < candidates.length; i += 1) {
      if (outcomes[i].unchecked) {
        return { upstream: candidates[i].upstream, headers: candidates[i].headers, sources: candidates[i].sources };
      }
    }
    let reason = "no stream";
    for (let i = 0; i < candidates.length; i += 1) {
      if (outcomes[i].reason) {
        reason = candidates[i].upstream + ": " + outcomes[i].reason;
        break;
      }
    }
    throw new Error("stream check failed (" + reason + ")");
  }

  async _checkGroup(group) {
    let reason = null;
    let playlists = 0;
    for (let index = 0; index < group.sources.length && playlists < 3; index += 1) {
      const source = group.sources[index];
      if (source.type !== "m3u8") continue;
      playlists += 1;
      try {
        const response = await fetch(source.url, { headers: group.headers });
        if (!response.ok) {
          reason = reason || "HTTP " + response.status + " from " + this._host(source.url);
          continue;
        }
        const body = String(await response.text());
        if (body.indexOf("#EXTM3U") >= 0) return { ok: true, index: index };
        reason = reason || this._host(source.url) + " did not answer with a playlist";
      } catch (error) {
        reason = reason || this._host(source.url) + " unreachable";
      }
    }
    if (playlists === 0) return { ok: false, unchecked: true };
    return { ok: false, reason: reason || "no stream" };
  }

  _withDeadline(promise, ms, fallback) {
    return new Promise(function (resolve) {
      let settled = false;
      const timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          resolve(fallback);
        }
      }, ms);
      promise.then(
        function (value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      );
    });
  }

  // ---------------------------------------------------------------- skip times

  // Intro and outro from an episode's `skip_times`: `op` (else `mixed_op`) is the intro, `ed`
  // (else `mixed_ed`) the outro; recaps and other kinds are not skipped. They travel in the
  // episode id as `i{start}-{end}` and/or `o{start}-{end}`.
  _skipPart(entries) {
    const self = this;
    const window = function (kinds) {
      if (!Array.isArray(entries)) return null;
      for (const kind of kinds) {
        for (const entry of entries) {
          if (!entry || entry.kind !== kind) continue;
          const start = self._number(entry.start_seconds);
          const end = self._number(entry.end_seconds);
          if (start !== null && end !== null && start >= 0 && end > start) return start + "-" + end;
        }
      }
      return null;
    };
    const intro = window(["op", "mixed_op"]);
    const outro = window(["ed", "mixed_ed"]);
    const parts = [];
    if (intro) parts.push("i" + intro);
    if (outro) parts.push("o" + outro);
    return parts.join(",");
  }

  _parseSkipPart(part) {
    if (!part) return null;
    const skip = {};
    for (const window of part.split(",")) {
      const match = /^([io])(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(window);
      if (!match) continue;
      const start = Number(match[2]);
      const end = Number(match[3]);
      if (!(end > start)) continue;
      if (match[1] === "i") {
        skip.introStart = start;
        skip.introEnd = end;
      } else {
        skip.outroStart = start;
        skip.outroEnd = end;
      }
    }
    return Object.keys(skip).length > 0 ? skip : null;
  }

  // ---------------------------------------------------------------- catalog API

  // Picks the anime a lookup answer has for the given external id. Like the site's own client,
  // an id counts as found only when exactly one anime lists it.
  async _lookup(kind, id) {
    let items;
    try {
      items = await this._list("/api/v1/anime?" + kind + "_id_in=" + id + "&limit=100");
    } catch (error) {
      if (error.problem) throw new Error("request rejected (" + this._problemText(error.problem) + ")");
      throw error;
    }
    const wanted = String(id);
    const matches = [];
    for (const item of items) {
      const listed = item && item.external_ids && item.external_ids[kind];
      if (!Array.isArray(listed)) continue;
      if (!listed.some(function (value) { return String(value).trim() === wanted; })) continue;
      if (!this._isAnimeId(item.id)) continue;
      if (!matches.some(function (m) { return m.id === item.id; })) matches.push(item);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  // Every item of a list endpoint, following its cursor as far as it goes.
  async _list(path) {
    const items = [];
    const cursors = [];
    for (;;) {
      const pagePath = cursors.length > 0 ? path + "&cursor=" + encodeURIComponent(cursors[cursors.length - 1]) : path;
      const page = await this._request(pagePath);
      if (!page || !Array.isArray(page.data)) throw new Error("the answer has no item list");
      for (const item of page.data) items.push(item);
      const next = this._text(page.next_cursor);
      if (page.has_more === true && next && cursors.indexOf(next) < 0 && cursors.length + 1 < this.maxPages) {
        cursors.push(next);
      } else {
        return items;
      }
    }
  }

  // One API request: the mirrors are raced, and when all of them fail for a passing reason (a
  // 502/503/504 or no connection) the race is run again after a pause, within a time budget.
  // An error answer of the API itself is thrown with `problem` set.
  async _request(path) {
    const deadline = Date.now() + this.requestBudgetMs;
    const pauses = [300, 800];
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this._race(path, deadline);
      if (outcome.answer) {
        if (outcome.answer.problem) {
          const error = new Error("request rejected (" + this._problemText(outcome.answer.problem) + ")");
          error.problem = outcome.answer.problem;
          throw error;
        }
        return outcome.answer.data;
      }

      const failures = outcome.failures;
      const limited = failures.filter(function (f) { return f.rateLimited; })[0];
      if (limited) throw new Error(limited.message);
      const allPassing = failures.length === this.mirrors.length && failures.every(function (f) { return f.passing; });
      const pause = pauses[Math.min(attempt - 1, pauses.length - 1)];
      if (allPassing && attempt < this.maxAttempts && Date.now() + pause < deadline) {
        await this._sleep(pause);
        continue;
      }
      throw new Error(this._summarize(failures));
    }
  }

  // The most telling reason among the mirrors: a block by the site's bot protection, then an
  // answer naming the mirror that gave it; a connection failure only when no mirror answered.
  _summarize(failures) {
    const blocked = failures.filter(function (f) { return f.blocked; })[0];
    if (blocked) return blocked.message;
    const answered = failures.filter(function (f) { return !f.passing || f.status; })[0];
    if (answered) return answered.message;
    return failures.length > 0 ? "no Miruro mirror reachable (" + failures[0].message + ")" : "no Miruro mirror answered in time";
  }

  // Each further mirror joins the race a little after the previous one, so a healthy first
  // mirror answers before the others are asked at all. The mirror that answered last starts.
  _race(path, deadline) {
    const self = this;
    const order = [];
    for (let i = 0; i < this.mirrors.length; i += 1) order.push(i);
    if (this.lastGood > 0) {
      order.splice(order.indexOf(this.lastGood), 1);
      order.unshift(this.lastGood);
    }

    return new Promise(function (resolve) {
      const failures = [];
      const timers = [];
      let settled = false;
      const finish = function (outcome) {
        if (settled) return;
        settled = true;
        timers.forEach(function (t) { clearTimeout(t); });
        resolve(outcome);
      };

      timers.push(setTimeout(function () { finish({ failures: failures }); }, Math.max(0, deadline - Date.now())));
      order.forEach(function (index, slot) {
        timers.push(
          setTimeout(function () {
            if (settled) return;
            self._ask(index, path).then(
              function (answer) {
                self.lastGood = index;
                finish({ answer: answer });
              },
              function (failure) {
                failures.push(failure);
                // The mirrors share one backend: being told to slow down holds for all.
                if (failure.rateLimited || failures.length === order.length) finish({ failures: failures });
              }
            );
          }, slot * self.mirrorStaggerMs)
        );
      });
    });
  }

  // Asks one mirror. Resolves with `{ data }` or `{ problem }`; rejects with a failure object
  // `{ message, passing, rateLimited, blocked, status }`.
  async _ask(index, path) {
    const mirror = this.mirrors[index];
    const host = this._host(mirror).replace(/^www\./, "");
    let response;
    try {
      response = await $anilili.fetchBytes(mirror + path, {
        headers: { Referer: mirror + "/", Accept: "*/*" },
      });
    } catch (error) {
      throw { message: host + ": " + this._errorText(error), passing: true };
    }
    if (!response || typeof response.status !== "number") throw { message: host + ": no answer", passing: true };

    const status = response.status;
    const base64 = typeof response.base64 === "string" ? response.base64 : "";
    if (response.url && !this._sameSite(this._host(response.url), host)) {
      throw { message: host + " redirected to " + this._host(response.url), passing: false, status: status };
    }
    if (status === 429) {
      throw { message: "rate limited by Miruro, try again shortly", passing: false, rateLimited: true, status: status };
    }

    if (status >= 200 && status < 300) {
      try {
        return { data: this._decode(base64) };
      } catch (error) {
        throw { message: host + ": " + this._errorText(error), passing: false, status: status };
      }
    }

    const body = this._base64Text(base64);
    const mitigated = this._header(response.headers, "cf-mitigated");
    if (mitigated || ((status === 403 || status === 503) && this._looksLikeChallenge(body))) {
      throw { message: "blocked by the site's bot protection", passing: false, blocked: true, status: status };
    }
    if (status === 502 || status === 503 || status === 504) {
      throw { message: "HTTP " + status + " from " + host, passing: true, status: status };
    }
    // Only what the API itself says counts as its answer; any other error page is the mirror's.
    const contentType = String(this._header(response.headers, "content-type") || "").toLowerCase();
    if (status >= 400 && status < 500 && contentType.indexOf("json") >= 0) {
      const problem = this._problem(status, body);
      if (problem) return { problem: problem };
    }
    throw { message: "HTTP " + status + " from " + host, passing: false, status: status };
  }

  // A successful answer: XOR with the catalog key, gunzip, parse. A body that already is JSON
  // text is parsed as it is.
  _decode(base64) {
    const head = this._binary(base64.slice(0, 16)).replace(/^\s+/, "");
    if (head.charAt(0) === "{" || head.charAt(0) === "[") return JSON.parse(this._base64Text(base64));

    const plain = $anilili.xor(base64, this.catalogKey);
    const magic = this._binary(String(plain).slice(0, 4));
    if (magic.charCodeAt(0) !== 0x1f || magic.charCodeAt(1) !== 0x8b) {
      throw new Error("the answer is not in the catalog encoding");
    }
    let text;
    try {
      text = $anilili.gunzip(plain);
    } catch (error) {
      throw new Error("the answer does not decompress");
    }
    return JSON.parse(text);
  }

  _problem(status, body) {
    let value;
    try {
      value = JSON.parse(body);
    } catch (error) {
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const title = this._text(value.title);
    const detail = this._text(value.detail);
    if (!title && !detail) return null;
    return { status: status, title: title || "HTTP " + status, detail: detail };
  }

  _problemText(problem) {
    return problem.detail || problem.title;
  }

  // ---------------------------------------------------------------- small helpers

  _requireHost() {
    if (
      typeof $anilili === "undefined" || !$anilili ||
      typeof $anilili.fetchBytes !== "function" ||
      typeof $anilili.xor !== "function" ||
      typeof $anilili.gunzip !== "function"
    ) {
      throw new Error("requires Anilili (this plugin needs the $anilili helpers to decode Miruro's answers)");
    }
  }

  _mirror() {
    return this.mirrors[this.lastGood >= 0 ? this.lastGood : 0];
  }

  _isAnimeId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_-]{32}$/.test(id);
  }

  _isHttpUrl(url) {
    return typeof url === "string" && /^https?:\/\/[^\s\/]+/i.test(url);
  }

  _text(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  _number(value) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return isFinite(number) ? number : null;
  }

  _count(value) {
    const number = this._number(value);
    return number === null || number < 0 ? null : Math.floor(number);
  }

  _distinct(values) {
    return values.filter(function (value, index) { return values.indexOf(value) === index; });
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

  _header(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") {
      const value = headers.get(name);
      if (value !== undefined && value !== null) return String(value);
    }
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === wanted) return String(headers[key]);
    }
    return null;
  }

  _looksLikeChallenge(body) {
    const markers = ["Just a moment", "cf-chl", "challenge-platform", "Attention Required! | Cloudflare",
      "Sorry, you have been blocked", "DDoS-Guard", "Checking your browser"];
    return markers.some(function (marker) { return body.indexOf(marker) >= 0; });
  }

  _errorText(error) {
    const text = error && error.message ? String(error.message) : String(error);
    return text.length > 140 ? text.slice(0, 140) : text;
  }

  _sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Base64 to a string of one character per byte.
  _binary(base64) {
    try {
      return atob(base64);
    } catch (error) {
      return "";
    }
  }

  _base64Text(base64) {
    const binary = this._binary(base64);
    if (typeof TextDecoder !== "undefined" && typeof Uint8Array !== "undefined") {
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    try {
      return decodeURIComponent(escape(binary));
    } catch (error) {
      return binary;
    }
  }
}
