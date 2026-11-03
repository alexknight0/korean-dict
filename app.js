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
// "품사 없음" (no part of speech) is the dictionaries' placeholder for a missing value: not shown.
const hasPos = (pos) => pos && pos !== "품사 없음" && pos !== "품사없음";

// ------------------------------------------------------------------ settings
// localStorage "korean-dict-settings" (Settings dialog, gear button in the search bar).
// koreanOnly, off by default: also use 우리말샘, the dictionary written for Korean
// readers. While off, entry pages show only the "For English readers" group and the
// search results / hanja word lists only list words in 기초사전.
// bottomBar, off by default: on phones, the search bar rests at the bottom of the
// screen (see updateBar). Alex relies on it; most people won't want it.
const SETTINGS_KEY = "korean-dict-settings";
const DEFAULT_SETTINGS = { koreanOnly: false, bottomBar: false };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
let settings = loadSettings();

function saveSetting(name, value) {
  settings = { ...settings, [name]: value };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const showOd = () => settings.koreanOnly;
// Index rows have a 4th element (the level, maybe "") only for words in 기초사전.
const shownRow = (r) => showOd() || r.length > 3;

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
  return appendParts(node, children);
}

/** Appends text/nodes (arrays are flattened), skipping missing parts (null, undefined, false, ""). */
function appendParts(node, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

/** node.replaceChildren(...) that skips missing parts like el() does, instead of
    rendering them as the text "null". Use this, not replaceChildren/append. */
function setChildren(node, ...children) {
  node.replaceChildren();
  return appendParts(node, children);
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
const hanjaHref = (ch) => "#h=" + encodeURIComponent(ch);

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
  setChildren(resultsEl, ...nodes);
  // The Ask AI shortcuts at the top only make sense when the list has an Ask AI section.
  $("#gap-bar").classList.toggle("has-ai", !!resultsEl.querySelector(".ai-options"));
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
    showList(el("p", { class: "hint empty-recent" }, "Recent searches will display here"));
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
      const rows = await Dict.english(query, !showOd());
      if (token !== searchToken) return;
      showList(
        rows.length ? el("ul", { class: "results" }, rows.map((r) => resultItem(r.key, r.disp, r.en))) : el("p", { class: "hint" }, "No results."),
        aiSection(query)
      );
      return;
    }

    const hangul = /^[\uac00-\ud7a3]+$/.test(key);
    const [allRows, bases] = await Promise.all([
      Dict.prefixRows(key),
      hangul && key.length >= 2 ? Dict.baseForms(key) : [],
    ]);
    if (token !== searchToken) return;

    const rows = allRows.filter(shownRow);
    const exact = rows.filter((r) => r[0] === key);
    const rest = rows.filter((r) => r[0] !== key).slice(0, RESULT_LIMIT);
    const shown = new Set(rows.map((r) => r[0]));
    const baseRows = bases.filter((b) => !shown.has(b.row[0]) && shownRow(b.row));

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
      parts.push(el("h2", null, "Headwords")); // always labelled: the Ask AI section follows
      parts.push(el("ul", { class: "results" }, [...exact, ...rest].map((r) => resultItem(r[0], r[1], r[2], r[3]))));
    }
    if (!parts.length) parts.push(el("p", { class: "hint" }, "No results."));
    parts.push(aiSection(query));
    showList(...parts);
  } catch (err) {
    if (token === searchToken) showList(el("p", { class: "error" }, "Failed to load: " + err.message));
  }
}

// ------------------------------------------------------------------ Ask AI
// Every search list ends with an "Ask AI" section of two rows (ai.js, Gemini):
//   spell:  "did I misspell it?" -> the dictionary words probably meant
//   define: "define it" -> meaning, example sentences and origin of a word the
//           dictionary doesn't have (slang, new words); Gemini says so instead of
//           inventing a meaning when it doesn't know the word.
// The first tap signs in with Google and, if the account has no Gemini key yet, asks
// for one; the key is saved to the account and reused after that.

const AI_MODES = {
  spell: { title: "✦ Did I misspell it?", hint: "Find the word you meant (typos, misremembered spelling)" },
  define: { title: "✦ Define it", hint: "For words this dictionary doesn't have (slang, new words): meaning, examples, origin" },
};

let aiModule = null;
/** ai.js and the Firebase SDK (~300 KB), loaded once: on the first press of an Ask AI row
    (pointerdown, slightly before the click), so ordinary searches never load them. The
    sign-in popup still opens within the tap's user activation (Chrome allows ~5 s). */
function loadAI() {
  aiModule ||= import("./ai.js").catch((err) => {
    aiModule = null;
    throw err;
  });
  return aiModule;
}

/** Earlier answer from ai.js's cache (localStorage, see cacheKey there), read without
    loading ai.js. */
function aiCached(query, mode) {
  try {
    const cache = JSON.parse(localStorage.getItem("korean-dict-ai") || "{}");
    return cache[mode === "spell" ? query.trim() : mode + ":" + query.trim()] || null;
  } catch {
    return null;
  }
}

