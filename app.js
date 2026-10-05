/* reading-notes MVP
   node = { id, type, title, category, kind, url, date, status,
            notes, links:[{to, why}], suggested_links:[] }
   links[] is human-only. suggested_links[] is llm-propose-only (ui later).
*/
"use strict";

var LS_KEY = "reading-nodes-v1";
var LS_CFG = "reading-notes-cfg-v1";
var CATS_KEY = "reading-cats-v1";
var FILMS_KEY = "commonplace-films-v1";
var BOOKS_KEY = "commonplace-books-v1";
var GIST_FILE = "reading-nodes.json";

var CATS = [
  ["game-theory", "game theory"],
  ["web3", "web3"],
  ["privacy", "privacy research"],
  ["gambia-drug", "gambia: drug prevention"],
  ["gambia-remit", "gambia: remittance"],
  ["gambia-data", "gambia: data gap"],
  ["general", "general"]
];
var KINDS = ["paper", "article", "digest", "thread", "book", "other"];

var nodes = [];
var cfg = {};
var cats = [];
var films = [];
var books = [];
var openFilm = null;
var openBook = null;
var filterCat = "all";
var filterType = "all";
var query = "";
var openId = null;
var pushTimer = null;

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function uid() {
  return "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
function today() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function catLabel(c) {
  for (var i = 0; i < cats.length; i++) if (cats[i][0] === c) return cats[i][1];
  return c;
}
function byId(id) {
  for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
  return null;
}

/* ---------- seed: first node, logged by mu ---------- */
function seed() {
  return [{
    id: "n-mcp-48h-20261004",
    type: "reading",
    title: "MCP servers had a rough 48 hours: 4 unauthenticated CVEs",
    label: "MCP auth CVEs",
    category: "privacy",
    kind: "digest",
    url: "https://dev.to/kielltampubolon/mcp-servers-had-a-rough-48-hours-4-unauthenticated-cves-4oco",
    date: "2026-10-04",
    status: "partial",
    authors: "kielltampubolon",
    year: "2026",
    venue: "dev.to",
    thesis: "多个 MCP 服务器把工具接口裸奔上网, 认证缺失是系统性问题",
    quotes: "",
    critique: "",
    notes: [
      "- 4 个 MCP 服务器的 HTTP/SSE 工具接口没设认证, 谁都能连 (CVSS 9.8/10.0)",
      "- GitLab Workhorse 那个最狠: 工具调用能把服务器环境变量读出来 -- 字符串越过信任边界",
      "- LiteLLM: 有认证检查, 但任意 Bearer token 都被当成合法 (假锁), 已确认被利用, 进了 CISA KEV",
      "- CVE = 漏洞身份证号; CVSS = 严重程度打分; KEV = 正在被利用名单",
      "- 研究连接: 没认证 = 系统不知道用户是谁 = 同意(consent)无处可挂, 同意机制直接失效"
    ].join("\n"),
    links: [],
    suggested_links: []
  }];
}

/* ---------- graph: metrics + force layout + link prediction ---------- */
var PALETTE = ["#ffffff", "#e8e8e8", "#d4d4d4", "#c0c0c0", "#a8a8a8", "#909090", "#787878"];
function catColor(c) {
  var h = 0;
  for (var i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function graphData(list) {
  var arr = list || nodes;
  var ns = arr.map(function (n) { return { id: n.id, title: n.title, label: n.label || "", cat: n.category, type: n.type || "reading" }; });
  var idx = {};
  ns.forEach(function (x, i) { idx[x.id] = i; });
  var edges = [];
  function addEdge(a, b, kind, why) {
    if (idx[b] == null || idx[a] >= idx[b]) return;
    for (var i = 0; i < edges.length; i++)
      if (edges[i].a === a && edges[i].b === b) return;
    edges.push({ a: a, b: b, kind: kind, why: why || "" });
  }
  nodes.forEach(function (n) {
    if (idx[n.id] == null) return;
    (n.links || []).forEach(function (l) { addEdge(n.id, l.to, "mine", l.why); });
    (n.suggested_links || []).forEach(function (l) {
      if (l.status === "pending") addEdge(n.id, l.to, "suggested", l.reason);
    });
  });
  return { ns: ns, idx: idx, edges: edges };
}
function graphMetrics(g) {
  var deg = {}, adj = {};
  g.ns.forEach(function (x) { deg[x.id] = 0; adj[x.id] = {}; });
  g.edges.forEach(function (e) { deg[e.a]++; deg[e.b]++; adj[e.a][e.b] = 1; adj[e.b][e.a] = 1; });
  function tris(a, b) { var t = 0; for (var k in adj[a]) if (adj[b][k]) t++; return t; }
  // Forman-Ricci (augmented, unweighted): 4 - deg(u) - deg(v) + 3*triangles
  g.edges.forEach(function (e) { e.tri = tris(e.a, e.b); e.curv = 4 - deg[e.a] - deg[e.b] + 3 * e.tri; });
  var nc = {};
  g.ns.forEach(function (x) { nc[x.id] = []; });
  g.edges.forEach(function (e) { nc[e.a].push(e.curv); nc[e.b].push(e.curv); });
  g.ncurv = {};
  g.ns.forEach(function (x) {
    var a = nc[x.id];
    g.ncurv[x.id] = a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0;
  });
  g.deg = deg;
  var cands = [];
  for (var i = 0; i < g.ns.length; i++) for (var j = i + 1; j < g.ns.length; j++) {
    var u = g.ns[i].id, v = g.ns[j].id;
    if (adj[u][v]) continue;
    var cn = 0;
    for (var k in adj[u]) if (adj[v][k]) cn++;
    if (cn > 0) {
      var union = deg[u] + deg[v] - cn;
      cands.push({ a: u, b: v, cn: cn, jac: union ? cn / union : 0 });
    }
  }
  cands.sort(function (x, y) { return y.cn - x.cn || y.jac - x.jac; });
  g.cands = cands.slice(0, 8);
  return g;
}
function layout(g, W, H) {
  var n = g.ns.length;
  if (!n) return;
  g.ns.forEach(function (x) {
    x.x = W / 2 + (Math.random() - 0.5) * W * 0.5;
    x.y = H / 2 + (Math.random() - 0.5) * H * 0.5;
    x.vx = 0; x.vy = 0;
  });
  var L = 130;
  for (var t = 0; t < 220; t++) {
    var i, j, a, b, dx, dy, d, f;
    for (i = 0; i < n; i++) {
      a = g.ns[i];
      for (j = i + 1; j < n; j++) {
        b = g.ns[j];
        dx = a.x - b.x; dy = a.y - b.y;
        d = Math.sqrt(dx * dx + dy * dy) + 0.1;
        f = 3500 / (d * d);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      a.vx += (W / 2 - a.x) * 0.004; a.vy += (H / 2 - a.y) * 0.004;
    }
    g.edges.forEach(function (e) {
      a = g.ns[g.idx[e.a]]; b = g.ns[g.idx[e.b]];
      dx = b.x - a.x; dy = b.y - a.y;
      d = Math.sqrt(dx * dx + dy * dy) + 0.1;
      f = (d - L) * 0.02;
      dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    });
    g.ns.forEach(function (x) {
      x.vx *= 0.85; x.vy *= 0.85;
      x.x = Math.max(34, Math.min(W - 34, x.x + x.vx));
      x.y = Math.max(22, Math.min(H - 22, x.y + x.vy));
    });
  }
}
function gname(id) {
  var n = byId(id);
  if (!n) return id;
  return n.label || n.title;
}
function renderGraphText(g) {
  var h = '<div class="sec-title" style="font-size:13px">EDGES -- Forman-Ricci curvature</div>';
  if (!g.edges.length) h += '<div class="small">no edges yet. add links inside a node.</div>';
  g.edges.slice().sort(function (a, b) { return a.curv - b.curv; }).forEach(function (e) {
    var tag = e.curv < 0 ? "bridge" : (e.curv > 0 ? "cluster" : "flat");
    h += '<div class="small">' + esc(gname(e.a)) + " -- " + esc(gname(e.b))
      + " : " + (e.curv > 0 ? "+" : "") + e.curv + " [" + tag + (e.kind === "suggested" ? ", suggested" : "") + "]</div>";
  });
  h += '<div class="sec-title" style="font-size:13px;margin-top:8px">LINK PREDICTION -- not linked yet</div>';
  if (!g.cands.length) h += '<div class="small">no candidates (needs shared neighbors).</div>';
  g.cands.forEach(function (c, i) {
    h += '<div class="small">' + esc(gname(c.a)) + " .. " + esc(gname(c.b))
      + " : common neighbors " + c.cn + ", jaccard " + c.jac.toFixed(2)
      + ' <button data-cand="' + i + '">[suggest]</button></div>';
  });
  h += '<div class="sec-title" style="font-size:13px;margin-top:8px">NODES</div>';
  g.ns.forEach(function (x) {
    h += '<div class="small">' + esc(x.label || x.title) + " [" + esc(x.type) + "] : degree " + (g.deg[x.id] || 0)
      + ", curvature " + (g.ncurv[x.id] >= 0 ? "+" : "") + g.ncurv[x.id].toFixed(1) + "</div>";
  });
  h += '<div class="small" style="margin-top:8px">curvature = 4 - deg(u) - deg(v) + 3*triangles.'
    + ' negative = bridge between neighborhoods; positive = inside a dense cluster.</div>';
  $("graph-text").innerHTML = h;
  $("graph-text").querySelectorAll("[data-cand]").forEach(function (btn) {
    btn.onclick = function () {
      var c = g.cands[+btn.getAttribute("data-cand")];
      var n = byId(c.a);
      n.suggested_links = n.suggested_links || [];
      var dup = n.suggested_links.some(function (s) { return s.to === c.b && s.status === "pending"; });
      if (dup) return;
      n.suggested_links.push({
        to: c.b, status: "pending",
        reason: "link prediction: " + c.cn + " common neighbor(s), jaccard " + c.jac.toFixed(2)
      });
      save(); render();
    };
  });
}
function drawGraph() {
  var cv = $("graph-canvas");
  if (!cv) return;
  var W = cv.parentElement.clientWidth || 800, H = 560;
  cv.width = W; cv.height = H;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  var ctx = cv.getContext("2d");
  ctx.font = "11px monospace";
  var g = graphMetrics(graphData(filtered()));
  if (!g.ns.length) {
    ctx.fillStyle = "#111"; ctx.fillText("no nodes", 20, 30);
  } else {
    layout(g, W, H);
    g.edges.forEach(function (e) {
      var a = g.ns[g.idx[e.a]], b = g.ns[g.idx[e.b]];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      if (e.kind === "suggested") { ctx.setLineDash([4, 4]); ctx.strokeStyle = "#999"; ctx.lineWidth = 1; }
      else {
        ctx.setLineDash([]);
        ctx.strokeStyle = e.curv < 0 ? "#a00" : "#111";
        ctx.lineWidth = e.curv < 0 ? 2.5 : 1.5;
      }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#555";
      ctx.fillText((e.curv > 0 ? "+" : "") + e.curv, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4);
    });
    g.ns.forEach(function (x) {
      var r = 9 + Math.min(12, (g.deg[x.id] || 0) * 3);
      ctx.beginPath(); ctx.arc(x.x, x.y, r, 0, 7);
      ctx.fillStyle = catColor(x.cat); ctx.fill();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#111";
      var label = x.label || (x.title.length > 20 ? x.title.slice(0, 19) + "…" : x.title);
      ctx.fillText(label, x.x + r + 4, x.y + 4);
    });
  }
  renderGraphText(g);
}

/* ---------- storage ---------- */
function load() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    nodes = raw ? JSON.parse(raw) : seed();
  } catch (e) { nodes = seed(); }
  try { cfg = JSON.parse(localStorage.getItem(LS_CFG) || "{}"); } catch (e) { cfg = {}; }
  try { films = JSON.parse(localStorage.getItem(FILMS_KEY) || "[]"); } catch (e) { films = []; }
  try { books = JSON.parse(localStorage.getItem(BOOKS_KEY) || "[]"); } catch (e) { books = []; }
  loadCats();
}
function loadCats() {
  try {
    var raw = localStorage.getItem(CATS_KEY);
    cats = raw ? JSON.parse(raw) : CATS.slice();
  } catch (e) { cats = CATS.slice(); }
  if (!cats.length) cats = CATS.slice();
}
function saveCats() {
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
}
function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || ("c" + Date.now().toString(36));
}
function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(nodes));
  localStorage.setItem(FILMS_KEY, JSON.stringify(films));
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
  schedulePush();
}

