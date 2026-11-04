import "server-only";
// 지라·컨플루언스 → NPD 단계 기록 (서버 전용)
import { supabaseAdmin } from "@/lib/supabase/admin";
import { adfToText, cleanLine, findMentions, shortHash, storageToText } from "./extract";

export interface ExtItem {
  source: "jira" | "confluence";
  /** GAME-12 / 컨플루언스 페이지 id */
  key: string;
  url: string;
  title: string;
  status?: string | null;
  assignee?: string | null;
  due?: string | null;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null);

/** 글 하나 처리: 언급된 단계마다 '참조' 기록 1개 + '결정:'/'이슈:' 줄마다 기록 */
export async function ingest(item: ExtItem): Promise<{ codes: number; stages: number; written: number }> {
  const mentions = findMentions(item.title, item.text);
  if (!mentions.length) return { codes: 0, stages: 0, written: 0 };
  const db = supabaseAdmin();
  const { data: stages, error } = await db
    .from("stages")
    .select("id,project_id,name,ref_code")
    .in(
      "ref_code",
      mentions.map((m) => m.code)
    );
  if (error) throw error;
  if (!stages?.length) return { codes: mentions.length, stages: 0, written: 0 };

  const label = item.source === "jira" ? item.key : "컨플루언스";
  const meta = [item.status && `상태 ${item.status}`, item.assignee && `담당 ${item.assignee}`, short(item.due) && `기한 ${short(item.due)}`]
    .filter(Boolean)
    .join(" · ");
  const extTitle = item.source === "jira" ? `${item.key} ${item.title}` : item.title;
  const base = `${item.source}:${item.key}`;
  let written = 0;

  for (const st of stages) {
    const m = mentions.find((x) => x.code === st.ref_code)!;
    const rows: Record<string, unknown>[] = [];
    // 참조 기록
    const excerpt = m.lines.map(cleanLine).filter(Boolean).slice(0, 3);
    rows.push({
      ext_key: base,
      kind: "memo",
      body: [`[${label}] ${item.title}`, meta, ...excerpt].filter(Boolean).join("\n"),
      body_html:
        `<p><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(extTitle)}</strong></a></p>` +
        (meta ? `<p><span style="color: #64748b">${esc(meta)}</span></p>` : "") +
        (excerpt.length ? `<ul>${excerpt.map((l) => `<li><p>${esc(l)}</p></li>`).join("")}</ul>` : ""),
      ext_title: extTitle,
      ext_status: [item.status, short(item.due) && `기한 ${short(item.due)}`].filter(Boolean).join(" · ") || null,
    });
    // 결정·이슈 줄
    for (const mk of m.marked) {
      if (!mk.text) continue;
      rows.push({
        ext_key: `${base}#${shortHash(mk.kind + mk.text)}`,
        kind: mk.kind,
        body: `${mk.text}\n(출처: ${extTitle})`,
        body_html: `<p>${esc(mk.text)}</p><p><span style="font-size: 12px"><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">출처: ${esc(extTitle)}</a></span></p>`,
        ext_title: extTitle,
        ext_status: null,
      });
    }

    const { data: existing } = await db
      .from("stage_logs")
      .select("id,ext_key,body,ext_status,ext_title")
      .eq("stage_id", st.id)
      .like("ext_key", `${base}%`);
    const byKey = new Map((existing ?? []).map((e) => [e.ext_key as string, e]));
    for (const r of rows) {
      const old = byKey.get(r.ext_key as string);
      const common = { ...r, source: item.source, ext_url: item.url, stage_name: st.name };
      if (!old) {
        const { error: e } = await db.from("stage_logs").insert({ ...common, project_id: st.project_id, stage_id: st.id, author_id: null });
        if (e) throw e;
        written++;
      } else if (old.body !== r.body || old.ext_status !== r.ext_status || old.ext_title !== r.ext_title) {
        const { error: e } = await db.from("stage_logs").update({ ...common, edited_at: new Date().toISOString() }).eq("id", old.id);
        if (e) throw e;
        written++;
      }
    }
  }
  return { codes: mentions.length, stages: stages.length, written };
}

// ---------------------------------------------------------------------
// 지라 자동화(Automation) 웹훅
// ---------------------------------------------------------------------
export function webhookKey(): string | null {
  return process.env.ATLASSIAN_WEBHOOK_SECRET || process.env.CRON_SECRET || null;
}

export function fromJiraWebhook(b: Record<string, unknown>): ExtItem | null {
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? adfToText(v) : String(v));
  const key = str(b.key).trim();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) return null;
  const site = process.env.ATLASSIAN_SITE?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = str(b.url) || (site ? `https://${site}/browse/${key}` : "");
  return {
    source: "jira",
    key,
    url,
    title: str(b.summary),
    status: str(b.status) || null,
    assignee: str(b.assignee) || null,
    due: str(b.duedate) || null,
    text: [str(b.summary), str(b.description), str(b.comment), str(b.text)].join("\n"),
  };
}

