import { NextResponse } from "next/server";
import { authorize } from "@/lib/calendar/server";
import { postSlack, slackConfigured } from "@/lib/atlassian/slack";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const siteUrl = () => (process.env.NPD_SITE_URL || process.env.URL || "https://rbtngamepartnpd.netlify.app").replace(/\/$/, "");
const sl = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * @언급 슬랙 알림. 본인 로그인으로 메모·단계를 읽으므로, 볼 수 없는 것은 알릴 수 없음.
 * 나만 보기 메모는 알리지 않음.
 */
export async function POST(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  const me = a.userId;
  if (!me) return NextResponse.json({ error: "로그인한 사람만 보낼 수 있습니다" }, { status: 401 });
  if (!slackConfigured()) return NextResponse.json({ ok: false, skipped: "슬랙이 설정되지 않았습니다" });

  const body = (await req.json().catch(() => null)) as
    | { kind: "note"; id: string; mentioned: string[] }
    | { kind: "log"; stageId: string; mentioned: string[]; text?: string }
    | null;
  const ids = Array.from(new Set((body?.mentioned ?? []).filter((x) => typeof x === "string" && UUID.test(x)))).slice(0, 20);
  if (!body || !ids.length) return NextResponse.json({ ok: false, skipped: "언급된 사람이 없습니다" });

  const sb = await supabaseServer();
  const { data: people } = await sb.from("profiles").select("id,name,email").in("id", [...ids, me]);
  const nameOf = (id: string) => {
    const p = (people ?? []).find((x) => x.id === id) as { name?: string | null; email?: string | null } | undefined;
    return p?.name || p?.email?.split("@")[0] || "누군가";
  };
  const who = ids.filter((id) => id !== me).map((id) => `*${sl(nameOf(id))}*님`);
  if (!who.length) return NextResponse.json({ ok: false, skipped: "자기 자신만 언급했습니다" });
  const by = sl(nameOf(me));

  let text: string;
  if (body.kind === "note") {
    if (!UUID.test(body.id)) return NextResponse.json({ error: "잘못된 메모" }, { status: 400 });
    const { data: n } = await sb.from("notes").select("id,title,visibility,body_text").eq("id", body.id).maybeSingle();
    if (!n) return NextResponse.json({ error: "메모를 찾을 수 없습니다" }, { status: 404 });
    if (n.visibility === "private") return NextResponse.json({ ok: false, skipped: "나만 보기 메모" });
    text = `:speech_balloon: ${by}님이 메모에서 ${who.join(", ")}을 언급했습니다\n<${siteUrl()}/notes?id=${n.id}|${sl(cut(n.title || "제목 없음", 80))}>`;
  } else {
    if (!UUID.test(body.stageId)) return NextResponse.json({ error: "잘못된 단계" }, { status: 400 });
    const { data: s } = await sb.from("stages").select("id,name,project_id,projects(name)").eq("id", body.stageId).maybeSingle();
    if (!s) return NextResponse.json({ error: "단계를 찾을 수 없습니다" }, { status: 404 });
    const pname = (s as unknown as { projects?: { name?: string } | null }).projects?.name ?? "";
    const snippet = body.text ? `\n> ${sl(cut(body.text.replace(/\s+/g, " ").trim(), 160))}` : "";
    text = `:speech_balloon: ${by}님이 진행 기록에서 ${who.join(", ")}을 언급했습니다\n<${siteUrl()}/projects/${s.project_id}?stage=${s.id}|${sl(cut(`${pname} › ${s.name}`, 100))}>${snippet}`;
  }
  const r = await postSlack(text);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