/* ---------- gist sync (same pattern as rithub) ---------- */
function setStatus(t) { $("status").textContent = t; }

function gistCall(method, path, body, cb) {
  if (!cfg.token) { cb(new Error("no token")); return; }
  var xhr = new XMLHttpRequest();
  xhr.open(method, "https://api.github.com" + path);
  xhr.setRequestHeader("Accept", "application/vnd.github+json");
  xhr.setRequestHeader("Authorization", "Bearer " + cfg.token);
  if (body) xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      cb(null, xhr.responseText ? JSON.parse(xhr.responseText) : null);
    } else cb(new Error("github " + xhr.status));
  };
  xhr.onerror = function () { cb(new Error("network")); };
  xhr.send(body ? JSON.stringify(body) : null);
}

function envelope() { return { updatedAt: new Date().toISOString(), nodes: nodes, films: films, books: books }; }

function gistPush() {
  if (!cfg.token || !cfg.gist) return;
  setStatus("pushing...");
  gistCall("PATCH", "/gists/" + cfg.gist,
    { files: { "reading-nodes.json": { content: JSON.stringify(envelope(), null, 1) } } },
    function (err) {
      if (err) { setStatus("push failed: " + err.message + " -- local copy is safe"); return; }
      setStatus("synced " + new Date().toLocaleTimeString() + " -- " + nodes.length + " nodes");
    });
}
function schedulePush() {
  if (!cfg.token || !cfg.gist) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(gistPush, 1500);
}
function gistPull() {
  if (!cfg.token || !cfg.gist) { setStatus("local only -- no gist connected"); return; }
  setStatus("pulling...");
  gistCall("GET", "/gists/" + cfg.gist, null, function (err, g) {
    if (err) { setStatus("pull failed: " + err.message + " -- using local copy"); render(); return; }
    try {
      var f = g.files[GIST_FILE] || g.files["reading-nodes.json"];
      var env = JSON.parse(f.content);
      if (env.nodes && env.nodes.length >= nodes.length) {
        nodes = env.nodes;
      } else if (env.nodes) {
        gistPush(); render(); renderMedia(); return;
      }
      if (env.films) films = env.films;
      if (env.books) books = env.books;
      localStorage.setItem(LS_KEY, JSON.stringify(nodes));
      localStorage.setItem(FILMS_KEY, JSON.stringify(films));
      localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
      setStatus("synced " + new Date().toLocaleTimeString() + " -- " + nodes.length + " nodes, " + films.length + " films, " + books.length + " books");
    } catch (e) { setStatus("gist parse failed -- using local copy"); }
    render(); renderMedia();
  });
}

