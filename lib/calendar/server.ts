import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { parseCalendar } from "./ics";
import { planSync, type EventRow, type ProjectRow, type StageRow } from "./apply";

export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/** 요청한 사람이 로그인·승인된 사용자이거나, 정기 실행(CRON_SECRET)인지 확인 */
export async function authorize(req: Request): Promise<{ ok: true; userId: string | null } | { ok: false; res: NextResponse }> {
  const cron = process.env.CRON_SECRET;
  const key = req.headers.get("x-cron-key");
  if (cron && key && key === cron) return { ok: true, userId: null };
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 }) };
  const { data } = await sb.from("profiles").select("approved").eq("id", user.id).maybeSingle();
  if (!data?.approved) return { ok: false, res: NextResponse.json({ error: "승인된 사용자만 동기화할 수 있습니다" }, { status: 403 }) };
  return { ok: true, userId: user.id };
}

export function fail(e: unknown, status = 500) {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  return NextResponse.json({ error: msg }, { status });
}

async function chunked<T>(items: T[], size: number, fn: (part: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

/** 캘린더 하나 읽어서 말머리 일정 저장 */
export async function syncSource(sourceId: string) {
  const db = supabaseAdmin();
  const { data: src, error } = await db.from("calendar_sources").select("*").eq("id", sourceId).maybeSingle();
  if (error) throw error;
  if (!src) throw new Error("캘린더를 찾을 수 없습니다");
  try {
    if (!String(src.ics_url).startsWith("https://calendar.google.com/calendar/ical/")) throw new Error("구글 캘린더 비공개 주소가 아닙니다");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(src.ics_url, { signal: ctrl.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      throw new Error(
        res.status === 404 || res.status === 403
          ? "캘린더 주소가 맞지 않거나 재설정되었습니다. 비공개 주소를 다시 복사해 주세요."
          : `캘린더를 읽지 못했습니다 (HTTP ${res.status})`
      );
    }
    const raw = await res.text();
    if (!raw.includes("BEGIN:VCALENDAR")) throw new Error("iCal 형식이 아닙니다. 'iCal 형식의 비공개 주소'를 복사했는지 확인해 주세요.");
    const { events, total } = parseCalendar(raw, today());

    // 기존 행 (이 캘린더가 가진 것 + 이번에 나온 key)
    const keys = events.map((e) => e.key);
    const existing = new Map<string, { key: string; source_ids: string[] }>();
    const { data: mine } = await db.from("calendar_events").select("key,source_ids").contains("source_ids", [sourceId]);
    (mine ?? []).forEach((r) => existing.set(r.key, r));
    await chunked(keys, 200, async (part) => {
      const { data } = await db.from("calendar_events").select("key,source_ids").in("key", part);
      (data ?? []).forEach((r) => existing.set(r.key, r));
    });

    const now = new Date().toISOString();
    const rows = events.map((e) => ({
      ...e,
      source_ids: Array.from(new Set([...(existing.get(e.key)?.source_ids ?? []), sourceId])),
      removed: false,
      last_seen_at: now,
      updated_at: now,
    }));
    await chunked(rows, 300, async (part) => {
      const { error: e } = await db.from("calendar_events").upsert(part, { onConflict: "key" });
      if (e) throw e;
    });

    // 이번에 안 보인 일정: 이 캘린더를 빼고, 아무 캘린더에도 없으면 '사라짐'
    const seen = new Set(keys);
    const gone = (mine ?? []).filter((r) => !seen.has(r.key));
    await pool(gone, 8, async (r) => {
      const left = r.source_ids.filter((s: string) => s !== sourceId);
      await db
        .from("calendar_events")
        .update({ source_ids: left, removed: left.length === 0, updated_at: now })
        .eq("key", r.key);
    });

    await db.from("calendar_sources").update({ last_synced_at: now, last_error: null, event_count: events.length }).eq("id", sourceId);
    return { ok: true, total, tagged: events.length, removed: gone.length };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "캘린더 응답이 너무 느립니다. 잠시 후 다시 시도해 주세요." : e.message) : String(e);
    await db.from("calendar_sources").update({ last_error: msg }).eq("id", sourceId);
    return { ok: false, error: msg };
  }
}

/** 저장된 말머리 일정 → 프로젝트 단계 반영 */
export async function applySync() {
  const db = supabaseAdmin();
  const [ev, pj, st, pf, src, ig] = await Promise.all([
    db.from("calendar_events").select("key,tag,tag_norm,stage_name,detail,start_date,end_date,done,organizer,attendees,source_ids,desc_owner,desc_related,desc_roles,removed,project_id,stage_id"),
    db.from("projects").select("id,name,calendar_tags,archived"),
    db
      .from("stages")
      .select("id,project_id,name,sort_order,department,related_departments,dept_roles,plan_start,plan_end,actual_start,actual_end,progress,cal_linked,cal_follow,cal_missing"),
    db.from("profiles").select("id,email,department"),
    db.from("calendar_sources").select("id,owner_id"),
    db.from("calendar_ignored_tags").select("tag_norm"),
  ]);
  for (const r of [ev, pj, st, pf, src, ig]) if (r.error) throw r.error;

  const deptById = Object.fromEntries((pf.data ?? []).map((p) => [p.id, p.department as string | null]));
  const deptByEmail = Object.fromEntries((pf.data ?? []).map((p) => [String(p.email).toLowerCase(), p.department as string | null]));
  const deptBySource = Object.fromEntries((src.data ?? []).map((s) => [s.id, deptById[s.owner_id] ?? null]));

  const plan = planSync({
    events: (ev.data ?? []) as EventRow[],
    projects: (pj.data ?? []) as ProjectRow[],
    stages: (st.data ?? []) as StageRow[],
    deptByEmail,
    deptBySource,
    ignoredTags: (ig.data ?? []).map((r) => r.tag_norm),
    today: today(),
  });

  // 새 단계
  const groupId = new Map<string, string>();
  for (const ins of plan.inserts) {
    const { _group, ...row } = ins;
    const { data, error } = await db.from("stages").insert(row).select("id").single();
    if (error) throw error;
    groupId.set(_group, data.id);
  }
  // 기존 단계 갱신
  await pool(plan.updates, 6, async (u) => {
    const { error } = await db.from("stages").update(u.patch).eq("id", u.id);
    if (error) throw error;
  });
  // 일정 ↔ 단계 연결 (바뀐 것만, 같은 연결끼리 묶어서)
  const current = new Map((ev.data ?? []).map((e) => [e.key, `${e.project_id}|${e.stage_id}`]));
  const buckets = new Map<string, string[]>();
  plan.eventLinks.forEach((l) => {
    const sid = l.stage_id ?? (l.group ? groupId.get(l.group) ?? null : null);
    const k = `${l.project_id}|${sid}`;
    if (current.get(l.key) === k) return;
    const b = buckets.get(k) ?? [];
    b.push(l.key);
    buckets.set(k, b);
  });
  await pool(Array.from(buckets.entries()), 4, async ([k, keys]) => {
    const [p, s] = k.split("|");
    await chunked(keys, 200, async (part) => {
      const { error } = await db
        .from("calendar_events")
        .update({ project_id: p === "null" ? null : p, stage_id: s === "null" ? null : s })
        .in("key", part);
      if (error) throw error;
    });
  });

  const result = { ...plan.stats, unmatchedTags: plan.unmatchedTags };
  await db.from("calendar_sync_state").upsert({ id: 1, last_run_at: new Date().toISOString(), last_result: result });
  return result;
}
