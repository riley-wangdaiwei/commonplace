#!/usr/bin/env python3
"""Build the commonplace static reader from wiki/*.md (stdlib only, idempotent).

Steps:
  1. Parse each wiki/*.md frontmatter + body.
  2. Extract any '## Suggested links' section -> merge into inbox.json,
     strip the section from the md file in place (content preserved in inbox.json).
  3. Migrate films/books from the old media snapshot into wiki/ (skips ids already present).
  4. Emit index.json: pages[{id,title,label,type,category,kind,date,status,
     authors,year,venue,url,body,links[]}] + meta.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WIKI = os.path.join(HERE, "wiki")
MEDIA_JSON = "/tmp/commonplace-old/migration/media-2026-10-05.json"
NOTION_JSON = "/tmp/commonplace-old/migration/notion-2026-10-05.json"
INBOX_JSON = os.path.join(HERE, "inbox.json")
INDEX_JSON = os.path.join(HERE, "index.json")

LINK_RE = re.compile(r"\[\[(?:([^\]|]+)\|)?([^\]]+)\]\]")
SUGGESTED_RE = re.compile(r"^## Suggested links\s*$", re.M)
H2_RE = re.compile(r"^## ", re.M)
SUGGEST_ITEM_RE = re.compile(
    r"^-\s*\[\[(?:([^\]|]+)\|)?([^\]]+)\]\]\s*(?:\((pending|approved|rejected)\))?\s*(?:[—–-]\s*(.*))?$"
)


def parse_frontmatter(text):
    """Return (dict, body). Minimal parser: flat 'key: value' lines."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    fm = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        fm[k] = v
    return fm, body


def extract_links(body):
    out, seen = [], set()
    for m in LINK_RE.finditer(body):
        tgt = m.group(2).strip()
        if tgt and tgt not in seen:
            seen.add(tgt)
            out.append(tgt)
    return out


def extract_suggested(page_id, body):
    """Return (items, cleaned_body). items = [{from,to,reason,status}]."""
    m = SUGGESTED_RE.search(body)
    if not m:
        return [], body
    start = m.start()
    rest = body[m.end() :]
    nxt = H2_RE.search(rest)
    section = rest[: nxt.start()] if nxt else rest
    tail = rest[nxt.start() :] if nxt else ""
    items = []
    for line in section.splitlines():
        im = SUGGEST_ITEM_RE.match(line.strip())
        if im:
            items.append(
                {
                    "from": page_id,
                    "to": im.group(2).strip(),
                    "reason": (im.group(4) or "").strip(),
                    "status": im.group(3) or "pending",
                }
            )
    head = body[:start].rstrip() + "\n"
    cleaned = head + tail.lstrip("\n")
    cleaned = cleaned.rstrip() + "\n"
    return items, cleaned


def first_h1(body):
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def display_title(fm, body, pid):
    return fm.get("label") or fm.get("title") or first_h1(body) or pid


def load_inbox():
    if os.path.exists(INBOX_JSON):
        with open(INBOX_JSON, encoding="utf-8") as f:
            return json.load(f)
    return []


