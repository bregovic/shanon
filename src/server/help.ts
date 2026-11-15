/**
 * Nápověda: návody k agendám v docs/help/*.md (Markdown s hlavičkou).
 *
 *   ---
 *   title: Vydaná faktura s QR platbou
 *   module: ar
 *   objects: ar.invoice, ar.invoiceLine
 *   order: 10
 *   summary: Od založení faktury po zaúčtování a odeslání PDF.
 *   video: 01-vydana-faktura      (volitelně: video návod z úložiště videí, nebo celá adresa)
 *   ---
 *
 * Návod se ukáže v Nápovědě, v hledání (Ctrl+K) a jako „?“ u modulu a
 * formulářů uvedených v `objects`. Odkazy v textu vedou rovnou do aplikace.
 */
import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HelpTopic {
  id: string;
  title: string;
  module: string;
  objects: string[];
  order: number;
  summary: string;
  /** adresa video návodu (prázdné = bez videa) */
  video: string | null;
  body: string;
}

/** Úložiště video návodů (veřejný bucket); `video: <název>` v hlavičce návodu → <úložiště>/<název>.mp4 */
const VIDEO_BASE = (process.env.SHANON_HELP_VIDEO_BASE ?? "https://pub-bc34fee76f694dea8d40b45072363a7f.r2.dev/shanon/").replace(/\/?$/, "/");
const videoUrl = (v: string | undefined) => (!v ? null : /^https?:\/\//.test(v) ? v : `${VIDEO_BASE}${v.replace(/\.mp4$/, "")}.mp4`);

const DIR = join(process.cwd(), "docs", "help");
let cache: HelpTopic[] | null = null;

function parse(id: string, src: string): HelpTopic {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  const head: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    id,
    title: head.title ?? id,
    module: head.module ?? "",
    objects: (head.objects ?? "").split(/[,\s]+/).filter(Boolean),
    order: Number(head.order ?? 100),
    summary: head.summary ?? "",
    video: videoUrl(head.video),
    body: m ? m[2] : src,
  };
}

/** Všechny návody (v produkci jednou za běh serveru). */
export function helpTopics(): HelpTopic[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
  cache = files.map((f) => parse(f.replace(/\.md$/, ""), readFileSync(join(DIR, f), "utf8"))).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return cache;
}

export const helpTopic = (id: string) => helpTopics().find((t) => t.id === id) ?? null;

/** Návod k objektu (formulář, seznam) nebo k modulu (plocha modulu). */
export function helpFor(objectOrModule: string): HelpTopic | null {
  const all = helpTopics();
  return all.find((t) => t.objects.includes(objectOrModule)) ?? all.find((t) => t.module === objectOrModule) ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Řádkové značky: **tučně**, *kurzíva*, `kód`, [odkaz](/cesta), klávesy <kbd> přes `[[Ctrl+K]]`. */
function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[\[([^\]]+)\]\]/g, "<kbd>$1</kbd>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, href: string) => {
    const safe = /^(\/|https?:\/\/|#)/.test(href) ? href : "#";
    const ext = safe.startsWith("http");
    return `<a href="${safe}"${ext ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
  });
  return out;
}

/**
 * Markdown → HTML (nadpisy, odstavce, seznamy, číslované kroky, tabulky,
 * citace jako tip „> “, vodorovná čára). Jen pro vlastní texty nápovědy.
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(4, h[1].length + 1);
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      html.push("<hr/>");
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      html.push(`<blockquote>${buf.map(inline).join("<br/>")}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m && m[1].length === 0) items.push(inline(m[3]));
        else if (m && items.length) items[items.length - 1] += `<br/>• ${inline(m[3])}`; // vnořená položka
        else if (lines[i].startsWith("   ") && items.length) items[items.length - 1] += ` ${inline(lines[i].trim())}`;
        else break;
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join("")}</${tag}>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\||\s*([-*]|\d+\.)\s|---)/.test(lines[i])) buf.push(lines[i++]);
    html.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return html.join("\n");
}
