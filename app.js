// UI: search-as-you-type, entry pages, recent lookups. Routes:
//   #            recent lookups
//   #q=<text>    search results
//   #w=<key>     entry page
"use strict";

const $ = (sel) => document.querySelector(sel);
const input = $("#q");
const resultsEl = $("#results");
const entryEl = $("#entry");
const statusEl = $("#status");

const RESULT_LIMIT = 40;
const RECENT_LIMIT = 50;
const WORD_TYPE = { 고: "고유어", 한: "한자어", 외: "외래어", 혼: "혼종어" };
const LEVEL = { 초: "초급", 중: "중급", 고: "고급" };
const OPENDICT_SENSE = "https://opendict.korean.go.kr/dictionary/view?sense_no=";

// ------------------------------------------------------------------ DOM helpers

/** el("a", {href: "#"}, "text", child, ...) - children are text or nodes; falsy skipped. */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

/** Example text with {headword} marked: returns nodes with <b> for the braces. */
function marked(text) {
  const out = [];
  const re = /\{([^}]*)\}/g;
  let i = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(el("b", null, m[1]));
    i = re.lastIndex;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

const wordHref = (key) => "#w=" + encodeURIComponent(key);

function wordLink(display, key, hom) {
  return el("a", { href: wordHref(key || Dict.toKey(display)) }, display, hom ? el("sup", null, hom) : null);
}

function setStatus(text) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
}

// ------------------------------------------------------------------ recent lookups

function recent() {
  try {
    return JSON.parse(localStorage.getItem("recent") || "[]");
  } catch {
    return [];
  }
}

function remember(key, display, gloss) {
  const list = recent().filter((r) => r[0] !== key);
  list.unshift([key, display, gloss]);
  localStorage.setItem("recent", JSON.stringify(list.slice(0, RECENT_LIMIT)));
}

// ------------------------------------------------------------------ result list

function resultItem(key, display, gloss, level, note) {
  return el(
    "li",
    null,
    el(
      "a",
      { href: wordHref(key) },
      el("span", { class: "hw" }, display),
      level ? el("span", { class: "level level-" + level }, LEVEL[level] || level) : null,
      note ? el("span", { class: "note" }, note) : null,
      el("span", { class: "gloss" }, gloss)
    )
  );
}

function showHome() {
  entryEl.hidden = true;
  resultsEl.hidden = false;
  setStatus("");
  const list = recent();
  resultsEl.replaceChildren(
    list.length
      ? el(
          "div",
          null,
          el("h2", null, "최근 찾은 단어", el("button", { class: "link", type: "button", onclick: clearRecent }, "지우기")),
          el("ul", { class: "results" }, list.map(([k, d, g]) => resultItem(k, d, g)))
        )
      : el("p", { class: "hint" }, "단어를 입력하세요. 활용형(먹었는데)이나 영어(doctor)로도 찾을 수 있어요.")
  );
}

function clearRecent() {
  localStorage.removeItem("recent");
  showHome();
}

let searchToken = 0;

async function search(q) {
  const token = ++searchToken;
  entryEl.hidden = true;
  resultsEl.hidden = false;
  const query = q.trim();
  if (!query) return showHome();

  const isLatin = /^[a-z\s'.,-]+$/i.test(query);
  const key = Dict.toKey(query);
  try {
    if (isLatin) {
      const rows = await Dict.english(query);
      if (token !== searchToken) return;
      resultsEl.replaceChildren(
        rows.length
          ? el("ul", { class: "results" }, rows.map((r) => resultItem(r.key, r.disp, r.en)))
          : el("p", { class: "hint" }, "결과가 없습니다.")
      );
      return;
    }

    const hangul = /^[\uac00-\ud7a3]+$/.test(key);
    const [rows, bases] = await Promise.all([
      Dict.prefixRows(key),
      hangul && key.length >= 2 ? Dict.baseForms(key) : [],
    ]);
    if (token !== searchToken) return;

    const exact = rows.filter((r) => r[0] === key);
    const rest = rows.filter((r) => r[0] !== key).slice(0, RESULT_LIMIT);
    const shown = new Set(rows.map((r) => r[0]));
    const baseRows = bases.filter((b) => !shown.has(b.row[0]));

    const parts = [];
    if (baseRows.length) {
      parts.push(
        el("h2", null, "기본형"),
        el(
          "ul",
          { class: "results bases" },
          baseRows.slice(0, 6).map(({ row: r }) => resultItem(r[0], r[1], r[2], r[3], query + " →"))
        )
      );
    }
    if (exact.length || rest.length) {
      if (baseRows.length) parts.push(el("h2", null, "표제어"));
      parts.push(el("ul", { class: "results" }, [...exact, ...rest].map((r) => resultItem(r[0], r[1], r[2], r[3]))));
    }
    if (!parts.length) {
      parts.push(el("p", { class: "hint" }, "결과가 없습니다."));
    }
    resultsEl.replaceChildren(...parts);
  } catch (err) {
    if (token === searchToken) resultsEl.replaceChildren(el("p", { class: "error" }, "불러오기 실패: " + err.message));
  }
}

// ------------------------------------------------------------------ entry page

function playButton(url) {
  if (!url) return null;
  return el(
    "button",
    {
      class: "play",
      type: "button",
      "aria-label": "발음 듣기",
      onclick: () => new Audio(url).play().catch(() => {}),
    },
    "▶"
  );
}

function relationList(items, homAt, keyAt) {
  // group [type, display, ...] by type, preserving order
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it[0])) groups.set(it[0], []);
    groups.get(it[0]).push(it);
  }
  return el(
    "dl",
    { class: "rel" },
    [...groups].map(([type, list]) => [
      el("dt", null, type),
      el(
        "dd",
        null,
        list.flatMap((it, i) => [i ? ", " : null, wordLink(it[1], keyAt != null ? it[keyAt] : null, homAt != null ? it[homAt] : null)])
      ),
    ])
  );
}

