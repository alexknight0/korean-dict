"""Stage 1: parse the raw NIKL XML dumps into compact JSONL files.

Sources (from a clone of spellcheck-ko/korean-dict-nikl):
  opendict/*.xml  우리말샘 (one <item> per sense)
  krdict/*.xml    한국어기초사전 (LMF, one <LexicalEntry> per word)
  stdict/*.xml    표준국어대사전 (only headwords are used, as a ranking signal)

Output goes to --out (default ~/.tmp/korean-dict/parsed):
  opendict-<file>.jsonl  one JSON sense record per line
  krdict.jsonl           one JSON entry per line
  stdict-words.txt       one headword per line

Example sentences that cite a publication (<source> present) are dropped:
NIKL's licence notes those are not open content.
"""

import argparse
import glob
import html
import json
import os
import re
import subprocess
from concurrent.futures import ProcessPoolExecutor

from lxml import etree

DEFAULT_NIKL = os.path.expanduser(
    "~/projects/university/COSE461/cose461-hanja-augmented-nmt/output/"
    "hanja_dictionary/korean-dict-nikl"
)
DEFAULT_OUT = os.path.expanduser("~/.tmp/korean-dict/parsed")

# XML 1.0 forbids most C0 control characters; the dumps contain a few (e.g. \x1d).
CONTROL_CHARS = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def load_xml_bytes(path):
    with open(path, "rb") as f:
        return CONTROL_CHARS.sub(b" ", f.read())


def text(el, path):
    """Stripped, entity-unescaped text at a relative path, or None."""
    node = el.find(path)
    if node is None or node.text is None:
        return None
    value = html.unescape(node.text).strip()
    return value or None


def texts(el, path):
    out = []
    for node in el.findall(path):
        if node.text and node.text.strip():
            out.append(html.unescape(node.text).strip())
    return out


def compact(d):
    """Drop empty values so the JSON stays small."""
    return {k: v for k, v in d.items() if v not in (None, [], "", {})}


# ---------------------------------------------------------------- 우리말샘


def parse_opendict_item(item):
    wi = item.find("wordInfo")
    si = item.find("senseInfo")

    word = {
        "w": text(wi, "word"),
        "unit": text(wi, "word_unit"),
        "wtype": text(wi, "word_type"),
        "pron": texts(wi, "pronunciation_info/pronunciation"),
        "conj": texts(wi, "conju_info/conjugation_info/conjugation"),
        "abbr": texts(wi, "conju_info/abbreviation_info/abbreviation"),
        "orig": [
            [text(o, "language_type"), text(o, "original_language")]
            for o in wi.findall("original_language_info")
            if text(o, "original_language")
        ],
        "origin": text(wi, "origin"),
        "allo": text(wi, "allomorph"),
    }

    examples = []
    for ex in si.findall("example_info"):
        if ex.find("source") is not None:
            continue  # quoted from a publication: not openly licensed
        e = text(ex, "example")
        if e:
            examples.append(
                compact(
                    {
                        "e": e,
                        "reg": text(ex, "region"),
                        "tr": text(ex, "translation"),
                        "orig": text(ex, "origin"),
                    }
                )
            )

    sense = {
        "pos": text(si, "pos"),
        "type": text(si, "type"),
        "def": text(si, "definition"),
        "cat": texts(si, "cat_info/cat"),
        "ex": examples,
        "rel": [
            [text(r, "type"), text(r, "word"), text(r, "link_target_code")]
            for r in si.findall("relation_info")
        ],
        "pat": texts(si, "pattern_info/pattern"),
        "gram": texts(si, "grammar_info/grammar"),
        "idiom": [
            [text(p, "type"), text(p, "word"), text(p, "link_target_code")]
            for p in si.findall("proverb_info")
        ],
        "reg": texts(si, "region_info/region"),
        "sci": text(si, "scientific_name"),
        "tl": [
            [text(t, "language_type"), text(t, "translation")]
            for t in si.findall("translation_info")
            if text(t, "translation")
        ],
        "hist": text(si, "history_info/word_form"),
        "norm": [
            [text(n, "type"), text(n, "desc")] for n in si.findall("norm_info")
        ],
    }

    return {
        "g": int(text(item, "group_code")),
        "o": int(text(item, "group_order") or 0),
        "t": int(text(item, "target_code")),
        "word": compact(word),
        "sense": compact(sense),
    }


def parse_opendict_file(args):
    path, out_dir = args
    name = os.path.splitext(os.path.basename(path))[0]
    out_path = os.path.join(out_dir, f"opendict-{name}.jsonl")
    root = etree.fromstring(load_xml_bytes(path), etree.XMLParser(huge_tree=True))
    n = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for item in root.iterfind("item"):
            out.write(json.dumps(parse_opendict_item(item), ensure_ascii=False))
            out.write("\n")
            n += 1
    return name, n


# ---------------------------------------------------------------- 한국어기초사전


def feats(el):
    """Direct <feat att=.. val=..> children as a dict of lists."""
    d = {}
    for f in el.findall("feat"):
        d.setdefault(f.get("att"), []).append(f.get("val"))
    return d


