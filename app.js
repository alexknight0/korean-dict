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
const WORD_TYPE = { 고: "native", 한: "Sino-Korean", 외: "loanword", 혼: "hybrid" };
const LEVEL = { 초: "Beginner", 중: "Intermediate", 고: "Advanced" };
const OPENDICT_SENSE = "https://opendict.korean.go.kr/dictionary/view?sense_no=";
const KR_NAME = "Basic Korean Dictionary";
const OD_NAME = "Urimalsaem";

// English labels for Korean terms that come from the data. Unknown terms are
// shown as-is; the Korean original is kept in the tooltip.
const EN = {
  // parts of speech
  명사: "noun", 동사: "verb", 형용사: "adjective", 부사: "adverb", 대명사: "pronoun",
  수사: "numeral", 관형사: "determiner", 감탄사: "interjection", 조사: "particle",
  의존명사: "bound noun", "의존 명사": "bound noun", 보조동사: "auxiliary verb",
  "보조 동사": "auxiliary verb", 보조형용사: "auxiliary adjective", "보조 형용사": "auxiliary adjective",
  어미: "ending", 접사: "affix", 접두사: "prefix", 접미사: "suffix", 어근: "root",
  "수사·관형사": "numeral/determiner", "명사·부사": "noun/adverb", "대명사·관형사": "pronoun/determiner",
  "명사·관형사": "noun/determiner", "수사·명사": "numeral/noun", "관형사·명사": "determiner/noun",
  "감탄사·부사": "interjection/adverb", 품사없음: "no part of speech", "품사 없음": "no part of speech",
  // units & sense types
  구: "phrase", 속담: "proverb", 관용구: "idiom", 단어: "word", 어휘: "word",
  방언: "dialect", 북한어: "North Korean", 옛말: "archaic",
  // relations
  비슷한말: "synonym", 유의어: "synonym", 반대말: "antonym", 상위어: "hypernym", 하위어: "hyponym",
  "참고 어휘": "see also", 참고어: "see also", 준말: "short form", 본말: "full form",
  높임말: "honorific", 낮춤말: "humble", 파생어: "derived", "☞(가 보라)": "see",
  // regions
  강원: "Gangwon", 경기: "Gyeonggi", 경남: "S. Gyeongsang", 경북: "N. Gyeongsang", 경상: "Gyeongsang",
  전남: "S. Jeolla", 전북: "N. Jeolla", 전라: "Jeolla", 충남: "S. Chungcheong", 충북: "N. Chungcheong",
  충청: "Chungcheong", 제주: "Jeju", 평안: "Pyeongan", 평북: "N. Pyeongan", 평남: "S. Pyeongan",
  함경: "Hamgyeong", 함북: "N. Hamgyeong", 함남: "S. Hamgyeong", 황해: "Hwanghae", 중국: "China",
  // a few common languages (translations / word origins)
  영어: "English", 독일어: "German", 프랑스어: "French", 라틴어: "Latin", 일본어: "Japanese",
  이탈리아어: "Italian", 러시아어: "Russian", 에스파냐어: "Spanish", 그리스어: "Greek", 중국어: "Chinese",
  // subject categories (우리말샘)
  의학: "medicine", "정보·통신": "IT", 지명: "place name", 역사: "history", 경제: "economics",
  건설: "construction", "전기·전자": "electronics", 생명: "biology", 음악: "music", 체육: "sports",
  식물: "plants", 교육: "education", 인명: "person", 물리: "physics", 법률: "law", 화학: "chemistry",
  동물: "animals", 수학: "maths", 불교: "Buddhism", 기독교: "Christianity", 군사: "military",
  행정: "administration", 사회: "society", "사회 일반": "society", 언어: "linguistics", 미술: "art",
  문학: "literature", 철학: "philosophy", 지리: "geography", 농업: "agriculture", 공업: "industry",
  교통: "transport", 매체: "media", 연기: "performing arts", 영상: "film", 심리: "psychology",
  천문: "astronomy", 지구: "earth science", 해양: "marine", 수산: "fisheries", 임업: "forestry",
  광업: "mining", 기계: "machinery", 재료: "materials", 환경: "environment", 보건: "health",
  약학: "pharmacy", 한의: "Korean medicine", 수의: "veterinary", 복식: "clothing", 음식: "food",
  "주거": "housing", 무용: "dance", 종교: "religion", 가톨릭: "Catholicism", 천도교: "Cheondogyo",
  "민속": "folklore", 인류: "anthropology", "고유명 일반": "proper noun", 책명: "book title",
  정치: "politics", 경영: "business", 서비스업: "services", 공예: "crafts", 사진: "photography",
};
const en = (term) => EN[term] || term;
/** Badge/label node: English text, Korean original in the tooltip. */
const label = (cls, term) =>
  el("span", { class: cls, title: EN[term] && EN[term] !== term ? term : null, lang: EN[term] ? "en" : "ko" }, en(term));

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

