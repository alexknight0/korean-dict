"""Sweep: render many entry, search and hanja pages and fail if any shows a missing value
as text ("null", "undefined", "NaN", "[object ...]").

Run from the repo root:
    ~/projects/ai-tool-venv/bin/python3 tests/no_null.py [pages_per_kind]
Scans the data first to pick keys whose pages contain null/empty fields, plus a random
sample. Serves the repo on http://127.0.0.1:8769/.
"""

import functools
import glob
import gzip
import http.server
import json
import random
import re
import sys
import threading

from playwright.sync_api import sync_playwright

PORT = 8769
# Missing values shown as text, or placeholders around an empty value ("[/]", "/ /",
# the 품사 없음 label). "null and void" is a real gloss (무효하다 on #h=無).
BAD = re.compile(r"\b(null(?! and void)|undefined|NaN)\b|\[object \w+\]|\[/*\]|/ +/|no part of speech|\(\)")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=".")
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{PORT}/"


def has_hole(v):
    """True if a JSON value contains null or an empty string anywhere."""
    if v is None or v == "":
        return True
    if isinstance(v, list):
        return any(has_hole(x) for x in v)
    if isinstance(v, dict):
        return any(has_hole(x) for x in v.values())
    return False


def pick_keys(n):
    rnd = random.Random(7)
    shards = sorted(glob.glob("data/e/*.json.gz"))
    holes, plain = [], []
    for path in rnd.sample(shards, 120):
        for key, page in json.loads(gzip.decompress(open(path, "rb").read())).items():
            (holes if has_hole(page) else plain).append(key)
    rnd.shuffle(holes)
    rnd.shuffle(plain)
    print(f"{len(holes)} sampled pages contain null/empty fields")
    # pages known to have empty fields (all of them, from a full scan): pron [""], empty example lines
    return ["국졸", "경색"] + holes[:n] + plain[: n // 2]


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
    keys = pick_keys(n)
    base = serve()
    found = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for korean_only in (True, False):
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
            ctx.add_init_script(f"localStorage.setItem('korean-dict-settings', JSON.stringify({{koreanOnly: {json.dumps(korean_only)}}}))")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(base)
            page.wait_for_selector("#settings-btn")

            def check(what):
                page.wait_for_load_state("networkidle")
                page.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
                text = page.inner_text("main")
                for m in BAD.finditer(text):
                    found.append((korean_only, what, text[max(0, m.start() - 60): m.end() + 30].replace("\n", " ")))

            hanja = set()
            for i, key in enumerate(keys, 1):
                page.evaluate("k => location.hash = '#w=' + encodeURIComponent(k)", key)
                page.wait_for_function("() => !document.querySelector('#status') || document.querySelector('#status').hidden")
                check("#w=" + key)
                hanja.update(page.locator("ul.hanja-chars a.hz").all_inner_texts()[:2])
                if i % 50 == 0:
                    print(f"  koreanOnly={korean_only}: {i}/{len(keys)} entries, {len(found)} problems")
            for i, q in enumerate(keys[:40] + ["doctor", "먹었는데", "ㄱ", "zzzq"]):
                page.evaluate("q => location.hash = '#q=' + encodeURIComponent(q)", q[:2] if i % 2 else q)
                page.wait_for_function("() => document.querySelector('#results').children.length")
                check("#q=" + q)
            for ch in list(hanja)[:30]:
                page.evaluate("c => location.hash = '#h=' + encodeURIComponent(c)", ch)
                page.wait_for_selector(".hanja-title")
                check("#h=" + ch)
            print(f"koreanOnly={korean_only}: {len(keys)} entries, 44 searches, {min(30, len(hanja))} hanja pages")
            ctx.close()
        browser.close()
    for f in found[:40]:
        print("PROBLEM", f)
    assert not found, f"{len(found)} pages show a missing value"
    assert not errors, errors
    print("all ok: no null/undefined text")


if __name__ == "__main__":
    main()