def first(d, key):
    v = d.get(key)
    return v[0] if v else None


def parse_krdict_entry(entry):
    f = feats(entry)
    lemma = feats(entry.find("Lemma"))
    prons, sound = [], None
    for wf in entry.findall("WordForm"):
        wff = feats(wf)
        if first(wff, "type") == "발음":
            prons += wff.get("pronunciation", [])
            sound = sound or first(wff, "sound")

    senses = []
    for s in entry.findall("Sense"):
        sf = feats(s)
        en = []
        for eq in s.findall("Equivalent"):
            ef = feats(eq)
            if first(ef, "language") == "영어":
                en.append([first(ef, "lemma"), first(ef, "definition")])
        examples = []
        for ex in s.findall("SenseExample"):
            exf = feats(ex)
            examples.append([first(exf, "type"), exf.get("example", [])])
        rels = []
        for r in s.findall("SenseRelation"):
            rf = feats(r)
            rels.append([first(rf, "type"), first(rf, "lemma")])
        senses.append(
            compact(
                {
                    "def": first(sf, "definition"),
                    "en": en,
                    "ex": examples,
                    "rel": rels,
                    "pat": first(sf, "syntacticPattern"),
                    "note": first(sf, "annotation"),
                }
            )
        )

    related = []
    for rf in entry.findall("RelatedForm"):
        rff = feats(rf)
        related.append([first(rff, "type"), first(rff, "writtenForm")])

    return compact(
        {
            "id": int(entry.get("val")),
            "w": first(lemma, "writtenForm"),
            "hom": int(first(f, "homonym_number") or 0),
            "unit": first(f, "lexicalUnit"),
            "pos": first(f, "partOfSpeech"),
            "level": first(f, "vocabularyLevel"),
            "origin": first(f, "origin"),
            "note": first(f, "annotation"),
            "pron": prons,
            "sound": sound,
            "variants": lemma.get("variant", []),
            "related": related,
            "senses": senses,
        }
    )


def parse_krdict(paths, out_dir):
    n = 0
    with open(os.path.join(out_dir, "krdict.jsonl"), "w", encoding="utf-8") as out:
        for i, path in enumerate(paths, 1):
            root = etree.fromstring(
                load_xml_bytes(path), etree.XMLParser(huge_tree=True)
            )
            for entry in root.iter("LexicalEntry"):
                out.write(json.dumps(parse_krdict_entry(entry), ensure_ascii=False))
                out.write("\n")
                n += 1
            print(f"krdict {i}/{len(paths)}: {os.path.basename(path)} ({n} entries)")
    return n


# ---------------------------------------------------------------- 표준국어대사전


STDICT_WORD = re.compile(rb"<word_info>\s*<word><!\[CDATA\[(.*?)\]\]></word>", re.S)


def parse_stdict(paths, out_dir):
    words = set()
    for i, path in enumerate(paths, 1):
        for m in STDICT_WORD.finditer(load_xml_bytes(path)):
            words.add(m.group(1).decode("utf-8"))
        print(f"stdict {i}/{len(paths)}: {os.path.basename(path)} ({len(words)} words)")
    with open(os.path.join(out_dir, "stdict-words.txt"), "w", encoding="utf-8") as out:
        out.write("\n".join(sorted(words)))


# ---------------------------------------------------------------- main


def git_files(repo, subdir):
    """krdict/ and stdict/ are not checked out in the local clone; read from git."""
    names = subprocess.run(
        ["git", "-C", repo, "ls-tree", "-r", "--name-only", "HEAD", subdir],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    return [n for n in names if n.endswith(".xml")]


def materialise(repo, subdir, cache_dir):
    """Return local paths for subdir/*.xml, extracting from git if needed."""
    local = sorted(glob.glob(os.path.join(repo, subdir, "*.xml")))
    if local:
        return local
    os.makedirs(cache_dir, exist_ok=True)
    paths = []
    for name in git_files(repo, subdir):
        dest = os.path.join(cache_dir, os.path.basename(name))
        if not os.path.exists(dest):
            with open(dest, "wb") as f:
                subprocess.run(
                    ["git", "-C", repo, "show", f"HEAD:{name}"], check=True, stdout=f
                )
        paths.append(dest)
    return sorted(paths)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nikl", default=DEFAULT_NIKL)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    raw = os.path.join(os.path.dirname(args.out), "raw")

    opendict = sorted(glob.glob(os.path.join(args.nikl, "opendict", "*.xml")))
    with ProcessPoolExecutor(max_workers=6) as pool:
        jobs = [(p, args.out) for p in opendict]
        for i, (name, n) in enumerate(pool.map(parse_opendict_file, jobs), 1):
            print(f"opendict {i}/{len(opendict)}: {name} ({n} senses)")

    parse_krdict(materialise(args.nikl, "krdict", os.path.join(raw, "krdict")), args.out)
    parse_stdict(materialise(args.nikl, "stdict", os.path.join(raw, "stdict")), args.out)


if __name__ == "__main__":
    main()