// ---------------------------------------------------------------------
// API로 정기 수집 (컨플루언스, 지라 보조)
// ---------------------------------------------------------------------
function creds() {
  const site = process.env.ATLASSIAN_SITE?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_API_TOKEN;
  if (!site || !email || !token) return null;
  return { site, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

export function pollConfigured() {
  return !!creds();
}

async function getJson(url: string, auth: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${new URL(url).pathname} → HTTP ${r.status}${r.status === 401 ? " (이메일·API 토큰 확인)" : ""}`);
    return r.json();
  } finally {
    clearTimeout(t);
  }
}

async function windowMinutes(key: string): Promise<number> {
  const { data } = await supabaseAdmin().from("integration_state").select("value").eq("key", key).maybeSingle();
  const last = (data?.value as { last_ok?: string } | null)?.last_ok;
  const m = last ? Math.ceil((Date.now() - new Date(last).getTime()) / 60000) + 15 : 3 * 24 * 60;
  return Math.min(7 * 24 * 60, Math.max(75, m));
}

async function saveState(key: string, value: Record<string, unknown>) {
  await supabaseAdmin().from("integration_state").upsert({ key, value, updated_at: new Date().toISOString() });
}

export async function pollConfluence() {
  const c = creds();
  if (!c) return { skipped: "ATLASSIAN_* 환경변수 없음" };
  const started = new Date().toISOString();
  try {
    const mins = await windowMinutes("confluence");
    const spaces = (process.env.ATLASSIAN_CONFLUENCE_SPACES ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const cql = `type in (page, blogpost) AND lastmodified >= now("-${mins}m")${spaces.length ? ` AND space in (${spaces.map((s) => `"${s}"`).join(",")})` : ""}`;
    let start = 0;
    let pages = 0;
    let written = 0;
    let stages = 0;
    for (let guard = 0; guard < 8; guard++) {
      const j = await getJson(
        `https://${c.site}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&expand=body.storage&limit=25&start=${start}`,
        c.auth
      );
      const results = (j.results ?? []) as { id: string; title: string; body?: { storage?: { value?: string } }; _links?: { webui?: string } }[];
      for (const p of results) {
        pages++;
        const r = await ingest({
          source: "confluence",
          key: p.id,
          url: `https://${c.site}/wiki${p._links?.webui ?? `/pages/${p.id}`}`,
          title: p.title,
          text: storageToText(p.body?.storage?.value ?? ""),
        });
        written += r.written;
        stages += r.stages;
      }
      if (results.length < 25) break;
      start += 25;
    }
    const out = { last_ok: started, window_min: mins, pages, stages, written, error: null };
    await saveState("confluence", out);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "컨플루언스 응답이 너무 느립니다" : e.message) : String(e);
    const { data } = await supabaseAdmin().from("integration_state").select("value").eq("key", "confluence").maybeSingle();
    await saveState("confluence", { ...((data?.value as object) ?? {}), error: msg, last_try: started });
    return { error: msg };
  }
}

/** 지라 보조 수집: 자동화 규칙이 없어도 정기적으로 코드가 적힌 이슈를 찾음 */
export async function pollJira() {
  const c = creds();
  if (!c) return { skipped: "ATLASSIAN_* 환경변수 없음" };
  const started = new Date().toISOString();
  try {
    const mins = await windowMinutes("jira");
    const jql = `text ~ "NPD*" AND updated >= -${mins}m ORDER BY updated DESC`;
    let token: string | undefined;
    let issues = 0;
    let written = 0;
    for (let guard = 0; guard < 6; guard++) {
      const q = new URLSearchParams({ jql, fields: "summary,status,assignee,duedate,description,comment", maxResults: "50" });
      if (token) q.set("nextPageToken", token);
      const j = await getJson(`https://${c.site}/rest/api/3/search/jql?${q}`, c.auth);
      for (const it of (j.issues ?? []) as { key: string; fields: Record<string, unknown> }[]) {
        issues++;
        const f = it.fields;
        const comments = ((f.comment as { comments?: { body: unknown }[] } | undefined)?.comments ?? []).map((x) => adfToText(x.body));
        const r = await ingest({
          source: "jira",
          key: it.key,
          url: `https://${c.site}/browse/${it.key}`,
          title: String(f.summary ?? ""),
          status: (f.status as { name?: string } | null)?.name ?? null,
          assignee: (f.assignee as { displayName?: string } | null)?.displayName ?? null,
          due: (f.duedate as string | null) ?? null,
          text: [String(f.summary ?? ""), adfToText(f.description), ...comments].join("\n"),
        });
        written += r.written;
      }
      token = j.nextPageToken;
      if (!token || j.isLast) break;
    }
    const out = { last_ok: started, window_min: mins, issues, written, error: null };
    await saveState("jira", out);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "지라 응답이 너무 느립니다" : e.message) : String(e);
    const { data } = await supabaseAdmin().from("integration_state").select("value").eq("key", "jira").maybeSingle();
    await saveState("jira", { ...((data?.value as object) ?? {}), error: msg, last_try: started });
    return { error: msg };
  }
}

export async function noteWebhook(item: ExtItem, result: { stages: number; written: number }) {
  await saveState("jira_webhook", { last_at: new Date().toISOString(), last_key: item.key, stages: result.stages, written: result.written });
}
