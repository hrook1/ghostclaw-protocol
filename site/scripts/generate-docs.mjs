import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, "..");
const sourceRoot = resolve(siteRoot, "public-docs");
const outputRoot = join(siteRoot, "docs");

const documents = [
  ["OVERVIEW.md", "Overview", "What GhostClaw does, what it protects, and the actions it supports."],
  ["ARCHITECTURE.md", "Architecture", "The client, proof runtime, Base contracts, merchant, and settlement path."],
  ["PRIVACY.md", "Privacy model", "The information that stays private and the information that remains public."],
  ["PAYMENT_FLOW.md", "Payment flow", "The complete path from an x402 quote to service delivery."],
  ["PROVING.md", "Local proving", "Proof system, circuits, private witnesses, and public proof outputs."],
  ["CONTRACTS.md", "Base contracts", "Escrow, commitments, roots, nullifiers, identities, and state transitions."],
  ["WALLET_AGENTS.md", "Wallet and agents", "Local wallet functions, agent tools, spending policy, and sponsored writes."],
  ["X402.md", "x402 integration", "How confidential settlement fits into the standard x402 request flow."],
  ["PERFORMANCE.md", "Performance", "Observed proving time, proof size, gas, and settlement measurements."],
].map(([file, title, description]) => ({ file, title, description, slug: file.replace(/\.md$/i, "").toLowerCase().replace(/_/g, "-").replace(/\./g, "-") }));

const groups = [
  ["Start here", ["OVERVIEW.md", "ARCHITECTURE.md", "PRIVACY.md"]],
  ["Protocol", ["PAYMENT_FLOW.md", "PROVING.md", "CONTRACTS.md", "X402.md"]],
  ["Client", ["WALLET_AGENTS.md", "PERFORMANCE.md"]],
];

const byFile = new Map(documents.map(document => [document.file.toLowerCase(), document]));
const escapeHtml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slugify = value => value.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";

function safeHref(raw) {
  const clean = raw.replaceAll("&amp;", "&");
  const [path, hash = ""] = clean.split("#", 2);
  const file = basename(path).toLowerCase();
  const linked = byFile.get(file);
  if (linked) return `${linked.slug}.html${hash ? `#${slugify(hash)}` : ""}`;
  if (/^(https?:|mailto:)/i.test(clean)) return clean;
  if (clean.startsWith("#")) return `#${slugify(clean.slice(1))}`;
  return "#";
}

function inlineMarkdown(raw) {
  const codes = [];
  let text = raw.replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(`<code>${escapeHtml(code)}</code>`) - 1}\u0000`);
  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => {
    const target = /^(https?:|mailto:)/i.test(href.replaceAll("&amp;", "&")) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(safeHref(href))}"${target}>${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
  return text;
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html = [];
  const usedIds = new Map();
  const sectionId = title => {
    const base = slugify(title);
    const count = usedIds.get(base) || 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const diagram = line.match(/^:::diagram(?:\s+(.+))?$/);
    if (diagram) {
      const steps = [];
      index += 1;
      while (index < lines.length && !/^:::\s*$/.test(lines[index])) {
        const [title, ...detail] = lines[index].split("|");
        if (title?.trim()) steps.push({ title: title.trim(), detail: detail.join("|").trim() });
        index += 1;
      }
      index += 1;
      html.push(`<figure class="system-diagram">${diagram[1] ? `<figcaption>${inlineMarkdown(diagram[1])}</figcaption>` : ""}<div class="diagram-track" style="--diagram-steps:${steps.length}">${steps.map((step, stepIndex) => `<div class="diagram-step"><span>${String(stepIndex + 1).padStart(2, "0")}</span><strong>${inlineMarkdown(step.title)}</strong>${step.detail ? `<p>${inlineMarkdown(step.detail)}</p>` : ""}</div>`).join("")}</div></figure>`);
      continue;
    }

    const fence = line.match(/^```\s*([^\s]*)/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      html.push(`<pre${fence[1] ? ` data-language="${escapeHtml(fence[1])}"` : ""}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/\s+#+$/, "");
      html.push(`<h${level} id="${sectionId(title)}">${inlineMarkdown(title)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || "")) {
      const rows = [];
      const cells = value => value.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
      rows.push(cells(line));
      index += 2;
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) rows.push(cells(lines[index++]));
      html.push(`<div class="table-wrap"><table><thead><tr>${rows[0].map(cell => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+] |\d+\. )(.*)$/);
    if (listMatch) {
      const ordered = /\d+\. /.test(listMatch[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-*+] |\d+\. )(.*)$/);
        if (!match || /\d+\. /.test(match[1]) !== ordered) break;
        items.push(match[2]); index += 1;
      }
      html.push(`<${tag}>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      html.push(`<blockquote>${inlineMarkdown(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { html.push("<hr>"); index += 1; continue; }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s+|^```|^:::diagram|^\s*([-*+] |\d+\. )|^>\s?|^\s*\|.*\|\s*$|^\s*(---+|___+|\*\*\*+)\s*$/.test(lines[index])) paragraph.push(lines[index++].trim());
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return html.join("\n");
}