/** "Ask AI" heading + one box per mode; a box shows its earlier answer if there is one
    (e.g. after going back from a suggestion), else its row. */
function aiSection(query) {
  return el(
    "div",
    { class: "ai-options" },
    el("h2", null, "Ask AI"),
    Object.keys(AI_MODES).map((mode) => {
      const box = el("div", { class: "ai ai-" + mode });
      const hit = aiCached(query, mode);
      if (hit) showAnswer(box, query, mode, hit);
      else showAskRow(box, query, mode);
      return box;
    })
  );
}

function showAskRow(box, query, mode) {
  setChildren(
    box,
    el(
      "ul",
      { class: "results" },
      el(
        "li",
        null,
        el(
          "button",
          { type: "button", class: "row ask-ai", onpointerdown: () => loadAI().catch(() => {}), onclick: () => askAI(box, query, mode) },
          el("span", { class: "ai-title" }, AI_MODES[mode].title),
          el("span", { class: "gloss" }, AI_MODES[mode].hint)
        )
      )
    )
  );
}

function aiBusy(box, text) {
  setChildren(box, el("p", { class: "hint ai-busy" }, el("span", { class: "spinner" }), text));
}

function showAnswer(box, query, mode, answer) {
  return mode === "define" ? showDefinition(box, query, answer) : showSuggestions(box, query, answer);
}

async function askAI(box, query, mode) {
  let user = null;
  try {
    const ai = await loadAI();
    user = await ai.currentUser();
    if (!user) {
      aiBusy(box, "Signing in…");
      user = await ai.signIn();
    }
    aiBusy(box, "Asking Gemini…");
    const key = await ai.getKey(user);
    if (!key) return keyForm(box, query, mode, user);
    const onRetry = (text) => box.isConnected && aiBusy(box, text);
    const answer = mode === "define" ? await ai.define(query, key, onRetry) : await ai.suggest(query, key, onRetry);
    if (box.isConnected) showAnswer(box, query, mode, answer);
  } catch (err) {
    if (!box.isConnected) return;
    const code = err.code || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return showAskRow(box, query, mode);
    if (err.name === "BadKeyError") return keyForm(box, query, mode, user, "Gemini didn't accept the key: " + err.message);
    const message =
      code === "permission-denied"
        ? "AI lookups only work with the site owner's Google account."
        : code === "auth/popup-blocked"
          ? "The sign-in popup was blocked. Allow popups for this site and try again."
          : "AI lookup failed: " + err.message;
    setChildren(
      box,
      el("p", { class: "error" }, message, " ", el("button", { class: "link", type: "button", onclick: () => askAI(box, query, mode) }, "Try again"))
    );
  }
}

/** Asks for a Gemini API key, saves it to the account, then asks Gemini. */
function keyForm(box, query, mode, user, problem) {
  const field = el("input", {
    type: "text",
    class: "ai-key",
    placeholder: "Gemini API key",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    "aria-label": "Gemini API key",
  });
  const form = el(
    "form",
    {
      class: "ai-key-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const key = field.value.trim();
        if (!key) return field.focus();
        aiBusy(box, "Saving the key…");
        try {
          await (await loadAI()).saveKey(user, key);
        } catch (err) {
          return keyForm(box, query, mode, user, "Couldn't save the key: " + err.message);
        }
        askAI(box, query, mode);
      },
    },
    field,
    el("button", { type: "submit", class: "btn" }, "Save")
  );
  setChildren(
    box,
    problem ? el("p", { class: "error" }, problem) : null,
    el(
      "p",
      { class: "hint ai-key-hint" },
      "Paste a Gemini API key (free from ",
      el("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "Google AI Studio"),
      "). It's saved to your Google account, so you only need to do this once."
    ),
    form
  );
  field.focus();
}

/** "Define it" answer: meaning, examples (word highlighted) and origin, or Gemini's "don't know". */
async function showDefinition(box, query, d) {
  if (!d.known) {
    setChildren(
      box,
      el("p", { class: "ai-sub" }, "Definition"),
      el("p", { class: "hint ai-unknown" }, `Gemini doesn't know ‘${query}’ as a Korean word or expression, so it didn't make up a meaning.`)
    );
    return;
  }
  const key = Dict.toKey(d.word);
  const row = await Dict.row(key).catch(() => null);
  if (!box.isConnected) return;
  const inDict = row && shownRow(row) && key !== Dict.toKey(query);
  const card = el(
    "div",
    { class: "ai-def" },
    el("h3", null, d.word, d.pos ? el("span", { class: "pos" }, d.pos) : null),
    inDict ? el("p", { class: "note" }, "In this dictionary as ", wordLink(row[1], row[0])) : null,
    el("p", { class: "en", lang: "en" }, d.meaning),
    d.examples.length
      ? el("ul", { class: "ex" }, d.examples.map((x) => el("li", null, el("span", { class: "ko" }, x.ko), x.en ? el("span", { class: "tr" }, " → " + x.en) : null)))
      : null,
    d.origin ? el("p", { class: "ai-origin" }, el("b", null, "Origin: "), d.origin) : null
  );
  setChildren(box, el("p", { class: "ai-sub" }, "Definition"), card, el("p", { class: "ai-credit" }, "Written by Gemini (" + d.model + "); it can be wrong."));
  highlightWord(card.querySelector("ul.ex"), [key, Dict.toKey(query)], d.word).catch(() => {});
}

