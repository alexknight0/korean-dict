# korean-dict

Static Korean dictionary (우리말샘 + 한국어기초사전) for GitHub Pages. No build step for the site; `data/` is generated.

## Features

- Search-as-you-type over ~975k headwords, ranked by learner level (한국어기초사전), 표준국어대사전 membership, and sense type.
- Base-form lookup for conjugated forms and particles (먹었는데 → 먹다, 추워요 → 춥다, 학교에서 → 학교): rule-based `deinflect.js` plus conjugations listed in the dictionaries.
- English → Korean search (doctor → 의사) from 한국어기초사전 equivalents and 우리말샘 translations.
- Entry pages with definitions, English, examples, patterns, related words, idioms, 한자 and pronunciation (audio is linked from NIKL, not hosted).
- Works offline for previously viewed data (service worker); installable to the home screen.

## Rebuilding the data

Source: a clone of [spellcheck-ko/korean-dict-nikl](https://github.com/spellcheck-ko/korean-dict-nikl) (path set in `tools/parse.py`).

```sh
~/projects/ai-tool-venv/bin/python3 tools/parse.py   # XML -> ~/.tmp/korean-dict/parsed/*.jsonl (~2 min)
~/projects/ai-tool-venv/bin/python3 tools/build.py   # JSONL -> data/ (~1 min)
```

## Tests

```sh
node tests/deinflect.test.js
~/projects/ai-tool-venv/bin/python3 tests/e2e.py      # Playwright, serves the repo locally
```

## Licence

Dictionary data © 국립국어원, [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/). Example sentences quoted from publications (those with a source) and multimedia are excluded because NIKL does not release them under that licence.
