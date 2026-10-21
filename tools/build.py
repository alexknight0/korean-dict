"""Stage 2: turn the parsed JSONL (from parse.py) into the static site data.

Output layout (under --out, default <repo>/data). Everything except meta.json is
gzipped JSON; the client inflates it with DecompressionStream.
  meta.json               shard counts, entry counts, build date
  e/<hhh>.json.gz         entry pages, sharded by fnv1a(key) % ENTRY_SHARDS
                          {key: {"kr": [...krdict entries], "od": [...우리말샘 words]}}
  i/<prefix>.json.gz      headword prefix index (see build_prefix_index)
  a/<hhh>.json.gz         conjugated form -> [keys], sharded by fnv1a(form) % ALIAS_SHARDS
  en/<abc>.json.gz        English word -> Korean headwords, bucketed by first 3 letters

A "key" is a headword with spaces, '^' and '-' removed, so 먹다 / -가 / 가- / 가
group naturally and the user never has to type morpheme boundaries.
"""

import argparse
import collections
import datetime
import glob
import gzip
import json
import os
import re
import shutil

DEFAULT_IN = os.path.expanduser("~/.tmp/korean-dict/parsed")
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

ENTRY_SHARDS = 4096
ALIAS_SHARDS = 1024
INDEX_LIMIT = 1500  # max rows in a prefix file before it is split by the next char
INDEX_TOP = 60  # rows kept in a split prefix file (shown while typing short prefixes)
MAX_RELATIONS = 40  # per sense; some 상위어 lists run to thousands
MAX_EXAMPLES = 8
MAX_KR_EXAMPLES = 6
GLOSS_LEN = 48

LEVEL_SCORE = {"초급": 1000, "중급": 850, "고급": 700}
SENSE_TYPE_ORDER = {"일반어": 0, "북한어": 1, "방언": 2, "옛말": 3}
WORD_TYPE_SHORT = {"고유어": "고", "한자어": "한", "외래어": "외", "혼종어": "혼"}
HOMONYM_SUFFIX = re.compile(r"\d+$")


# ---------------------------------------------------------------- helpers


def fnv1a(s):
    """32-bit FNV-1a over UTF-16 code units (matches the JS in app.js)."""
    h = 0x811C9DC5
    data = s.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def to_key(word):
    return re.sub(r"[\s^\-]", "", word)


def to_display(word):
    """대전^삼천^중학교 -> 대전 삼천 중학교; 곱-자 -> 곱자; keep affix hyphens (-가, 가-)."""
    w = word.replace("^", " ").strip()
    lead = "-" if w.startswith("-") else ""
    trail = "-" if w.endswith("-") and len(w) > 1 else ""
    core = w.strip("-").replace("-", "")
    return lead + core + trail


def ref(word):
    """Relation target like '들다036' -> (display, homonym number or None)."""
    m = HOMONYM_SUFFIX.search(word)
    hom = int(m.group()) if m else None
    base = word[: m.start()] if m else word
    return to_display(base), hom


def prefix_name(prefix):
    return "-".join(f"{ord(c):x}" for c in prefix)


def write_json(path, obj):
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if path.endswith(".gz"):
        # mtime=0 keeps rebuilds byte-identical, so git only stores real changes
        data = gzip.compress(data, compresslevel=9, mtime=0)
    with open(path, "wb") as f:
        f.write(data)


def truncate(s, n):
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- load


