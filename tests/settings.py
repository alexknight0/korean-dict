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
        print("1/5 default off:", r_off[:6], "| doctor:", en_off[:3], "|", head_off)

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
        print("2/5 ticked:", len(r_off), "->", len(r_on), "results")

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
        print("3/5 on after reload: 우리말샘 sections, root page, all hanja words |", page.inner_text("#entry h2"))

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
        print("4/5 'Show Korean-only dictionaries' link, untick, backdrop closes")

        # 5. Search bar position: top on phones by default; with "Search bar at the bottom"
        # it rests at the bottom, and when it drops back down after typing the results
        # stay where they were (no jump up).
        page.evaluate("localStorage.removeItem('korean-dict-settings')")
        page.goto(base + "#")
        page.reload()
        page.wait_for_selector("#settings-btn")
        assert page.locator("header").bounding_box()["y"] == 0  # default: top
        page.fill("#q", "먹")
        page.wait_for_selector("#results ul.results li a")
        y0 = page.locator("#results ul.results li").first.bounding_box()["y"]
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)
        assert page.locator("header").bounding_box()["y"] == 0
        assert page.locator("#results ul.results li").first.bounding_box()["y"] == y0
        page.click("#settings-btn")
        assert not page.is_checked("#set-bottom-bar")
        page.check("#set-bottom-bar")
        page.click("#settings .btn")
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box  # now at the bottom
        # turning it on over results keeps the bar's room at the top (no jump)
        yon = page.locator("#results ul.results li").first.bounding_box()["y"]
        assert abs(yon - y0) < 1, (y0, yon, page.evaluate("document.body.className"))
        page.focus("#q")
        page.wait_for_timeout(100)
        assert page.locator("header").bounding_box()["y"] < 5  # top while typing
        y1 = page.locator("#results ul.results li").first.bounding_box()["y"]
        page.keyboard.press("Enter")  # blur: bar drops to the bottom
        page.wait_for_timeout(200)
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box
        y2 = page.locator("#results ul.results li").first.bounding_box()["y"]
        assert abs(y2 - y1) < 1, (y1, y2)  # the list didn't move
        # the gap holds the two Ask AI shortcuts side by side
        chips = page.locator("#gap-bar .ai-chip")
        assert chips.all_inner_texts() == ["✦ Did I misspell it?", "✦ Define it"], chips.all_inner_texts()
        b1, b2 = chips.nth(0).bounding_box(), chips.nth(1).bounding_box()
        assert abs(b1["y"] - b2["y"]) < 1 and b1["x"] + b1["width"] <= b2["x"], (b1, b2)
        page.screenshot(path="/tmp/korean-dict-gap-chips.png")
        page.route("https://www.gstatic.com/**", lambda r: r.abort())  # no real sign-in from the test
        chips.nth(1).click()
        page.wait_for_function("() => !document.querySelector('.ai-define .ask-ai')")  # the define option started
        page.wait_for_function("() => { const r = document.querySelector('.ai-define').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }")
        page.unroute("https://www.gstatic.com/**")
        errors[:] = [e for e in errors if "ERR_FAILED" not in e and "Failed to fetch dynamically imported module" not in e]
        page.wait_for_timeout(800)  # let the smooth scroll finish
        page.evaluate("scrollTo(0, 0)")
        page.focus("#q")
        page.wait_for_timeout(100)
        y3 = page.locator("#results ul.results li").first.bounding_box()["y"]
        assert abs(y3 - y1) < 1, (y1, y3, page.evaluate("[document.body.className, scrollY, document.activeElement.id]"))  # nor when it comes back up
        # Enter while the keyboard is open: the bar waits at the top until the keyboard has
        # closed (viewport back to full height), then moves in one step.
        page.set_viewport_size({"width": 390, "height": 500})  # keyboard opens
        page.wait_for_timeout(100)
        page.keyboard.press("Enter")
        page.wait_for_timeout(100)
        assert page.locator("header").bounding_box()["y"] < 5, "moved before the keyboard closed"
        page.set_viewport_size({"width": 390, "height": 700})  # closing animation, part way
        page.wait_for_timeout(50)
        assert page.locator("header").bounding_box()["y"] < 5, "moved mid-animation"
        page.set_viewport_size({"width": 390, "height": 844})  # closed
        page.wait_for_timeout(50)
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box
        assert abs(page.locator("#results ul.results li").first.bounding_box()["y"] - y1) < 1
        # if the viewport never grows back (no resize event), it still moves after a while
        page.focus("#q")
        page.set_viewport_size({"width": 390, "height": 500})
        page.wait_for_timeout(100)
        page.keyboard.press("Enter")
        page.wait_for_timeout(1000)
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 500) < 2, box
        page.set_viewport_size({"width": 390, "height": 844})
        page.focus("#q")
        page.wait_for_timeout(100)
        page.keyboard.press("Enter")
        page.click("#results ul.results li a >> nth=0")
        page.wait_for_selector("#entry h1")
        assert not page.evaluate("document.body.classList.contains('keep-gap')")  # entry page: no gap
        assert page.evaluate("JSON.parse(localStorage.getItem('korean-dict-settings')).bottomBar") is True
        print(f"5/5 bar top by default; bottom-bar setting: list stays at y={y1:.0f} when the bar drops and returns")

        browser.close()
    assert not errors, errors
    print("all ok")


if __name__ == "__main__":
    main()
