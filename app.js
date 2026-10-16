/* commonplace v1 -- search-first reader over wiki/*.md
   md files are the truth; index.json is a rebuildable cache.
   the llm only suggests -- never writes links. */
"use strict";

let PAGES = [];
let BY_ID = {};
let INBOX = [];
const LS_KEY = "commonplace-inbox-v1";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WIKILINK_RE = /\[\[(?:([^\]|]+)\|)?([^\]]+)\]\]/g;

function renderInline(text) {
  let h = esc(text);
  h = h.replace(WIKILINK_RE, (m, alias, target) => {
    target = target.trim();
    const label = esc((alias || target).trim());
    if (BY_ID[target]) {
      return `<a href="#/${target}">${label}</a>`;
    }
    return `<span class="unresolved" title="page not found">${label}</span>`;
  });
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return h;
}

function renderBody(body) {
  // drop the leading "# Title" -- the title is shown separately
  const lines = body.split("\n");
  if (lines.length && lines[0].startsWith("# ")) lines.shift();
  const blocks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) blocks.push(cur.join("\n"));
    cur = [];
  };
  for (const ln of lines) {
    if (/^\s*$/.test(ln)) flush();
    else cur.push(ln);
  }
  flush();
  const out = [];
  for (const b of blocks) {
    const bl = b.split("\n");
    if (/^#{1,3} /.test(bl[0])) {
      out.push(`<div class="md-h">${renderInline(bl[0].replace(/^#{1,3} /, ""))}</div>`);
      const rest = bl.slice(1).join("\n").trim();
      if (rest) out.push(`<p>${renderInline(rest)}</p>`);
    } else if (/^---+$/.test(bl[0].trim())) {
      out.push(`<div class="bar"></div>`);
    } else if (bl.every((l) => /^\s*-\s+/.test(l))) {
      out.push("<ul>" + bl.map((l) => `<li>${renderInline(l.replace(/^\s*-\s+/, ""))}</li>`).join("") + "</ul>");
    } else {
      out.push(`<p>${renderInline(bl.join(" "))}</p>`);
    }
  }
  return `<div class="md">${out.join("\n")}</div>`;
}

function metaLine(p) {
  const bits = [p.type, p.category, p.kind, p.date, p.status, p.authors].filter(Boolean);
  return bits.map(esc).join(" · ");
}

/* ---------- cite box (readings) ---------- */
function apaRef(p) {
  const parts = [];
  if (p.authors) parts.push(p.authors);
  parts.push(p.year ? `(${p.year})` : "(n.d.)");
  if (p.title) parts.push(p.title + ".");
  if (p.venue) parts.push(p.venue + ".");
  if (p.url) parts.push(p.url);
  return parts.join(" ");
}

function bibtex(p) {
  const key = p.id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const entry = p.kind === "book" ? "book" : p.kind === "article" ? "article" : "misc";
  const f = [];
  if (p.authors) f.push(`  author = {${p.authors}}`);
  if (p.title) f.push(`  title = {${p.title}}`);
  if (p.year) f.push(`  year = {${p.year}}`);
  if (p.venue) f.push(`  journal = {${p.venue}}`);
  if (p.url) f.push(`  url = {${p.url}}`);
  return `@${entry}{${key},\n${f.join(",\n")}\n}`;
}

function citeBox(p) {
  const apa = apaRef(p);
  const bib = bibtex(p);
  return `<div class="bar"></div>
<div class="sec-title">CITE</div>
<div class="citebox">
<div class="small">APA</div>
<pre id="cite-apa">${esc(apa)}</pre>
<div class="row"><span class="fixed"><button data-copy="cite-apa">[copy] apa</button></span></div>
<div class="small">BibTeX</div>
<pre id="cite-bib">${esc(bib)}</pre>
<div class="row"><span class="fixed"><button data-copy="cite-bib">[copy] bibtex</button></span></div>
</div>`;
}

