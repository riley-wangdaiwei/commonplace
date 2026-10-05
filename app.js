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
}
document.addEventListener("DOMContentLoaded", init);
