// Rule-based Korean deinflection: turns a conjugated or particle-marked form
// into candidate dictionary forms (먹었는데 -> 먹다, 추워요 -> 춥다,
// 학교에서 -> 학교). It over-generates on purpose; the caller keeps only the
// candidates that exist as headwords.
"use strict";

const Deinflect = (() => {
  const BASE = 0xac00;
  // Final consonant (받침) indices
  const T = { none: 0, ㄴ: 4, ㄷ: 7, ㄹ: 8, ㅁ: 16, ㅂ: 17, ㅅ: 19, ㅆ: 20, ㅎ: 27 };
  // Vowel indices
  const V = { ㅏ: 0, ㅐ: 1, ㅑ: 2, ㅒ: 3, ㅓ: 4, ㅕ: 6, ㅗ: 8, ㅘ: 9, ㅙ: 10, ㅚ: 11, ㅜ: 13, ㅝ: 14, ㅡ: 18, ㅣ: 20 };
  const L_IEUNG = 11; // ㅇ
  const L_RIEUL = 5; // ㄹ
  const L_HIEUH = 18; // ㅎ

  const isSyl = (c) => c >= BASE && c <= 0xd7a3;
  const split = (ch) => {
    const n = ch.codePointAt(0) - BASE;
    return { l: Math.floor(n / 588), v: Math.floor((n % 588) / 28), t: n % 28 };
  };
  const join = ({ l, v, t }) => String.fromCharCode(BASE + l * 588 + v * 28 + t);

  const last = (s) => (s && isSyl(s.charCodeAt(s.length - 1)) ? split(s[s.length - 1]) : null);
  const init = (s) => s.slice(0, -1);
  const withLast = (s, patch) => init(s) + join({ ...last(s), ...patch });

  // A pattern like "*ㄴ다" means: the previous syllable carries final ㄴ, then 다.
  // Returns the remaining base, or null when `word` doesn't end with `pattern`.
  function strip(word, pattern) {
    if (!pattern.startsWith("*")) {
      return word.length > pattern.length && word.endsWith(pattern)
        ? word.slice(0, -pattern.length)
        : null;
    }
    const fin = T[pattern[1]];
    const rest = pattern.slice(2);
    if (!word.endsWith(rest)) return null;
    const head = word.slice(0, word.length - rest.length);
    const s = last(head);
    if (!s || s.t !== fin) return null;
    return withLast(head, { t: 0 });
  }

  // Endings attached directly to a stem (or to 시/겠/었 forms).
  const STEM_ENDINGS = [
    "습니다", "습니까", "습니다만", "는데요", "는데", "는다고", "는다", "는구나", "는군요", "는군",
    "는지", "느냐", "는", "지만", "지요", "죠", "지", "고요", "고", "게요", "게", "기에", "기로",
    "기", "네요", "네", "구나", "군요", "군", "거나", "거든요", "거든", "든지", "다가", "다고",
    "다면", "다", "던데", "던", "더라", "자고", "자", "잖아요", "잖아", "냐", "니", "나",
  ];
  // Endings with an optional 으 after a consonant-final stem; "*ㄴ" etc. attach as 받침.
  const STEM_V_ENDINGS = [
    "*ㅂ니다", "*ㅂ니까", "*ㄴ다고", "*ㄴ다", "*ㄴ데요", "*ㄴ데", "*ㄴ지", "*ㄹ게요", "*ㄹ게",
    "*ㄹ까요", "*ㄹ까", "*ㄹ래요", "*ㄹ래", "*ㄹ지", "*ㄹ수록", "*ㄴ", "*ㄹ", "*ㅁ",
    "면서", "면", "니까", "니", "러", "려고", "려면", "려", "세요", "셔요", "십시오", "므로", "마",
  ];
  const WITH_EU = (e) =>
    e.startsWith("*")
      ? ["으" + e.slice(0, 2).replace("*", "") + e.slice(2)].map((x) => {
          // 으 + 받침 ending: 으ㄴ -> 은, 으ㄹ -> 을, 으ㅁ -> 음, 으ㅂ니다 -> 읍니다 (archaic, skip)
          const fin = T[x[1]];
          return join({ l: L_IEUNG, v: V.ㅡ, t: fin }) + x.slice(2);
        })
      : ["으" + e];
  // Endings after the 아/어 form.
  const EO_ENDINGS = ["서요", "서", "도", "야지", "야", "요", "라", "다가", "버리다", "주세요", "줘"];

  // Noun particles (and the copula), longest first when stripping.
  const PARTICLES = [
    "에서부터", "에게서", "한테서", "으로부터", "로부터", "에서는", "에서도", "에게는", "에게도",
    "으로는", "로는", "으로도", "로도", "까지는", "까지도", "부터는", "이라도", "이라고", "라고",
    "이에요", "예요", "입니다", "이었어요", "였어요", "이었다", "였다", "이야", "이고", "이지만",
    "인데", "이랑", "랑", "에서", "에게", "한테", "께서", "께", "으로", "로", "까지", "부터",
    "보다", "처럼", "같이", "마다", "만큼", "이나", "나", "하고", "와", "과", "은", "는", "이",
    "가", "을", "를", "에", "의", "도", "만", "요", "야",
  ];

  // Undo the 아/어 contraction: returns possible stems for an 어-form.
  function eoStems(w) {
    const out = [];
    const s = last(w);
    if (!s) return out;
    const prev = w.length > 1 ? last(init(w)) : null;
    // separate 아/어/여 syllable: 먹어 -> 먹, 하여 -> 하, 들어 -> 듣, 나아 -> 낫
    if (s.l === L_IEUNG && s.t === 0 && [V.ㅏ, V.ㅓ, V.ㅕ].includes(s.v) && w.length > 1) {
      const stem = init(w);
      out.push(stem);
      if (prev && prev.t === T.ㄹ) out.push(withLast(stem, { t: T.ㄷ }));
      if (prev && prev.t === 0) out.push(withLast(stem, { t: T.ㅅ }));
    }
    // 워/와 -> ㅂ irregular: 추워 -> 춥, 도와 -> 돕
    if (s.l === L_IEUNG && s.t === 0 && (s.v === V.ㅝ || s.v === V.ㅘ) && prev && prev.t === 0) {
      out.push(withLast(init(w), { t: T.ㅂ }));
    }
    // 르 irregular: 몰라 -> 모르, 불러 -> 부르
    if (s.l === L_RIEUL && s.t === 0 && (s.v === V.ㅏ || s.v === V.ㅓ) && prev && prev.t === T.ㄹ) {
      out.push(withLast(init(w), { t: 0 }) + "르");
    }
    // 러 irregular: 이르러 -> 이르
    if (s.l === L_RIEUL && s.t === 0 && s.v === V.ㅓ && w.length > 1) out.push(init(w));
    if (s.t !== 0) return out;
    // contracted vowels
    const map = {
      [V.ㅏ]: [V.ㅏ, V.ㅡ], // 가 -> 가, 아파 -> 아프
      [V.ㅓ]: [V.ㅓ, V.ㅡ], // 서 -> 서, 써 -> 쓰
      [V.ㅐ]: [V.ㅐ], // 보내 -> 보내
      [V.ㅔ]: [V.ㅔ],
      [V.ㅘ]: [V.ㅗ], // 봐 -> 보
      [V.ㅝ]: [V.ㅜ], // 줘 -> 주
      [V.ㅙ]: [V.ㅚ], // 돼 -> 되
      [V.ㅕ]: [V.ㅣ], // 켜 -> 키, 셔 -> 시
    };
    for (const v of map[s.v] || []) out.push(withLast(w, { v }));
    if (s.v === V.ㅐ && s.l === L_HIEUH) out.push(withLast(w, { v: V.ㅏ })); // 해 -> 하
    if (s.v === V.ㅐ) {
      // ㅎ irregular: 그래 -> 그렇, 파래 -> 파랗
      out.push(withLast(w, { v: V.ㅓ, t: T.ㅎ }), withLast(w, { v: V.ㅏ, t: T.ㅎ }));
    }
    if (s.v === V.ㅒ) out.push(withLast(w, { v: V.ㅑ, t: T.ㅎ })); // 하얘 -> 하얗
    return out;
  }

  // Irregular stems for a base that preceded a 으-alternating ending.
  function vStems(base, usedEu) {
    const out = [base];
    const s = last(base);
    if (!s) return out;
    if (usedEu) {
      if (s.t === T.ㄹ) out.push(withLast(base, { t: T.ㄷ })); // 들으면 -> 듣
      if (s.t === 0) out.push(withLast(base, { t: T.ㅅ })); // 나으면 -> 낫
    } else {
      if (s.t === 0) {
        out.push(withLast(base, { t: T.ㄹ })); // 사세요 -> 살
        out.push(withLast(base, { t: T.ㅎ })); // 그러면, 그런 -> 그렇
      }
      if (s.l === L_IEUNG && s.v === V.ㅜ && s.t === 0 && base.length > 1 && last(init(base)).t === 0) {
        out.push(withLast(init(base), { t: T.ㅂ })); // 추우면, 추운 -> 춥
      }
    }
    return out;
  }

  // Pre-final endings: 겠, 었 (as ㅆ on the 어-form), 시/으시.
  function preStems(base, depth, add) {
    if (depth > 4 || !base) return;
    let b;
    if ((b = strip(base, "겠"))) preStems(b, depth + 1, add);
    const s = last(base);
    if (s && s.t === T.ㅆ) {
      // 먹었 -> 먹어, 했 -> 해, 갔 -> 가
      for (const st of eoStems(withLast(base, { t: 0 }))) preStems(st, depth + 1, add);
    }
    if ((b = strip(base, "으시"))) for (const st of vStems(b, true)) preStems(st, depth + 1, add);
    if ((b = strip(base, "시"))) for (const st of vStems(b, false)) preStems(st, depth + 1, add);
    add(base);
  }

  function verbCandidates(word) {
    const stems = new Set();
    const add = (st) => st && stems.add(st);
    // bare 어-form, or 어-form + ending
    for (const st of eoStems(word)) preStems(st, 0, add);
    for (const e of EO_ENDINGS) {
      const b = strip(word, e);
      if (b) for (const st of eoStems(b)) preStems(st, 0, add);
    }
    // 았어/었어: the 어 syllable after a ㅆ form
    for (const e of ["어요", "어", "어서", "어도"]) {
      const b = strip(word, e);
      if (b) preStems(b, 0, add);
    }
    for (const e of STEM_ENDINGS) {
      const b = strip(word, e);
      if (!b) continue;
      preStems(b, 0, add);
      // ㄹ drops before ㄴ/ㅅ/ㅂ: 사는 -> 살, 아니 -> 알
      const s = last(b);
      if (s && s.t === 0 && /^[는니네나냐느]/.test(e)) preStems(withLast(b, { t: T.ㄹ }), 0, add);
    }
    for (const e of STEM_V_ENDINGS) {
      const b = strip(word, e);
      if (b) for (const st of vStems(b, false)) preStems(st, 0, add);
      for (const eu of WITH_EU(e)) {
        const b2 = strip(word, eu);
        if (b2) for (const st of vStems(b2, true)) preStems(st, 0, add);
      }
    }
    return [...stems].filter((s) => s !== word).map((s) => s + "다");
  }

  function nounCandidates(word) {
    const out = [];
    for (const p of PARTICLES) {
      const b = word.length > p.length ? word.slice(0, -p.length) : null;
      if (b && word.endsWith(p)) out.push(b);
    }
    // "*ㄴ" / "*ㄹ" contracted particles: 난 -> 나는, 날 -> 나를
    const s = last(word);
    if (s && (s.t === T.ㄴ || s.t === T.ㄹ)) out.push(withLast(word, { t: 0 }));
    return out;
  }

  /** Candidate dictionary keys for `word`, most specific first, without `word` itself. */
  function candidates(word) {
    if (!word || !/^[\uac00-\ud7a3]+$/.test(word)) return [];
    const seen = new Set([word]);
    const out = [];
    for (const c of [...verbCandidates(word), ...nounCandidates(word)]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    // 하다 verbs as nouns: 공부했어요 -> 공부하다 -> 공부
    for (const c of [...out]) {
      if (c.endsWith("하다") && c.length > 2 && !seen.has(c.slice(0, -2))) {
        seen.add(c.slice(0, -2));
        out.push(c.slice(0, -2));
      }
    }
    return out;
  }

  return { candidates };
})();

if (typeof module !== "undefined") module.exports = Deinflect;