function copyText(text, btn) {
  const done = () => {
    const old = btn.textContent;
    btn.textContent = "[copied]";
    setTimeout(() => (btn.textContent = old), 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    done();
  }
}

/* ---------- shared ---------- */
function setView(html) {
  const v = document.getElementById("view");
  v.innerHTML = html;
  return v;
}

function rowHtml(p, snippet) {
  return `<div class="result"><div class="result-head" data-open="${p.id}">
<span class="t" style="font-weight:bold">&gt; ${esc(p.title)}</span>
<div class="meta">${esc(metaLine(p))}</div></div>
${snippet ? `<div class="snip">${snippet}</div>` : ""}</div>`;
}

function snippetFor(p, q) {
  if (!q) return esc(p.body.replace(/\n+/g, " ").slice(0, 140)) + (p.body.length > 140 ? "..." : "");
  const low = p.body.toLowerCase();
  const i = low.indexOf(q);
  if (i < 0) return "";
  const s = Math.max(0, i - 60);
  const sn = p.body.slice(s, s + 200).replace(/\n+/g, " ");
  return esc((s > 0 ? "..." : "") + sn + "...");
}

function visiblePages() {
  return PAGES.filter((p) => p.type !== "template");
}

function bindOpen(root) {
  root.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = "#/" + el.getAttribute("data-open");
    });
  });
}

function backlinks(id) {
  return visiblePages().filter((p) => p.id !== id && p.links.includes(id));
}

/* ---------- home: search bar + results ---------- */
function doSearch() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const pages = visiblePages();
  const hits = q
    ? pages.filter((p) =>
        (p.title + " " + p.label + " " + p.body + " " + p.authors + " " + p.category + " " + p.id)
          .toLowerCase()
          .includes(q)
      )
    : pages;
  document.getElementById("results").innerHTML =
    `<div class="small" style="margin-bottom:8px">${hits.length} result${hits.length === 1 ? "" : "s"}${q ? ` for "${esc(q)}"` : ""}</div>` +
    hits.map((p) => rowHtml(p, q ? snippetFor(p, q) : "")).join("");
  bindOpen(document.getElementById("results"));
}

function viewHome() {
  document.title = "commonplace";
  const v = setView(`
<div class="bar"></div>
<div class="sec-title">FIND</div>
<div class="row bigsearch">
  <input type="text" id="q" placeholder="search title / notes / author ..." autocomplete="off">
  <span class="fixed"><button id="clearq">[x] clear</button></span>
</div>
<div id="results"></div>`);
  const q = v.querySelector("#q");
  q.addEventListener("input", doSearch);
  v.querySelector("#clearq").addEventListener("click", () => {
    q.value = "";
    doSearch();
    q.focus();
  });
  doSearch();
  q.focus();
}

/* ---------- to do: grouped by type ---------- */
function viewTodo() {
  document.title = "commonplace — to do";
  const groups = [
    ["question", "QUESTIONS"],
    ["film", "FILMS"],
    ["reading", "READINGS"],
    ["book", "BOOKS"],
  ];
  let html = "";
  for (const [type, label] of groups) {
    const items = visiblePages()
      .filter((p) => p.type === type && p.status === "todo")
      .sort((a, b) => a.title.localeCompare(b.title));
    html += `<div class="bar"></div><div class="sec-title">${label} <span>(${items.length})</span></div>`;
    html += items.length
      ? items.map((p) => rowHtml(p, "")).join("")
      : `<div class="small">nothing here.</div>`;
  }
  const v = setView(html);
  bindOpen(v);
}

/* ---------- all pages: compact list grouped by type ---------- */
const TYPE_GROUPS = [
  ["question", "QUESTIONS"],
  ["reading", "READINGS"],
  ["film", "FILMS"],
  ["book", "BOOKS"],
  ["hub", "HUBS"],
];

function viewPages() {
  document.title = "commonplace — pages";
  const v = setView(`
<div class="bar"></div>
<div class="sec-title">ALL PAGES</div>
<div class="row"><input type="text" id="fq" placeholder="filter ..." autocomplete="off"></div>
<div id="pagelist"></div>`);
  const linkRow = (p, metaBits) =>
    `<div class="link"><a href="#/${p.id}">${esc(p.title)}</a> <span class="meta">${esc(metaBits.filter(Boolean).join(" · "))}</span></div>`;
  const render = () => {
    const q = v.querySelector("#fq").value.trim().toLowerCase();
    const box = v.querySelector("#pagelist");
    if (!q) {
      let html = "";
      for (const [type, label] of TYPE_GROUPS) {
        const items = visiblePages()
          .filter((p) => p.type === type)
          .sort((a, b) => a.title.localeCompare(b.title));
        if (!items.length) continue;
        html += `<div class="bar"></div><div class="sec-title">${label} <span>(${items.length})</span></div>`;
        html += items.map((p) => linkRow(p, [p.category, p.status])).join("");
      }
      box.innerHTML = html;
    } else {
      const hits = visiblePages()
        .filter((p) => (p.title + " " + p.id).toLowerCase().includes(q))
        .sort((a, b) => a.title.localeCompare(b.title));
      box.innerHTML =
        `<div class="small" style="margin:8px 0">${hits.length} match${hits.length === 1 ? "" : "es"}</div>` +
        hits.map((p) => linkRow(p, [p.type, p.category])).join("");
    }
  };
  v.querySelector("#fq").addEventListener("input", render);
  render();
}

