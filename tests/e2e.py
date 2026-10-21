"""End-to-end smoke test with Playwright (Chromium).

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/e2e.py [base_url]
Without base_url it serves the repo on http://127.0.0.1:8766/.
"""

import functools
import http.server
import sys
import threading

from playwright.sync_api import expect, sync_playwright

PORT = 8766


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=".")
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{PORT}/"


def results(page):
    return page.locator("#results ul.results li .hw").all_inner_texts()


def type_query(page, text):
    page.fill("#q", text)
    page.wait_for_timeout(150)
    page.wait_for_function("() => document.querySelector('#results').children.length > 0")
    page.wait_for_load_state("networkidle")


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(base)
        expect(page.locator(".hint")).to_be_visible()
        print("1/7 home ok")

        type_query(page, "먹다")
        r = results(page)
        assert r and r[0] == "먹다", r
        gloss = page.locator("#results li .gloss").first.inner_text()
        assert "eat" in gloss, gloss
        print("2/7 exact search ok:", r[:5], gloss)

        type_query(page, "먹었는데")
        bases = page.locator("ul.bases .hw").all_inner_texts()
        assert "먹다" in bases, bases
        print("3/7 deinflection ok:", bases)

        type_query(page, "추워요")
        bases = page.locator("ul.bases .hw").all_inner_texts()
        assert "춥다" in bases, bases
        print("   추워요 ->", bases)

        type_query(page, "doctor")
        r = results(page)
        assert "의사" in r[:5], r
        print("4/7 english ok:", r[:5])

        type_query(page, "대")
        r = results(page)
        assert len(r) > 20, r
        print("5/7 single-syllable prefix ok:", r[:8])

        type_query(page, "먹다")
        page.click("#results li a >> nth=0")
        page.wait_for_selector("#entry h1")
        page.wait_for_load_state("networkidle")
        assert page.inner_text("#entry h1") == "먹다"
        assert page.locator(".source.kr .en").count() > 0
        assert page.locator(".source.od details.word").count() > 0
        assert page.locator(".source.od ul.ex b").count() > 0
        print("6/7 entry ok:", page.locator(".source.kr .en").first.inner_text()[:60])

        link = page.locator(".source.od dl.rel a").first
        target = link.inner_text()
        link.click()
        page.wait_for_function("t => document.querySelector('#entry h1')?.textContent.startsWith(t.replace(/\\d+$/, ''))", arg=target)
        page.go_back()
        page.wait_for_function("() => document.querySelector('#entry h1')?.textContent === '먹다'")
        page.go_back()
        page.wait_for_function("() => !document.querySelector('#results').hidden")
        print("7/7 relation link + back ok:", target)

        page.screenshot(path="/tmp/korean-dict-results.png")
        page.goto(base + "#w=" + "가다")
        page.wait_for_selector("#entry h1")
        page.wait_for_load_state("networkidle")
        page.screenshot(path="/tmp/korean-dict-entry.png", full_page=False)
        browser.close()

    assert not errors, errors
    print("all passed")


if __name__ == "__main__":
    main()