const CSS = `
:root{--bg:#050812;--panel:#080d18;--paper:#eef4ff;--muted:#8692a7;--dim:#536078;--line:#1c2940;--blue:#91b8ff;--cyan:#b8e5ff;--red:#ff5a4e;--mono:ui-monospace,"SF Mono",Menlo,Consolas,"Courier New",monospace;--sans:"Helvetica Neue",Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--paper);font-family:var(--sans);-webkit-font-smoothing:antialiased}a{color:inherit;text-decoration:none}a:hover{color:var(--cyan)}::selection{background:var(--blue);color:var(--bg)}
.topbar{position:sticky;z-index:20;top:0;height:68px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 28px;border-bottom:1px solid var(--line);background:rgba(5,8,18,.9);backdrop-filter:blur(18px)}
.brand{font:800 12px/1 var(--mono);letter-spacing:.2em}.brand b{color:var(--red)}.top-links{display:flex;gap:28px;font:700 9px/1 var(--mono);letter-spacing:.18em;color:var(--muted)}.release{justify-self:end;font:700 9px/1 var(--mono);letter-spacing:.16em;color:var(--blue)}
.layout{display:grid;grid-template-columns:260px minmax(0,820px);gap:clamp(44px,6vw,100px);width:min(1240px,calc(100% - 48px));margin:0 auto;padding:72px 0 120px}.layout.index-layout{display:block;width:min(1120px,calc(100% - 48px))}.sidebar{position:sticky;top:104px;align-self:start;max-height:calc(100vh - 132px);overflow:auto;padding-right:18px}.sidebar-title{margin-bottom:18px;font:700 9px/1 var(--mono);letter-spacing:.18em;color:var(--dim)}.sidebar a{display:block;padding:9px 10px;border-left:1px solid var(--line);font:600 10px/1.35 var(--mono);letter-spacing:.06em;color:var(--muted)}.sidebar a.active{border-left-color:var(--blue);background:rgba(145,184,255,.06);color:var(--paper)}
.doc{min-width:0}.doc-meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:32px;padding-bottom:14px;border-bottom:1px solid var(--line);font:700 9px/1.4 var(--mono);letter-spacing:.16em;color:var(--dim)}.doc article>h1:first-child{margin-top:0}.doc h1{max-width:13ch;margin:0 0 48px;font:850 clamp(48px,7vw,86px)/.92 var(--sans);letter-spacing:-.055em;text-transform:uppercase}.doc h2{margin:72px 0 22px;padding-top:18px;border-top:1px solid var(--line);font:800 clamp(29px,4vw,44px)/1 var(--sans);letter-spacing:-.04em}.doc h3{margin:42px 0 16px;font:750 22px/1.1 var(--sans);letter-spacing:-.025em}.doc h4,.doc h5,.doc h6{margin:34px 0 12px;font:700 13px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--blue)}.doc p,.doc li{font-size:16px;line-height:1.72;color:#b8c2d3}.doc p{margin:0 0 22px}.doc strong{color:var(--paper)}.doc em{color:var(--cyan)}.doc ul,.doc ol{margin:0 0 26px;padding-left:24px}.doc li+li{margin-top:8px}.doc a{color:var(--blue);text-decoration:underline;text-decoration-color:rgba(145,184,255,.35);text-underline-offset:3px}.doc code{padding:.16em .38em;border:1px solid var(--line);border-radius:4px;background:#090f1c;color:#cce8ff;font:500 .88em/1.4 var(--mono)}.doc pre{position:relative;margin:28px 0;padding:22px;overflow:auto;border:1px solid var(--line);background:#03060c}.doc pre[data-language]::before{content:attr(data-language);display:block;margin-bottom:14px;color:var(--dim);font:700 8px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase}.doc pre code{padding:0;border:0;background:none;color:#c5d3e8;font-size:12px;line-height:1.65}.table-wrap{max-width:100%;margin:28px 0;overflow:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font:500 12px/1.55 var(--mono)}th,td{padding:13px 15px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--blue);background:#080e1b}td{color:#aebbd0}tr:last-child td{border-bottom:0}th:last-child,td:last-child{border-right:0}blockquote{margin:28px 0;padding:4px 0 4px 20px;border-left:2px solid var(--blue);color:#c2d7f7}hr{margin:52px 0;border:0;border-top:1px solid var(--line)}
.system-diagram{margin:34px 0;padding:20px;border:1px solid var(--line);background:#03060c}.system-diagram figcaption{margin-bottom:18px;font:700 9px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}.diagram-track{display:grid;grid-template-columns:repeat(var(--diagram-steps),minmax(0,1fr));gap:22px}.diagram-step{position:relative;min-width:0;padding:16px 14px;border:1px solid var(--line);background:#070c16}.diagram-step:not(:last-child)::after{content:"→";position:absolute;z-index:2;top:50%;right:-19px;width:16px;transform:translateY(-50%);color:var(--blue);font:700 12px/1 var(--mono);text-align:center}.diagram-step>span{display:block;margin-bottom:18px;color:var(--dim);font:700 8px/1 var(--mono);letter-spacing:.16em}.diagram-step>strong{display:block;color:var(--paper);font:700 11px/1.35 var(--mono);letter-spacing:.08em;text-transform:uppercase}.diagram-step>p{margin:9px 0 0;color:var(--muted);font:500 11px/1.5 var(--mono)}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:80px;padding-top:24px;border-top:1px solid var(--line)}.pager a{padding:16px;border:1px solid var(--line);font:700 9px/1.5 var(--mono);letter-spacing:.1em;color:var(--muted)}.pager a:last-child{text-align:right}.pager a:hover{border-color:#40577c;color:var(--paper)}
.index-hero{padding:18px 0 64px}.index-kicker{font:700 9px/1 var(--mono);letter-spacing:.18em;color:var(--blue)}.index-hero h1{max-width:10ch;margin:18px 0 26px;font:850 clamp(54px,8vw,96px)/.9 var(--sans);letter-spacing:-.06em;text-transform:uppercase}.index-hero p{max-width:55ch;margin:0;color:#aeb9ca;font-size:17px;line-height:1.7}.doc-group{margin-top:54px}.doc-group h2{margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid var(--line);font:700 10px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--blue)}.doc-list a{display:grid;grid-template-columns:minmax(180px,.8fr) 1.4fr auto;gap:24px;align-items:center;padding:17px 0;border-bottom:1px solid rgba(28,41,64,.7)}.doc-list strong{font:700 13px/1.25 var(--mono);letter-spacing:.04em}.doc-list span{color:var(--muted);font-size:14px;line-height:1.45}.doc-list i{font:700 10px/1 var(--mono);font-style:normal;color:var(--dim)}
.mobile-nav{display:none}
@media(max-width:800px){.topbar{grid-template-columns:1fr auto;padding:0 18px}.top-links{display:none}.release{font-size:8px}.layout{display:block;width:calc(100% - 36px);padding-top:38px}.sidebar{display:none}.mobile-nav{display:block;margin-bottom:36px;padding:12px 14px;border:1px solid var(--line);background:var(--panel);color:var(--paper);font:600 12px var(--mono)}.index-hero h1{font-size:36px}.doc h1{font-size:44px;overflow-wrap:anywhere}.doc h2{font-size:32px}.doc p,.doc li{font-size:15px}.doc-list a{grid-template-columns:1fr auto}.doc-list span{grid-column:1/-1}.diagram-track{grid-template-columns:1fr}.diagram-step:not(:last-child)::after{content:"↓";top:auto;right:50%;bottom:-19px;transform:translateX(50%)}.pager{grid-template-columns:1fr}.pager a:last-child{text-align:left}}
`;

