// "Ask AI" for searches that find nothing: Gemini guesses which word was meant
// (typo, misremembered spelling, conjugated form, romanisation, wrong keyboard layout).
//
// Sign-in and the Gemini API key use the Netflix Dual Subs extension's Firebase project
// (dual-subs-2b0407), so a key saved by either is used by both:
//   users/{uid}/settings/geminiKey  { value: JSON string, updated }
// Its Firestore rules only let Alex's account read/write its own users/{uid}.
// app.js imports this module lazily (when an Ask AI row is shown), so the Firebase SDK
// never loads for ordinary lookups.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore-lite.js";

const firebaseConfig = {
  apiKey: "AIzaSyAwUezOndGsztkWGH00Z-PqNRUnyZHouHU", // public by design; rules enforce access
  authDomain: "dual-subs-2b0407.firebaseapp.com",
  projectId: "dual-subs-2b0407",
  appId: "1:729739067887:web:134e9a9668a73c6b69f61a",
};
// A named app, so the sign-in is stored under its own localStorage key
// (firebase:authUser:<apiKey>:korean-dict) and not shared with other pages on the origin.
const app = initializeApp(firebaseConfig, "korean-dict");
const auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
const db = getFirestore(app);

// Fast flash-lite models. On a quota (429), missing model (404), overload (5xx) or a
// reply slower than MODEL_TIMEOUT_MS, try the next. 3.1 first: on 2026-11-04,
// gemini-3.5-flash-lite (the extension's first choice) took 20-30 s per reply while
// 3.1 took 1-3 s with equally good answers (~/.tmp/korean-dict-ai/define-variants.mjs).
const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];
const MODEL_TIMEOUT_MS = 15000; // the last model gets LAST_MODEL_TIMEOUT_MS
const LAST_MODEL_TIMEOUT_MS = 60000;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
const SUGGESTION_LIMIT = 5;
const CACHE_KEY = "korean-dict-ai"; // localStorage {query: {suggestions, model, at}}
const CACHE_MAX = 100;

export class BadKeyError extends Error {
  name = "BadKeyError";
}

/** The signed-in user, or null (waits for the stored sign-in to load). */
export async function currentUser() {
  await auth.authStateReady();
  return auth.currentUser;
}

/** Google sign-in popup. Call from a tap (popups need a user gesture). */
export async function signIn() {
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  return user;
}

const keyDoc = (uid) => doc(db, "users", uid, "settings", "geminiKey");
let cachedKey = null;

/** The Gemini key saved to the account, or null. */
export async function getKey(user) {
  if (cachedKey) return cachedKey;
  const snap = await getDoc(keyDoc(user.uid));
  try {
    cachedKey = snap.exists() ? JSON.parse(snap.data().value) || null : null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

export async function saveKey(user, key) {
  await setDoc(keyDoc(user.uid), { value: JSON.stringify(key), updated: serverTimestamp() });
  cachedKey = key;
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

/** A previous answer for this query and mode ("spell" | "define"), or null. */
export function cached(query, mode = "spell") {
  return readCache()[cacheKey(query, mode)] || null;
}

// Spelling answers keep the plain query as key (cached before modes existed).
const cacheKey = (query, mode) => (mode === "spell" ? query.trim() : mode + ":" + query.trim());

function store(key, answer) {
  const cache = readCache();
  cache[key] = { ...answer, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].at - cache[b].at);
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

const isLatin = (query) => /^[a-z\s'.,-]+$/i.test(query);

/** "Did I misspell it?": the dictionary words that were probably meant. */
export function prompt(query) {
  const latin = isLatin(query);
  return [
    "I'm an English speaker learning Korean. I searched my Korean–English dictionary for this and it found nothing:",
    `"${query}"`,
    "",
    latin
      ? "It is probably an English word or phrase, which I may have misspelled: then suggest the Korean words that " +
        "translate it. It could also be Korean typed in romanisation (e.g. saranghae), or Korean typed with the " +
        "keyboard left in English layout (두벌식 keys: dkssud = 안녕)."
      : "I may have typed the word slightly wrong (a typo, the wrong 받침, ㅐ/ㅔ, ㅓ/ㅗ, a tense/plain consonant mix-up, " +
        "a missing or extra syllable), I may be misremembering how it is spelled, or it may be a conjugated form, " +
        "a phrase, slang or a spoken contraction that the dictionary doesn't list.",
    "",
    `Suggest the Korean dictionary words I most likely meant, most likely first, at most ${SUGGESTION_LIMIT}. ` +
      "Only suggest real words. For each give:",
    "- word: the headword as a Korean dictionary lists it, in Hangul (verbs and adjectives in their 다 form)",
    "- meaning: a short English gloss",
    '- note: at most 6 words on how it relates to what I typed (e.g. "ㅔ, not ㅐ", "past tense", "romanised")',
  ].join("\n");
}

/** "Define it": the word is right but not in the dictionary (slang, new words, names...). */
export function definePrompt(query) {
  return [
    "I'm an English speaker learning Korean. My Korean–English dictionary has no entry for this, and I believe it is " +
      "spelled correctly:",
    `"${query}"`,
    "",
    "It may be slang, internet language, a new word, an abbreviation, a loanword, a dialect word, a proper noun, " +
      "a set phrase, or a conjugated form of a word." +
      (isLatin(query) ? " It may also be Korean typed in romanisation." : ""),
    "",
    "If you know it as something Korean speakers actually say or write, explain it:",
    "- word: the form it is usually written in, in Hangul (verbs and adjectives in their 다 form)",
    "- pos: its part of speech in English (e.g. noun, verb, expression)",
    "- meaning: its meaning in plain English, under 60 words; mention the register (slang, formal, dated...) " +
      "and any other meanings",
    "- examples: 3 natural example sentences that use it, each with an English translation",
    "- origin: where it comes from, under 50 words (hanja with their meanings, the source language of a loanword, " +
      "what an abbreviation is short for, how the slang arose). If you are unsure of the origin, say so.",
    "",
    "Do not invent a meaning. If you don't recognise it as a real word or expression, set known to false and " +
      "leave the other fields empty.",
  ].join("\n");
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    suggestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { word: { type: "STRING" }, meaning: { type: "STRING" }, note: { type: "STRING" } },
        required: ["word", "meaning"],
      },
    },
  },
  required: ["suggestions"],
};

const DEFINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    known: { type: "BOOLEAN" },
    word: { type: "STRING" },
    pos: { type: "STRING" },
    meaning: { type: "STRING" },
    examples: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { ko: { type: "STRING" }, en: { type: "STRING" } }, required: ["ko", "en"] },
    },
    origin: { type: "STRING" },
  },
  required: ["word", "known"],
  // word before known: asked for "known" first, the model often answered false for real slang.
  propertyOrdering: ["word", "known", "pos", "meaning", "examples", "origin"],
};

