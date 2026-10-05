/* reading-notes MVP
   node = { id, type, title, category, kind, url, date, status,
            notes, links:[{to, why}], suggested_links:[] }
   links[] is human-only. suggested_links[] is llm-propose-only (ui later).
*/
"use strict";

var LS_KEY = "reading-nodes-v1";
var LS_CFG = "reading-notes-cfg-v1";
var CATS_KEY = "reading-cats-v1";
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
var filterCat = "all";
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
function graphData() {
  var ns = nodes.map(function (n) { return { id: n.id, title: n.title, cat: n.category }; });
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
function renderGraphText(g) {
  var h = '<div class="sec-title" style="font-size:13px">EDGES -- Forman-Ricci curvature</div>';
  if (!g.edges.length) h += '<div class="small">no edges yet. add links inside a node.</div>';
  g.edges.slice().sort(function (a, b) { return a.curv - b.curv; }).forEach(function (e) {
    var A = byId(e.a), B = byId(e.b);
    var tag = e.curv < 0 ? "bridge" : (e.curv > 0 ? "cluster" : "flat");
    h += '<div class="small">' + esc(A ? A.title : e.a) + " -- " + esc(B ? B.title : e.b)
      + " : " + (e.curv > 0 ? "+" : "") + e.curv + " [" + tag + (e.kind === "suggested" ? ", suggested" : "") + "]</div>";
  });
  h += '<div class="sec-title" style="font-size:13px;margin-top:8px">LINK PREDICTION -- not linked yet</div>';
  if (!g.cands.length) h += '<div class="small">no candidates (needs shared neighbors).</div>';
  g.cands.forEach(function (c, i) {
    var A = byId(c.a), B = byId(c.b);
    h += '<div class="small">' + esc(A ? A.title : c.a) + " .. " + esc(B ? B.title : c.b)
      + " : common neighbors " + c.cn + ", jaccard " + c.jac.toFixed(2)
      + ' <button data-cand="' + i + '">[suggest]</button></div>';
  });
  h += '<div class="sec-title" style="font-size:13px;margin-top:8px">NODES</div>';
  g.ns.forEach(function (x) {
    h += '<div class="small">' + esc(x.title) + " : degree " + (g.deg[x.id] || 0)
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
  var W = cv.parentElement.clientWidth || 800, H = 420;
  cv.width = W; cv.height = H;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  var ctx = cv.getContext("2d");
  ctx.font = "11px monospace";
  var g = graphMetrics(graphData());
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
      var label = x.title.length > 20 ? x.title.slice(0, 19) + "…" : x.title;
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

function envelope() { return { updatedAt: new Date().toISOString(), nodes: nodes }; }

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
        localStorage.setItem(LS_KEY, JSON.stringify(nodes));
      } else if (env.nodes) {
        // local has more -- push local up
        gistPush(); render(); return;
      }
      setStatus("synced " + new Date().toLocaleTimeString() + " -- " + nodes.length + " nodes");
    } catch (e) { setStatus("gist parse failed -- using local copy"); }
    render();
  });
}

/* ---------- markdown export (future wiki seed) ---------- */
function nodeMd(n) {
  var L = ["---", "id: " + n.id, "type: " + n.type,
    "title: " + JSON.stringify(n.title), "category: " + n.category,
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
function render() {
  renderCats();
  renderCatManage();
  var list = filtered().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
  $("count").textContent = "(" + list.length + "/" + nodes.length + ")";
  var h = "";
  list.forEach(function (n) {
    var open = openId === n.id ? " open" : "";
    h += '<div class="node' + open + '" data-id="' + esc(n.id) + '">';
    h += '<div class="node-head"><span class="t">' + esc(n.title) + '</span> '
      + '<span class="tag">' + esc(n.status) + "</span><br>"
      + '<span class="meta">' + esc(catLabel(n.category)) + " | " + esc(n.kind) + " | " + esc(n.date)
      + (n.links && n.links.length ? " | links:" + n.links.length : "")
      + "</span></div>";
    h += '<div class="node-body">';
    if (n.url) h += '<div class="row"><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.url) + "</a></div>";
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
      + '<span class="fixed"><button data-act="toggle-status">[' + (n.status === "partial" ? "done?" : "partial?") + "]</button></span>"
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
          ["notes", "authors", "year", "venue", "thesis", "quotes", "critique"].forEach(function (f) {
            var inp = el.querySelector('[data-f="' + f + '"]');
            if (inp) n[f] = inp.value;
          });
          save(); setStatus("saved locally"); render();
        } else if (act === "toggle-status") {
          n.status = n.status === "partial" ? "done" : "partial";
          save(); render();
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
      id: uid(), type: "reading", title: t,
      category: fc.value, kind: fk.value,
      url: $("f-url").value.trim(), date: today(),
      status: "partial", notes: "", links: [], suggested_links: []
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
  gistPull();
  if ($("draw")) $("draw").onclick = drawGraph;
}
document.addEventListener("DOMContentLoaded", init);
