"""Version light: ok -> stale ("Update") -> tap updates -> ok, and offline -> grey dot.

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/version.py
version.js is faked: the live check (?t=) gets the "deployed" version, plain loads the "running" one.
"""

import functools
import http.server
import threading

from playwright.sync_api import sync_playwright

OLD, NEW = "2026-10-01T00:00:00Z", "2026-10-30T00:00:00Z"
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        fails.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory="."))
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch()
    # service workers blocked so page.route sees every request
    page = browser.new_page(viewport={"width": 390, "height": 844}, service_workers="block", locale="en-AU")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    state = {"deployed": OLD, "running": OLD, "offline": False}

    def version(route):
        if "?t=" in route.request.url:  # the live check
            if state["offline"]:
                return route.abort()
            v = state["deployed"]
        else:  # script load / cache refresh
            v = state["running"]
        route.fulfill(body=f'const VERSION = "{v}";', content_type="text/javascript")

    page.route("**/version.js*", version)
    page.goto(f"http://127.0.0.1:{port}/")
    page.wait_for_function("document.querySelector('#version').dataset.state !== 'checking'")
    st = lambda: page.get_attribute("#version", "data-state")
    check("same version -> ok", st() == "ok", st())
    check("ok shows the dot only", page.inner_text("#version") == "")

    page.focus("#q")
    state["deployed"] = NEW  # a deploy lands; this page still runs OLD
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_function("document.querySelector('#version').dataset.state === 'stale'")
    check("stale shows 'Update'", page.inner_text("#version") == "Update")
    page.locator("#q").blur()
    page.wait_for_timeout(100)
    page.screenshot(path="/tmp/korean-dict-version-stale.png", clip={"x": 0, "y": 774, "width": 390, "height": 70})

    state["running"] = NEW  # after the cache refresh the browser gets the new files
    with page.expect_navigation():
        page.click("#version")
    page.wait_for_function("document.querySelector('#version').dataset.state !== 'checking'")
    check("after update -> ok", st() == "ok", st())
    check("running version is new", "30 Oct" in page.get_attribute("#version", "title"), page.get_attribute("#version", "title"))
    page.screenshot(path="/tmp/korean-dict-version-ok.png", clip={"x": 0, "y": 774, "width": 390, "height": 70})

    state["offline"] = True
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function("document.querySelector('#version').dataset.state === 'unknown'")
    page.click("#version")
    page.wait_for_timeout(200)
    check("tapping unknown explains", "Couldn't check" in page.inner_text("#status"), page.inner_text("#status"))
    check("no page errors", not errors, errors)
    browser.close()

print(f"\n{len(fails)} failed" if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
