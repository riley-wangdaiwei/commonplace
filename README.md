# commonplace

Riles's commonplace book. Seed of an LLM wiki.

- `index.html` + `app.js` -- the capture tool (ASCII aesthetic, no design)
- data: browser localStorage + gist backup (`reading-nodes.json`)
- export: one `.md` per node with frontmatter (future wiki seed)

Node types: reading / idea / question / concept. A node is anything worth
pointing at; links (human-only, each with a `why`) are the connective tissue.
Status: todo (to read) / partial / done.

Separate datasets (top tabs, not graph nodes): **films** (to watch / watched,
with director/date/cinema/comment) and **reading** (to read / read, with
author/date/url/kind: book/article/video). Same localStorage + gist backup,
same ASCII UI.

Live at https://riley-wangdaiwei.github.io/commonplace/

## node schema

```yaml
id: n-...
type: reading            # more types later: idea, concept, paper, person
title: ...
label: ...              # short display name; graph shows this (falls back to title)
category: ...            # user-editable; presets: game-theory / web3 / privacy / gambia-* / general
kind: paper|article|digest|thread|book|other
url: ...
date: YYYY-MM-DD
status: partial|done
authors: ...
year: ...
venue: ...
thesis: ...              # one line: what does it claim?
quotes: ...              # key quotes
critique: ...            # limitations / my take
notes: ...
links:                   # HUMAN-ONLY. each with a `why`.
  - to: <node id>
    why: "..."
suggested_links: []      # llm may propose here. never auto-promoted.
```

## rules

- `links[]` is written only by Riles. The LLM proposes into `suggested_links[]`.
- Rejected suggestions are remembered (not re-suggested).
- Live at https://riley-wangdaiwei.github.io/reading-notes/
