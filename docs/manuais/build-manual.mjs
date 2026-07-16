#!/usr/bin/env node
// Converts a manual's Markdown source into a self-contained, searchable HTML page.
// Hand-rolled parser tailored to this repo's manual Markdown patterns only (headings, tables,
// code fences, blockquotes, lists, bold, links, hr, and the custom [PRINT: file.png] marker) -
// not a general-purpose Markdown engine, since we fully control the source shape.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const embedIdx = args.indexOf("--embed");
const EMBED_IMAGES = embedIdx !== -1;
if (embedIdx !== -1) args.splice(embedIdx, 1);
const [inputPath, outputPath, titleArg, otherManualHref, otherManualLabel] = args;
if (!inputPath || !outputPath) {
  console.error("uso: build-manual.mjs <entrada.md> <saida.html> <titulo> <link-outro-manual> <label-outro-manual> [--embed]");
  process.exit(1);
}
const screenshotsDir = path.join(path.dirname(inputPath), "screenshots");

function imageSrc(file) {
  if (!EMBED_IMAGES) return `screenshots/${file}`;
  const filePath = path.join(screenshotsDir, file);
  try {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    console.warn("aviso: imagem nao encontrada para embed:", filePath);
    return `screenshots/${file}`;
  }
}

const src = fs.readFileSync(inputPath, "utf8");
const lines = src.split("\n");

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Inline formatting: **bold**, `code`, [text](url) - applied after escaping.
function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => `<a href="${href}">${text}</a>`);
  return out;
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

let html = [];
let searchIndex = []; // {id, heading, text}
let currentSection = null;
let i = 0;
let inCodeBlock = false;
let codeBuf = [];
let inTable = false;
let tableRows = [];
let inList = false;
let listBuf = [];

function flushList() {
  if (inList) {
    html.push("<ul>" + listBuf.map((li) => `<li>${inline(li)}</li>`).join("") + "</ul>");
    listBuf = [];
    inList = false;
  }
}

function flushTable() {
  if (inTable) {
    const [headerRow, , ...bodyRows] = tableRows; // row 1 = header, row 2 = --- separator
    const thead = "<tr>" + headerRow.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr>";
    const tbody = bodyRows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("");
    html.push(`<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`);
    tableRows = [];
    inTable = false;
  }
}

function pushSearchText(text) {
  if (currentSection) currentSection.text += " " + text;
}