function krSection(entries) {
  return el(
    "section",
    { class: "source kr" },
    el("h2", null, "한국어기초사전"),
    entries.map((e, i) =>
      el(
        "div",
        { class: "word" },
        el(
          "h3",
          null,
          e.w,
          entries.length > 1 && e.hom ? el("sup", null, e.hom) : null,
          e.level && e.level !== "없음" ? el("span", { class: "level level-" + e.level[0] }, e.level) : null
        ),
        el(
          "p",
          { class: "meta" },
          e.pos ? el("span", { class: "pos" }, e.pos) : null,
          e.unit && e.unit !== "단어" ? el("span", { class: "tag" }, e.unit) : null,
          e.pron && e.pron.length ? el("span", { class: "pron" }, "[" + e.pron.join("/") + "]") : null,
          playButton(e.sound),
          e.origin ? el("span", { class: "orig" }, e.origin) : null
        ),
        e.note ? el("p", { class: "note" }, e.note) : null,
        el(
          "ol",
          { class: "senses" },
          (e.senses || []).map((s) =>
            el(
              "li",
              null,
              el("p", { class: "def" }, s.def),
              (s.en || []).map(([lemma, def]) =>
                el("p", { class: "en", lang: "en" }, el("b", null, lemma), def ? " — " + def : null)
              ),
              s.pat ? el("p", { class: "pat" }, "「" + s.pat + "」") : null,
              s.note ? el("p", { class: "note" }, s.note) : null,
              s.ex && s.ex.length ? krExamples(s.ex) : null,
              s.rel && s.rel.length ? relationList(s.rel, null, 2) : null
            )
          )
        ),
        e.related && e.related.length ? relationList(e.related, null, 2) : null
      )
    )
  );
}

function krExamples(ex) {
  const phrases = ex.filter(([t]) => t === "구").map(([, lines]) => lines.join(" "));
  const others = ex.filter(([t]) => t !== "구");
  return el(
    "ul",
    { class: "ex" },
    phrases.length ? el("li", { class: "phrases" }, phrases.join(" / ")) : null,
    others.map(([type, lines]) =>
      type === "대화"
        ? el("li", { class: "dialog" }, lines.map((l, i) => el("span", null, (i % 2 ? "나: " : "가: ") + l)))
        : el("li", null, lines.join(" "))
    )
  );
}

function odSense(s) {
  return el(
    "li",
    null,
    el(
      "p",
      { class: "def" },
      s.type ? el("span", { class: "tag type" }, s.type) : null,
      (s.cat || []).map((c) => el("span", { class: "tag" }, c)),
      (s.reg || []).map((r) => el("span", { class: "tag region" }, r)),
      s.def
    ),
    s.pat && s.pat.length ? el("p", { class: "pat" }, "「" + s.pat.join(", ") + "」") : null,
    s.gram && s.gram.length ? el("p", { class: "note" }, s.gram.join(" ")) : null,
    s.sci ? el("p", { class: "sci" }, el("i", null, s.sci)) : null,
    s.tl && s.tl.length
      ? el("p", { class: "en", lang: "en" }, s.tl.map(([lang, t]) => (lang === "영어" ? t : `${t} (${lang})`)).join("; "))
      : null,
    s.ex && s.ex.length
      ? el(
          "ul",
          { class: "ex" },
          s.ex.map((x) =>
            el(
              "li",
              null,
              marked(x.e),
              x.reg ? el("span", { class: "tag region" }, x.reg) : null,
              x.tr ? el("span", { class: "tr" }, " → ", marked(x.tr)) : null,
              x.orig ? el("span", { class: "tr" }, " (" + x.orig + ")") : null
            )
          )
        )
      : null,
    s.rel && s.rel.length ? relationList(s.rel, 2, 3) : null,
    s.relMore ? el("p", { class: "more" }, `외 ${s.relMore}개`) : null,
    s.idiom && s.idiom.length ? relationList(s.idiom, 2, 3) : null,
    s.hist ? el("p", { class: "hist" }, "역사: " + s.hist) : null,
    (s.norm || []).map(([type, desc]) => el("p", { class: "note" }, `${type}: ${desc}`)),
    el("a", { class: "src", href: OPENDICT_SENSE + s.t, target: "_blank", rel: "noopener" }, "우리말샘")
  );
}

