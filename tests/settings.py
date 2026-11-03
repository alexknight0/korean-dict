"""Settings dialog: "Show Korean-only dictionaries" (default off).

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/settings.py
Serves the repo on http://127.0.0.1:8768/.
"""

import functools
import http.server
import threading

from playwright.sync_api import sync_playwright

PORT = 8768


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=".")
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{PORT}/"


def hws(page):
    return page.locator("#results ul.results li .hw").all_inner_texts()


def search(page, base, q, ready):
    page.goto(base + "#q=" + q)
    page.wait_for_function(ready)
    page.wait_for_load_state("networkidle")
    return hws(page)


def main():
    base = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        any_result = "() => document.querySelector('#results ul.results li, #results .hint')"

        # 1. Default (off): only 기초사전 words in search results; entry pages lack 우리말샘.
        page.goto(base)
        page.wait_for_selector("#settings-btn")
        r_off = search(page, base, "먹", any_result)
        assert r_off and "먹" in r_off and "먹다" in r_off, r_off
        en_off = search(page, base, "doctor", any_result)
        assert "의사" in en_off[:5], en_off
        page.goto(base + "#w=음악")
        page.wait_for_selector(".source.kr")
        page.wait_for_load_state("networkidle")
        assert page.locator(".group.for-ko").count() == 0 and page.locator(".source.od").count() == 0
        assert page.locator(".hanja-word").count() >= 1
        page.goto(base + "#w=기특")  # 우리말샘-only root page
        page.wait_for_selector(".od-hidden")
        assert page.locator(".source.root").count() == 0
        page.goto(base + "#h=大")
        page.wait_for_selector("ul.hanja-words li")
        n_off = len(page.locator("ul.hanja-words li").all())
        head_off = page.inner_text("#entry h2")
        print("1/4 default off:", r_off[:6], "| doctor:", en_off[:3], "|", head_off)

        # 2. The gear opens Settings; ticking the box redraws the page with 우리말샘.
        page.goto(base + "#q=먹")
        page.wait_for_selector("#results ul.results li")
        page.click("#settings-btn")
        assert page.locator("#settings").is_visible()
        assert not page.is_checked("#set-korean-only")
        page.screenshot(path="/tmp/korean-dict-settings.png")
        page.check("#set-korean-only")
        page.wait_for_function("n => document.querySelectorAll('#results ul.results li').length > n", arg=len(r_off))
        page.click("#settings .btn")
        assert not page.locator("#settings").is_visible()
        r_on = hws(page)
        assert len(r_on) > len(r_off) and set(r_off) <= set(r_on), (r_off, r_on)
        assert page.evaluate("JSON.parse(localStorage.getItem('korean-dict-settings')).koreanOnly") is True
        print("2/4 ticked:", len(r_off), "->", len(r_on), "results")

        # 3. On: the old behaviour (both reader groups, root page, every hanja word).
        page.reload()
        page.goto(base + "#w=음악")
        page.wait_for_selector(".group.for-ko .source.od")
        page.goto(base + "#w=기특")
        page.wait_for_selector(".source.root")
        page.goto(base + "#h=大")
        page.wait_for_selector("ul.hanja-words li")
        num = lambda h: int(h.split(" ")[0].replace(",", ""))
        assert num(page.inner_text("#entry h2")) > num(head_off), (page.inner_text("#entry h2"), head_off)
        print("3/4 on after reload: 우리말샘 sections, root page, all hanja words |", page.inner_text("#entry h2"))

        # 4. The link on a hidden-only page turns the setting on; unticking and a backdrop tap work.
        page.evaluate("localStorage.setItem('korean-dict-settings', JSON.stringify({koreanOnly: false}))")
        page.goto(base + "#w=기특")
        page.reload()
        page.wait_for_selector(".od-hidden button")
        page.click(".od-hidden button")
        page.wait_for_selector(".source.od")
        page.click("#settings-btn")
        assert page.is_checked("#set-korean-only")
        page.uncheck("#set-korean-only")
        page.wait_for_selector(".od-hidden")
        page.mouse.click(5, 5)  # backdrop
        assert not page.locator("#settings").is_visible()
        print("4/4 'Show Korean-only dictionaries' link, untick, backdrop closes")

        browser.close()
    assert not errors, errors
    print("all ok")


if __name__ == "__main__":
    main()
