"""End-to-end smoke test with Playwright (Chromium).

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/e2e.py [base_url]
Without base_url it serves the repo on http://127.0.0.1:8766/.
"""

import functools
import http.server
import sys
import threading

from playwright.sync_api import sync_playwright

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
        page.wait_for_function("document.body.classList.contains('idle')")
        assert page.locator("#results").inner_text().strip() == ""  # no filler text when empty
        assert not page.locator("#credit").is_visible()  # attribution only on entry pages
        page.screenshot(path="/tmp/korean-dict-home.png")
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box  # phone: search bar at bottom
        page.set_viewport_size({"width": 1000, "height": 800})
        assert page.locator("header").bounding_box()["y"] == 0  # desktop: at top
        page.set_viewport_size({"width": 390, "height": 844})
        print("1/7 home ok (bar bottom on phone, top on desktop)")

        type_query(page, "먹다")
        r = results(page)
        assert r and r[0] == "먹다", r
        gloss = page.locator("#results li .gloss").first.inner_text()
        assert "eat" in gloss, gloss
        ys = [b["y"] for b in (l.bounding_box() for l in page.locator("#results ul.results li").all()[:3])]
        assert ys[0] < ys[1] < ys[2], ys  # top-down
        assert page.locator("header").bounding_box()["y"] < 5  # bar moved to the top while searching
        print("2/7 exact search ok (bar at top while searching):", r[:5], gloss)
        # simulate the on-screen keyboard opening then being dismissed
        page.set_viewport_size({"width": 390, "height": 500})
        page.wait_for_timeout(200)
        assert page.evaluate("document.activeElement.id") == "q"
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(200)
        assert page.evaluate("document.activeElement.id") != "q"
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box
        print("   keyboard dismissed -> bar back at the bottom")

        # Enter shows the completion list instead of opening the first match
        page.focus("#q")
        page.fill("#q", "먹")
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.querySelector('#results .hw')?.textContent === '먹'")
        assert page.evaluate("location.hash").startswith("#q="), page.evaluate("location.hash")
        assert page.locator("#entry").is_hidden()
        assert page.evaluate("document.activeElement.id") != "q"  # keyboard closed
        n = len(results(page))
        assert n > 5, n
        page.click("#results li a >> nth=1")
        page.wait_for_selector("#entry h1")
        page.go_back()
        page.wait_for_function("() => !document.querySelector('#results').hidden")
        print(f"   Enter -> list of {n} completions, tap opens, back returns to list")

        # Android IME: Enter while still composing must wait for compositionend, and a
        # keyboard re-committing its text on blur (히히 -> 히히히히) must not win.
        page.focus("#q")
        page.fill("#q", "히히")
        page.evaluate("document.querySelector('#q').dispatchEvent(new CompositionEvent('compositionstart'))")
        page.evaluate("document.querySelector('#search-form').requestSubmit()")
        assert page.evaluate("document.activeElement.id") == "q"  # not blurred mid-composition
        page.evaluate("""() => {
            const q = document.querySelector('#q');
            q.addEventListener('blur', () => { q.value += q.value; q.dispatchEvent(new Event('input')); }, { once: true });
            q.dispatchEvent(new CompositionEvent('compositionend'));
        }""")
        page.wait_for_timeout(400)
        assert page.input_value("#q") == "히히", page.input_value("#q")
        assert page.evaluate("decodeURIComponent(location.hash)") == "#q=히히", page.evaluate("decodeURIComponent(location.hash)")
        assert page.evaluate("document.activeElement.id") != "q"
        print("   Enter while composing: waits, no duplicated text")

        type_query(page, "먹었는데")
        page.wait_for_selector("ul.bases .hw")
        bases = page.locator("ul.bases .hw").all_inner_texts()
        assert "먹다" in bases, bases
        print("3/7 deinflection ok:", bases)

        type_query(page, "추워요")
        page.wait_for_function("() => [...document.querySelectorAll('ul.bases .hw')].some(e => e.textContent === '춥다')")
        bases = page.locator("ul.bases .hw").all_inner_texts()
        assert "춥다" in bases, bases
        print("   추워요 ->", bases)

        type_query(page, "doctor")
        page.wait_for_function("() => [...document.querySelectorAll('#results .hw')].some(e => e.textContent === '의사')")
        r = results(page)
        assert "의사" in r[:5], r
        print("4/7 english ok:", r[:5])

        type_query(page, "대")
        page.wait_for_function("() => document.querySelector('#results .hw')?.textContent === '대'")
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
        assert page.locator("#credit").is_visible() and not page.locator("#credit p").is_visible()
        box = page.locator("header").bounding_box()
        assert abs(box["y"] + box["height"] - 844) < 2, box  # entry page: bar back at the bottom
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

        # reader groups + hanja meanings (음악 = 音樂: 樂 must read 악 here, not 락/낙)
        page.goto(base + "#w=음악")
        page.wait_for_selector(".hanja-word")
        groups = page.locator(".group-h").all_inner_texts()
        assert groups[0].startswith("For English readers") and groups[1].startswith("For Korean readers"), groups
        assert page.locator(".group.for-en .source.kr").count() == 1
        assert page.locator(".group.for-ko .source.od").count() == 1
        first = page.locator(".hanja-word").first
        assert first.locator(".hanja-head .hz").inner_text() == "音樂"
        assert first.locator("li .rd").all_inner_texts() == ["음", "악"]
        print("8/8 reader groups + hanja ok:", first.inner_text().replace("\n", " ")[:70])

        # the bottom search bar must stay on top of a group heading scrolled under it
        page.goto(base + "#w=대박")
        page.wait_for_selector(".hanja-word")
        page.evaluate("""() => {
            const h = document.querySelector('.group.for-ko .group-h');
            const bar = document.querySelector('header').getBoundingClientRect();
            scrollTo(0, h.getBoundingClientRect().top + scrollY - bar.top + 10);  // heading straddles the bar's top edge
        }""")
        page.wait_for_timeout(100)
        on_top = page.evaluate("""() => {
            const y = document.querySelector('header').getBoundingClientRect().top + 5;
            const h = document.querySelector('.group.for-ko .group-h').getBoundingClientRect();
            if (!(h.top < y && h.bottom > y)) return 'heading not under the bar: ' + h.top;
            return !!document.elementFromPoint(200, y).closest('header');
        }""")
        assert on_top is True, on_top
        print("   search bar stays above group headings")

        # tap a hanja -> words written with it -> tap one -> back to the list
        page.goto(base + "#w=대학")
        page.wait_for_selector("ul.hanja-chars a.hz")
        page.click("ul.hanja-chars a.hz >> text=大")
        page.wait_for_selector("ul.hanja-words li")
        assert page.inner_text(".hanja-title h1") == "大"
        assert "big" in page.inner_text(".hanja-title"), page.inner_text(".hanja-title")
        hw = page.locator("ul.hanja-words .hw").all_inner_texts()
        assert "대학" in hw[:10], hw[:10]
        assert all("大" in s for s in page.locator("ul.hanja-words .note").all_inner_texts())
        page.screenshot(path="/tmp/korean-dict-hanja-page.png")
        page.click("ul.hanja-words li a >> text=대회")
        page.wait_for_function("() => document.querySelector('#entry h1')?.textContent === '대회'")
        page.go_back()
        page.wait_for_selector("ul.hanja-words li")
        print("   hanja page ok:", hw[:6])

        # root page (기특 = root of 기특하다) shows the full word's English; Naver links
        page.goto(base + "#w=기특")
        page.wait_for_selector(".root-word .en")
        assert page.locator(".group.for-en .source.root").count() == 1
        root_en = page.inner_text(".root-word")
        assert "기특하다" in root_en and "praiseworthy" in root_en, root_en
        assert page.locator(".source.od .def a >> text=기특하다").count() >= 1  # linked in the definition
        hrefs = page.locator("p.ext a").evaluate_all("els => els.map(e => e.href)")
        assert any("en.dict.naver.com" in h and "%EA%B8%B0%ED%8A%B9" in h for h in hrefs), hrefs
        page.screenshot(path="/tmp/korean-dict-root.png")
        page.click(".root-word h3 a")
        page.wait_for_function("() => document.querySelector('#entry h1')?.textContent === '기특하다'")
        print("   root page ok:", root_en.replace("\n", " ")[:70])

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