/* ---------- markdown export (future wiki seed) ---------- */
function nodeMd(n) {
  var L = ["---", "id: " + n.id, "type: " + n.type,
    "title: " + JSON.stringify(n.title), "category: " + n.category,
    "label: " + JSON.stringify(n.label || ""),
    "kind: " + n.kind, "url: " + (n.url || ""), "date: " + n.date,
    "status: " + n.status,
    "authors: " + JSON.stringify(n.authors || ""),
    "year: " + JSON.stringify(n.year || ""),
    "venue: " + JSON.stringify(n.venue || ""),
    "thesis: " + JSON.stringify(n.thesis || "")];
  if (n.links && n.links.length) {
    L.push("links:");
    n.links.forEach(function (l) {
      L.push("  - to: " + l.to);
      if (l.why) L.push("    why: " + JSON.stringify(l.why));
    });
  } else L.push("links: []");
  var sl = (n.suggested_links || []).filter(function (s) { return s.status === "pending"; });
  if (sl.length) {
    L.push("suggested_links:");
    sl.forEach(function (s) {
      L.push("  - to: " + s.to);
      if (s.reason) L.push("    reason: " + JSON.stringify(s.reason));
    });
  }
  L.push("---", "");
  if (n.quotes) L.push("## quotes", "", n.quotes, "");
  if (n.critique) L.push("## critique", "", n.critique, "");
  L.push(n.notes || "", "");
  return L.join("\n");
}
function download(name, text) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { document.body.removeChild(a); }, 100);
}

