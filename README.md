# reading-notes

Riles's personal reading-notes dataset. Seed of an LLM wiki.

- `index.html` + `app.js` -- the capture tool (ASCII aesthetic, no design)
- data: browser localStorage + gist backup (`reading-nodes.json`)
- export: one `.md` per node with frontmatter (future wiki seed)

## node schema

```yaml
id: n-...
type: reading            # more types later: idea, concept, paper, person
title: ...
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