while (i < lines.length) {
  const line = lines[i];

  if (line.startsWith("```")) {
    if (!inCodeBlock) {
      flushList();
      flushTable();
      inCodeBlock = true;
      codeBuf = [];
    } else {
      html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
      inCodeBlock = false;
    }
    i++;
    continue;
  }
  if (inCodeBlock) {
    codeBuf.push(line);
    i++;
    continue;
  }

  // Screenshot marker: **[PRINT: file.png]**  or  [PRINT: file.png]
  const printMatch = line.match(/\[PRINT:\s*([^\]]+?\.png)\]/);
  if (printMatch) {
    flushList();
    flushTable();
    const file = printMatch[1].trim();
    const captionMatch = line.match(/\*\(([^)]+)\)\*/);
    const caption = captionMatch ? captionMatch[1] : "";
    html.push(
      `<figure class="screenshot"><img src="${imageSrc(file)}" alt="${escapeHtml(file)}" loading="lazy">` +
        (caption ? `<figcaption>${inline(caption)}</figcaption>` : "") +
        `</figure>`
    );
    i++;
    continue;
  }

  // Headings
  const h = line.match(/^(#{1,3})\s+(.*)$/);
  if (h) {
    flushList();
    flushTable();
    const level = h[1].length;
    let text = h[2].replace(/^\d+\.\s*/, "");
    // Strip a leading anchor-style prefix like "1." already handled; also strip trailing manual
    // anchor markdown like [texto](#anchor) used only in the ToC, not in real section headings.
    const id = slugify(text.replace(/[().]/g, ""));
    if (level === 1) {
      html.push(`<h1 id="${id}">${inline(text)}</h1>`);
    } else if (level === 2) {
      currentSection = { id, heading: text, text: "" };
      searchIndex.push(currentSection);
      html.push(`<h2 id="${id}">${inline(text)}</h2>`);
    } else {
      const subId = slugify(text);
      searchIndex.push({ id: subId, heading: text, text: "" });
      html.push(`<h3 id="${subId}">${inline(text)}</h3>`);
    }
    i++;
    continue;
  }

  // Table row
  if (line.trim().startsWith("|")) {
    flushList();
    inTable = true;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    tableRows.push(cells);
    i++;
    continue;
  } else if (inTable) {
    flushTable();
  }

  // Blockquote (possibly multi-line, consecutive > lines merge into one <blockquote>)
  if (line.trim().startsWith(">")) {
    flushList();
    const buf = [];
    while (i < lines.length && lines[i].trim().startsWith(">")) {
      buf.push(lines[i].trim().replace(/^>\s?/, ""));
      i++;
    }
    const text = buf.join(" ");
    html.push(`<blockquote>${inline(text)}</blockquote>`);
    pushSearchText(text);
    continue;
  }

  // List item
  const li = line.match(/^-\s+(.*)$/);
  if (li) {
    inList = true;
    listBuf.push(li[1]);
    pushSearchText(li[1]);
    i++;
    continue;
  } else if (inList) {
    flushList();
  }

  // Horizontal rule
  if (line.trim() === "---") {
    i++;
    continue;
  }

  // Sumário link line (skip - we build our own nav)
  if (/^\d+\.\s+\[.*\]\(#.*\)$/.test(line.trim())) {
    i++;
    continue;
  }

  // Blank line
  if (line.trim() === "") {
    i++;
    continue;
  }

  // Plain paragraph
  html.push(`<p>${inline(line)}</p>`);
  pushSearchText(line);
  i++;
}
flushList();
flushTable();

const searchIndexJson = JSON.stringify(
  searchIndex.map((s) => ({ id: s.id, heading: s.heading, text: s.text.replace(/\s+/g, " ").trim().slice(0, 500) }))
);

const navHtml = searchIndex
  .filter((s) => s.text !== "" || true)
  .map((s) => `<a href="#${s.id}" class="nav-link">${escapeHtml(s.heading)}</a>`)
  .join("\n");

const title = titleArg || "Manual";

const page = `<!doctype html>
<html lang="pt-BR" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Pre-Sales Compliance Platform</title>
<style>
  :root {
    --ink: #14181c; --ink-soft: #3a4149; --ink-faint: #6b7480;
    --paper: #f7f8f9; --paper-raised: #ffffff; --hairline: #dde1e5; --hairline-strong: #c4cad0;
    --accent: #0f766e; --accent-soft: #e6f4f2;
    --mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    --serif: Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e7eaed; --ink-soft: #b7c0c8; --ink-faint: #838d97; --paper: #14181c; --paper-raised: #1b2126; --hairline: #2a323a; --hairline-strong: #3a434c; --accent: #4fd1c5; --accent-soft: #123a36; }
  }
  html[data-theme="dark"] { --ink: #e7eaed; --ink-soft: #b7c0c8; --ink-faint: #838d97; --paper: #14181c; --paper-raised: #1b2126; --hairline: #2a323a; --hairline-strong: #3a434c; --accent: #4fd1c5; --accent-soft: #123a36; }
  html[data-theme="light"] { --ink: #14181c; --ink-soft: #3a4149; --ink-faint: #6b7480; --paper: #f7f8f9; --paper-raised: #ffffff; --hairline: #dde1e5; --hairline-strong: #c4cad0; --accent: #0f766e; --accent-soft: #e6f4f2; }

  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--paper); }
  body { color: var(--ink); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  code { font-family: var(--mono); font-size: 0.9em; background: var(--hairline); padding: 1px 5px; border-radius: 4px; }
  pre { background: var(--paper-raised); border: 1px solid var(--hairline); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }

  .topbar { position: sticky; top: 0; z-index: 20; background: var(--paper-raised); border-bottom: 1px solid var(--hairline); }
  .topbar-inner { max-width: 1180px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  .brand { font-family: var(--serif); font-weight: 700; font-size: 16px; white-space: nowrap; }
  .brand span { color: var(--accent); }
  .other-manual { margin-left: auto; font-size: 12.5px; font-weight: 600; white-space: nowrap; }

  .search-wrap { position: relative; flex: 1; max-width: 480px; }
  #search-input { width: 100%; padding: 8px 12px 8px 32px; border-radius: 8px; border: 1px solid var(--hairline-strong); background: var(--paper); color: var(--ink); font-size: 13.5px; font-family: var(--sans); }
  #search-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; color: var(--ink-faint); pointer-events: none; }
  #search-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--paper-raised); border: 1px solid var(--hairline-strong); border-radius: 10px; box-shadow: 0 8px 24px -8px rgba(0,0,0,.25); max-height: 60vh; overflow-y: auto; display: none; z-index: 30; }
  #search-results.open { display: block; }
  .result-item { display: block; padding: 9px 14px; text-decoration: none; color: var(--ink); border-bottom: 1px solid var(--hairline); cursor: pointer; }
  .result-item:last-child { border-bottom: none; }
  .result-item:hover, .result-item.active { background: var(--accent-soft); }
  .result-heading { font-weight: 700; font-size: 13px; }
  .result-snippet { font-size: 12px; color: var(--ink-faint); margin-top: 2px; }
  .result-snippet mark, .result-heading mark { background: none; color: var(--accent); font-weight: 700; }
  .no-results { padding: 14px; font-size: 13px; color: var(--ink-faint); }

  .layout { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 240px 1fr; gap: 40px; padding: 28px 20px 100px; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .sidebar { display: none; } }

  .sidebar { position: sticky; top: 68px; align-self: start; max-height: calc(100vh - 90px); overflow-y: auto; }
  .sidebar .cap { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); margin: 0 0 10px; }
  .nav-link { display: block; font-size: 12.5px; padding: 5px 0; color: var(--ink-soft); text-decoration: none; border-left: 2px solid transparent; padding-left: 10px; margin-left: -1px; }
  .nav-link:hover { color: var(--accent); }

  .content h1 { font-family: var(--serif); font-size: 30px; margin: 0 0 6px; text-wrap: balance; }
  .content h2 { font-family: var(--serif); font-size: 21px; margin: 44px 0 14px; padding-top: 8px; border-top: 1px solid var(--hairline); }
  .content h2:first-of-type { border-top: none; margin-top: 20px; }
  .content h3 { font-size: 15px; font-weight: 700; margin: 26px 0 10px; color: var(--ink); }
  .content p { font-size: 14px; line-height: 1.7; color: var(--ink-soft); max-width: 720px; }
  .content ul { font-size: 14px; line-height: 1.7; color: var(--ink-soft); max-width: 720px; padding-left: 20px; }
  .content li { margin-bottom: 4px; }
  .content blockquote { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 10px 16px; border-radius: 0 8px 8px 0; font-size: 13.5px; color: var(--ink-soft); max-width: 700px; margin: 16px 0; }
  .table-wrap { overflow-x: auto; margin: 14px 0; }
  table { border-collapse: collapse; font-size: 13px; width: 100%; max-width: 760px; }
  th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--hairline); }
  th { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); border-bottom: 1px solid var(--hairline-strong); }

  figure.screenshot { margin: 18px 0 26px; }
  figure.screenshot img { max-width: 100%; border-radius: 10px; border: 1px solid var(--hairline-strong); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 12px 28px -12px rgba(0,0,0,.18); display: block; }
  figure.screenshot figcaption { font-size: 12px; color: var(--ink-faint); margin-top: 8px; }

  mark.hl { background: #ffe58a; color: #14181c; padding: 0 2px; border-radius: 2px; }
  html[data-theme="dark"] mark.hl, @media (prefers-color-scheme: dark) { mark.hl { background: #7a5d00; color: #fff3d0; } }
</style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-inner">
      <div class="brand">Pre-Sales <span>Compliance Platform</span></div>
      <div class="search-wrap">
        <span class="search-icon">&#9906;</span>
        <input id="search-input" type="text" placeholder="Pesquisar no manual... (ex: aprovação, POC, cor primária)" autocomplete="off">
        <div id="search-results"></div>
      </div>
      ${otherManualHref ? `<a class="other-manual" href="${otherManualHref}" target="_blank" rel="noopener">${escapeHtml(otherManualLabel || "Outro manual")} &rarr;</a>` : ""}
    </div>
  </div>
  <div class="layout">
    <nav class="sidebar">
      <p class="cap">Neste manual</p>
      ${navHtml}
    </nav>
    <main class="content">
${html.join("\n")}
    </main>
  </div>

<script>
(function () {
  var THEME_KEY = "manual-theme";
  var stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (stored) document.documentElement.setAttribute("data-theme", stored);

  var INDEX = ${searchIndexJson};
  var input = document.getElementById("search-input");
  var resultsBox = document.getElementById("search-results");

  function norm(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  }

  function highlight(text, q) {
    if (!q) return text;
    var idx = norm(text).indexOf(q);
    if (idx === -1) return text;
    return text.slice(0, idx) + '<mark class="hl">' + text.slice(idx, idx + q.length) + "</mark>" + text.slice(idx + q.length);
  }

  function snippetAround(text, q) {
    var n = norm(text);
    var idx = n.indexOf(q);
    if (idx === -1) return text.slice(0, 140);
    var start = Math.max(0, idx - 60);
    var end = Math.min(text.length, idx + q.length + 80);
    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }

  function render(query) {
    var q = norm(query.trim());
    if (!q) {
      resultsBox.classList.remove("open");
      resultsBox.innerHTML = "";
      return;
    }
    var matches = INDEX.filter(function (item) {
      return norm(item.heading).indexOf(q) !== -1 || norm(item.text).indexOf(q) !== -1;
    }).slice(0, 12);

    if (matches.length === 0) {
      resultsBox.innerHTML = '<div class="no-results">Nada encontrado para "' + query + '".</div>';
      resultsBox.classList.add("open");
      return;
    }

    resultsBox.innerHTML = matches
      .map(function (m) {
        var headingHtml = highlight(m.heading, q);
        var snippet = norm(m.text).indexOf(q) !== -1 ? highlight(snippetAround(m.text, q), q) : "";
        return (
          '<a class="result-item" href="#' + m.id + '" data-id="' + m.id + '">' +
          '<div class="result-heading">' + headingHtml + "</div>" +
          (snippet ? '<div class="result-snippet">' + snippet + "</div>" : "") +
          "</a>"
        );
      })
      .join("");
    resultsBox.classList.add("open");
  }

  input.addEventListener("input", function () { render(input.value); });
  input.addEventListener("focus", function () { if (input.value.trim()) render(input.value); });

  resultsBox.addEventListener("click", function (e) {
    var item = e.target.closest(".result-item");
    if (!item) return;
    e.preventDefault();
    var id = item.getAttribute("data-id");
    var target = document.getElementById(id);
    resultsBox.classList.remove("open");
    input.value = "";
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.style.transition = "background-color .2s";
      target.style.backgroundColor = "var(--accent-soft)";
      setTimeout(function () { target.style.backgroundColor = ""; }, 1200);
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-wrap")) resultsBox.classList.remove("open");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { resultsBox.classList.remove("open"); input.blur(); }
    if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  });
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, page, "utf8");
console.log("gerado:", outputPath, `(${searchIndex.length} seções indexadas)`);
