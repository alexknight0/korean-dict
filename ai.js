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

// Same models as the extension: fast flash-lite ones; on a quota (429) or missing
// model (404) try the next.
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"];
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

/** A previous answer for this query, or null. */
export function cached(query) {
  return readCache()[query.trim()] || null;
}

function store(query, answer) {
  const cache = readCache();
  cache[query] = { ...answer, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].at - cache[b].at);
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function prompt(query) {
  const latin = /^[a-z\s'.,-]+$/i.test(query);
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

/** Gemini's guesses for a query: {suggestions: [{word, meaning, note?}], model}. */
export async function suggest(query, key) {
  query = query.trim();
  const hit = cached(query);
  if (hit) return hit;
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const res = await fetch(`${GEMINI_URL}${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt(query) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      let suggestions;
      try {
        suggestions = JSON.parse(text).suggestions;
      } catch {
        throw new Error(`Gemini gave no answer (${body.candidates?.[0]?.finishReason || "unreadable reply"})`);
      }
      const answer = {
        suggestions: (suggestions || []).filter((s) => s && s.word).slice(0, SUGGESTION_LIMIT),
        model,
      };
      store(query, answer);
      return answer;
    }
    const message = body.error?.message || `HTTP ${res.status}`;
    if (/api key/i.test(message) || res.status === 401 || res.status === 403) throw new BadKeyError(message);
    lastError = `${model}: ${message}`;
    console.warn("Gemini", lastError);
    if (res.status !== 429 && res.status !== 404) break; // other models won't help
  }
  throw new Error(lastError);
}