const phone = window.matchMedia("(max-width: 640px)");

function showList(...nodes) {
  document.body.classList.remove("idle");
  $("#credit").hidden = true; // attribution only on entry pages
  resultsEl.replaceChildren(...nodes);
}

function showHome() {
  entryEl.hidden = true;
  resultsEl.hidden = false;
  setStatus("");
  const list = recent();
  if (list.length) {
    showList(
      el("h2", null, "Recent", el("button", { class: "link", type: "button", onclick: clearRecent }, "Clear")),
      el("ul", { class: "results" }, list.map(([k, d, g]) => resultItem(k, d, g)))
    );
  } else {
    // Nothing to show: dim the page so attention goes to the search bar.
    showList();
    document.body.classList.add("idle");
  }
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
      showList(
        rows.length
          ? el("ul", { class: "results" }, rows.map((r) => resultItem(r.key, r.disp, r.en)))
          : el("p", { class: "hint" }, "No results.")
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
        el("h2", null, "Dictionary form"),
        el(
          "ul",
          { class: "results bases" },
          baseRows.slice(0, 6).map(({ row: r }) => resultItem(r[0], r[1], r[2], r[3], query + " →"))
        )
      );
    }
    if (exact.length || rest.length) {
      if (baseRows.length) parts.push(el("h2", null, "Headwords"));
      parts.push(el("ul", { class: "results" }, [...exact, ...rest].map((r) => resultItem(r[0], r[1], r[2], r[3]))));
    }
    if (!parts.length) {
      parts.push(el("p", { class: "hint" }, "No results."));
    }
    showList(...parts);
  } catch (err) {
    if (token === searchToken) showList(el("p", { class: "error" }, "Failed to load: " + err.message));
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
      "aria-label": "Play pronunciation",
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
      el("dt", { title: EN[type] ? type : null }, en(type)),
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
    el("h2", null, KR_NAME, el("span", { class: "ko-name" }, "한국어기초사전")),
    entries.map((e, i) =>
      el(
        "div",
        { class: "word" },
        el(
          "h3",
          null,
          e.w,
          entries.length > 1 && e.hom ? el("sup", null, e.hom) : null,
          e.level && LEVEL[e.level[0]] ? el("span", { class: "level level-" + e.level[0], title: e.level }, LEVEL[e.level[0]]) : null
        ),
        el(
          "p",
          { class: "meta" },
          e.pos ? label("pos", e.pos) : null,
          e.unit && e.unit !== "단어" ? label("tag", e.unit) : null,
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
        ? el("li", { class: "dialog" }, lines.map((l, i) => el("span", null, (i % 2 ? "B: " : "A: ") + l)))
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
      s.type ? label("tag type", s.type) : null,
      (s.cat || []).map((c) => label("tag", c)),
      (s.reg || []).map((r) => label("tag region", r)),
      s.def
    ),
    s.pat && s.pat.length ? el("p", { class: "pat" }, "「" + s.pat.join(", ") + "」") : null,
    s.gram && s.gram.length ? el("p", { class: "note" }, s.gram.join(" ")) : null,
    s.sci ? el("p", { class: "sci" }, el("i", null, s.sci)) : null,
    s.tl && s.tl.length
      ? el("p", { class: "en", lang: "en" }, s.tl.map(([lang, t]) => (lang === "영어" ? t : `${t} (${en(lang)})`)).join("; "))
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
              x.reg ? label("tag region", x.reg) : null,
              x.tr ? el("span", { class: "tr" }, " → ", marked(x.tr)) : null,
              x.orig ? el("span", { class: "tr" }, " (" + x.orig + ")") : null
            )
          )
        )
      : null,
    s.rel && s.rel.length ? relationList(s.rel, 2, 3) : null,
    s.relMore ? el("p", { class: "more" }, `and ${s.relMore} more`) : null,
    s.idiom && s.idiom.length ? relationList(s.idiom, 2, 3) : null,
    s.hist ? el("p", { class: "hist" }, "History: " + s.hist) : null,
    (s.norm || []).map(([type, desc]) => el("p", { class: "note" }, `${type}: ${desc}`)),
    el("a", { class: "src", href: OPENDICT_SENSE + s.t, target: "_blank", rel: "noopener" }, "View on " + OD_NAME)
  );
}