async function showSuggestions(box, query, { suggestions, model }) {
  // Link each guess to its dictionary page when the dictionary has it.
  const found = await Promise.all(
    suggestions.map(async (s) => {
      const key = Dict.toKey(s.word);
      try {
        const row = await Dict.row(key);
        if (row && shownRow(row)) return row;
        const bases = /^[\uac00-\ud7a3]{2,}$/.test(key) ? await Dict.baseForms(key) : [];
        const base = bases.find((b) => shownRow(b.row));
        return base ? base.row : null;
      } catch {
        return null;
      }
    })
  );
  if (!box.isConnected) return;
  const items = suggestions.map((s, i) => {
    const r = found[i];
    const why = s.note ? el("span", { class: "why" }, s.note) : null;
    if (!r) {
      return el(
        "li",
        null,
        el("div", { class: "row missing" }, el("span", { class: "hw" }, s.word), why, el("span", { class: "gloss" }, [s.meaning, "not in this dictionary"].filter(Boolean).join(" · ")))
      );
    }
    const item = resultItem(r[0], r[1], r[2] || s.meaning, r[3]);
    const link = item.querySelector("a");
    if (why) link.insertBefore(why, link.querySelector(".gloss"));
    return item;
  });
  setChildren(box,
    el("p", { class: "ai-sub" }, "Did you mean"),
    items.length ? el("ul", { class: "results ai-results" }, items) : el("p", { class: "hint" }, "Gemini had no suggestions."),
    el("p", { class: "ai-credit" }, "Guesses by Gemini (" + model + "); they can be wrong.")
  );
}

// ------------------------------------------------------------------ highlighting
// The page's word is highlighted wherever it appears in Korean body text: definitions,
// examples, notes (먹다 -> 먹고, 먹어도; 춥다 -> 추운, 추워지다; 공부 -> 공부를). 우리말샘
// examples already mark it with {braces} (<b>), which are left as they are.

const HL_SKIP = "a, b, mark, button, h1, h2, h3, summary .hw, sup, .pron, .orig, .level, .tag, .pos, .ko-name, .ext, .src, .hanja";
const HANGUL_RUN = /[\uac00-\ud7a3]+/g;
const initial = (ch) => Math.floor((ch.charCodeAt(0) - 0xac00) / 588); // 초성 of a syllable

/** Wraps occurrences of the word in <mark class="hl"> inside root. keys: the page key(s);
    display: the headword as written (phrases with spaces are matched as written). */
