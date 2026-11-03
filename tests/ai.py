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
            key = req.headers.get("x-goog-api-key")
            prompt = json.loads(req.post_data)["contents"][0]["parts"][0]["text"]
            gemini.append((key, prompt))
            if key == "bad":
                return route.fulfill(status=400, json={"error": {"message": "API key not valid. Please pass a valid API key."}})
            answer = {"suggestions": [
                {"word": "먹다", "meaning": "to eat", "note": "past tense"},
                {"word": "없는낱말", "meaning": "made up", "note": "test"},
            ]}
            page.wait_for_timeout(300)  # so the spinner can be seen
            route.fulfill(json={"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})

        page.route("https://generativelanguage.googleapis.com/**", fake_gemini)

        # 1. A search with results has no Ask AI row; one without has it last.
        page.goto(base + "#q=먹")
        page.wait_for_selector("#results ul.results li")
        assert page.locator(".ask-ai").count() == 0
        page.goto(base + "#q=먹엇다")
        page.wait_for_selector(".ask-ai")
        assert "No results." in page.locator("#results").inner_text()
        assert page.locator("#results > *").last.locator(".ask-ai").count() == 1
        page.screenshot(path="/tmp/korean-dict-ai-row.png")
        print("1/6 Ask AI row only when nothing is found")

        # 2. Closing the sign-in popup puts the row back.
        page.evaluate("sessionStorage.setItem('fake', JSON.stringify({closePopup: true}))")
        page.click(".ask-ai")
        page.wait_for_selector(".ask-ai")
        assert fake_state(page)["signIns"] == 1 and not gemini
        page.evaluate("sessionStorage.removeItem('fake')")
        print("2/6 cancelled sign-in -> row back")

        # 3. First tap: sign in, no key yet -> key form. A rejected key shows the error and the form again.
        page.click(".ask-ai")
        page.wait_for_selector(".ai-key")
        assert fake_state(page)["signIns"] == 1
        assert page.evaluate("document.activeElement.classList.contains('ai-key')")
        page.screenshot(path="/tmp/korean-dict-ai-key.png")
        assert "null" not in page.locator(".ai").inner_text()
        page.fill(".ai-key", "bad")
        page.press(".ai-key", "Enter")
        page.wait_for_selector("text=Gemini didn't accept the key")
        assert page.locator(".ai-key").count() == 1
        print("3/6 key form, bad key rejected")

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
        assert "not in this dictionary" in page.locator(".ai-results .missing").inner_text()
        assert "Gemini" in page.locator(".ai-credit").inner_text()
        page.screenshot(path="/tmp/korean-dict-ai-results.png")
        print("4/6 key saved to account, suggestions linked to entries")

        # 5. Open a suggestion and come back: the answer is reused without asking again.
        calls = len(gemini)
        link.click()
        page.wait_for_selector("#entry h1")
        page.go_back()
        page.wait_for_selector(".ai-results")
        assert len(gemini) == calls
        print("5/6 back -> cached answer, no new Gemini call")

        # 6. After a reload (still signed in, key in the account) a new query goes straight to Gemini.
        page.reload()
        page.goto(base + "#q=겐찬아")
        page.wait_for_selector(".ask-ai")
        page.click(".ask-ai")
        page.wait_for_selector(".ai-results")
        assert fake_state(page)["signIns"] == 1 and page.locator(".ai-key").count() == 0
        assert gemini[-1][0] == "good" and '"겐찬아"' in gemini[-1][1]
        page.goto(base + "#q=docter")
        page.click(".ask-ai")
        page.wait_for_selector(".ai-results")
        assert "translate" in gemini[-1][1]  # English prompt variant
        print("6/6 later taps reuse the account's key (Hangul and English queries)")

        browser.close()
    errors = [e for e in errors if "status of 400" not in e]  # the deliberately rejected key
    assert not errors, errors
    print("all ok")


if __name__ == "__main__":
    main()