const faviconRows = [
  "......BBB......", ".....BBBBB.....", "C.C.BBBBBBB.C.C", "CCC.BBEBBEB.CCC", ".C..BBEBBEB..C.",
  "..C.BBBBBBB.C..", "...CBBBBBBBC...", "....BBBBBBB....", "....BBBBBBB....", "....BBBBBBB....", "....B.BBB.B...."
];
const faviconColors = { B: "#e6f4ff", C: "#ff5a4e", E: "#12234f" };
const faviconRects = faviconRows.flatMap((row, y) => [...row].flatMap((cell, x) => faviconColors[cell]
  ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${faviconColors[cell]}"/>`
  : [])).join("");
const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 11" shape-rendering="crispEdges">${faviconRects}</svg>`)}`;

function navigation(activeFile = "") {
  return `<aside class="sidebar"><div class="sidebar-title">DOCUMENTS</div>${documents.map(document => `<a${document.file === activeFile ? ' class="active" aria-current="page"' : ""} href="${document.slug}.html">${escapeHtml(document.title)}</a>`).join("")}</aside>`;
}

function mobileNavigation(activeFile = "") {
  return `<select class="mobile-nav" aria-label="Select a document" onchange="if(this.value)location.href=this.value"><option value="index.html">Contents</option>${documents.map(document => `<option value="${document.slug}.html"${document.file === activeFile ? " selected" : ""}>${escapeHtml(document.title)}</option>`).join("")}</select>`;
}

