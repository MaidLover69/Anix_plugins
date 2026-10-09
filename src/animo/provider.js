// Animo (4animo.xyz): sub and dub as HLS from the site's own players (ReCloud), with soft
// subtitles and intro/outro times. Reference for the site's pages and players: the Aniyomi
// extension src/en/fouranimo (github.com/salmanbappi/sb-extensions-source).

class Provider {
  constructor() {
    this.base = "https://4animo.xyz";
    this.player = "https://cdn.4animo.xyz";
    this.servers = ["ReCloud 1", "ReCloud 2", "ReCloud HD"];
  }

  getSettings() {
    return {
      episodeServers: ["ReCloud 1", "ReCloud 2", "ReCloud HD"],
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
      const html = await this._page(this.base + "/search?keyword=" + encodeURIComponent(query), this.base + "/");
      const data = this._nextPayload(html);
      // One card: {"href":"/one-piece-12","title":"One Piece", … }
      const re = /\{"href":"\/([a-z0-9-]+-\d+)","title":("(?:[^"\\]|\\.)*")/g;
      let match;
      while ((match = re.exec(data)) !== null) {
        const slug = match[1];
        if (results.some(function (r) { return r.id.split("|")[0] === slug; })) continue;
        let title = "";
        try {
          title = this._text(JSON.parse(match[2]));
        } catch (error) {
          title = "";
        }
        if (!title) continue;
        results.push({ id: slug + "|" + audio, title: title, url: this.base + "/" + slug, subOrDub: audio });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const slug = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!/^[a-z0-9-]+$/.test(slug || "")) throw new Error("invalid anime id '" + id + "'");

    const html = await this._page(this.base + "/watch/" + slug + "?ep=1", this.base + "/");
    const data = this._nextPayload(html);
    const at = data.indexOf('"episodes":[{');
    const listed = at >= 0 ? this._jsonAt(data, at + '"episodes":'.length) : null;
    if (!Array.isArray(listed) || listed.length === 0) throw new Error("no episodes listed");

    const episodes = [];
    const seen = {};
    for (const item of listed) {
      if (!item || typeof item.number !== "number" || seen[item.number]) continue;
      if (item[audio] !== true) continue;
      seen[item.number] = true;
      const titles = item.titles && typeof item.titles === "object" ? item.titles : {};
      const episode = {
        // slug | audio | number | episode id | player id
        id: [slug, audio, item.number, item.id, item.embed_id || ""].join("|"),
        number: item.number,
        url: this.base + "/watch/" + slug + "?ep=" + item.number,
        title: this._text(titles.en) || this._text(titles.romaji) || "Episode " + item.number,
      };
      if (typeof item.thumbnail === "string" && /^https:\/\//.test(item.thumbnail)) episode.image = item.thumbnail;
      if (item.filler === true) episode.filler = true;
      episodes.push(episode);
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) throw new Error(audio === "dub" ? "no dub" : "no subbed episodes");
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const slug = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    const episodeId = parts[3];
    const playerId = parts[4];
    if (!slug || !/^\d+$/.test(episodeId || "")) throw new Error("invalid episode id '" + (episode && episode.id) + "'");
    const wanted = String(server || "default");
    const known = this.servers;
    if (wanted !== "default" && !known.some(function (name) { return name.toLowerCase() === wanted.toLowerCase(); })) {
      throw new Error("unknown server '" + wanted + "'");
    }

    const paths = {
      "recloud 1": "/embed/a-1/" + episodeId + "/" + audio + "?k=1",
      "recloud 2": "/embed/a-2/" + episodeId + "/" + audio + "?k=1",
      "recloud hd": playerId ? "/embed/s-1/" + encodeURIComponent(playerId) + "/" + audio + "?k=1" : "",
    };
    const order = wanted === "default" ? known : [wanted];
    let reason = null;
    for (const name of order) {
      const path = paths[name.toLowerCase()];
      if (!path) {
        reason = reason || "'" + name + "' is not offered for this episode";
        continue;
      }
      try {
        return await this._player(known.filter(function (k) { return k.toLowerCase() === name.toLowerCase(); })[0], this.player + path, audio);
      } catch (error) {
        reason = reason || this._errorText(error);
      }
    }
    throw new Error(reason || "no playable source for this episode");
  }

  // ---------------------------------------------------------------- players

  // A player page names the address of its sources; that answers with the playlist, the
  // subtitle tracks and the intro/outro times, all as addresses on the player's host.
  async _player(name, embedUrl, audio) {
    const page = await this._page(embedUrl, this.base + "/");
    const named = /var\s+sourcesUrl\s*=\s*['"]([^'"]+)['"]/.exec(page);
    if (!named) throw new Error("the player page has changed (no sources address)");
    const data = await this._api(this._absolute(named[1], this.player), { headers: { Referer: embedUrl } });
    if (data && data.error) throw new Error(this._text(String(data.error)) || "the player reports an error");

    let file = "";
    if (data && Array.isArray(data.sources) && data.sources[0] && typeof data.sources[0].file === "string") file = data.sources[0].file;
    else if (data && data.link && typeof data.link.file === "string") file = data.link.file;
    else if (data && typeof data.file === "string") file = data.file;
    if (!file) throw new Error("the player names no video");

    const self = this;
    const listed = (data && Array.isArray(data.tracks) ? data.tracks : []).map(function (track) {
      if (!track || typeof track.file !== "string" || (track.kind !== "captions" && track.kind !== "subtitles")) return null;
      return { url: self._absolute(track.file, self.player), label: track.label, isDefault: track.default === true };
    });
    const subtitles = this._subtitles(listed);
    const result = {
      server: name,
      headers: { Referer: embedUrl },
      videoSources: [
        {
          url: this._absolute(file, this.player),
          type: "m3u8",
          quality: "auto",
          label: audio === "dub" ? "Dub" : subtitles.length > 0 ? "Soft sub" : "Sub",
          subtitles: subtitles,
        },
      ],
    };
    const skip = this._skip(data.intro, data.outro);
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