/* ---------- graph (d3-force, canvas) ---------- */
let sim = null;

function graphData() {
  const pages = visiblePages();
  const ids = new Set(pages.map((p) => p.id));
  const nodes = pages.map((p) => ({ id: p.id, label: p.title, degree: 0 }));
  const edges = [];
  const seen = new Set();
  for (const p of pages) {
    for (const t of p.links) {
      if (!ids.has(t)) continue;
      const k = p.id < t ? p.id + "|" + t : t + "|" + p.id;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: p.id, target: t, dashed: false });
    }
  }
  const decisions = getDecisions();
  for (const s of INBOX) {
    if (s.status !== "pending") continue;
    if (decisions[inboxKey(s)]) continue;
    if (!ids.has(s.from) || !ids.has(s.to)) continue;
    const k = s.from < s.to ? s.from + "|" + s.to : s.to + "|" + s.from;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ source: s.from, target: s.to, dashed: true });
  }
  const deg = {};
  for (const e of edges) {
    deg[e.source] = (deg[e.source] || 0) + 1;
    deg[e.target] = (deg[e.target] || 0) + 1;
  }
  for (const n of nodes) {
    n.degree = deg[n.id] || 0;
    n.r = 3 + Math.sqrt(n.degree) * 2.2;
  }
  return { nodes, edges };
}

function drawGraph() {
  const canvas = document.getElementById("graph-canvas");
  if (typeof d3 === "undefined" || !d3.forceSimulation) {
    canvas.outerHTML = `<div class="small">graph library failed to load.</div>`;
    return;
  }
  const { nodes, edges } = graphData();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = 460;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  canvas.style.touchAction = "none";
  const ctx = canvas.getContext("2d");

  const view = { k: 1, x: 0, y: 0 };
  let hoverNode = null;
  let nodeDrag = null;
  let panDrag = null;
  let userMoved = false;

  if (sim) sim.stop();
  // seed positions on a circle so first paint is stable
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    n.x = w / 2 + Math.cos(a) * Math.min(w, h) * 0.3;
    n.y = h / 2 + Math.sin(a) * Math.min(w, h) * 0.3;
  });
  sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id((d) => d.id).distance(60))
    .force("charge", d3.forceManyBody().strength(-70))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collide", d3.forceCollide().radius((d) => d.r + 12));

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);
    for (const e of edges) {
      ctx.beginPath();
      ctx.strokeStyle = "#999";
      ctx.setLineDash(e.dashed ? [4, 4] : []);
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "11px ui-monospace, Menlo, monospace";
    for (const n of nodes) {
      ctx.beginPath();
      ctx.fillStyle = n === hoverNode || (nodeDrag && nodeDrag.n === n) ? "#111" : "#fff";
      ctx.strokeStyle = "#111";
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111";
      const label = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
      ctx.fillText(label, n.x + n.r + 4, n.y + 4);
    }
  }

  function fitView() {
    if (!nodes.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x - n.r - 40); y0 = Math.min(y0, n.y - n.r - 14);
      x1 = Math.max(x1, n.x + n.r + 40); y1 = Math.max(y1, n.y + n.r + 14);
    }
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const k = Math.min(2, Math.max(0.15, Math.min((w - 40) / bw, (h - 40) / bh)));
    view.k = k;
    view.x = (w - bw * k) / 2 - x0 * k;
    view.y = (h - bh * k) / 2 - y0 * k;
    paint();
  }

  let ticks = 0, fitted = false;
  sim.on("tick", () => {
    paint();
    if (!fitted && !userMoved && ++ticks > 120) { fitted = true; fitView(); }
  });
  paint();

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const toWorld = (x, y) => ({ x: (x - view.x) / view.k, y: (y - view.y) / view.k });
  const hit = (x, y) => {
    const p = toWorld(x, y);
    let best = null, bestD = 1e9;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 8 / view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  canvas.onpointerdown = (ev) => {
    const { x, y } = pos(ev);
    const n = hit(x, y);
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    if (n) {
      const p = toWorld(x, y);
      nodeDrag = { n, sx: x, sy: y, moved: false };
      n.fx = p.x; n.fy = p.y;
      sim.alphaTarget(0.3).restart();
    } else {
      panDrag = { sx: x, sy: y, vx: view.x, vy: view.y, moved: false };
    }
    canvas.style.cursor = "grabbing";
  };
  canvas.onpointermove = (ev) => {
    const { x, y } = pos(ev);
    if (nodeDrag) {
      if (Math.hypot(x - nodeDrag.sx, y - nodeDrag.sy) > 4) nodeDrag.moved = true;
      const p = toWorld(x, y);
      nodeDrag.n.fx = p.x; nodeDrag.n.fy = p.y;
      return;
    }
    if (panDrag) {
      if (Math.hypot(x - panDrag.sx, y - panDrag.sy) > 4) {
        panDrag.moved = true;
        userMoved = true;
      }
      view.x = panDrag.vx + (x - panDrag.sx);
      view.y = panDrag.vy + (y - panDrag.sy);
      paint();
      return;
    }
    hoverNode = hit(x, y);
    canvas.style.cursor = hoverNode ? "pointer" : "grab";
    paint();
  };
  const endPointer = (ev) => {
    if (nodeDrag) {
      const n = nodeDrag.n, moved = nodeDrag.moved;
      n.fx = null; n.fy = null;
      nodeDrag = null;
      sim.alphaTarget(0);
      if (ev && !moved) {
        const { x, y } = pos(ev);
        if (hit(x, y) === n) location.hash = "#/" + n.id;
      }
    }
    panDrag = null;
    canvas.style.cursor = "grab";
  };
  canvas.onpointerup = endPointer;
  canvas.onpointercancel = () => endPointer(null);
  canvas.onpointerleave = () => { hoverNode = null; if (!nodeDrag && !panDrag) paint(); };
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    userMoved = true;
    const { x, y } = pos(ev);
    const k2 = Math.min(4, Math.max(0.15, view.k * Math.exp(-ev.deltaY * 0.0015)));
    view.x = x - (x - view.x) * (k2 / view.k);
    view.y = y - (y - view.y) * (k2 / view.k);
    view.k = k2;
    paint();
  }, { passive: false });

  const resetBtn = document.getElementById("graph-reset");
  if (resetBtn) resetBtn.onclick = () => { fitted = true; fitView(); };
}