function shell({ title, description, activeFile = "", content, index = false }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="description" content="${escapeHtml(description)}"><link rel="icon" href="${favicon}"><title>${escapeHtml(title)} — GhostClaw docs</title><style>${CSS}</style></head>
<body><header class="topbar"><a class="brand" href="index.html"><b>◆</b> GHOSTCLAW / DOCS</a><nav class="top-links"><a href="../index.html">SITE</a><a href="index.html">CONTENTS</a><a href="https://x.com/_Ghostclaw" target="_blank" rel="noopener noreferrer">X ↗</a></nav><span class="release">PUBLIC REFERENCE</span></header>
<main class="layout${index ? " index-layout" : ""}">${index ? "" : navigation(activeFile)}<section class="${index ? "index" : "doc"}">${mobileNavigation(activeFile)}${content}</section></main></body></html>`;
}

// Rebuild the public directory from a reviewed source set so retired internal pages cannot remain reachable.
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const indexContent = `<header class="index-hero"><span class="index-kicker">PUBLIC TECHNICAL REFERENCE</span><h1>GhostClaw documentation.</h1><p>Learn how GhostClaw gives public agent identities confidential payment amounts and private balances on Base.</p></header>${groups.map(([name, files]) => `<section class="doc-group"><h2>${escapeHtml(name)}</h2><div class="doc-list">${files.map(file => { const document = byFile.get(file.toLowerCase()); return `<a href="${document.slug}.html"><strong>${escapeHtml(document.title)}</strong><span>${escapeHtml(document.description)}</span><i>OPEN →</i></a>`; }).join("")}</div></section>`).join("")}`;
await writeFile(join(outputRoot, "index.html"), shell({ title: "Contents", description: "GhostClaw public architecture and protocol documentation.", content: indexContent, index: true }));

for (let index = 0; index < documents.length; index += 1) {
  const document = documents[index];
  const markdown = await readFile(join(sourceRoot, document.file), "utf8");
  const previous = documents[index - 1];
  const next = documents[index + 1];
  const pager = `<nav class="pager" aria-label="Document navigation">${previous ? `<a href="${previous.slug}.html">← ${escapeHtml(previous.title)}</a>` : "<span></span>"}${next ? `<a href="${next.slug}.html">${escapeHtml(next.title)} →</a>` : '<a href="index.html">Contents →</a>'}</nav>`;
  const content = `<div class="doc-meta"><span>PUBLIC REFERENCE / ${escapeHtml(document.title.toUpperCase())}</span><a href="index.html">ALL DOCUMENTS</a></div><article>${renderMarkdown(markdown)}</article>${pager}`;
  await writeFile(join(outputRoot, `${document.slug}.html`), shell({ title: document.title, description: document.description, activeFile: document.file, content }));
}

const redirect = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=docs/index.html"><link rel="canonical" href="docs/index.html"><title>GhostClaw docs</title></head><body><a href="docs/index.html">Open GhostClaw docs</a></body></html>`;
await writeFile(join(siteRoot, "docs.html"), redirect);

console.log(`Generated ${documents.length + 1} documentation pages in ${outputRoot}`);