function odWord(w, i, count, key, open) {
  const display = w.w || key;
  const orig =
    typeof w.orig === "string"
      ? w.orig
      : (w.orig || []).map(([type, o]) => (type === "한자" || type === "고유어" ? o : `${o} (${type})`)).join(" + ");
  // group consecutive senses by part of speech
  const groups = [];
  for (const s of w.senses) {
    const pos = s.pos || "품사 없음";
    if (!groups.length || groups[groups.length - 1].pos !== pos) groups.push({ pos, senses: [] });
    groups[groups.length - 1].senses.push(s);
  }
  const allMarked = w.senses.every((s) => s.type);
  return el(
    "details",
    { class: "word", open: open },
    el(
      "summary",
      null,
      el("span", { class: "hw" }, display, count > 1 ? el("sup", null, i + 1) : null),
      w.wtype ? el("span", { class: "tag" }, WORD_TYPE[w.wtype] || w.wtype) : null,
      w.unit ? el("span", { class: "tag" }, w.unit) : null,
      allMarked ? el("span", { class: "tag type" }, w.senses[0].type) : null,
      orig ? el("span", { class: "orig" }, orig) : null,
      el("span", { class: "gloss" }, w.senses[0].def)
    ),
    el(
      "p",
      { class: "meta" },
      w.pron && w.pron.length ? el("span", { class: "pron" }, "[" + w.pron.join("/") + "]") : null,
      w.conj && w.conj.length ? el("span", { class: "conj" }, "활용: " + [...w.conj, ...(w.abbr || [])].join(", ")) : null,
      w.origin ? el("span", { class: "orig" }, "어원: " + w.origin) : null
    ),
    groups.map((g) =>
      el("div", { class: "pos-group" }, el("p", { class: "pos" }, g.pos), el("ol", { class: "senses" }, g.senses.map(odSense)))
    )
  );
}

function odSection(words, key, hasKr) {
  return el(
    "section",
    { class: "source od" },
    el("h2", null, "우리말샘"),
    words.map((w, i) => {
      const general = w.senses.some((s) => !s.type);
      return odWord(w, i, words.length, key, general && i < (hasKr ? 2 : 3));
    })
  );
}

async function showEntry(key) {
  ++searchToken; // cancel any pending search render
  resultsEl.hidden = true;
  entryEl.hidden = false;
  entryEl.replaceChildren();
  setStatus("불러오는 중…");
  try {
    const page = await Dict.entry(key);
    setStatus("");
    if (!page) {
      entryEl.replaceChildren(
        el("p", { class: "hint" }, `‘${key}’ 표제어가 없습니다. `, el("a", { href: "#q=" + encodeURIComponent(key) }, "검색하기"))
      );
      return;
    }
    const kr = page.kr || [];
    const od = page.od || [];
    const display = kr.length ? kr[0].w : od[0].w || key;
    document.title = display + " - 사전";
    if (document.activeElement !== input) input.value = display;
    entryEl.replaceChildren(
      el("h1", null, display),
      kr.length ? krSection(kr) : null,
      od.length ? odSection(od, key, kr.length > 0) : null
    );
    window.scrollTo(0, 0);
    const r = await Dict.row(key).catch(() => null);
    remember(key, display, r ? r[2] : "");
  } catch (err) {
    setStatus("불러오기 실패: " + err.message);
  }
}

// ------------------------------------------------------------------ routing

function route() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  if (params.has("w")) {
    const key = params.get("w");
    showEntry(key);
  } else if (params.has("q")) {
    const q = params.get("q");
    if (input.value !== q) input.value = q;
    document.title = "사전";
    search(q);
  } else {
    input.value = "";
    document.title = "사전";
    showHome();
  }
}

let debounce;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const q = input.value;
    const hash = q.trim() ? "#q=" + encodeURIComponent(q) : "#";
    // typing replaces the current history entry; opening a word pushes a new one
    if (location.hash.startsWith("#w=") || !location.hash) history.pushState(null, "", hash);
    else history.replaceState(null, "", hash);
    routeOnce();
  }, 120);
});

$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const first = resultsEl.querySelector("ul.results a");
  if (first && !resultsEl.hidden) location.hash = first.getAttribute("href");
  input.blur();
});

input.addEventListener("focus", () => {
  if (!entryEl.hidden && input.value.trim()) {
    history.pushState(null, "", "#q=" + encodeURIComponent(input.value));
    routeOnce();
  }
});

$("#home").addEventListener("click", () => {
  input.value = "";
  setTimeout(() => input.focus(), 0);
});

// Link clicks fire hashchange (and usually popstate); back/forward may fire
// either. Route once per distinct URL.
let lastRouted = null;
function routeOnce() {
  if (location.href === lastRouted) return;
  lastRouted = location.href;
  route();
}
window.addEventListener("hashchange", routeOnce);
window.addEventListener("popstate", routeOnce);

Dict.init()
  .then((meta) => {
    $("#built").textContent = `(${meta.keys.toLocaleString()}개 표제어, ${meta.built} 빌드)`;
  })
  .catch(() => {});
routeOnce();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