function viewGraph() {
  document.title = "commonplace — graph";
  setView(`
<div class="bar"></div>
<div class="sec-title">GRAPH</div>
<div class="small" style="margin-bottom:8px">nodes sized by degree. dashed edge = suggested link. scroll to zoom, drag background to pan, drag node to move, click node to open. <button id="graph-reset">[.] reset view</button></div>
<canvas id="graph-canvas"></canvas>`);
  drawGraph();
}

/* ---------- inbox ---------- */
function inboxKey(s) {
  return s.from + "→" + s.to;
}
function getDecisions() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch (e) {
    return {};
  }
}
function setDecision(key, val) {
  const d = getDecisions();
  d[key] = val;
  localStorage.setItem(LS_KEY, JSON.stringify(d));
}

function pendingInbox() {
  const decisions = getDecisions();
  return INBOX.filter((s) => s.status === "pending" && !decisions[inboxKey(s)]);
}
function acceptedInbox() {
  const decisions = getDecisions();
  return INBOX.filter(
    (s) => s.status === "approved" || decisions[inboxKey(s)] === "accepted"
  );
}

function updateInboxCount() {
  const n = pendingInbox().length;
  const el = document.getElementById("inbox-link");
  if (el) el.textContent = `[inbox${n ? " (" + n + ")" : ""}]`;
}