function odWord(w, i, count, key, open) {
  const display = w.w || key;
  const orig =
    typeof w.orig === "string"
      ? w.orig
      : (w.orig || []).map(([type, o]) => (type === "한자" || type === "고유어" ? o : `${o} (${en(type)})`)).join(" + ");
  // group consecutive senses by part of speech
  const groups = [];
  for (const s of w.senses) {
    const pos = s.pos || "품사 없음"; // labelled in English when rendered
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
      w.unit ? label("tag", w.unit) : null,
      allMarked ? label("tag type", w.senses[0].type) : null,
      orig ? el("span", { class: "orig" }, orig) : null,
      el("span", { class: "gloss" }, w.senses[0].def)
    ),
    el(
      "p",
      { class: "meta" },
      w.pron && w.pron.length ? el("span", { class: "pron" }, "[" + w.pron.join("/") + "]") : null,
      w.conj && w.conj.length ? el("span", { class: "conj" }, "Conjugation: " + [...w.conj, ...(w.abbr || [])].join(", ")) : null,
      w.origin ? el("span", { class: "orig" }, "Etymology: " + w.origin) : null
    ),
    groups.map((g) =>
      el("div", { class: "pos-group" }, el("p", { class: "pos", title: EN[g.pos] ? g.pos : null }, en(g.pos)), el("ol", { class: "senses" }, g.senses.map(odSense)))
    )
  );
}

function odSection(words, key, hasKr) {
  return el(
    "section",
    { class: "source od" },
    el("h2", null, OD_NAME, el("span", { class: "ko-name" }, "우리말샘")),
    words.map((w, i) => {
      const general = w.senses.some((s) => !s.type);
      return odWord(w, i, words.length, key, general && i < (hasKr ? 2 : 3));
    })
  );
}

async function showEntry(key) {
  document.body.classList.remove("idle");
  $("#credit").hidden = false;
  $("#credit").open = false;
  ++searchToken; // cancel any pending search render
  resultsEl.hidden = true;
  entryEl.hidden = false;
  entryEl.replaceChildren();
  setStatus("Loading…");
  try {
    const page = await Dict.entry(key);
    setStatus("");
    if (!page) {
      entryEl.replaceChildren(
        el("p", { class: "hint" }, `No entry for ‘${key}’. `, el("a", { href: "#q=" + encodeURIComponent(key) }, "Search instead"))
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
    setStatus("Failed to load: " + err.message);
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

// Phones: the search bar sits at the bottom until you search; while the box is
// focused or results are showing it moves to the top (CSS body.searching).
function updateBar() {
  const searching = document.activeElement === input || location.hash.startsWith("#q=");
  document.body.classList.toggle("searching", searching);
}
input.addEventListener("focus", updateBar);
input.addEventListener("blur", () => setTimeout(updateBar, 0));
window.addEventListener("hashchange", updateBar);

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

Dict.init().catch(() => {});
routeOnce();
updateBar();
// Empty home: put the cursor in the search box. Not on phones — focusing there
// would move the bar to the top and may pop the keyboard unasked.
if (document.body.classList.contains("idle") && !phone.matches) input.focus({ preventScroll: true });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
