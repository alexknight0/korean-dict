"""Ask AI (searches with no results) with fake Firebase and a fake Gemini.

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/ai.py
Serves the repo on http://127.0.0.1:8767/. The fake Firebase modules keep their state in
sessionStorage, so a reload keeps the sign-in and the saved key.
"""

import functools
import http.server
import json
import threading

from playwright.sync_api import sync_playwright

PORT = 8767
FB = "https://www.gstatic.com/firebasejs/13.0.0/"

FAKE_APP = "export const initializeApp = () => ({});"
FAKE_AUTH = """
const st = () => JSON.parse(sessionStorage.getItem('fake') || '{}');
const put = (s) => sessionStorage.setItem('fake', JSON.stringify(s));
const auth = { get currentUser() { return st().user || null; }, authStateReady: async () => {} };
export const initializeAuth = () => auth;
export const browserLocalPersistence = {}, browserPopupRedirectResolver = {};
export class GoogleAuthProvider {}
export async function signInWithPopup() {
  const s = st();
  s.signIns = (s.signIns || 0) + 1;
  if (s.closePopup) { put(s); throw Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }); }
  s.user = { uid: 'u1' };
  put(s);
  return { user: s.user };
}
"""
FAKE_FIRESTORE = """
const st = () => JSON.parse(sessionStorage.getItem('fake') || '{}');
const put = (s) => sessionStorage.setItem('fake', JSON.stringify(s));
export const getFirestore = () => ({});
export const doc = (db, ...path) => path.join('/');
export const serverTimestamp = () => 'TS';
export async function getDoc(path) {
  const d = (st().docs || {})[path];
  return { exists: () => !!d, data: () => d };
}
export async function setDoc(path, data) {
  const s = st();
  s.docs = { ...(s.docs || {}), [path]: data };
  put(s);
}
"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=".")
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{PORT}/"


def fake_state(page):
    return page.evaluate("JSON.parse(sessionStorage.getItem('fake') || '{}')")


def main():
    base = serve()
    errors = []
    gemini = []  # (api key, prompt) per call
    models = []  # request URLs (one per model tried)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))

        js = lambda body: (lambda route: route.fulfill(body=body, content_type="text/javascript"))
        page.route(FB + "firebase-app.js", js(FAKE_APP))
        page.route(FB + "firebase-auth.js", js(FAKE_AUTH))
        page.route(FB + "firebase-firestore-lite.js", js(FAKE_FIRESTORE))

        def fake_gemini(route):
            req = route.request
            models.append(req.url)
            key = req.headers.get("x-goog-api-key")
            prompt = json.loads(req.post_data)["contents"][0]["parts"][0]["text"]
            gemini.append((key, prompt))
            if key == "bad":
                return route.fulfill(status=400, json={"error": {"message": "API key not valid. Please pass a valid API key."}})
            if "gemini-3.1-flash-lite" in req.url and "갑분싸" in prompt:
                return route.fulfill(status=503, json={"error": {"message": "This model is currently experiencing high demand."}})
            if "Do not invent" in prompt:  # define it
                answer = {"word": "갑분싸", "known": True, "pos": "expression", "meaning": "the mood suddenly turns awkward",
                          "examples": [{"ko": "농담 하나에 갑분싸가 됐다.", "en": "One joke and the mood died."}],
                          "origin": "Short for 갑자기 분위기 싸해진다."} if "갑분싸" in prompt else {"word": "뷁쀍", "known": False}
                page.wait_for_timeout(300)
                return route.fulfill(json={"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})
            answer = {"suggestions": [
                {"word": "먹다", "meaning": "to eat", "note": "past tense"},
                {"word": "먹다", "meaning": "to go deaf", "note": "same spelling again"},  # same page: dropped
                {"word": "먹었다", "meaning": "ate", "note": "conjugated"},  # opens 먹다 too: dropped
                {"word": "없는낱말", "meaning": "made up", "note": "test"},
            ]}
            page.wait_for_timeout(300)  # so the spinner can be seen
            route.fulfill(json={"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})

        page.route("https://generativelanguage.googleapis.com/**", fake_gemini)

        # 1. Every search ends with an "Ask AI" section (after Headwords etc.); the Firebase
        # SDK only loads once a row is pressed.
        page.goto(base + "#q=먹")
        page.wait_for_selector("#results ul.results li a")
        heads = page.locator("#results h2").all_inner_texts()
        assert heads[-1] == "Ask AI", heads
        assert page.locator("#results > *").last.locator(".ask-ai").count() == 2  # last in the list
        page.goto(base + "#q=먹었는데")
        page.wait_for_selector("ul.bases")
        heads = page.locator("#results h2").all_inner_texts()
        assert heads == ["Dictionary form", "Ask AI"], heads  # 먹었는데: no headwords start with it
        page.goto(base + "#q=먹")
        page.wait_for_selector("#results ul.results li a")
        assert page.locator("#results h2").all_inner_texts() == ["Headwords", "Ask AI"]
        page.goto(base + "#q=doctor")
        page.wait_for_selector("#results ul.results li a")
        assert page.locator("#results h2").all_inner_texts()[-1] == "Ask AI"
        page.goto(base + "#q=먹엇다")
        page.wait_for_selector(".ask-ai")
        assert "No results." in page.locator("#results").inner_text()
        rows = page.locator("#results .ask-ai .ai-title").all_inner_texts()
        assert rows == ["✦ Spellcheck 먹엇다", "✦ Define 먹엇다"], rows
        assert page.get_attribute("#q", "placeholder") == "Search (English / Korean)"
        page.wait_for_load_state("networkidle")
        assert not page.evaluate("performance.getEntriesByType('resource').some(r => r.name.includes('firebase'))")
        page.screenshot(path="/tmp/korean-dict-ai-row.png")
        print("1/8 Ask AI section last in every search; SDK not loaded until pressed")

        # 2. Closing the sign-in popup puts the row back.
        page.evaluate("sessionStorage.setItem('fake', JSON.stringify({closePopup: true}))")
        page.click(".ai-spell .ask-ai")
        page.wait_for_function("() => JSON.parse(sessionStorage.getItem('fake') || '{}').signIns === 1")
        page.wait_for_selector(".ai-spell .ask-ai")
        assert fake_state(page)["signIns"] == 1 and not gemini
        page.evaluate("sessionStorage.removeItem('fake')")
        print("2/8 cancelled sign-in -> row back")

        # 3. First tap: sign in, no key yet -> key form. A rejected key shows the error and the form again.
        page.click(".ai-spell .ask-ai")
        page.wait_for_selector(".ai-key")
        assert fake_state(page)["signIns"] == 1
        assert page.evaluate("document.activeElement.classList.contains('ai-key')")
        page.screenshot(path="/tmp/korean-dict-ai-key.png")
        assert "null" not in page.locator(".ai-options").inner_text()
        page.fill(".ai-key", "bad")
        page.press(".ai-key", "Enter")
        page.wait_for_selector("text=Gemini didn't accept the key")
        assert page.locator(".ai-key").count() == 1
        print("3/8 key form, bad key rejected")

        # 4. A good key is saved to the account (extension's format) and suggestions show.
        page.fill(".ai-key", "good")
        page.click(".ai-key-form .btn")
        page.wait_for_selector(".ai-busy")
        page.wait_for_selector(".ai-results")
        doc = fake_state(page)["docs"]["users/u1/settings/geminiKey"]
        assert doc == {"value": '"good"', "updated": "TS"}, doc
        assert gemini[-1][0] == "good" and '"먹엇다"' in gemini[-1][1] and "slightly wrong" in gemini[-1][1]
        link = page.locator('.ai-results a[href="#w=%EB%A8%B9%EB%8B%A4"]')
        assert link.count() == 1 and "past tense" in link.inner_text()
        assert page.locator(".ai-results li").count() == 2  # one row per page: 먹다 + the missing word
        assert "It found these entries" not in gemini[-1][1]  # nothing found for 먹엇다
        assert "not in this dictionary" in page.locator(".ai-results .missing").inner_text()
        assert "Gemini" in page.locator(".ai-credit").inner_text()
        page.screenshot(path="/tmp/korean-dict-ai-results.png")
        print("4/8 key saved to account, suggestions linked to entries")

        # 5. Open a suggestion and come back: the answer is reused without asking again.
        calls = len(gemini)
        link.click()
        page.wait_for_selector("#entry h1")
        page.go_back()
        page.wait_for_selector(".ai-results")
        assert len(gemini) == calls
        print("5/8 back -> cached answer, no new Gemini call")

        # 6. After a reload (still signed in, key in the account) a new query goes straight to Gemini.
        page.reload()
        page.goto(base + "#q=겐찬아")
        page.wait_for_selector(".ask-ai")
        page.click(".ai-spell .ask-ai")
        page.wait_for_selector(".ai-results")
        assert fake_state(page)["signIns"] == 1 and page.locator(".ai-key").count() == 0
        assert gemini[-1][0] == "good" and '"겐찬아"' in gemini[-1][1]
        page.goto(base + "#q=docter")
        page.click(".ai-spell .ask-ai")
        page.wait_for_selector(".ai-results")
        assert "translate" in gemini[-1][1]  # English prompt variant
        # the words the search found go into the prompt, so Gemini knows which pages exist
        page.goto(base + "#q=시다")
        page.wait_for_selector("#results ul.results li a")
        page.click(".ai-spell .ask-ai")
        page.wait_for_selector(".ai-results")
        p = gemini[-1][1]
        assert "It found these entries: 시다 (sour)" in p and "at most once" in p, p
        print("6/8 later taps reuse the account's key (Hangul and English queries); found words in the prompt")

        # 7. Define it: meaning, examples with the word highlighted, origin; the first model's
        # 503 falls through to the next model.
        page.goto(base + "#q=갑분싸")
        page.wait_for_selector(".ai-define .ask-ai")
        page.click(".ai-define .ask-ai")
        page.wait_for_selector(".ai-def")
        d = page.inner_text(".ai-def")
        assert "expression" in d and "awkward" in d and "One joke" in d and "Origin:" in d and "갑자기" in d, d
        assert page.locator(".ai-def ul.ex mark.hl").all_inner_texts() == ["갑분싸"]
        assert any("gemini-3.1-flash-lite" in u for u in models) and "gemini-flash-lite-latest" in models[-1], models[-2:]
        assert page.locator(".ai-spell .ask-ai").count() == 1  # the other option stays
        assert "Gemini" in page.inner_text(".ai-define .ai-credit")
        page.screenshot(path="/tmp/korean-dict-ai-define.png")
        print("7/8 define: meaning, highlighted example, origin; 503 -> next model")

        # 8. A word Gemini doesn't know: it says so, no made-up meaning.
        page.goto(base + "#q=뷁쀍")
        page.click(".ai-define .ask-ai")
        page.wait_for_selector(".ai-unknown")
        assert "didn't make up a meaning" in page.inner_text(".ai-unknown")
        assert page.locator(".ai-def").count() == 0
        print("8/8 unknown word -> says so")

        browser.close()
    errors = [e for e in errors if "status of 400" not in e and "status of 503" not in e]  # deliberate failures
    assert not errors, errors
    print("all ok")


if __name__ == "__main__":
    main()
