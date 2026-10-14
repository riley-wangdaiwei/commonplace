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

/* ---------- lists ---------- */
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

function renderToread() {
  const items = visiblePages()
    .filter((p) => p.status === "todo" && p.type !== "hub")
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.title.localeCompare(b.title)));
  document.getElementById("toread-n").textContent = `(${items.length})`;
  document.getElementById("toread").innerHTML = items.length
    ? items.map((p) => rowHtml(p, "")).join("")
    : `<div class="small">queue is empty. enjoy.</div>`;
  bindOpen(document.getElementById("toread"));
}

function renderNodes() {
  const items = visiblePages().sort((a, b) => a.title.localeCompare(b.title));
  document.getElementById("count").textContent = `(${items.length})`;
  document.getElementById("list").innerHTML = items
    .map(
      (p) => `<div class="link"><a href="#/${p.id}">${esc(p.title)}</a> <span class="meta">${esc([p.type, p.category].filter(Boolean).join(" · "))}</span></div>`
    )
    .join("");
}

function bindOpen(root) {
  root.querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = "#/" + el.getAttribute("data-open");
    });
  });
}

/* ---------- page view ---------- */
function backlinks(id) {
  return visiblePages().filter((p) => p.id !== id && p.links.includes(id));
}

function showPage(id) {
  const p = BY_ID[id];
  document.getElementById("view-home").style.display = "none";
  const vp = document.getElementById("view-page");
  vp.style.display = "";
  if (!p) {
    document.getElementById("page").innerHTML = `<div class="pg-title">not found</div><div class="small">no page with id "${esc(id)}".</div>`;
    document.title = "commonplace";
    return;
  }
  document.title = `commonplace — ${p.title}`;
  const bl = backlinks(id);
  document.getElementById("page").innerHTML = `
<div class="pg-title">${esc(p.title)}</div>
<div class="pg-meta">${esc(metaLine(p))}</div>
<div class="bar"></div>
${renderBody(p.body)}
${p.type === "reading" ? citeBox(p) : ""}
<div class="bar"></div>
<div class="sec-title">BACKLINKS <span>(${bl.length})</span></div>
${bl.length ? bl.map((b) => `<div class="link"><a href="#/${b.id}">${esc(b.title)}</a></div>`).join("") : `<div class="small">nothing links here yet.</div>`}
`;
  vp.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = document.getElementById(btn.getAttribute("data-copy"));
      copyText(src.textContent, btn);
    });
  });
}

function showHome() {
  document.title = "commonplace";
  document.getElementById("view-page").style.display = "none";
  document.getElementById("view-home").style.display = "";
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
  const h = 420;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  let hoverNode = null;
  let dragNode = null;

  if (sim) sim.stop();
  // seed positions on a circle so first paint is stable
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    n.x = w / 2 + Math.cos(a) * Math.min(w, h) * 0.35;
    n.y = h / 2 + Math.sin(a) * Math.min(w, h) * 0.35;
  });
  sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id((d) => d.id).distance(70))
    .force("charge", d3.forceManyBody().strength(-140))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collide", d3.forceCollide().radius((d) => d.r + 16));

  function paint() {
    ctx.clearRect(0, 0, w, h);
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
      ctx.fillStyle = n === hoverNode || n === dragNode ? "#111" : "#fff";
      ctx.strokeStyle = "#111";
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111";
      const label = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
      ctx.fillText(label, n.x + n.r + 4, n.y + 4);
    }
  }
  sim.on("tick", paint);

  paint();
  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const hit = (x, y) => {
    let best = null;
    let bestD = 1e9;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < n.r + 6 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };
  canvas.onmousemove = (ev) => {
    const { x, y } = pos(ev);
    if (dragNode) {
      dragNode.fx = x;
      dragNode.fy = y;
      return;
    }
    hoverNode = hit(x, y);
    canvas.style.cursor = hoverNode ? "pointer" : "grab";
    paint();
  };
  canvas.onmousedown = (ev) => {
    const { x, y } = pos(ev);
    const n = hit(x, y);
    if (n) {
      dragNode = n;
      n.fx = x; n.fy = y;
      sim.alphaTarget(0.3).restart();
      canvas.style.cursor = "grabbing";
    }
  };
  const endDrag = (ev) => {
    if (dragNode) {
      const moved = ev && Math.hypot(dragNode.fx - pos(ev).x, dragNode.fy - pos(ev).y) > 4;
      dragNode.fx = null;
      dragNode.fy = null;
      dragNode = null;
      sim.alphaTarget(0);
      if (ev && !moved) {
        // treat as click
        const { x, y } = pos(ev);
        const n = hit(x, y);
        if (n) location.hash = "#/" + n.id;
      }
    }
  };
  canvas.onmouseup = endDrag;
  canvas.onmouseleave = () => { hoverNode = null; endDrag(null); paint(); };
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

function renderInbox(note) {
  const decisions = getDecisions();
  const pending = INBOX.filter((s) => s.status === "pending" && !decisions[inboxKey(s)]);
  const accepted = INBOX.filter(
    (s) => s.status === "approved" || decisions[inboxKey(s)] === "accepted"
  );
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
<div class="row" style="margin-top:4px"><span class="fixed"><button data-copyd="${esc(s.to)}">[copy] [[${esc(s.to)}]]</button></span></div></div>`
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
}

/* ---------- boot ---------- */
function route() {
  const h = location.hash;
  if (h.startsWith("#/") && h.length > 2) showPage(decodeURIComponent(h.slice(2)));
  else showHome();
}

async function init() {
  const [idx, inbox] = await Promise.all([
    fetch("index.json").then((r) => r.json()),
    fetch("inbox.json").then((r) => r.json()),
  ]);
  PAGES = idx.pages;
  BY_ID = {};
  for (const p of PAGES) BY_ID[p.id] = p;
  INBOX = inbox;

  document.getElementById("q").addEventListener("input", doSearch);
  document.getElementById("clearq").addEventListener("click", () => {
    document.getElementById("q").value = "";
    doSearch();
    document.getElementById("q").focus();
  });
  document.getElementById("draw").addEventListener("click", drawGraph);
  document.getElementById("back").addEventListener("click", () => {
    location.hash = "";
  });

  doSearch();
  renderToread();
  renderNodes();
  renderInbox();
  drawGraph();
  window.addEventListener("hashchange", route);
  route();
}

document.addEventListener("DOMContentLoaded", init);
