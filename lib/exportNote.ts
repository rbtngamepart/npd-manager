"use client";

// 메모 내보내기: PDF(인쇄) · 마크다운 · Word(.doc)
import TurndownService from "turndown";
import { sanitize } from "@/components/RichText";
import { signedUrl } from "@/components/editor/files";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a); // 붙여야 파일 이름이 지켜짐
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 3000);
}
const safeName = (s: string) => (s || "메모").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "메모";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 내보내기용 HTML: 저장소 이미지는 주소를 붙이고, 임베드는 링크로 */
async function prepare(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(sanitize(html), "text/html");
  await Promise.all(
    Array.from(doc.querySelectorAll("img[data-path]")).map(async (img) => {
      const url = await signedUrl(img.getAttribute("data-path") ?? "");
      if (url) img.setAttribute("src", url);
    })
  );
  doc.querySelectorAll('div[data-type="embed"]').forEach((el) => {
    const src = el.getAttribute("data-src") ?? "";
    el.innerHTML = `<p>🔗 <a href="${esc(src)}">${esc(src)}</a></p>`;
  });
  doc.querySelectorAll('div[data-type="callout"]').forEach((el) => {
    el.insertAdjacentHTML("afterbegin", `<span>${esc(el.getAttribute("data-emoji") ?? "💡")} </span>`);
  });
  doc.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  doc.querySelectorAll('li[data-type="taskItem"] input[type="checkbox"]').forEach((cb) => {
    if (cb.closest("li")?.getAttribute("data-checked") === "true") cb.setAttribute("checked", "checked");
  });
  return doc.body.innerHTML;
}

const PRINT_CSS = `
body{font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.65;font-size:14px}
h1.t{font-size:26px;margin:0 0 4px}.meta{color:#64748b;font-size:12px;margin-bottom:24px}
h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}
img{max-width:100%}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}th{background:#f8fafc}
blockquote{border-left:3px solid #cbd5e1;margin:0;padding-left:12px;color:#475569}
pre{background:#f1f5f9;padding:10px;border-radius:6px;white-space:pre-wrap}
div[data-type=callout]{background:#f1f5f9;border-radius:8px;padding:10px 12px;margin:8px 0}
ul[data-type=taskList]{list-style:none;padding-left:4px}ul[data-type=taskList] li{display:flex;gap:6px}ul[data-type=taskList] label span{display:none}
details summary{font-weight:600}
.mention,span[data-type=mention],a[data-type=ref]{background:#eef2ff;border-radius:4px;padding:0 3px;text-decoration:none;color:#1e3a8a}
@media print{body{margin:0}}`;

export async function exportPrint(title: string, meta: string, html: string) {
  const w = window.open("", "_blank");
  if (!w) return alert("팝업이 막혀 있습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요.");
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title || "메모")}</title><style>${PRINT_CSS}</style></head><body><p>불러오는 중…</p></body></html>`);
  const body = await prepare(html);
  w.document.body.innerHTML = `<h1 class="t">${esc(title || "제목 없음")}</h1><div class="meta">${esc(meta)}</div>${body}`;
  // 이미지가 다 뜬 뒤 인쇄 창 (PDF로 저장 선택)
  const imgs = Array.from(w.document.images);
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))));
  w.focus();
  w.print();
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*" });
  td.addRule("task", {
    filter: (n) => n.nodeName === "LI" && (n as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, n) => `- [${(n as HTMLElement).getAttribute("data-checked") === "true" ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`,
  });
  td.addRule("callout", {
    filter: (n) => n.nodeName === "DIV" && (n as HTMLElement).getAttribute("data-type") === "callout",
    replacement: (content, n) => `\n> ${(n as HTMLElement).getAttribute("data-emoji") ?? "💡"} ${content.trim().replace(/\n/g, "\n> ")}\n\n`,
  });
  td.addRule("details", {
    filter: "details",
    replacement: (content) => `\n${content.trim()}\n\n`,
  });
  td.addRule("summary", { filter: "summary", replacement: (content) => `**▸ ${content.trim()}**\n\n` });
  td.addRule("highlight", { filter: "mark", replacement: (content) => `==${content}==` });
  td.addRule("ref", {
    filter: (n) => n.nodeName === "A" && (n as HTMLElement).getAttribute("data-type") === "ref",
    replacement: (_c, n) => `[[${(n as HTMLElement).getAttribute("data-label") ?? ""}]]`,
  });
  td.addRule("table", {
    filter: "table",
    replacement: (_c, n) => {
      const rows = Array.from((n as HTMLTableElement).rows).map((r) => Array.from(r.cells).map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return `\n${line(rows[0])}\n| ${Array.from({ length: cols }, () => "---").join(" | ")} |\n${rows.slice(1).map(line).join("\n")}\n\n`;
    },
  });
  td.remove(["script", "style", "label"]);
  return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export async function exportMarkdown(title: string, html: string) {
  const md = `# ${title || "제목 없음"}\n\n${htmlToMarkdown(await prepare(html))}`;
  download(`${safeName(title)}.md`, new Blob([md], { type: "text/markdown;charset=utf-8" }));
}

export function exportMarkdownText(title: string, text: string) {
  download(`${safeName(title)}.md`, new Blob([`# ${title || "제목 없음"}\n\n${text}\n`], { type: "text/markdown;charset=utf-8" }));
}

export async function exportWord(title: string, meta: string, html: string) {
  const body = await prepare(html);
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><h1 class="t">${esc(title || "제목 없음")}</h1><div class="meta">${esc(meta)}</div>${body}</body></html>`;
  download(`${safeName(title)}.doc`, new Blob(["﻿", doc], { type: "application/msword" }));
}
