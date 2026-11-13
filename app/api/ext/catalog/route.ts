import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildRows } from "@/lib/groups";
import type { Stage, StageGroup } from "@/lib/types";

export const dynamic = "force-dynamic";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

/** 크롬 확장 프로그램: 진행 중인 프로젝트와 단계 목록 (연결 코드로 확인) */
export async function GET(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "연결 코드가 없습니다. 확장 프로그램 설정에 NPD에서 받은 연결 코드를 넣어 주세요." }, 401);
  try {
    const db = supabaseAdmin();
    const { data: tok } = await db
      .from("ext_tokens")
      .select("id,owner_id,profiles(name,email,approved)")
      .eq("token_hash", createHash("sha256").update(token, "utf8").digest("hex"))
      .maybeSingle();
    const prof = tok?.profiles as unknown as { name: string | null; email: string; approved: boolean } | null;
    if (!tok || !prof?.approved) return json({ error: "연결 코드가 맞지 않거나 삭제됐습니다. NPD [캘린더 연동]에서 새 코드를 받아 주세요." }, 401);
    await db.from("ext_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);

    const { data: projects, error } = await db.from("projects").select("*").eq("archived", false).order("created_at", { ascending: false });
    if (error) throw error;
    const pids = (projects ?? []).map((p) => p.id);
    const [{ data: stages, error: se }, g] = await Promise.all([
      db.from("stages").select("*").in("project_id", pids).order("sort_order"),
      db.from("stage_groups").select("*").in("project_id", pids),
    ]);
    if (se) throw se;
    const groups = (g.error ? [] : g.data ?? []) as StageGroup[];

    const out = (projects ?? []).map((p) => {
      const ss = ((stages ?? []) as Stage[]).filter((s) => s.project_id === p.id);
      const gs = groups.filter((x) => x.project_id === p.id);
      const rows = buildRows(ss, gs, new Set(ss.map((s) => s.id)), new Set(), false);
      const path: string[] = [];
      const list: unknown[] = [];
      for (const r of rows) {
        path.length = r.depth;
        if (r.kind === "group") {
          path[r.depth] = r.group.name;
          continue;
        }
        const s = r.stage;
        list.push({
          id: s.id,
          name: s.name,
          code: s.ref_code ?? null,
          path: path.slice(0, r.depth).filter(Boolean).join(" › "),
          depth: r.depth,
          plan_start: s.plan_start,
          plan_end: s.plan_end,
          done: !!s.actual_end,
          skipped: !!s.skipped,
          calendar: !!s.cal_linked,
        });
        path[r.depth] = s.name;
      }
      const tags = ((p.calendar_tags ?? []) as string[]).filter(Boolean);
      return { id: p.id, name: p.name, category: p.category, tag: tags[0] ?? p.name, tags, stages: list };
    });

    const site = (process.env.NPD_SITE_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, "");
    return json({ user: prof.name || prof.email.split("@")[0], site, projects: out, at: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    return json({ error: /ext_tokens/.test(msg) ? "DB 업데이트(011_ext_tokens.sql)가 필요합니다" : msg }, 500);
  }
}