/* ---------- render ---------- */
function filtered() {
  var q = query.trim().toLowerCase();
  return nodes.filter(function (n) {
    if (filterCat !== "all" && n.category !== filterCat) return false;
    if (filterType !== "all" && (n.type || "reading") !== filterType) return false;
    if (!q) return true;
    return (n.title + " " + (n.notes || "") + " " + (n.url || "")
      + " " + (n.authors || "") + " " + (n.thesis || "")).toLowerCase().indexOf(q) >= 0;
  });
}
function renderCats() {
  var h = '<span class="cat' + (filterCat === "all" ? " on" : "") + '" data-c="all">[all]</span>';
  cats.forEach(function (c) {
    h += '<span class="cat' + (filterCat === c[0] ? " on" : "") + '" data-c="' + esc(c[0]) + '">[' + esc(c[1]) + "]</span>";
  });
  $("cats").innerHTML = h;
  var els = $("cats").querySelectorAll(".cat");
  els.forEach(function (el) {
    el.onclick = function () { filterCat = el.getAttribute("data-c"); render(); };
  });
}
function renderTypes() {
  var ts = ["reading", "idea", "question", "concept"];
  var h = '<span class="cat' + (filterType === "all" ? " on" : "") + '" data-t="all">[all]</span>';
  ts.forEach(function (t) {
    h += '<span class="cat' + (filterType === t ? " on" : "") + '" data-t="' + t + '">[' + t + "]</span>";
  });
  $("types").innerHTML = h;
  $("types").querySelectorAll(".cat").forEach(function (el) {
    el.onclick = function () { filterType = el.getAttribute("data-t"); render(); };
  });
}
function render() {
  renderCats();
  renderTypes();
  renderCatManage();
  var list = filtered().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  $("count").textContent = "(" + list.length + "/" + nodes.length + ")";
  var h = "";
  list.forEach(function (n) {
    var open = openId === n.id ? " open" : "";
    h += '<div class="node' + open + '" data-id="' + esc(n.id) + '">';
    h += '<div class="node-head"><span class="t">' + esc(n.label || n.title) + '</span> '
      + '<span class="tag">' + esc(n.type || "reading") + '</span> '
      + '<span class="tag">' + esc(n.status) + "</span><br>"
      + '<span class="meta">' + esc(catLabel(n.category)) + " | " + esc(n.kind) + " | " + esc(n.date)
      + (n.links && n.links.length ? " | links:" + n.links.length : "")
      + "</span></div>";
    h += '<div class="node-body">';
    if (n.url) h += '<div class="row"><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.url) + "</a></div>";
    h += '<div class="row"><input type="text" data-f="url" placeholder="url" value="' + esc(n.url || "") + '"></div>';
    h += '<div class="row"><input type="text" data-f="label" placeholder="SHORT LABEL -- this is what the graph shows" value="' + esc(n.label || "") + '">'
      + '<span style="flex:0 0 120px"><select data-f="type">'
      + '<option value="reading"' + (n.type === "reading" ? " selected" : "") + '>reading</option>'
      + '<option value="idea"' + (n.type === "idea" ? " selected" : "") + '>idea</option>'
      + '<option value="question"' + (n.type === "question" ? " selected" : "") + '>question</option>'
      + '<option value="film"' + (n.type === "film" ? " selected" : "") + '>film</option>'
      + '<option value="book"' + (n.type === "book" ? " selected" : "") + '>book</option>'
      + '<option value="concept"' + (n.type === "concept" ? " selected" : "") + '>concept</option>'
      + "</select></span></div>";
    h += '<div class="sec-title" style="font-size:13px">BIB</div>'
      + '<div class="row"><input type="text" data-f="authors" placeholder="authors" value="' + esc(n.authors || "") + '">'
      + '<span style="flex:0 0 80px"><input type="text" data-f="year" placeholder="year" value="' + esc(n.year || "") + '"></span>'
      + '<input type="text" data-f="venue" placeholder="venue / journal" value="' + esc(n.venue || "") + '"></div>'
      + '<div class="row"><input type="text" data-f="thesis" placeholder="one line: what does it claim?" value="' + esc(n.thesis || "") + '"></div>'
      + '<div class="sec-title" style="font-size:13px">QUOTES</div>'
      + '<textarea data-f="quotes" style="min-height:56px">' + esc(n.quotes || "") + "</textarea>"
      + '<div class="sec-title" style="font-size:13px">CRITIQUE / MY TAKE</div>'
      + '<textarea data-f="critique" style="min-height:56px">' + esc(n.critique || "") + "</textarea>"
      + '<div class="sec-title" style="font-size:13px">NOTES</div>'
      + '<textarea data-f="notes">' + esc(n.notes || "") + "</textarea>";
    h += '<div class="sec-title" style="font-size:13px;margin-top:8px">LINKS (yours)</div><div data-f="links">';
    (n.links || []).forEach(function (l, i) {
      var t = byId(l.to);
      h += '<div class="link">' + esc(t ? t.title : l.to)
        + ' <span class="why">' + esc(l.why || "") + "</span> "
        + '<button data-act="unlink" data-i="' + i + '">[x]</button></div>';
    });
    h += "</div>";
    h += '<div class="sec-title" style="font-size:13px;margin-top:8px">SUGGESTED (metrics / llm -- your call)</div>';
    var pend = (n.suggested_links || []).map(function (s, i) { s._i = i; return s; })
      .filter(function (s) { return s.status === "pending"; });
    if (!pend.length) h += '<div class="small">none pending.</div>';
    pend.forEach(function (s) {
      var t = byId(s.to);
      h += '<div class="link" style="color:#555">? ' + esc(t ? t.title : s.to)
        + ' <span class="why">' + esc(s.reason || "") + "</span> "
        + '<button data-act="approve-s" data-i="' + s._i + '">[approve]</button>'
        + ' <button data-act="reject-s" data-i="' + s._i + '">[x]</button></div>';
    });
    h += '<div class="row" style="margin-top:6px"><select data-f="linkto"><option value="">-- link to --</option>';
    nodes.forEach(function (m) {
      if (m.id === n.id) return;
      h += '<option value="' + esc(m.id) + '">' + esc(m.title.slice(0, 60)) + "</option>";
    });
    h += '</select></div><div class="row"><input type="text" data-f="linkwhy" placeholder="why this link? (your call)">'
      + '<span class="fixed"><button data-act="link">[+] link</button></span></div>';
    h += '<div class="row" style="margin-top:8px">'
      + '<span class="fixed"><button data-act="save-notes">[ok] save</button></span>'
      + '<span class="fixed"><select data-f="status">'
      + ["todo", "partial", "done"].map(function (s) {
          return '<option value="' + s + '"' + (n.status === s ? " selected" : "") + ">" + s + "</option>";
        }).join("")
      + "</select></span>"
      + '<span class="fixed"><button data-act="export">[>] .md</button></span>'
      + '<span class="fixed"><button data-act="del" class="danger">[x] delete</button></span>'
      + "</div>";
    h += "</div></div>";
  });
  $("list").innerHTML = h || '<div class="small">no nodes yet. add one above.</div>';

  // wire events
  var nl = $("list").querySelectorAll(".node");
  nl.forEach(function (el) {
    var id = el.getAttribute("data-id");
    el.querySelector(".node-head").onclick = function () {
      openId = openId === id ? null : id; render();
    };
    el.querySelectorAll("button").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var act = b.getAttribute("data-act");
        var n = byId(id);
        if (act === "save-notes") {
          ["notes", "url", "label", "type", "status", "authors", "year", "venue", "thesis", "quotes", "critique"].forEach(function (f) {
            var inp = el.querySelector('[data-f="' + f + '"]');
            if (inp) n[f] = inp.value;
          });
          save(); setStatus("saved locally"); render();
        } else if (act === "link") {
          var to = el.querySelector('[data-f="linkto"]').value;
          var why = el.querySelector('[data-f="linkwhy"]').value.trim();
          if (!to) return;
          n.links = n.links || [];
          n.links.push({ to: to, why: why });
          save(); render();
        } else if (act === "unlink") {
          n.links.splice(parseInt(b.getAttribute("data-i"), 10), 1);
          save(); render();
        } else if (act === "approve-s") {
          var s = n.suggested_links[parseInt(b.getAttribute("data-i"), 10)];
          s.status = "approved";
          n.links = n.links || [];
          n.links.push({ to: s.to, why: s.reason || "" });
          save(); render();
        } else if (act === "reject-s") {
          n.suggested_links[parseInt(b.getAttribute("data-i"), 10)].status = "rejected";
          save(); render();
        } else if (act === "export") {
          download(n.id + ".md", nodeMd(n));
        } else if (act === "del") {
          if (confirm("delete this node? links pointing to it stay as text.")) {
            nodes = nodes.filter(function (m) { return m.id !== id; });
            if (openId === id) openId = null;
            save(); render();
          }
        }
      };
    });
  });
}

