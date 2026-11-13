import "server-only";
// 슬랙으로 'NPD 업데이트 요청' 보내기 (Incoming Webhook)
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface StageChange {
  stageId: string;
  projectId: string;
  stageName: string;
  refCode: string;
  /** new: 처음 연결 / status / comment / content */
  kinds: ("new" | "status" | "comment" | "content")[];
  oldStatus?: string | null;
}

export function slackConfigured() {
  return !!process.env.SLACK_WEBHOOK_URL;
}

const siteUrl = () => (process.env.NPD_SITE_URL || process.env.URL || "https://rbtngamepartnpd.netlify.app").replace(/\/$/, "");
// 슬랙 mrkdwn 에서 <, >, & 는 바꿔야 함
const sl = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function postSlack(text: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL 환경변수가 없습니다" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, error: `슬랙 응답 ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

export async function notifyChange(
  item: { source: "jira" | "confluence"; key: string; url: string; title: string; status?: string | null; assignee?: string | null; lastComment?: string | null },
  changes: StageChange[]
) {
  if (!slackConfigured() || !changes.length) return;
  const db = supabaseAdmin();
  const pids = Array.from(new Set(changes.map((c) => c.projectId)));
  const { data: projects } = await db.from("projects").select("id,name,pm_id").in("id", pids);
  const pmIds = (projects ?? []).map((p) => p.pm_id).filter(Boolean) as string[];
  const { data: pms } = pmIds.length ? await db.from("profiles").select("id,name,email").in("id", pmIds) : { data: [] };
  const pName = (pid: string) => (projects ?? []).find((p) => p.id === pid)?.name ?? "";
  const pm = (pid: string) => {
    const id = (projects ?? []).find((p) => p.id === pid)?.pm_id;
    const p = (pms ?? []).find((x) => x.id === id);
    return p ? p.name || p.email.split("@")[0] : null;
  };

  const all = new Set(changes.flatMap((c) => c.kinds));
  const what: string[] = [];
  if (item.source === "jira") {
    if (all.has("new")) what.push("NPD 코드가 새로 연결됨");
    if (all.has("status")) {
      const from = changes.find((c) => c.oldStatus)?.oldStatus?.split(" · ")[0];
      what.push(`상태 ${from ? `${sl(from)} → ` : ""}*${sl(item.status ?? "")}*`);
    }
    if (all.has("comment")) what.push("새 댓글");
    if (all.has("content")) what.push("제목·설명 수정");
  } else {
    what.push(all.has("new") ? "NPD 코드가 적힌 문서가 새로 생기거나 코드가 추가됨" : "문서 내용 수정");
  }

  const head =
    item.source === "jira"
      ? `<${item.url}|${sl(item.key)} ${sl(cut(item.title, 80))}>`
      : `<${item.url}|📘 ${sl(cut(item.title, 80))}>`;
  const lines = [
    `:arrows_counterclockwise: *NPD 업데이트 요청* · ${item.source === "jira" ? "Jira" : "Confluence"}`,
    `${head}`,
    `변경: ${what.join(" · ")}${item.assignee ? ` (담당 ${sl(item.assignee)})` : ""}`,
  ];
  if (all.has("comment") && item.lastComment?.trim()) lines.push(`> ${sl(cut(item.lastComment.replace(/\s+/g, " ").trim(), 160))}`);
  lines.push("");
  for (const c of changes) {
    const p = pm(c.projectId);
    lines.push(`• <${siteUrl()}/s/${c.refCode}|${sl(pName(c.projectId))} › ${sl(c.stageName)}> \`${c.refCode}\`${p ? ` · PM ${sl(p)}` : ""}`);
  }
  lines.push("단계 일정·진행 상황을 확인하고 업데이트해 주세요.");
  const r = await postSlack(lines.join("\n"));
  await db
    .from("integration_state")
    .upsert({ key: "slack", value: { last_at: new Date().toISOString(), last_item: `${item.source}:${item.key}`, ok: r.ok, error: r.error ?? null }, updated_at: new Date().toISOString() });
}
