// AnimeGG (animegg.org): sub and dub as direct MP4 files in several qualities. The watch page
// holds one embedded player per audio version; the embed page names the files.

class Provider {
  constructor() {
    this.base = "https://www.animegg.org";
  }

  getSettings() {
    return {
      episodeServers: ["Animegg"],
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
      const html = await this._page(this.base + "/search?q=" + encodeURIComponent(query), this.base + "/");
      // One result: <a href="/series/slug" class="mse"> ... <h2>Title</h2> ... Alt Titles : a, b </a>
      const blocks = html.split(/<a\s+href="(?=\/series\/)/).slice(1);
      for (const block of blocks) {
        const path = block.slice(0, block.indexOf('"')).split(/[?#]/)[0];
        const slug = path.replace(/^\/series\//, "");
        if (!slug || results.some(function (r) { return r.id.split("|")[0] === slug; })) continue;
        const body = block.split("</a>")[0];
        const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body);
        const title = heading ? this._plain(heading[1]) : "";
        const alt = /Alt Titles\s*:\s*([^<]*)/.exec(body);
        const count = /Episodes:\s*(\d+)/.exec(body);
        const altTitles = alt
          ? this._plain(alt[1]).split(/\s*,\s*/).map(function (t) { return t.trim(); }).filter(function (t) { return t; })
          : [];
        // The slug is the title with dashes, which is a usable title in its own right.
        const fromSlug = slug.replace(/-+/g, " ").trim();
        results.push({
          id: slug + "|" + audio,
          title: title || fromSlug,
          url: this.base + path,
          subOrDub: audio,
          altTitles: title ? altTitles.concat([fromSlug]) : altTitles,
          episodeCount: count ? parseInt(count[1], 10) : undefined,
        });
      }
      if (results.length > 0) break;
    }
    return results;
  }

  async findEpisodes(id) {
    const parts = String(id).split("|");
    const slug = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!slug) throw new Error("invalid anime id '" + id + "'");

    const html = await this._page(this.base + "/series/" + slug, this.base + "/");
    // One entry: <a href="/x-episode-12" class="anm_det_pop"><strong>X 12</strong></a>
    // <i class="anititle">Title</i> followed by links ending in #subbed / #dubbed.
    const entries = html.split(/<a\s+href="(?=\/[^"]*-episode-\d)/).slice(1);
    const byNumber = {};
    const total = {};
    for (const entry of entries) {
      const href = entry.slice(0, entry.indexOf('"'));
      const path = href.split("#")[0];
      const numbered = /-episode-(\d+(?:\.\d+)?)/.exec(path);
      if (!numbered) continue;
      const key = numbered[1];
      total[key] = true;
      const found = byNumber[key] || { path: path, title: null, sub: false, dub: false, marked: false };
      byNumber[key] = found;
      const fragment = href.indexOf("#") >= 0 ? href.slice(href.indexOf("#") + 1).toLowerCase() : "";
      if (fragment === "subbed") found.sub = found.marked = true;
      if (fragment === "dubbed") found.dub = found.marked = true;
      const named = /<i[^>]*class="anititle"[^>]*>([\s\S]*?)<\/i>/.exec(entry.split(/<\/li>/)[0]);
      if (named && !found.title) found.title = this._plain(named[1]) || null;
    }

    const episodes = [];
    for (const key of Object.keys(byNumber)) {
      const found = byNumber[key];
      // A page without audio markers is taken as subbed.
      const offered = found.marked ? found[audio] : audio === "sub";
      if (!offered) continue;
      episodes.push({
        id: found.path + "|" + audio,
        number: Number(key),
        url: this.base + found.path,
        title: found.title || "Episode " + key,
      });
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    if (episodes.length === 0) {
      throw new Error(Object.keys(total).length === 0 ? "no episodes listed" : audio === "dub" ? "no dub" : "no subbed episodes");
    }
    return episodes;
  }

  async findEpisodeServer(episode, server) {
    const parts = String((episode && episode.id) || "").split("|");
    const path = parts[0];
    const audio = parts[1] === "dub" ? "dub" : "sub";
    if (!path || path.charAt(0) !== "/") throw new Error("invalid episode id '" + (episode && episode.id) + "'");

    const watchUrl = this.base + path;
    const html = await this._page(watchUrl, this.base + "/");

    // One tab per audio version and host: <div id="subbed-Animegg"><iframe src="/embed/123">.
    const tabs = [];
    const tabRe = /<div[^>]*\bid="(subbed|dubbed)-([^"]+)"[^>]*>\s*<iframe[^>]*\bsrc="([^"]+)"/gi;
    let match;
    while ((match = tabRe.exec(html)) !== null) {
      tabs.push({ audio: match[1].toLowerCase() === "dubbed" ? "dub" : "sub", name: match[2], src: match[3] });
    }
    if (tabs.length === 0) {
      // Older markup: a single player without audio tabs, which is the subbed one.
      const lone = /<iframe[^>]*\bsrc="(\/embed\/[^"]+|https?:\/\/[^"]*animegg[^"]*\/embed\/[^"]+)"/i.exec(html);
      if (lone) tabs.push({ audio: "sub", name: "Animegg", src: lone[1] });
    }

    let candidates = tabs.filter(function (tab) { return tab.audio === audio; });
    if (candidates.length === 0) {
      if (tabs.length > 0) throw new Error(audio === "dub" ? "no dub for this episode" : "no subbed version of this episode");
      const playlists = this._mediaUrls(html).filter(this._isHls);
      if (playlists.length === 0) throw new Error("no player on the episode page");
      return {
        server: "Animegg",
        headers: { Referer: this.base + "/" },
        videoSources: playlists.map(function (url, index) {
          return { url: url, type: "m3u8", quality: index === 0 ? "auto" : "auto (" + (index + 1) + ")", subtitles: [] };
        }),
      };
    }

    const wanted = String(server || "default");
    if (wanted !== "default") {
      const offered = candidates.map(function (tab) { return tab.name; });
      candidates = candidates.filter(function (tab) { return tab.name.toLowerCase() === wanted.toLowerCase(); });
      if (candidates.length === 0) throw new Error("'" + wanted + "' is not offered for this episode (offered: " + offered.join(", ") + ")");
    }

    let reason = null;
    for (const tab of candidates) {
      const embedUrl = this._absolute(tab.src);
      let embed;
      try {
        embed = await this._page(embedUrl, watchUrl);
      } catch (error) {
        reason = reason || this._errorText(error);
        continue;
      }
      const sources = this._videoSources(embed, audio);
      if (sources.length === 0) {
        reason = reason || "the player names no video";
        continue;
      }
      return { server: tab.name, headers: { Referer: embedUrl }, videoSources: sources };
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

  // Videos named by an embed page's player setup (`{file: "/play/1/video.mp4?for=..", label:
  // "720p"}`), best quality first. `/play/...` links are files behind a redirect.
  _videoSources(embedHtml, audio) {
    const text = this._unescapeBody(embedHtml);
    const found = [];
    const self = this;
    const add = function (raw, label) {
      if (!/\/play\/|\.mp4(?:[?#]|$)|\.m3u8(?:[?#]|$)/i.test(raw)) return;
      const url = self._absolute(raw);
      if (found.some(function (f) { return f.url === url; })) return;
      found.push({ url: url, label: label || "" });
    };

    const objectRe = /\{[^{}]*?file:\s*["']([^"']+)["'][^{}]*?\}/g;
    let match;
    while ((match = objectRe.exec(text)) !== null) {
      const label = /label:\s*["']([^"']*)["']/.exec(match[0]);
      add(match[1], label ? label[1] : "");
    }
    if (found.length === 0) {
      const looseRe = /(?:file:\s*["']|src=["'])([^"']*(?:\/play\/|\.mp4|\.m3u8)[^"']*)/g;
      while ((match = looseRe.exec(text)) !== null) add(match[1], "");
    }

    const height = function (label) { return parseInt(label, 10) || 0; };
    found.sort(function (a, b) { return height(b.label) - height(a.label); });
    const voice = audio === "dub" ? "Dub" : "Sub";
    const used = {};
    return found.map(function (f, index) {
      let quality = f.label || "auto";
      if (used[quality]) quality = quality + " (" + (index + 1) + ")";
      used[quality] = true;
      return { url: f.url, type: self._isHls(f.url) ? "m3u8" : "mp4", quality: quality, label: voice, subtitles: [] };
    });
  }

  _absolute(raw) {
    const url = String(raw).trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (/^https?:\/\//i.test(url)) return url;
    return this.base + (url.charAt(0) === "/" ? "" : "/") + url;
  }

  // Visible text of a piece of markup.
  _plain(html) {
    return this._unescapeBody(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------- shared helpers

  async _page(url, referer) {
    const host = this._host(url);
    let response;
    try {
      response = await fetch(url, { headers: { Referer: referer } });
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