/* ---------- categories manager ---------- */
function syncCatSelect() {
  var fc = $("f-cat");
  var cur = fc.value;
  fc.innerHTML = "";
  cats.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c[0]; o.textContent = c[1];
    fc.appendChild(o);
  });
  if (cats.some(function (c) { return c[0] === cur; })) fc.value = cur;
}
function renderCatManage() {
  var h = "";
  cats.forEach(function (c) {
    h += '<span class="cat">' + esc(c[1])
      + ' <button data-cdel="' + esc(c[0]) + '" style="border:none;padding:0 4px" title="remove">[x]</button></span>';
  });
  $("cats-manage").innerHTML = h || '<span class="small">none</span>';
  $("cats-manage").querySelectorAll("[data-cdel]").forEach(function (b) {
    b.onclick = function () {
      var slug = b.getAttribute("data-cdel");
      cats = cats.filter(function (c) { return c[0] !== slug; });
      if (!cats.length) cats = CATS.slice();
      if (filterCat === slug) filterCat = "all";
      saveCats(); syncCatSelect(); render();
    };
  });
}

/* ---------- films & books (separate lists, not graph nodes) ---------- */
function filmById(id) { for (var i = 0; i < films.length; i++) if (films[i].id === id) return films[i]; return null; }
function bookById(id) { for (var i = 0; i < books.length; i++) if (books[i].id === id) return books[i]; return null; }
function normFilm(f) {
  return { id: f.id || uid(), title: f.title || "(untitled)", director: f.director || "",
           date: f.date || "", cinema: f.cinema || "", comment: f.comment || "",
           status: f.status === "done" ? "done" : "todo" };
}
function normBook(b) {
  return { id: b.id || uid(), title: b.title || "(untitled)", author: b.author || "",
           date: b.date || "", kind: b.kind || "book", url: b.url || "",
           status: b.status === "done" ? "done" : "todo", notes: b.notes || "" };
}
function mediaHtml(item, isF, openId, key) {
  var open = openId === item.id;
  var h = '<div class="node' + (open ? " open" : "") + '" ' + key + '="' + esc(item.id) + '">';
  h += '<div class="node-head"><span class="t">' + esc(item.title) + '</span> '
    + '<span class="tag">' + esc(item.status) + "</span><br>";
  var meta = isF ? [item.director, item.date, item.cinema] : [item.kind, item.author, item.date];
  h += '<span class="meta">' + esc(meta.filter(Boolean).join(" · ")) + "</span>";
  if (!isF && item.url) h += ' <a href="' + esc(item.url) + '" target="_blank" rel="noopener">[link]</a>';
  h += "</div>";
  h += '<div class="node-body">';
  h += '<div class="row"><input type="text" data-' + (isF ? "mf" : "mb") + '="title" value="' + esc(item.title) + '"></div>';
  if (isF) {
    h += '<div class="row"><input type="text" data-mf="director" placeholder="director" value="' + esc(item.director) + '">'
      + '<span style="flex:0 0 110px"><input type="text" data-mf="date" placeholder="date" value="' + esc(item.date) + '"></span>'
      + '<span style="flex:0 0 100px"><select data-mf="cinema"><option value="">cinema?</option>'
      + ["一人", "影院", "家庭"].map(function (c) { return '<option' + (item.cinema === c ? " selected" : "") + ">" + c + "</option>"; }).join("")
      + "</select></span>"
      + '<span style="flex:0 0 100px"><select data-mf="status">'
      + ["todo", "done"].map(function (s) { return '<option value="' + s + '"' + (item.status === s ? " selected" : "") + ">" + s + "</option>"; }).join("")
      + "</select></span></div>"
      + '<div class="sec-title" style="font-size:13px">COMMENT</div><textarea data-mf="comment">' + esc(item.comment) + "</textarea>";
  } else {
    h += '<div class="row"><input type="text" data-mb="author" placeholder="author" value="' + esc(item.author) + '">'
      + '<span style="flex:0 0 110px"><input type="text" data-mb="date" placeholder="date" value="' + esc(item.date) + '"></span>'
      + '<span style="flex:0 0 110px"><select data-mb="kind">'
      + ["book", "article", "video"].map(function (k) { return '<option value="' + k + '"' + (item.kind === k ? " selected" : "") + ">" + k + "</option>"; }).join("")
      + "</select></span>"
      + '<span style="flex:0 0 100px"><select data-mb="status">'
      + ["todo", "done"].map(function (s) { return '<option value="' + s + '"' + (item.status === s ? " selected" : "") + ">" + s + "</option>"; }).join("")
      + "</select></span></div>"
      + '<div class="row"><input type="text" data-mb="url" placeholder="url" value="' + esc(item.url) + '"></div>'
      + '<div class="sec-title" style="font-size:13px">NOTES</div><textarea data-mb="notes">' + esc(item.notes) + "</textarea>";
  }
  h += '<div class="row" style="margin-top:8px"><span class="fixed"><button data-mact="save">[ok] save</button></span>'
    + '<span class="fixed"><button data-mact="del" class="danger">[x] delete</button></span></div>';
  h += "</div></div>";
  return h;
}
function wireMediaBox(boxId, isF, list, byIdFn) {
  var box = $(boxId);
  box.querySelectorAll(".node").forEach(function (el) {
    var id = el.getAttribute(isF ? "data-fid" : "data-bid");
    el.querySelector(".node-head").onclick = function () {
      if (isF) openFilm = openFilm === id ? null : id;
      else openBook = openBook === id ? null : id;
      renderMedia();
    };
    el.querySelectorAll("button").forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var item = byIdFn(id);
        if (b.getAttribute("data-mact") === "save") {
          var pfx = isF ? "mf" : "mb";
          var fields = isF ? ["title", "director", "date", "cinema", "comment", "status"]
                           : ["title", "author", "date", "kind", "url", "notes", "status"];
          fields.forEach(function (ff) {
            var inp = el.querySelector('[data-' + pfx + '="' + ff + '"]');
            if (inp) item[ff] = inp.value;
          });
          save(); renderMedia();
        } else if (b.getAttribute("data-mact") === "del") {
          if (confirm("delete?")) {
            if (isF) films = films.filter(function (x) { return x.id !== id; });
            else books = books.filter(function (x) { return x.id !== id; });
            save(); renderMedia();
          }
        }
      };
    });
  });
}
function renderFilms() {
  var todo = films.filter(function (f) { return f.status !== "done"; });
  var done = films.filter(function (f) { return f.status === "done"; });
  $("films-todo-n").textContent = "(" + todo.length + ")";
  $("films-done-n").textContent = "(" + done.length + ")";
  $("films-todo").innerHTML = todo.map(function (f) { return mediaHtml(f, true, openFilm, "data-fid"); }).join("")
    || '<div class="small">nothing queued.</div>';
  $("films-done").innerHTML = done.map(function (f) { return mediaHtml(f, true, openFilm, "data-fid"); }).join("")
    || '<div class="small">nothing watched yet.</div>';
  wireMediaBox("view-films", true, films, filmById);
}
function renderBooks() {
  var todo = books.filter(function (b) { return b.status !== "done"; });
  var done = books.filter(function (b) { return b.status === "done"; });
  $("books-todo-n").textContent = "(" + todo.length + ")";
  $("books-done-n").textContent = "(" + done.length + ")";
  $("books-todo").innerHTML = todo.map(function (b) { return mediaHtml(b, false, openBook, "data-bid"); }).join("")
    || '<div class="small">nothing queued.</div>';
  $("books-done").innerHTML = done.map(function (b) { return mediaHtml(b, false, openBook, "data-bid"); }).join("")
    || '<div class="small">nothing read yet.</div>';
  wireMediaBox("view-books", false, books, bookById);
}
function renderMedia() { renderFilms(); renderBooks(); }