function renderInbox(note) {
  const pending = pendingInbox();
  const accepted = acceptedInbox();
  document.getElementById("inbox-n").textContent = `(${pending.length})`;
  const item = (s) => {
    const from = BY_ID[s.from];
    const to = BY_ID[s.to];
    return `<div class="inbox-item">
<div><a href="#/${s.from}">${esc(from ? from.title : s.from)}</a> <span class="meta">-&gt;</span> <a href="#/${s.to}">${esc(to ? to.title : s.to)}</a></div>
${s.reason ? `<div class="small">${esc(s.reason)}</div>` : ""}
<div class="row" style="margin-top:6px">
<span class="fixed"><button data-accept="${esc(s.from)}|${esc(s.to)}">[accept]</button></span>
<span class="fixed"><button data-reject="${esc(s.from)}|${esc(s.to)}">[reject]</button></span>
</div></div>`;
  };
  let html = "";
  if (note) html += `<div class="small" style="margin-bottom:8px">${esc(note)}</div>`;
  html += pending.map(item).join("");
  if (accepted.length) {
    html += `<div class="bar"></div><div class="small" style="margin-bottom:4px">accepted</div>`;
    html += accepted
      .map(
        (s) => `<div class="inbox-item"><div class="small">${esc(s.from)} -&gt; ${esc(s.to)}</div>
<div class="row" style="margin-top:4px"><span class="fixed"><button data-copyb="${esc(s.to)}">[copy] [[${esc(s.to)}]]</button></span></div></div>`
      )
      .join("");
  }
  if (!pending.length && !accepted.length) {
    html += `<div class="small">inbox zero. the llm is quiet.</div>`;
  }
  const box = document.getElementById("inbox");
  box.innerHTML = html;
  box.querySelectorAll("[data-accept]").forEach((b) =>
    b.addEventListener("click", () => {
      const [from, to] = b.getAttribute("data-accept").split("|");
      setDecision(from + "→" + to, "accepted");
      copyText(`[[${to}]]`, b);
      renderInbox(`copied [[${to}]] -- paste it into the page "${from}" in Obsidian.`);
    })
  );
  box.querySelectorAll("[data-reject]").forEach((b) =>
    b.addEventListener("click", () => {
      const [from, to] = b.getAttribute("data-reject").split("|");
      setDecision(from + "→" + to, "rejected");
      renderInbox();
    })
  );
  box.querySelectorAll("[data-copyb]").forEach((b) =>
    b.addEventListener("click", () => copyText(`[[${b.getAttribute("data-copyb")}]]`, b))
  );
  updateInboxCount();
}

function viewInbox() {
  document.title = "commonplace — inbox";
  setView(`
<div class="bar"></div>
<div class="sec-title">INBOX <span id="inbox-n"></span></div>
<div class="small" style="margin-bottom:8px">suggested links from the llm. accept copies the link -- paste it into the page in Obsidian.</div>
<div id="inbox"></div>`);
  renderInbox();
}

/* ---------- page view ---------- */
function viewPage(id) {
  const p = BY_ID[id];
  document.title = p ? `commonplace — ${p.title}` : "commonplace";
  if (!p) {
    setView(`<div class="bar"></div><div class="pg-title">not found</div><div class="small">no page with id "${esc(id)}".</div>`);
    return;
  }
  const bl = backlinks(id);
  const v = setView(`
<div class="row"><span class="fixed"><button id="back">[&lt;] back</button></span></div>
<div class="pg-title">${esc(p.title)}</div>
<div class="pg-meta">${esc(metaLine(p))}</div>
<div class="bar"></div>
${renderBody(p.body)}
${p.type === "reading" ? citeBox(p) : ""}
<div class="bar"></div>
<div class="sec-title">BACKLINKS <span>(${bl.length})</span></div>
${bl.length ? bl.map((b) => `<div class="link"><a href="#/${b.id}">${esc(b.title)}</a></div>`).join("") : `<div class="small">nothing links here yet.</div>`}
`);
  v.querySelector("#back").addEventListener("click", () => {
    location.hash = "#/";
  });
  v.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = document.getElementById(btn.getAttribute("data-copy"));
      copyText(src.textContent, btn);
    });
  });
}

/* ---------- router ---------- */
function route() {
  if (sim) {
    sim.stop();
    sim = null;
  }
  const h = location.hash || "#/";
  document.querySelectorAll("#nav .tab").forEach((t) =>
    t.classList.toggle("on", t.getAttribute("data-go") === h)
  );
  let pageId = null;
  if (h.startsWith("#/") && h.length > 2) {
    try {
      pageId = decodeURIComponent(h.slice(2));
    } catch (e) {
      pageId = null;
    }
  }
  if (h === "#/todo") viewTodo();
  else if (h === "#/graph") viewGraph();
  else if (h === "#/pages") viewPages();
  else if (h === "#/inbox") viewInbox();
  else if (pageId && BY_ID[pageId]) viewPage(pageId);
  else viewHome();
  window.scrollTo(0, 0);
}

/* ---------- boot ---------- */
async function init() {
  const [idx, inbox] = await Promise.all([
    fetch("index.json").then((r) => r.json()),
    fetch("inbox.json").then((r) => r.json()),
  ]);
  PAGES = idx.pages;
  BY_ID = {};
  for (const p of PAGES) BY_ID[p.id] = p;
  INBOX = inbox;

  document.querySelectorAll("#nav .tab").forEach((t) =>
    t.addEventListener("click", () => {
      location.hash = t.getAttribute("data-go");
    })
  );

  updateInboxCount();
  window.addEventListener("hashchange", route);
  route();
}

document.addEventListener("DOMContentLoaded", init);