def save_inbox(items):
    with open(INBOX_JSON, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
        f.write("\n")


def migrate_media(existing_ids):
    """Migrate films/books from the old snapshot. Returns (added, skipped)."""
    try:
        with open(MEDIA_JSON, encoding="utf-8") as f:
            media = json.load(f)
    except FileNotFoundError:
        print("media snapshot not found, skipping film/book migration")
        return 0, 0
    added, skipped = 0, 0
    films, books = [], []
    for film in media.get("films", []):
        fid = film.get("id", "")
        if not fid or fid in existing_ids:
            skipped += 1
            continue
        lines = [
            "---",
            f"id: {fid}",
            f"title: {film.get('title', '')}",
            "type: film",
            "category: film",
            f"director: {film.get('director', '')}",
            f"date: {film.get('date', '')}",
            f"status: {film.get('status', 'todo')}",
            "---",
            "",
            f"# {film.get('title', fid)}",
            "",
        ]
        if film.get("director"):
            lines.append(f"- Director: {film['director']}")
        watched = film.get("date") or ""
        cinema = film.get("cinema") or ""
        if watched or cinema:
            bits = f"Watched: {watched}".rstrip(": ")
            if cinema:
                bits += f" ({cinema})"
            lines.append(f"- {bits}")
        if film.get("comment"):
            lines += ["", film["comment"]]
        lines.append("")
        with open(os.path.join(WIKI, fid + ".md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        existing_ids.add(fid)
        films.append((film.get("title", fid), fid, film.get("director", "")))
        added += 1
    for book in media.get("books", []):
        bid = book.get("id", "")
        if not bid or bid in existing_ids:
            skipped += 1
            continue
        lines = [
            "---",
            f"id: {bid}",
            f"title: {book.get('title', '')}",
            "type: book",
            "category: book",
            f"author: {book.get('author', '')}",
            f"date: {book.get('date', '')}",
            f"status: {book.get('status', 'todo')}",
            f"kind: {book.get('kind', 'book')}",
            f"url: \"{book.get('url', '')}\"",
            "---",
            "",
            f"# {book.get('title', bid)}",
            "",
        ]
        if book.get("author"):
            lines.append(f"- Author: {book['author']}")
        if book.get("notes"):
            lines += ["", book["notes"]]
        lines.append("")
        with open(os.path.join(WIKI, bid + ".md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        existing_ids.add(bid)
        books.append((book.get("title", bid), bid, book.get("author", "")))
        added += 1
    if films:
        films.sort(key=lambda x: x[0].lower())
        with open(os.path.join(WIKI, "hub-films.md"), "w", encoding="utf-8") as f:
            f.write("---\nid: hub-films\ntype: hub\ncategory: film\n---\n\n# films\n\n")
            for title, fid, director in films:
                desc = f"{title} ({director})" if director else title
                f.write(f"- [[{fid}]] — {desc}\n")
        existing_ids.add("hub-films")
    if books:
        books.sort(key=lambda x: x[0].lower())
        with open(os.path.join(WIKI, "hub-books.md"), "w", encoding="utf-8") as f:
            f.write("---\nid: hub-books\ntype: hub\ncategory: book\n---\n\n# books\n\n")
            for title, bid, author in books:
                desc = f"{title} ({author})" if author else title
                f.write(f"- [[{bid}]] — {desc}\n")
        existing_ids.add("hub-books")
    return added, skipped


def report_skipped_nodes(existing_ids):
    skipped = []
    for path, label in ((MEDIA_JSON, "media"), (NOTION_JSON, "notion")):
        try:
            with open(path, encoding="utf-8") as f:
                nodes = json.load(f).get("nodes", [])
        except FileNotFoundError:
            continue
        for n in nodes:
            nid = n.get("id", "")
            if nid and nid not in existing_ids:
                skipped.append((label, nid, n.get("title", "")))
    return skipped


def main():
    md_files = sorted(
        f for f in os.listdir(WIKI) if f.endswith(".md") and f != "template-reading.md"
    )
    # template is excluded from listings but still validated
    all_files = sorted(f for f in os.listdir(WIKI) if f.endswith(".md"))

    # Step 0: migrate films/books first so they join the index
    existing_ids = set()
    for fn in all_files:
        with open(os.path.join(WIKI, fn), encoding="utf-8") as f:
            fm, _ = parse_frontmatter(f.read())
        existing_ids.add(fm.get("id") or fn[:-3])
    added, mskipped = migrate_media(existing_ids)
    print(f"films/books migrated: {added} added, {mskipped} skipped (already in wiki)")

    skipped_nodes = report_skipped_nodes(existing_ids)
    print(
        f"old-snapshot reading nodes skipped (not migrated, avoid dupes with verified set): {len(skipped_nodes)}"
    )
    for label, nid, title in skipped_nodes[:30]:
        print(f"  [{label}] {nid} — {title[:60]}")

    # Step 1+2: parse pages, extract suggested links, strip sections in place
    inbox = load_inbox()
    seen_inbox = {(i["from"], i["to"]) for i in inbox}
    new_items = 0
    pages = []
    md_files = sorted(
        f for f in os.listdir(WIKI) if f.endswith(".md") and f != "template-reading.md"
    )
    for fn in md_files:
        path = os.path.join(WIKI, fn)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        fm, body = parse_frontmatter(text)
        pid = fm.get("id") or fn[:-3]
        items, cleaned = extract_suggested(pid, body)
        if items:
            with open(path, "w", encoding="utf-8") as f:
                f.write("---\n")
                # rebuild frontmatter verbatim from parsed dict is lossy; instead
                # splice: keep original frontmatter block, replace body
                f.write(text.split("\n---", 1)[0][3:].strip() + "\n---\n\n")
                f.write(cleaned)
            for it in items:
                if (it["from"], it["to"]) not in seen_inbox:
                    inbox.append(it)
                    seen_inbox.add((it["from"], it["to"]))
                    new_items += 1
            body = cleaned
        # Hub pages are indexes: their [[links]] are navigation-only and must
        # NOT become graph edges (categorical membership is not a semantic link).
        page_links = [] if fm.get("type") == "hub" else extract_links(body)
        pages.append(
            {
                "id": pid,
                "title": display_title(fm, body, pid),
                "label": fm.get("label", ""),
                "type": fm.get("type", ""),
                "category": fm.get("category", ""),
                "kind": fm.get("kind", ""),
                "date": fm.get("date", ""),
                "status": fm.get("status", ""),
                "authors": fm.get("authors", "") or fm.get("author", "") or fm.get("director", ""),
                "year": fm.get("year", ""),
                "venue": fm.get("venue", ""),
                "url": fm.get("url", ""),
                "body": body,
                "links": page_links,
            }
        )
    save_inbox(inbox)
    print(f"suggested links extracted: {new_items} new inbox items ({len(inbox)} total)")

    pages.sort(key=lambda p: p["id"])
    index = {
        "meta": {"generator": "build.py", "pages": len(pages)},
        "pages": pages,
    }
    with open(INDEX_JSON, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"index.json written: {len(pages)} pages")


if __name__ == "__main__":
    sys.exit(main())