/* ---------- import ---------- */
function normalizeNode(n) {
  return {
    id: n.id || uid(), type: n.type || "reading", title: n.title || "(untitled)",
    label: n.label || "",
    category: n.category || "general", kind: n.kind || "other", url: n.url || "",
    date: n.date || today(), status: n.status || "partial",
    authors: n.authors || "", year: n.year || "", venue: n.venue || "",
    thesis: n.thesis || "", quotes: n.quotes || "", critique: n.critique || "",
    notes: n.notes || "", links: n.links || [], suggested_links: n.suggested_links || []
  };
}
function filmFromNode(n) {
  var cinema = "", comment = n.notes || "";
  var m = comment.match(/^watched:\s*(.*)$/m);
  if (m) { cinema = m[1].trim(); comment = comment.replace(m[0], "").trim(); }
  return normFilm({ id: n.id, title: n.title, director: n.authors || "", date: n.date || "",
                    cinema: cinema, comment: comment, status: n.status });
}
function bookFromNode(n) {
  return normBook({ id: n.id, title: n.title, author: n.authors || "", date: n.date || "",
                    kind: n.kind && n.kind !== "book" ? n.kind : "book", url: n.url || "",
                    status: n.status, notes: n.notes || "" });
}
function routeNode(n) {
  // films & books live in their own lists, never in the graph
  if (n.type === "film") { if (!filmById(n.id)) { films.push(filmFromNode(n)); return "film"; } return "dup"; }
  if (n.type === "book") { if (!bookById(n.id)) { books.push(bookFromNode(n)); return "book"; } return "dup"; }
  if (!byId(n.id)) { nodes.push(n); return "node"; }
  return "dup";
}
function wireImport() {
  $("do-import").onclick = function () {
    try {
      var data = JSON.parse($("import-text").value);
      var list = data.nodes || (Array.isArray(data) ? data : []);
      var added = { node: 0, film: 0, book: 0 }, skipped = 0;
      list.forEach(function (raw) {
        var r = routeNode(normalizeNode(raw));
        if (r === "dup") skipped++; else added[r]++;
      });
      (data.films || []).forEach(function (raw) {
        var f = normFilm(raw);
        if (!filmById(f.id)) { films.push(f); added.film++; } else skipped++;
      });
      (data.books || []).forEach(function (raw) {
        var b = normBook(raw);
        if (!bookById(b.id)) { books.push(b); added.book++; } else skipped++;
      });
      (data.categories || []).forEach(function (c) {
        if (!cats.some(function (x) { return x[0] === c[0]; })) cats.push(c);
      });
      saveCats(); syncCatSelect();
      $("import-text").value = "";
      save(); render(); renderMedia();
      $("import-msg").textContent = "imported nodes:" + added.node + " films:" + added.film
        + " books:" + added.book + " skipped:" + skipped;
    } catch (e) { $("import-msg").textContent = "bad json: " + e.message; }
  };
}

