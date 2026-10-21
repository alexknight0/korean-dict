// Data access for the static dictionary files built by tools/build.py.
// Everything under data/ except meta.json is gzipped JSON.
"use strict";

const Dict = (() => {
  const ROOT = "data/";
  const cache = new Map(); // path -> Promise<json|null>
  let meta = null;

  const EN_STOPWORDS = new Set(
    "a an the of to in on at by for from with and or as be is are was it its one's someone something somebody sb sth".split(" ")
  );

  /** Same normalisation as build.py to_key(). */
  const toKey = (s) => s.normalize("NFC").replace(/[\s^\-]/g, "");

  /** 32-bit FNV-1a over UTF-16 code units (matches build.py fnv1a). */
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  const hex3 = (n) => n.toString(16).padStart(3, "0");
  const prefixName = (chars) => chars.map((c) => c.codePointAt(0).toString(16)).join("-");

  async function inflate(buf) {
    const bytes = new Uint8Array(buf);
    // GitHub Pages serves .gz as application/gzip (no Content-Encoding), but be
    // tolerant of a server that already decoded it.
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  function load(path) {
    if (!cache.has(path)) {
      const p = (async () => {
        const res = await fetch(ROOT + path + "?v=" + (meta ? meta.built : ""));
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        const text = path.endsWith(".gz") ? await inflate(await res.arrayBuffer()) : await res.text();
        return JSON.parse(text);
      })();
      cache.set(path, p);
      p.catch(() => cache.delete(path)); // allow retry after a network error
    }
    return cache.get(path);
  }

  async function init() {
    if (!meta) {
      const res = await fetch(ROOT + "meta.json", { cache: "no-cache" });
      meta = await res.json();
    }
    return meta;
  }

  /**
   * Index rows [key, display, gloss, level?] whose key starts with `q`, best first.
   * Walks the prefix files down as far as needed (see build_prefix_index).
   */
  async function prefixRows(q) {
    const chars = Array.from(q);
    if (!chars.length) return [];
    let depth = 1;
    let file = await load(`i/${prefixName(chars.slice(0, 1))}.json.gz`);
    while (file && file.c && chars.length > depth && file.c.includes(chars[depth])) {
      depth++;
      file = await load(`i/${prefixName(chars.slice(0, depth))}.json.gz`);
    }
    if (!file) return [];
    return file.r.filter((r) => r[0].startsWith(q));
  }

  /** The index row for an exact key, or null. */
  async function row(key) {
    const rows = await prefixRows(key);
    return rows.find((r) => r[0] === key) || null;
  }

  /** Full page data {kr?, od?} for a key, or null. */
  async function entry(key) {
    await init();
    const shard = await load(`e/${hex3(fnv1a(key) % meta.entryShards)}.json.gz`);
    return (shard && shard[key]) || null;
  }

  /** Headword keys whose listed conjugations include `form`. */
  async function aliases(form) {
    await init();
    const shard = await load(`a/${hex3(fnv1a(form) % meta.aliasShards)}.json.gz`);
    return (shard && shard[form]) || [];
  }

  /** Base-form suggestions for an inflected query: [{row, via}] */
  async function baseForms(q) {
    const found = new Map();
    for (const key of await aliases(q)) found.set(key, "활용형");
    for (const key of Deinflect.candidates(q)) if (!found.has(key)) found.set(key, "규칙");
    const out = [];
    await Promise.all(
      [...found].map(async ([key, via], i) => {
        const r = await row(key);
        if (r) out.push({ row: r, via, order: i });
      })
    );
    // dictionary-listed forms first, then the rule order (most specific first)
    return out.sort((a, b) => a.order - b.order);
  }

  /** English -> Korean: [{en, row: [key, display]}] */
  async function english(q) {
    const tokens = (q.toLowerCase().match(/[a-z]+/g) || []).filter(
      (t) => t.length >= 2 && !EN_STOPWORDS.has(t)
    );
    if (!tokens.length) return [];
    const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a));
    const rows = (await load(`en/${longest.slice(0, 3)}.json.gz`)) || [];
    const needle = q.toLowerCase().trim();
    const scored = [];
    for (const [en, key, disp] of rows) {
      const words = en.toLowerCase().match(/[a-z]+/g) || [];
      if (!tokens.every((t) => words.some((w) => w.startsWith(t)))) continue;
      const lower = en.toLowerCase();
      const tier = lower === needle ? 0 : words.includes(longest) ? 1 : 2;
      scored.push({ en, key, disp, tier, i: scored.length });
    }
    scored.sort((a, b) => a.tier - b.tier || a.i - b.i);
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      if (seen.has(s.key)) continue;
      seen.add(s.key);
      out.push(s);
      if (out.length >= 60) break;
    }
    return out;
  }

  return { init, toKey, prefixRows, row, entry, aliases, baseForms, english };
})();
