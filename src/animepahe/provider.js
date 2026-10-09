// AnimePahe (animepahe.pw): sub and dub as HLS from the Kwik player, 360p to 1080p. The site
// answers plain clients with a browser check; in Anilili it works after "Verify" has been
// passed once. Reference for the site's API and pages: the Aniyomi extension src/en/animepahe
// (github.com/yuzono/anime-extensions).

class Provider {
  constructor() {
    this.base = "https://animepahe.pw";
    this.apiHeaders = { Referer: this.base + "/" };
    this.pageSize = 30;
    // Longer series are listed from the first page alone; see findEpisodes.
    this.fullPages = 6;
  }

  getSettings() {
    return {
      episodeServers: ["Kwik"],
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
      const found = await this._api(this.base + "/api?m=search&q=" + encodeURIComponent(query));
      for (const item of found && Array.isArray(found.data) ? found.data : []) {
        if (!item || typeof item.session !== "string" || !item.session) continue;
        if (results.some(function (r) { return r.id.split("|")[0] === item.session; })) continue;
        const title = this._text(item.title);
        if (!title) continue;
        results.push({
          id: item.session + "|" + audio,
          title: title,
          url: this.base + "/anime/" + item.session,
          subOrDub: audio,
          year: typeof item.year === "number" && item.year > 1900 ? item.year : undefined,
          episodeCount: typeof item.episodes === "number" && item.episodes > 0 ? item.episodes : undefined,
          format: this._text(item.type) || undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  // The site lists 30 episodes per request. Up to `fullPages` pages are read; of a longer
  // series only the first, and the remaining episodes are numbered on from it. Their entry
  // on the site is looked up when one is played.
  async findEpisodes(id) {
    const parts = String(id).split("|");
    const session = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^[\w-]+$/.test(session || "")) throw new Error("invalid anime id '" + id + "'");

    const first = await this._release(session, 1);
    if (first.items.length === 0) throw new Error("no episodes listed");
    let items = first.items;
    const complete = first.lastPage <= this.fullPages;
    if (complete && first.lastPage > 1) {
      const pages = [];
      for (let page = 2; page <= first.lastPage; page += 1) pages.push(this._release(session, page));
      for (const page of await Promise.all(pages)) items = items.concat(page.items);
    }

    // A sequel may go on counting where the season before ended.
    const offset = this._offset(items[0].number);
    const episodes = [];
    const seen = {};
    for (const item of items) {
      const number = item.number - offset;
      if (number <= 0 || seen[number]) continue;
      seen[number] = true;
      const episode = {
        id: [session, audio, "e", item.session].join("|"),
        number: number,
        url: this.base + "/play/" + session + "/" + item.session,
        title: item.title || "Episode " + number,
      };
      if (item.image) episode.image = item.image;
      if (item.filler) episode.filler = true;
      episodes.push(episode);
    }
    if (!complete) {
      const total = Math.max(first.total, items.length);
      for (let index = items.length; index < total; index += 1) {
        const number = index + 1;
        if (seen[number]) continue;
        episodes.push({
          id: [session, audio, "n", number, offset].join("|"),
          number: number,
          url: this.base + "/anime/" + session,
          title: "Episode " + number,
        });
      }
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const session = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^[\w-]+$/.test(session || "") || (parts[2] !== "e" && parts[2] !== "n")) {
      throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    }
    const wanted = String(server || "default");
    if (wanted !== "default" && wanted.toLowerCase() !== "kwik") throw new Error("unknown server '" + wanted + "'");

    let episodeSession = parts[3];
    if (parts[2] === "n") episodeSession = await this._episodeSession(session, Number(parts[3]), Number(parts[4]) || 0);
    if (!/^[\w-]+$/.test(episodeSession || "")) throw new Error("invalid episode id '" + episode.id + "'");

    const playUrl = this.base + "/play/" + session + "/" + episodeSession;
    const html = await this._page(playUrl, this.base + "/");
    const players = this._players(html);
    if (players.length === 0) throw new Error("no player on the episode page");
    const offered = players.filter(function (p) { return p.audio === audio; });
    if (offered.length === 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");

    const self = this;
    const settled = await Promise.all(offered.slice(0, 8).map(function (player) {
      return self._kwik(player.url).then(
        function (stream) { return { player: player, stream: stream }; },
        function (error) { return { player: player, error: self._errorText(error) }; }
      );
    }));
    const videoSources = [];
    let referer = "";
    let reason = null;
    const used = {};
    for (const entry of settled) {
      if (!entry.stream) {
        reason = reason || entry.error;
        continue;
      }
      if (videoSources.some(function (v) { return v.url === entry.stream.url; })) continue;
      referer = referer || entry.stream.referer;
      let quality = entry.player.resolution ? entry.player.resolution + "p" : "auto";
      if (used[quality]) quality = quality + " (" + (entry.player.fansub || videoSources.length + 1) + ")";
      used[quality] = true;
      videoSources.push({
        url: entry.stream.url,
        type: "m3u8",
        quality: quality,
        label: (audio === "dub" ? "Dub" : "Hard sub") + (entry.player.fansub ? " · " + entry.player.fansub : ""),
        subtitles: [],
      });
    }
    if (videoSources.length === 0) throw new Error(reason || "no playable source for this episode");
    const height = function (v) { return parseInt(v.quality, 10) || 0; };
    videoSources.sort(function (a, b) { return height(b) - height(a); });
    return { server: "Kwik", headers: { Referer: referer, Origin: this._origin(referer) }, videoSources: videoSources };
  }

  // ---------------------------------------------------------------- parsing

  _offset(firstNumber) {
    return firstNumber > 1 && Math.floor(firstNumber) === firstNumber ? firstNumber - 1 : 0;
  }

  // One page of a release's episodes, oldest first: { total, lastPage, items: [{ number,
  // session, title, image, filler }] }.
  async _release(session, page) {
    const data = await this._api(this.base + "/api?m=release&id=" + encodeURIComponent(session) + "&sort=episode_asc&page=" + page);
    const items = [];
    for (const entry of data && Array.isArray(data.data) ? data.data : []) {
      const number = Number(entry && entry.episode);
      if (!entry || typeof entry.session !== "string" || !entry.session || !isFinite(number)) continue;
      items.push({
        number: number,
        session: entry.session,
        title: this._text(entry.title),
        image: typeof entry.snapshot === "string" && /^https:\/\//.test(entry.snapshot) ? entry.snapshot : "",
        filler: entry.filler === 1 || entry.filler === true,
      });
    }
    return {
      total: data && typeof data.total === "number" ? data.total : items.length,
      lastPage: data && typeof data.last_page === "number" ? data.last_page : 1,
      items: items,
    };
  }

  // The site's entry of episode `number` (counted from 1) of a long series: it is on the
  // page its position falls on, or on a neighbour when the series has half episodes.
  async _episodeSession(session, number, offset) {
    if (!(number >= 1)) throw new Error("invalid episode number");
    const expected = Math.floor((number - 1) / this.pageSize) + 1;
    let fallback = "";
    for (const page of [expected, expected + 1, expected - 1]) {
      if (page < 1) continue;
      const release = await this._release(session, page);
      const exact = release.items.filter(function (item) { return item.number - offset === number; })[0];
      if (exact) return exact.session;
      if (page === expected) {
        const positional = release.items[(number - 1) % this.pageSize];
        if (positional) fallback = positional.session;
        if (release.lastPage < page + 1 && page === 1) break;
      }
    }
    if (fallback) return fallback;
    throw new Error("episode " + number + " not on AnimePahe");
  }

  // The players of an episode page, one per fansub, resolution and audio version:
  // <button data-src="https://kwik.cx/e/…" data-fansub="…" data-resolution="1080" data-audio="jpn">
  _players(html) {
    const players = [];
    const re = /<button\b[^>]*\bdata-src\s*=\s*["'][^>]*>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
      const tag = match[0];
      const url = this._attr(tag, "data-src");
      if (!/^https:\/\//i.test(url) || players.some(function (p) { return p.url === url; })) continue;
      const voice = this._attr(tag, "data-audio").toLowerCase();
      const resolution = parseInt(this._attr(tag, "data-resolution"), 10);
      players.push({
        url: url,
        audio: voice === "eng" ? "dub" : "sub",
        resolution: resolution > 0 ? resolution : 0,
        fansub: this._attr(tag, "data-fansub"),
      });
    }
    return players;
  }

  // The Kwik player page carries its playlist in a packed script: const source='….m3u8'.
  async _kwik(url) {
    const page = await this._page(url, this.base + "/");
    const script = this._unpack(page);
    const named = /source\s*=\s*\\?['"](https?:\/\/[^'"\\]+)/.exec(script) || /source\s*=\s*\\?['"](https?:\/\/[^'"\\]+\.m3u8[^'"\\]*)/.exec(page);
    if (!named) throw new Error(script ? "the Kwik player names no video" : "the Kwik player page has changed");
    return { url: named[1], referer: this._origin(url) + "/" };
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

  // A JSON answer of the site's API. `init` may carry `method`, `body` and extra `headers`.
  async _api(url, init) {
    const host = this._host(url);
    const headers = { Accept: "application/json" };
    for (const name of Object.keys(this.apiHeaders || {})) headers[name] = this.apiHeaders[name];
    for (const name of Object.keys((init && init.headers) || {})) headers[name] = init.headers[name];
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

  // A page of a site as text. `referer` is a URL, or an object of request headers.
  async _page(url, referer, init) {
    const host = this._host(url);
    const headers = {};
    if (typeof referer === "string" && referer) headers.Referer = referer;
    else if (referer && typeof referer === "object") for (const name of Object.keys(referer)) headers[name] = referer[name];
    const options = { headers: headers };
    if (init && init.method) {
      options.method = init.method;
      options.body = init.body;
      headers["Content-Type"] = init.contentType || "application/x-www-form-urlencoded; charset=UTF-8";
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
    return text;
  }

  // Visible text of a piece of markup.
  _plain(html) {
    return this._unescapeBody(String(html).replace(/<[^>]*>/g, " ")).replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
  }

  // Undoes the escaping scraped bodies wrap URLs in: `\/`, `\uXXXX` and common HTML entities.
  _unescapeBody(body) {
    return String(body)
      .replace(/\\+u([0-9a-fA-F]{4})/g, function (whole, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/\\+\//g, "/")
      .replace(/&#(\d{2,5});/g, function (whole, code) { return String.fromCharCode(parseInt(code, 10)); })
      .replace(/&#x([0-9a-fA-F]{2,4});/g, function (whole, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  // The value of an attribute in one tag's text.
  _attr(tag, name) {
    const match = new RegExp("[\\s\"']" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(" " + tag);
    return match ? this._unescapeBody(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]).trim() : "";
  }

  _absolute(raw, base) {
    const url = String(raw).trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (/^https?:\/\//i.test(url)) return url;
    const origin = this._origin(base || this.base);
    if (url.charAt(0) === "/") return origin + url;
    const folder = String(base || this.base).split(/[?#]/)[0].replace(/\/[^\/]*$/, "/");
    return (/^https?:\/\/[^\/]+$/i.test(folder.replace(/\/$/, "")) ? origin + "/" : folder) + url;
  }

  _origin(url) {
    const match = /^(https?:\/\/[^\/?#]+)/i.exec(String(url));
    return match ? match[1] : "";
  }

  // `www.example.to` and `example.tv` are the same site.
  _sameSite(a, b) {
    const label = function (host) {
      const parts = host.toLowerCase().replace(/^www\./, "").split(".");
      return parts.length > 1 ? parts[parts.length - 2] : parts[0];
    };
    return label(a) === label(b);
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
        const before = text.charAt(match.index - 1);
        if (before !== '"' && before !== "'") continue;
        url = "https:" + url;
      }
      if (urls.indexOf(url) < 0) urls.push(url);
    }
    return urls;
  }

  // The JSON value that starts at `index` of `text` (an object or an array), or null.
  _jsonAt(text, index) {
    const open = text.charAt(index);
    const close = open === "{" ? "}" : open === "[" ? "]" : "";
    if (!close) return null;
    let depth = 0;
    let quoted = false;
    for (let i = index; i < text.length; i += 1) {
      const c = text.charAt(i);
      if (quoted) {
        if (c === "\\") i += 1;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth += 1;
      else if (c === "}" || c === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(index, i + 1));
          } catch (error) {
            return null;
          }
        }
      }
    }
    return null;
  }

  // The data a Next.js page carries in its `self.__next_f.push([1,"…"])` calls, as one text.
  _nextPayload(html) {
    const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\[\s\S])*")\]\)/g;
    let text = "";
    let match;
    while ((match = re.exec(html)) !== null) {
      try {
        text += JSON.parse(match[1]);
      } catch (error) {
        continue;
      }
    }
    return text;
  }

  // The text a `eval(function(p,a,c,k,e,d){…})` packed script expands to; "" when none.
  _unpack(body) {
    const re = /\}\s*\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\s*\.split\(\s*'\|'\s*\)/g;
    let out = "";
    let match;
    while ((match = re.exec(body)) !== null) {
      const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      const radix = parseInt(match[2], 10);
      const words = match[4].split("|");
      const digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const value = function (token) {
        let n = 0;
        for (let i = 0; i < token.length; i += 1) {
          const d = digits.indexOf(token.charAt(i));
          if (d < 0 || d >= radix) return -1;
          n = n * radix + d;
        }
        return n;
      };
      out += payload.replace(/\b\w+\b/g, function (token) {
        const n = value(token);
        return n >= 0 && n < words.length && words[n] ? words[n] : token;
      }) + "\n";
    }
    return out;
  }

  // ---------------------------------------------------------------- video hosts

  // A Blogger video (blogger.com/video.g?token=…): its MP4 files, best first, as
  // [{ url, quality }]. The page names them itself or through the player's data request.
  async _blogger(url, referer) {
    const page = await this._page(url, referer);
    const found = [];
    const add = function (address, itag) {
      const quality = { 18: "360p", 22: "720p", 37: "1080p", 59: "480p" }[itag];
      if (!quality || !/^https:\/\//.test(address) || found.some(function (f) { return f.quality === quality; })) return;
      found.push({ url: address, quality: quality });
    };

    const listed = /"streams":\[([\s\S]*?)\]/.exec(page);
    if (listed && page.indexOf("errorContainer") < 0) {
      const re = /"play_url":"([^"]+)"[^}]*?"format_id":(\d+)/g;
      let match;
      while ((match = re.exec(listed[1])) !== null) add(this._unescapeBody(match[1]), parseInt(match[2], 10));
    }
    if (found.length === 0) {
      const token = /[?&]token=([^&#]+)/.exec(url);
      const session = /"FdrFJe":"([^"]+)"/.exec(page);
      const build = /"cfb2h":"([^"]+)"/.exec(page);
      if (!token || !session || !build) throw new Error("the Blogger video page has changed");
      const origin = this._origin(url);
      const request = JSON.stringify([[["WcwnYd", JSON.stringify([token[1], "", 0]), null, "generic"]]]);
      const answer = await this._page(
        origin + "/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&f.sid=" + encodeURIComponent(session[1]) +
          "&bl=" + encodeURIComponent(build[1]) + "&hl=en-US&_reqid=" + (Math.floor(Date.now() / 1000) % 86400) + "&rt=c",
        { Referer: origin + "/", "x-same-domain": "1" },
        { method: "POST", body: "f.req=" + encodeURIComponent(request) + "&", contentType: "application/x-www-form-urlencoded;charset=UTF-8" }
      );
      for (const line of answer.split("\n")) {
        if (line.indexOf('[["wrb.fr"') !== 0) continue;
        let streams = null;
        try {
          streams = JSON.parse(JSON.parse(line)[0][2])[2];
        } catch (error) {
          streams = null;
        }
        for (const stream of Array.isArray(streams) ? streams : []) {
          if (Array.isArray(stream) && typeof stream[0] === "string" && Array.isArray(stream[1])) add(stream[0], stream[1][0]);
        }
      }
    }
    if (found.length === 0) throw new Error("the Blogger video is not available");
    found.sort(function (a, b) { return parseInt(b.quality, 10) - parseInt(a.quality, 10); });
    return found;
  }
}