/* ---------- init ---------- */
function init() {
  load();
  syncCatSelect();
  var fc = $("f-cat"), fk = $("f-kind");
  KINDS.forEach(function (k) {
    var o = document.createElement("option"); o.value = k; o.textContent = k; fk.appendChild(o);
  });
  $("add").onclick = function () {
    var t = $("f-title").value.trim();
    if (!t) { $("f-title").focus(); return; }
    nodes.unshift({
      id: uid(), type: $("f-type").value, title: t,
      category: fc.value, kind: fk.value,
      url: $("f-url").value.trim(), date: today(),
      status: $("f-status").value, label: "", notes: "", links: [], suggested_links: []
    });
    $("f-title").value = ""; $("f-url").value = "";
    save(); render();
  };
  $("q").oninput = function () { query = $("q").value; render(); };
  $("clearq").onclick = function () { $("q").value = ""; query = ""; render(); };
  $("add-cat").onclick = function () {
    var name = $("new-cat").value.trim();
    if (!name) return;
    var slug = slugify(name);
    if (cats.some(function (c) { return c[0] === slug; })) { setStatus("category exists: " + slug); return; }
    cats.push([slug, name]);
    saveCats(); syncCatSelect();
    $("new-cat").value = "";
    render();
  };
  $("exp-all").onclick = function () {
    download("reading-nodes.md", nodes.map(nodeMd).join("\n---\n\n"));
  };
  $("exp-json").onclick = function () {
    download("reading-nodes.json", JSON.stringify({ updatedAt: new Date().toISOString(), nodes: nodes }, null, 1));
  };
  $("sync-now").onclick = function () { gistPull(); };
  $("sync-settings").onclick = function () {
    var f = $("sync-form");
    f.style.display = f.style.display === "none" ? "block" : "none";
    $("s-token").value = cfg.token || "";
    $("s-gist").value = cfg.gist || "";
  };
  $("s-save").onclick = function () {
    cfg.token = $("s-token").value.trim();
    cfg.gist = $("s-gist").value.trim();
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
    if (cfg.token && !cfg.gist) {
      // create a new gist
      gistCall("POST", "/gists", {
        description: "reading-nodes backup", public: false,
        files: { "reading-nodes.json": { content: JSON.stringify(envelope(), null, 1) } }
      }, function (err, g) {
        if (err) { setStatus("gist create failed: " + err.message); return; }
        cfg.gist = g.id;
        localStorage.setItem(LS_CFG, JSON.stringify(cfg));
        setStatus("gist created + synced -- " + nodes.length + " nodes");
      });
    } else gistPull();
  };
  render();
  renderMedia();
  gistPull();
  wireImport();
  if ($("draw")) $("draw").onclick = drawGraph;
  // tabs
  document.querySelectorAll(".tab").forEach(function (el) {
    el.onclick = function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("on"); });
      el.classList.add("on");
      var v = el.getAttribute("data-v");
      $("view-notes").style.display = v === "notes" ? "block" : "none";
      $("view-films").style.display = v === "films" ? "block" : "none";
      $("view-books").style.display = v === "books" ? "block" : "none";
    };
  });
  $("mf-add").onclick = function () {
    var t = $("mf-title").value.trim();
    if (!t) { $("mf-title").focus(); return; }
    films.unshift(normFilm({ title: t, director: $("mf-director").value.trim(),
      date: $("mf-date").value.trim(), cinema: $("mf-cinema").value, status: $("mf-status").value }));
    $("mf-title").value = ""; $("mf-director").value = ""; $("mf-date").value = "";
    save(); renderMedia();
  };
  $("mb-add").onclick = function () {
    var t = $("mb-title").value.trim();
    if (!t) { $("mb-title").focus(); return; }
    books.unshift(normBook({ title: t, author: $("mb-author").value.trim(),
      date: $("mb-date").value.trim(), kind: $("mb-kind").value, url: $("mb-url").value.trim(),
      status: $("mb-status").value }));
    $("mb-title").value = ""; $("mb-author").value = ""; $("mb-date").value = ""; $("mb-url").value = "";
    save(); renderMedia();
  };
}
document.addEventListener("DOMContentLoaded", init);