async function highlightWord(root, keys, display) {
  if (!root) return;
  keys = [...new Set(keys.filter(Boolean))];
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/[\uac00-\ud7a3]/.test(n.data) && !n.parentElement.closest(HL_SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  if (!nodes.length) return;

  // Each match: [node, start, length, form]; form = the conjugated text, checked below.
  const matches = [];
  const phrase = display && /\s/.test(display.trim()) ? display.trim() : null;
  for (const node of nodes) {
    if (phrase) {
      for (let i = node.data.indexOf(phrase); i >= 0; i = node.data.indexOf(phrase, i + phrase.length)) matches.push([node, i, phrase.length, null]);
      continue;
    }
    for (const m of node.data.matchAll(HANGUL_RUN)) {
      const len = matchLength(m[0], keys);
      if (len) matches.push([node, m.index, len[0], len[1]]);
    }
  }
  // A conjugation guess that is itself a learner word is that word instead (가게 "shop",
  // not 가다 + 게), so skip it. Only forms that start like the headword can be such a word
  // (갔지, 추운 can't), which also saves fetching index files for 갔, 추...
  const forms = [...new Set(matches.map((m) => m[3]).filter((f) => f && keys.some((k) => f[0] === k[0])))];
  const words = new Set();
  await Promise.all(
    forms.map(async (f) => {
      const r = await Dict.row(f).catch(() => null);
      if (r && r.length > 3) words.add(f);
    })
  );
  if (!root.isConnected) return;
  // Wrap from the end of each node so earlier offsets stay valid.
  for (const [node, start, length] of matches.filter((m) => !words.has(m[3])).reverse()) {
    const word = node.splitText(start);
    word.splitText(length);
    const mark = el("mark", { class: "hl" });
    word.replaceWith(mark);
    mark.append(word);
  }
}

/** How much of a Hangul run is the word: [length, form?] or null. form is set when the
    match relies on a conjugation guess (it over-generates; see highlightWord). */
function matchLength(run, keys) {
  for (const key of keys) {
    const verb = key.length > 1 && key.endsWith("다");
    if (!verb && key.length === 1) {
      // One syllable (가, 눈): only on its own or with a particle, not inside other words.
      if (run === key || Deinflect.candidates(run).includes(key)) return [key.length, null];
      continue;
    }
    if (run.startsWith(key)) return [key.length, null]; // noun + particle: just the noun
    if (!verb || initial(run) !== initial(key)) continue;
    for (let len = run.length; len >= 1; len--) {
      const form = run.slice(0, len);
      if (Deinflect.candidates(form).includes(key)) return [len, form];
    }
  }
  return null;
}

// ------------------------------------------------------------------ entry page

/** ▶ button for a hotlinked NIKL recording. The audio comes from a slow server, so the
    button shows a spinner (data-state=loading) until sound starts, and "!" if it fails.
    The Audio object is kept, so replays are instant. */
function playButton(url) {
  if (!url) return null;
  let audio = null;
  let errorTimer;
  const btn = el("button", { class: "play", type: "button", "aria-label": "Play pronunciation", "data-state": "idle" }, "▶");
  const set = (state) => {
    btn.dataset.state = state;
    btn.textContent = state === "error" ? "!" : state === "loading" ? "" : "▶";
    btn.setAttribute("aria-label", { loading: "Loading pronunciation…", error: "Couldn't load the pronunciation. Tap to retry." }[state] || "Play pronunciation");
  };
  btn.addEventListener("click", () => {
    clearTimeout(errorTimer);
    const fail = () => {
      set("error");
      errorTimer = setTimeout(() => btn.dataset.state === "error" && set("idle"), 4000);
    };
    if (!audio || btn.dataset.state === "error") {
      audio = new Audio(url);
      audio.addEventListener("playing", () => set("playing"));
      audio.addEventListener("ended", () => set("idle"));
      audio.addEventListener("error", fail);
    }
    audio.currentTime = 0;
    if (audio.readyState < 3) set("loading"); // not enough data yet: show the spinner
    audio.play().catch((err) => err.name !== "AbortError" && fail());
  });
  return btn;
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
          hasPos(e.pos) ? label("pos", e.pos) : null,
          e.unit && e.unit !== "단어" ? label("tag", e.unit) : null,
          e.pron && e.pron.some(Boolean) ? el("span", { class: "pron" }, "[" + e.pron.filter(Boolean).join("/") + "]") : null,
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
  // A few examples have empty lines; drop them rather than show "/ /".
  const text = (lines) => (lines || []).filter(Boolean);
  const phrases = ex.filter(([t]) => t === "구").map(([, lines]) => text(lines).join(" ")).filter(Boolean);
  const others = ex.filter(([t, lines]) => t !== "구" && text(lines).length);
  return el(
    "ul",
    { class: "ex" },
    phrases.length ? el("li", { class: "phrases" }, phrases.join(" / ")) : null,
    others.map(([type, lines]) =>
      type === "대화"
        ? el("li", { class: "dialog" }, text(lines).map((l, i) => el("span", null, (i % 2 ? "B: " : "A: ") + l)))
        : el("li", null, text(lines).join(" "))
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
      defText(s.def)
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
      : (w.orig || []).filter(([, o]) => o).map(([type, o]) => (type === "한자" || type === "고유어" ? o : `${o} (${en(type)})`)).join(" + ");
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
      w.pron && w.pron.some(Boolean) ? el("span", { class: "pron" }, "[" + w.pron.filter(Boolean).join("/") + "]") : null,
      w.conj && w.conj.length ? el("span", { class: "conj" }, "Conjugation: " + [...w.conj, ...(w.abbr || [])].join(", ")) : null,
      w.origin ? el("span", { class: "orig" }, "Etymology: " + w.origin) : null
    ),
    groups.map((g) =>
      el("div", { class: "pos-group" }, hasPos(g.pos) ? el("p", { class: "pos", title: EN[g.pos] ? g.pos : null }, en(g.pos)) : null, el("ol", { class: "senses" }, g.senses.map(odSense)))
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

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u;
const HANJA_SHOWN = 8; // hanja words shown before "N more"

/** Distinct hanja spellings on the page: [{text, word, gloss?}], 기초사전 first. */
function hanjaItems(page, key) {
  const items = new Map();
  const add = (text, word, gloss) => {
    if (!text || !HAN.test(text)) return;
    const it = items.get(text);
    if (!it) items.set(text, { text, word, gloss });
    else if (!it.gloss) it.gloss = gloss;
  };
  for (const e of page.kr || []) {
    const s = (e.senses || [])[0];
    add(e.origin, e.w, s && s.en && s.en[0] ? s.en[0][0] : null);
  }
  for (const w of showOd() ? page.od || [] : []) {
    const text = typeof w.orig === "string" ? w.orig : (w.orig || []).map(([, o]) => o).join("");
    const tl = w.senses.flatMap((s) => s.tl || []).find(([lang]) => lang === "영어");
    add(text, w.w || key, tl ? tl[1] : null);
  }
  return [...items.values()];
}

/** One hanja spelling with each character's reading and English meaning. */
function hanjaRow(item, table) {
  const chars = Array.from(item.text.replace(/[\s^\-]/g, ""));
  // When the spelling lines up with the headword syllable by syllable, show the
  // reading used in this word (樂 in 음악 -> 악) instead of every reading.
  const syl = Array.from(Dict.toKey(item.word));
  const aligned = syl.length === chars.length;
  const seen = new Set();
  const lines = [];
  chars.forEach((c, i) => {
    if (!HAN.test(c) || seen.has(c) || !table[c]) return;
    seen.add(c);
    const [readings, def] = table[c];
    const all = readings ? readings.split(" ") : [];
    const reading = aligned && all.includes(syl[i]) ? syl[i] : all.join("/");
    lines.push(
      el(
        "li",
        null,
        el("a", { class: "hz", href: hanjaHref(c), title: `Words using ${c}` }, c),
        el("span", { class: "rd" }, reading),
        el("span", { lang: "en" }, def)
      )
    );
  });
  if (!lines.length) return null;
  return el(
    "div",
    { class: "hanja-word" },
    el("p", { class: "hanja-head" }, el("span", { class: "hz" }, item.text), item.gloss ? el("span", { class: "en", lang: "en" }, item.gloss) : null),
    el("ul", { class: "hanja-chars" }, lines)
  );
}

/** Hanja meanings (Unihan). The character data loads after the page renders. */
function hanjaSection(page, key) {
  const items = hanjaItems(page, key);
  if (!items.length) return null;
  const section = el("section", { class: "source hanja" }, el("h2", null, "Hanja meanings", el("span", { class: "ko-name" }, "한자")));
  const drop = () => {
    const group = section.closest(".group");
    section.remove();
    if (group && !group.querySelector("section")) group.remove();
  };
  const chars = items.flatMap((it) => Array.from(it.text).filter((c) => HAN.test(c)));
  Dict.hanja(chars)
    .then((table) => {
      const rows = items.map((it) => hanjaRow(it, table)).filter(Boolean);
      if (!rows.length) return drop();
      appendParts(section, ...rows.slice(0, HANJA_SHOWN));
      if (rows.length > HANJA_SHOWN) {
        appendParts(section, el("details", { class: "more-hanja" }, el("summary", null, `${rows.length - HANJA_SHOWN} more`), rows.slice(HANJA_SHOWN)));
      }
    })
    .catch(drop);
  return section;
}

// 우리말샘 lists word roots (기특 of 기특하다) whose only definition is "‘기특하다’의 어근."
const ROOT_DEF = /^‘([^’]+)’의 어근\./;
const homonymless = (w) => w.replace(/\d+$/, "");

/** Words this page is the root of: [{key, display}], in page order. */
function rootTargets(page) {
  const out = new Map();
  for (const w of page.od || []) {
    for (const s of w.senses) {
      const m = ROOT_DEF.exec(s.def || "");
      if (!m) continue;
      const display = homonymless(m[1]);
      const key = Dict.toKey(display);
      if (!out.has(key)) out.set(key, { key, display });
    }
  }
  return [...out.values()];
}

/** Definition text, with the word in "‘X’의 어근." linked. */
function defText(def) {
  const m = ROOT_DEF.exec(def || "");
  if (!m) return def;
  return ["‘", wordLink(homonymless(m[1])), def.slice(1 + m[1].length)]; // rest starts at the closing ’
}

/** "Root of": the full word's English (기초사전), else its 우리말샘 translation/definition. */
function rootCard(target) {
  const card = el("div", { class: "root-word" }, el("h3", null, wordLink(target.display, target.key)));
  Dict.entry(target.key)
    .then((page) => {
      if (!page) return;
      const kr = page.kr || [];
      const level = kr.map((e) => e.level).find((l) => l && LEVEL[l[0]]);
      if (level) appendParts(card.firstChild, el("span", { class: "level level-" + level[0], title: level }, LEVEL[level[0]]));
      const en = kr.flatMap((e) => (e.senses || []).flatMap((s) => s.en || []));
      if (en.length) {
        appendParts(card, ...en.map(([lemma, def]) => el("p", { class: "en", lang: "en" }, el("b", null, lemma), def ? " — " + def : null)));
        return;
      }
      const senses = (page.od || []).flatMap((w) => w.senses);
      const tl = senses.flatMap((s) => s.tl || []).filter(([lang]) => lang === "영어").map(([, t]) => t);
      if (tl.length) appendParts(card, el("p", { class: "en", lang: "en" }, tl.join("; ")));
      const def = senses.find((s) => s.def && !ROOT_DEF.test(s.def));
      if (def) appendParts(card, el("p", { class: "def" }, def.def));
    })
    .catch(() => {});
  return card;
}

function rootSection(page, display) {
  const targets = rootTargets(page);
  if (!targets.length) return null;
  return el(
    "section",
    { class: "source root" },
    el("h2", null, "Root of", el("span", { class: "ko-name" }, "어근")),
    el("p", { class: "note" }, `${display} is a root, not used on its own. Full ${targets.length > 1 ? "words" : "word"}:`),
    targets.map(rootCard)
  );
}

const NAVER = {
  en: (q) => "https://en.dict.naver.com/#/search?query=" + encodeURIComponent(q),
  ko: (q) => "https://ko.dict.naver.com/#/search?query=" + encodeURIComponent(q),
  hanja: (q) => "https://hanja.dict.naver.com/#/search?query=" + encodeURIComponent(q),
};
const extLink = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);

/** A group of dictionary sections for one kind of reader; null when empty. */
function readerGroup(cls, title, koTitle, sections) {
  sections = sections.filter(Boolean);
  if (!sections.length) return null;
  return el("div", { class: "group " + cls }, el("h2", { class: "group-h" }, title, el("span", { class: "ko-name" }, koTitle)), sections);
}

async function showEntry(key) {
  document.body.classList.remove("idle");
  $("#credit").hidden = false;
  $("#credit").open = false;
  ++searchToken; // cancel any pending search render
  resultsEl.hidden = true;
  entryEl.hidden = false;
  setChildren(entryEl);
  setStatus("Loading…");
  try {
    const page = await Dict.entry(key);
    setStatus("");
    if (!page) {
      setChildren(entryEl,
        el("p", { class: "hint" }, `No entry for ‘${key}’. `, el("a", { href: "#q=" + encodeURIComponent(key) }, "Search instead"))
      );
      return;
    }
    const kr = page.kr || [];
    const od = page.od || [];
    const odShown = showOd();
    const display = kr.length ? kr[0].w : od[0].w || key;
    document.title = display + " - 사전";
    if (document.activeElement !== input) input.value = display;
    const naver = el("p", { class: "ext" }, "Naver: ", extLink(NAVER.en(display), "English"), " · ", extLink(NAVER.ko(display), "국어사전"));
    if (!kr.length && !odShown) {
      // Reached by a link or a recent lookup while 우리말샘 is hidden.
      setChildren(entryEl,
        el("h1", null, display),
        naver,
        el(
          "p",
          { class: "hint od-hidden" },
          `‘${display}’ is only in ${OD_NAME} (우리말샘), a dictionary for Korean readers. `,
          el("button", { class: "link", type: "button", onclick: () => setKoreanOnly(true) }, "Show Korean-only dictionaries")
        )
      );
      window.scrollTo(0, 0);
      return;
    }
    setChildren(entryEl,
      el("h1", null, display),
      naver,
      // 기초사전 is written for learners (English equivalents); 우리말샘 for native speakers.
      readerGroup("for-en", "For English readers", "영어 풀이", [
        odShown ? rootSection(page, display) : null,
        kr.length ? krSection(kr) : null,
        hanjaSection(page, key),
      ]),
      readerGroup("for-ko", "For Korean readers", "한국어 풀이", [odShown && od.length ? odSection(od, key, kr.length > 0) : null])
    );
    window.scrollTo(0, 0);
    highlightWord(entryEl, [key], display).catch((err) => console.warn("highlight:", err));
    const r = await Dict.row(key).catch(() => null);
    remember(key, display, r ? r[2] : "");
  } catch (err) {
    setStatus("Failed to load: " + err.message);
  }
}

// ------------------------------------------------------------------ hanja page

/** #h=<char>: the character's readings and meaning, then the words written with it. */
async function showHanja(ch) {
  document.body.classList.remove("idle");
  $("#credit").hidden = false;
  $("#credit").open = false;
  ++searchToken; // cancel any pending search render
  resultsEl.hidden = true;
  entryEl.hidden = false;
  setChildren(entryEl);
  document.title = ch + " - 사전";
  if (document.activeElement !== input) input.value = "";
  setStatus("Loading…");
  try {
    const [info, words] = await Promise.all([Dict.hanja([ch]), Dict.hanjaWords(ch)]);
    setStatus("");
    const [readings, def] = info[ch] || ["", ""];
    // Without 우리말샘: only 기초사전 spellings (rows with a 5th element), counted by k.
    const rows = words ? words.r.filter((r) => showOd() || r.length > 4) : [];
    const total = !words ? 0 : showOd() ? words.n : words.k ?? rows.length;
    setChildren(entryEl,
      el(
        "div",
        { class: "hanja-title" },
        el("h1", { class: "hz" }, ch),
        el("div", null, readings ? el("p", { class: "rd" }, readings.split(" ").join(" · ")) : null, def ? el("p", { lang: "en" }, def) : null)
      ),
      el("p", { class: "ext" }, "Naver: ", extLink(NAVER.hanja(ch), "한자사전")),
      el(
        "h2",
        null,
        total ? `${total.toLocaleString()} ${total === 1 ? "word" : "words"} using ${ch}` : `No words using ${ch}`,
        total > rows.length ? el("span", { class: "ko-name" }, `top ${rows.length} shown`) : null
      ),
      rows.length
        ? el("ul", { class: "results hanja-words" }, rows.map(([key, disp, spelling, gloss, level]) => resultItem(key, disp, gloss, level, spelling)))
        : null
    );
    window.scrollTo(0, 0);
  } catch (err) {
    setStatus("Failed to load: " + err.message);
  }
}

// ------------------------------------------------------------------ routing

function route() {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  if (!params.has("q")) document.body.classList.remove("keep-gap"); // other pages start at the top anyway
  if (params.has("h")) {
    const ch = Array.from(params.get("h"))[0];
    if (ch) showHanja(ch);
    else showHome();
  } else if (params.has("w")) {
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
/** Show results for the box's text (typing replaces the history entry; leaving a word pushes one). */
function goSearch() {
  clearTimeout(debounce);
  const q = input.value;
  const hash = q.trim() ? "#q=" + encodeURIComponent(q) : "#";
  if (/^#[wh]=/.test(location.hash) || !location.hash) history.pushState(null, "", hash);
  else history.replaceState(null, "", hash);
  routeOnce();
}
input.addEventListener("input", () => {
  clearTimeout(debounce);
  // A keyboard re-committing its text just after Enter blurred the box (see below).
  if (lastSubmit && document.activeElement !== input && Date.now() - lastSubmit.t < 1000) {
    if (input.value !== lastSubmit.q) input.value = lastSubmit.q;
    return;
  }
  debounce = setTimeout(goSearch, 120);
});

// Enter: show the result list for what was typed (no auto-opening the first
// match) and close the keyboard so the whole list is visible to tap from.
// Android keyboards (Korean especially) may still be composing when Enter is
// pressed (text underlined). Blurring then makes the keyboard commit the
// composing text a second time (히히 -> 히히히히), so wait for compositionend,
// and if the text still changes during the blur, the submitted text wins.
let composing = false;
let pendingSubmit = null;
let lastSubmit = null; // {q, t}: text and time of the last Enter
input.addEventListener("compositionstart", () => (composing = true));
input.addEventListener("compositionend", () => {
  composing = false;
  const run = pendingSubmit;
  pendingSubmit = null;
  if (run) setTimeout(run, 0); // let the committed text land in input.value first
});

function submitSearch() {
  const q = input.value;
  lastSubmit = { q, t: Date.now() };
  goSearch();
  input.blur();
  setTimeout(() => {
    if (input.value === q) return;
    clearTimeout(debounce);
    input.value = q;
    goSearch();
  }, 50);
}

$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!composing) return submitSearch();
  const run = () => {
    if (pendingSubmit === run) pendingSubmit = null;
    submitSearch();
  };
  pendingSubmit = run;
  setTimeout(() => pendingSubmit === run && run(), 300); // keyboard never ended the composition
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

// Setting "Search bar at the bottom" (body.bottom-bar, phones only): the bar sits at the
// bottom and moves to the top (CSS body.searching) while the search box is focused,
// i.e. while typing. When it drops back down over a results list, body.keep-gap keeps
// the room it took at the top, so the list doesn't jump up (Alex found the jump
// jarring); the gap goes when the page changes or the box is focused again.
function moveBar() {
  clearTimeout(barTimer);
  barTimer = null;
  const body = document.body;
  const searching = document.activeElement === input;
  if (body.classList.contains("searching") && !searching) keepGap();
  if (searching) body.classList.remove("keep-gap");
  body.classList.toggle("searching", searching);
}

/** Bottom bar over a results list: keep the room the top bar takes (see updateBar). */
function keepGap() {
  if (!settings.bottomBar || resultsEl.hidden) return;
  document.body.style.setProperty("--bar-h", $("header").offsetHeight + "px");
  document.body.classList.add("keep-gap");
}

// The on-screen keyboard, seen through the visual viewport: it shrinks when the
// keyboard opens and grows back when it closes.
const vv = window.visualViewport;
const KEYBOARD_MIN = 150; // px; smaller changes are browser toolbars, not a keyboard
let fullHeight = vv ? vv.height : 0; // viewport height without a keyboard
let keyboardOpen = false;
let barTimer = null; // a drop to the bottom waiting for the keyboard to close
const BAR_WAIT_MS = 800; // longest wait for the keyboard's closing animation

/** Typing ended: drop the bar to the bottom, but only once the keyboard has finished
    closing. While it animates, the bottom of the layout viewport rises in steps, and a
    fixed-bottom bar rode those steps down (Alex: it "glitches down"). Staying at the top
    until then makes it one instant move. */
function updateBar() {
  const dropping = settings.bottomBar && document.activeElement !== input && document.body.classList.contains("searching");
  if (dropping && vv && vv.height < fullHeight - 8) {
    clearTimeout(barTimer);
    barTimer = setTimeout(moveBar, BAR_WAIT_MS);
    return;
  }
  moveBar();
}
input.addEventListener("focus", updateBar);
input.addEventListener("blur", () => setTimeout(updateBar, 0));

// Dismissing the keyboard (Android back/down button, iOS swipe) leaves the box focused,
// so when the viewport grows back, blur the box so the bar returns to the bottom (only
// with the bottom bar; at the top nothing moves).
if (vv) {
  vv.addEventListener("resize", () => {
    if (barTimer) {
      if (vv.height >= fullHeight - 8) moveBar(); // keyboard gone: move now
      return;
    }
    if (document.activeElement !== input) {
      fullHeight = vv.height; // rotation etc.
      keyboardOpen = false;
      return;
    }
    if (vv.height > fullHeight) fullHeight = vv.height;
    if (vv.height < fullHeight - KEYBOARD_MIN) keyboardOpen = true;
    else if (keyboardOpen && vv.height > fullHeight - KEYBOARD_MIN / 2) {
      keyboardOpen = false;
      if (settings.bottomBar) input.blur();
    }
  });
  input.addEventListener("focus", () => {
    if (!keyboardOpen && vv.height > fullHeight) fullHeight = vv.height;
  });
}

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

// Ask AI shortcuts in the gap the bottom bar leaves at the top of a results list
// (#gap-bar, shown by CSS with body.keep-gap): run that option of the list's Ask AI
// section and scroll down to it.
for (const chip of document.querySelectorAll(".ai-chip")) {
  const mode = chip.dataset.mode;
  chip.textContent = AI_MODES[mode].title;
  chip.addEventListener("pointerdown", () => loadAI().catch(() => {}));
  chip.addEventListener("click", () => {
    const box = resultsEl.querySelector(".ai-" + mode);
    if (!box) return;
    const row = box.querySelector(".ask-ai");
    if (row) row.click(); // else it already shows its answer
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

// ------------------------------------------------------------------ settings dialog

const settingsDialog = $("#settings");
const koreanOnlyBox = $("#set-korean-only");

/** Saves the setting and redraws the current page with it. */
function setKoreanOnly(on) {
  saveSetting("koreanOnly", on);
  koreanOnlyBox.checked = on;
  lastRouted = null;
  routeOnce();
}

const bottomBarBox = $("#set-bottom-bar");
const applyBottomBar = () => document.body.classList.toggle("bottom-bar", settings.bottomBar);
applyBottomBar();
bottomBarBox.addEventListener("change", () => {
  saveSetting("bottomBar", bottomBarBox.checked);
  document.body.classList.remove("keep-gap");
  // Turning it on over a results list moves the bar down now: keep its room at the top
  // too, as when typing ends (measured while the bar is still at the top).
  if (settings.bottomBar && document.activeElement !== input) keepGap();
  applyBottomBar();
});

$("#settings-btn").addEventListener("click", () => {
  koreanOnlyBox.checked = showOd();
  bottomBarBox.checked = settings.bottomBar;
  settingsDialog.showModal();
});
koreanOnlyBox.addEventListener("change", () => setKoreanOnly(koreanOnlyBox.checked));
// A tap on the backdrop (outside the box) closes it too.
settingsDialog.addEventListener("click", (e) => e.target === settingsDialog && settingsDialog.close());

Dict.init().catch(() => {});
routeOnce();
updateBar();
// Empty home: put the cursor in the search box. Not on phones — focusing there
// would move the bar to the top and may pop the keyboard unasked.
if (document.body.classList.contains("idle") && !phone.matches) input.focus({ preventScroll: true });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ------------------------------------------------------------------ version check
// The update light is shared by Alex's Pages sites (github.com/alexknight0/pages-common).
// sw.js keeps a copy of it for offline use. Updating fetches every shell file past the HTTP
// cache; those requests go through the service worker (network-first), which stores the
// fresh copies, so the reload can't pick up stale ones.
let versionStatusTimer;
import("https://cdn.jsdelivr.net/gh/alexknight0/pages-common@1.0.0/update.js")
  .then(({ initUpdateLight }) => initUpdateLight({
    version: VERSION,
    buttons: "#version",
    serviceWorker: true,
    report(text) {
      clearTimeout(versionStatusTimer);
      setStatus(text);
      versionStatusTimer = setTimeout(() => statusEl.textContent === text && setStatus(""), 4000);
    },
    beforeUpdate() {
      clearTimeout(versionStatusTimer);
      if (statusEl.textContent === $("#version").title) setStatus("");
    },
  }))
  .catch((e) => {
    console.warn("update light:", e);
    for (const b of document.querySelectorAll(".version")) {
      b.dataset.state = "unknown";
      b.title = "Couldn't load the update check (offline?).";
    }
  });