/** Gemini's JSON reply for a prompt: {data, model}. Falls through the models (see
    GEMINI_MODELS); onRetry(message) is called before each fallback. */
async function generate(text, schema, key, onRetry = () => {}) {
  let lastError = null;
  for (const [i, model] of GEMINI_MODELS.entries()) {
    if (lastError) onRetry("Gemini is busy, trying another model…");
    const timeout = i === GEMINI_MODELS.length - 1 ? LAST_MODEL_TIMEOUT_MS : MODEL_TIMEOUT_MS;
    let res;
    try {
      res = await fetch(`${GEMINI_URL}${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text }] }],
          // The token cap stops the occasional reply that repeats itself until it is cut off.
          generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens: 1500, temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (err.name !== "TimeoutError") throw new Error("Couldn't reach Gemini (offline?)");
      lastError = `${model} took longer than ${timeout / 1000} s`;
      console.warn("Gemini", lastError);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const reply = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      try {
        return { data: JSON.parse(reply), model };
      } catch {
        lastError = `${model} gave no answer (${body.candidates?.[0]?.finishReason || "unreadable reply"})`;
        console.warn("Gemini", lastError);
        continue;
      }
    }
    const message = body.error?.message || `HTTP ${res.status}`;
    if (/api key/i.test(message) || res.status === 401 || res.status === 403) throw new BadKeyError(message);
    lastError = `${model}: ${message}`;
    console.warn("Gemini", lastError);
    if (res.status !== 429 && res.status !== 404 && res.status < 500) break; // other models won't help
  }
  throw new Error(/busy|demand|longer than/i.test(lastError) ? "Gemini is overloaded right now. Try again in a minute." : lastError);
}

/** Gemini's guesses for a query: {suggestions: [{word, meaning, note?}], model}. */
export async function suggest(query, key, onRetry) {
  query = query.trim();
  const hit = cached(query, "spell");
  if (hit) return hit;
  const { data, model } = await generate(prompt(query), SCHEMA, key, onRetry);
  const answer = {
    suggestions: (data.suggestions || []).filter((s) => s && s.word).slice(0, SUGGESTION_LIMIT),
    model,
  };
  store(cacheKey(query, "spell"), answer);
  return answer;
}

/** Gemini's explanation of a word the dictionary lacks:
    {known, word?, pos?, meaning?, examples: [{ko, en?}], origin?, model}. */
export async function define(query, key, onRetry) {
  query = query.trim();
  const hit = cached(query, "define");
  if (hit) return hit;
  const { data, model } = await generate(definePrompt(query), DEFINE_SCHEMA, key, onRetry);
  const clean = (s) => (typeof s === "string" ? s.trim() : "");
  const answer = {
    known: data.known === true && !!clean(data.meaning),
    word: clean(data.word) || query,
    pos: clean(data.pos),
    meaning: clean(data.meaning),
    examples: (data.examples || []).filter((x) => x && clean(x.ko)).map((x) => ({ ko: clean(x.ko), en: clean(x.en) })),
    origin: clean(data.origin),
    model,
  };
  store(cacheKey(query, "define"), answer);
  return answer;
}