def load_opendict(in_dir):
    """Group sense records into words keyed by group_code."""
    words = {}
    files = sorted(glob.glob(os.path.join(in_dir, "opendict-*.jsonl")))
    for i, path in enumerate(files, 1):
        with open(path, encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                w = words.get(r["g"])
                if w is None:
                    w = words[r["g"]] = {"word": r["word"], "senses": []}
                elif "origin" not in w["word"] and "origin" in r["word"]:
                    w["word"]["origin"] = r["word"]["origin"]
                s = r["sense"]
                s["t"] = r["t"]
                s["_o"] = r["o"]
                w["senses"].append(s)
        print(f"load opendict {i}/{len(files)}: {os.path.basename(path)} ({len(words)} words)")
    return words


def load_krdict(in_dir):
    with open(os.path.join(in_dir, "krdict.jsonl"), encoding="utf-8") as f:
        entries = [json.loads(line) for line in f]
    print(f"load krdict: {len(entries)} entries")
    return entries


def load_stdict_keys(in_dir):
    with open(os.path.join(in_dir, "stdict-words.txt"), encoding="utf-8") as f:
        return {to_key(HOMONYM_SUFFIX.sub("", w)) for w in f.read().split("\n") if w}


# ---------------------------------------------------------------- pages


def build_pages(od_words, kr_entries):
    """Return {key: {"kr": [...], "od": [...]}} plus sense->key map for links."""
    sense_key = {}
    for w in od_words.values():
        k = to_key(w["word"]["w"])
        for s in w["senses"]:
            sense_key[s["t"]] = k

    def link(items):
        out = []
        for typ, word, target in items[:MAX_RELATIONS]:
            if not word:
                continue
            disp, hom = ref(word)
            key = (sense_key.get(int(target)) if target else None) or to_key(disp)
            # [type, display, homonym?, key?] - key only when it isn't to_key(display)
            item = [typ, disp, hom or 0]
            if key != to_key(disp):
                item.append(key)
            elif not hom:
                item.pop()
            out.append(item)
        return out

    pages = collections.defaultdict(lambda: {"kr": [], "od": []})
    for g, w in od_words.items():
        wi = w["word"]
        senses = sorted(w["senses"], key=lambda s: (SENSE_TYPE_ORDER.get(s.get("type"), 9), s["_o"]))
        out_senses = []
        for s in senses:
            s = dict(s)
            del s["_o"]
            if "rel" in s:
                n = len(s["rel"])
                s["rel"] = link(s["rel"])
                if n > MAX_RELATIONS:
                    s["relMore"] = n - MAX_RELATIONS
            if "idiom" in s:
                s["idiom"] = link(s["idiom"])
            if "ex" in s:
                s["ex"] = s["ex"][:MAX_EXAMPLES]
            if "norm" in s:
                s["norm"] = [n for n in s["norm"] if n[1]]
            out_senses.append(s)
        # Defaults are omitted to keep the shards small (the client fills them in):
        # w = key, unit = 어휘, sense type = 일반어, orig [["한자", x]] -> "x".
        key = to_key(wi["w"])
        entry = {"_id": g}
        disp = to_display(wi["w"])
        if disp != key:
            entry["w"] = disp
        if wi.get("unit", "어휘") != "어휘":
            entry["unit"] = wi["unit"]
        if "wtype" in wi:
            entry["wtype"] = WORD_TYPE_SHORT.get(wi["wtype"], wi["wtype"])
        orig = wi.get("orig", [])
        if len(orig) == 1 and orig[0][0] == "한자":
            entry["orig"] = orig[0][1]
        elif orig:
            entry["orig"] = orig
        for f in ("pron", "conj", "abbr", "origin", "allo"):
            if f in wi:
                entry[f] = wi[f]
        for s in out_senses:
            if s.get("type") == "일반어":
                del s["type"]
        entry["senses"] = out_senses
        pages[key]["od"].append(entry)

    for e in kr_entries:
        if not e.get("w"):
            continue
        e = dict(e)
        e["w"] = to_display(e["w"])
        for s in e.get("senses", []):
            if "rel" in s:
                s["rel"] = [[t, w] for t, w in s["rel"] if w]
            if "ex" in s:
                s["ex"] = s["ex"][:MAX_KR_EXAMPLES]
        if "related" in e:
            e["related"] = [[t, w] for t, w in e["related"] if w]
        pages[to_key(e["w"])]["kr"].append(e)

    return pages, sense_key


def word_rank(entry):
    """Order homonyms on a page: general vocabulary before dialect/archaic/North."""
    best = min((SENSE_TYPE_ORDER.get(s.get("type", "일반어"), 9) for s in entry["senses"]), default=9)
    return (best, "unit" in entry, -len(entry["senses"]), entry["_id"])


def score(key, page, stdict_keys):
    s = 0
    if page["kr"]:
        s += max(LEVEL_SCORE.get(e.get("level"), 500) for e in page["kr"])
    if key in stdict_keys:
        s += 200
    senses = [x for w in page["od"] for x in w["senses"]]
    if any("type" not in x for x in senses):
        s += 60
    units = {w.get("unit", "어휘") for w in page["od"]} | {e.get("unit") for e in page["kr"]}
    if "어휘" in units or "단어" in units:
        s += 40
    elif units & {"속담", "관용구"}:
        s += 15
    if senses and all(x.get("cat") for x in senses):
        s -= 25  # only specialist senses (지명, 의학, ...)
    s += min(len(senses), 20) * 3
    s -= len(key) * 2
    return s


def gloss(page):
    for e in page["kr"]:
        for sense in e.get("senses", []):
            if sense.get("en"):
                return truncate(sense["en"][0][0], GLOSS_LEN)
    # English first: a 우리말샘 English translation beats a Korean definition
    for w in page["od"]:
        for sense in w["senses"]:
            for lang, tr in sense.get("tl", []):
                if lang == "영어" and tr:
                    return truncate(tr, GLOSS_LEN)
    for w in page["od"]:
        for sense in w["senses"]:
            if sense.get("def"):
                return truncate(sense["def"], GLOSS_LEN)
    return ""


def display(key, page):
    if page["kr"]:
        return page["kr"][0]["w"]
    return page["od"][0].get("w", key)


def strip_private(page):
    """Drop build-only fields before writing a page."""
    out = {}
    if page["kr"]:
        out["kr"] = [{k: v for k, v in e.items() if k != "variants"} for e in page["kr"]]
    if page["od"]:
        out["od"] = [{k: v for k, v in w.items() if k != "_id"} for w in page["od"]]
    return out


# ---------------------------------------------------------------- index


def build_prefix_index(rows, out_dir):
    """rows: [(key, display, gloss, level?)] sorted best-first.

    i/<prefix>.json.gz = {"r": rows (best-first), "c": chars with their own file}

    A prefix with at most INDEX_LIMIT rows gets a single file with all of them.
    A bigger prefix keeps its top INDEX_TOP rows plus any exact match, and also
    inlines whole small child groups (smallest first, up to INDEX_LIMIT rows) so
    that tiny files aren't created. "c" lists the children that do have their own
    file. The client walks down from the first character: while the file has "c",
    the query is longer than the prefix and the next query char is in "c", move to
    that child; otherwise this file holds every row the query can match.
    """
    os.makedirs(out_dir, exist_ok=True)
    count = 0

    def emit(prefix, group, depth):
        nonlocal count
        path = os.path.join(out_dir, prefix_name(prefix) + ".json.gz")
        if len(group) <= INDEX_LIMIT:
            write_json(path, {"r": group})
            count += 1
            return
        children = collections.defaultdict(list)
        for r in group:
            if len(r[0]) > depth:
                children[r[0][depth]].append(r)
        keep = {id(r) for r in group[:INDEX_TOP]}
        keep |= {id(r) for r in group if r[0] == prefix}
        budget = INDEX_LIMIT
        split = []
        for ch, sub in sorted(children.items(), key=lambda kv: len(kv[1])):
            if len(sub) <= budget:
                budget -= len(sub)
                keep |= {id(r) for r in sub}
            else:
                split.append(ch)
        write_json(path, {"r": [r for r in group if id(r) in keep], "c": "".join(sorted(split))})
        count += 1
        for ch in split:
            emit(prefix + ch, children[ch], depth + 1)

    by_first = collections.defaultdict(list)
    for r in rows:
        by_first[r[0][0]].append(r)
    for i, (ch, group) in enumerate(sorted(by_first.items()), 1):
        emit(ch, group, 1)
        if i % 500 == 0:
            print(f"prefix index {i}/{len(by_first)} first chars ({count} files)")
    print(f"prefix index: {count} files")
    return count


def build_aliases(pages, out_dir):
    """Conjugated/variant forms listed in the dictionaries -> headword keys."""
    alias = collections.defaultdict(set)
    for key, page in pages.items():
        forms = []
        for w in page["od"]:
            forms += w.get("conj", []) + w.get("abbr", [])
        for e in page["kr"]:
            for v in e.get("variants", []):
                forms += [x.strip() for x in v.split(",")]
        for f in forms:
            fk = to_key(f)
            if fk and fk != key:
                alias[fk].add(key)
    shards = collections.defaultdict(dict)
    for form, keys in alias.items():
        shards[fnv1a(form) % ALIAS_SHARDS][form] = sorted(keys)
    os.makedirs(out_dir, exist_ok=True)
    for n, d in shards.items():
        write_json(os.path.join(out_dir, f"{n:03x}.json.gz"), d)
    print(f"aliases: {len(alias)} forms")
    return len(alias)


EN_STOPWORDS = set(
    "a an the of to in on at by for from with and or as be is are was it its "
    "one's someone something somebody sb sth".split()
)


def en_bucket(token):
    return token[:3]


def build_english(pages, rank_of, out_dir):
    """English equivalents from 한국어기초사전 (primary) and 우리말샘 translations.

    en/<first 3 letters>.json.gz = [[english, key, display], ...] best-first.
    Every non-stopword token of the English text is bucketed, so "high school"
    is found from both "high" and "school". 2-letter tokens get their own bucket.
    """
    rows = collections.defaultdict(dict)  # bucket -> {(en, key): row}

    def add(en, key, disp, primary):
        en = en.strip()
        for token in set(re.findall(r"[a-z]+", en.lower())):
            if len(token) < 2 or token in EN_STOPWORDS:
                continue
            k = (en, key)
            bucket = rows[en_bucket(token)]
            if k not in bucket:
                bucket[k] = [en, key, disp, rank_of[key] + (0 if primary else 10_000_000)]

    for key, page in pages.items():
        disp = display(key, page)
        for e in page["kr"]:
            for s in e.get("senses", []):
                for lemma, _ in s.get("en", []):
                    if lemma:
                        for part in lemma.split(";"):
                            add(part, key, disp, True)
        for w in page["od"]:
            for s in w["senses"]:
                for lang, tr in s.get("tl", []):
                    if lang == "영어" and tr:
                        add(tr, key, disp, False)

    os.makedirs(out_dir, exist_ok=True)
    for bucket, d in rows.items():
        r = sorted(d.values(), key=lambda x: x[3])
        write_json(os.path.join(out_dir, bucket + ".json.gz"), [x[:3] for x in r])
    print(f"english: {sum(len(d) for d in rows.values())} rows in {len(rows)} buckets")


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", default=DEFAULT_IN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    od_words = load_opendict(args.in_dir)
    kr_entries = load_krdict(args.in_dir)
    stdict_keys = load_stdict_keys(args.in_dir)

    pages, _ = build_pages(od_words, kr_entries)
    del od_words
    pages.pop("", None)
    print(f"pages: {len(pages)} headword keys")

    for page in pages.values():
        page["od"].sort(key=word_rank)
        # most basic vocabulary first (먹다 "eat" before 먹다 "go deaf"), then homonym no.
        page["kr"].sort(key=lambda e: (-LEVEL_SCORE.get(e.get("level"), 0), e.get("hom", 0)))

    keys = sorted(pages, key=lambda k: (-score(k, pages[k], stdict_keys), k))
    rank_of = {k: i for i, k in enumerate(keys)}

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    os.makedirs(args.out)

    # entry shards
    shards = collections.defaultdict(dict)
    for k, page in pages.items():
        shards[fnv1a(k) % ENTRY_SHARDS][k] = strip_private(page)
    os.makedirs(os.path.join(args.out, "e"))
    for i, (n, d) in enumerate(shards.items(), 1):
        write_json(os.path.join(args.out, "e", f"{n:03x}.json.gz"), d)
        if i % 1000 == 0:
            print(f"entry shards {i}/{len(shards)}")

    # prefix index rows: [key, display, gloss, level?]
    rows = []
    for k in keys:
        page = pages[k]
        level = next((e["level"] for e in page["kr"] if e.get("level") in LEVEL_SCORE), None)
        row = [k, display(k, page), gloss(page)]
        if level:
            row.append(level[0])  # 초 / 중 / 고
        rows.append(row)
    index_files = build_prefix_index(rows, os.path.join(args.out, "i"))
    n_alias = build_aliases(pages, os.path.join(args.out, "a"))
    build_english(pages, rank_of, os.path.join(args.out, "en"))

    with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "built": datetime.date.today().isoformat(),
                "entryShards": ENTRY_SHARDS,
                "aliasShards": ALIAS_SHARDS,
                "keys": len(pages),
                "krdict": len(kr_entries),
                "indexFiles": index_files,
                "aliases": n_alias,
            },
            f,
            ensure_ascii=False,
        )
    print("done")


if __name__ == "__main__":
    main()
