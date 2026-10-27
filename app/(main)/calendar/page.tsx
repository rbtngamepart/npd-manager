"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { displayName, useApp } from "@/components/AppProvider";
import { Empty, Toast } from "@/components/ui";
import { relativeTime, short } from "@/lib/dates";
import { normTag } from "@/lib/calendar/text";
import { runCalendarSync, summaryText, type SyncSummary } from "@/lib/calendar/client";
import type { CalendarEvent, CalendarSourceInfo, Project } from "@/lib/types";

interface MySource extends CalendarSourceInfo {
  ics_url: string;
}

export default function CalendarPage() {
  const { me, profileById } = useApp();
  const [ready, setReady] = useState<boolean | null>(null);
  const [mine, setMine] = useState<MySource[]>([]);
  const [all, setAll] = useState<CalendarSourceInfo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ignored, setIgnored] = useState<{ tag_norm: string; tag: string }[]>([]);
  const [state, setState] = useState<{ last_run_at: string | null; last_result: SyncSummary["apply"] | null } | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const sb = supabase();
    const st = await sb.from("calendar_sync_state").select("*").maybeSingle();
    if (st.error) {
      setReady(false);
      return;
    }
    setReady(true);
    setState(st.data as typeof state);
    const [m, a, e, p, ig] = await Promise.all([
      sb.from("calendar_sources").select("*").order("created_at"),
      sb.rpc("calendar_sources_overview"),
      sb.from("calendar_events").select("*").eq("removed", false).order("start_date", { ascending: false }).limit(1000),
      sb.from("projects").select("*").eq("archived", false).order("created_at", { ascending: false }),
      sb.from("calendar_ignored_tags").select("tag_norm,tag"),
    ]);
    setMine(((m.data ?? []) as MySource[]).filter((s) => s.owner_id === me?.id));
    setAll((a.data ?? []) as CalendarSourceInfo[]);
    setEvents((e.data ?? []) as CalendarEvent[]);
    setProjects((p.data ?? []) as Project[]);
    setIgnored(ig.data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener("npd-calendar-synced", on);
    return () => window.removeEventListener("npd-calendar-synced", on);
  }, [load]);

  async function sync(ids?: string[]) {
    setSyncing(true);
    const r = await runCalendarSync(ids);
    setSyncing(false);
    show(summaryText(r));
    load();
  }

  async function addSource() {
    const u = url.trim();
    if (!u.startsWith("https://calendar.google.com/calendar/ical/")) {
      show("구글 캘린더의 'iCal 형식의 비공개 주소'를 붙여넣어 주세요 (https://calendar.google.com/calendar/ical/… 로 시작)");
      return;
    }
    if (u.includes("/public/")) {
      show("'공개 주소'가 아니라 '비공개 주소(iCal)'를 붙여넣어 주세요");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase()
      .from("calendar_sources")
      .insert({ ics_url: u, label: label.trim() || null, owner_id: me?.id })
      .select("id")
      .single();
    setBusy(false);
    if (error) return show(`실패: ${error.message}`);
    setUrl("");
    setLabel("");
    await load();
    sync([data.id]);
  }

  async function toggle(s: MySource) {
    await supabase().from("calendar_sources").update({ enabled: !s.enabled }).eq("id", s.id);
    load();
  }

  async function removeSource(id: string, who?: string) {
    if (!confirm(`${who ? `${who}의 ` : ""}캘린더 연결을 끊을까요? 이미 만들어진 단계는 남습니다.`)) return;
    await supabase().from("calendar_sources").delete().eq("id", id);
    load();
  }

  // 대기함: 프로젝트를 못 찾은 말머리
  const inbox = useMemo(() => {
    const ig = new Set(ignored.map((x) => x.tag_norm));
    const map = new Map<string, { tag: string; tag_norm: string; events: CalendarEvent[] }>();
    events
      .filter((e) => !e.project_id && !ig.has(e.tag_norm))
      .forEach((e) => {
        const g = map.get(e.tag_norm) ?? { tag: e.tag, tag_norm: e.tag_norm, events: [] };
        g.events.push(e);
        map.set(e.tag_norm, g);
      });
    return Array.from(map.values()).sort((a, b) => b.events.length - a.events.length);
  }, [events, ignored]);

  async function linkTag(tag: string, projectId: string) {
    const p = projects.find((x) => x.id === projectId);
    if (!p) return;
    const tags = Array.from(new Set([...(p.calendar_tags ?? []), tag]));
    const { error } = await supabase().from("projects").update({ calendar_tags: tags }).eq("id", projectId);
    if (error) return show(error.message);
    show(`[${tag}] → ${p.name} 연결. 단계를 만드는 중…`);
    sync([]);
  }

  async function createProject(tag: string, evs: CalendarEvent[]) {
    const start = evs.reduce((m, e) => (e.start_date < m ? e.start_date : m), evs[0].start_date);
    const name = prompt("새 프로젝트 이름", tag);
    if (!name) return;
    const { error } = await supabase()
      .from("projects")
      .insert({ name: name.trim(), start_date: start, calendar_tags: [tag], pm_id: me?.id });
    if (error) return show(error.message);
    show(`'${name}' 프로젝트를 만들었습니다. 단계를 만드는 중…`);
    sync([]);
  }

  async function ignore(tag: string) {
    await supabase().from("calendar_ignored_tags").insert({ tag_norm: normTag(tag), tag });
    load();
  }

  async function unignore(tagNorm: string) {
    await supabase().from("calendar_ignored_tags").delete().eq("tag_norm", tagNorm);
    load();
  }

  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const upcoming = events
    .filter((e) => e.project_id && e.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 12);
  const isGP = !!me?.is_game_part;

  if (ready === false) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">구글 캘린더 연동</h1>
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          캘린더 연동을 쓰려면 DB 업데이트가 필요합니다. 관리자가 Supabase SQL Editor에서 <code className="rounded bg-white/60 px-1">supabase/006_calendar.sql</code>을 실행해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">구글 캘린더 연동</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            캘린더 일정 제목에 <b>[프로젝트 말머리]</b>를 붙이면 그 프로젝트의 단계로 자동 반영됩니다. 일정은 캘린더에서만 관리하고, NPD에서는 PM 판단·이슈·역할·메모만 챙기면 됩니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state?.last_run_at && <span className="text-xs text-slate-500">마지막 동기화 {relativeTime(state.last_run_at)}</span>}
          <button className="btn-primary" disabled={syncing} onClick={() => sync()} data-tour="cal-sync">
            {syncing ? "동기화 중…" : "📅 지금 동기화"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          {/* 규칙 */}
          <section className="card p-5" data-tour="cal-rules">
            <h2 className="text-sm font-semibold">일정 제목 쓰는 법</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <code className="text-[13px] font-medium">[OG26] 게임 개발</code>
                <p className="mt-1 text-xs text-slate-500">말머리 OG26 프로젝트의 &lsquo;게임 개발&rsquo; 단계. 기간을 잡은 일정이면 그 기간이 단계 계획이 됩니다.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <code className="text-[13px] font-medium">[OG26] 공모전 심사 - 1차 평가</code>
                <p className="mt-1 text-xs text-slate-500">&lsquo;공모전 심사&rsquo; 단계의 세부 일정. 같은 단계명 일정들은 첫 일정~마지막 일정이 단계 기간이 됩니다.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <code className="text-[13px] font-medium">[OG26] 제품화 검증 ✅</code>
                <p className="mt-1 text-xs text-slate-500">단계의 마지막 일정에 ✅ 또는 (완료)를 붙이면 실제 완료일이 자동 입력됩니다.</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <code className="block whitespace-pre text-[12px] font-medium">{"설명란 (선택)\n담당: 게임파트(주관)\n연관: 운영팀(검토), 경영진(의결)"}</code>
                <p className="mt-1 text-xs text-slate-500">없으면 일정을 만든 사람 부서가 담당, 참석자 부서가 연관부서가 됩니다.</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              말머리는 프로젝트 [설정·권한]의 &lsquo;캘린더 말머리&rsquo;에서 정합니다 (프로젝트 이름과 같으면 자동 연결). 말머리가 없는 일정은 읽지도 저장하지도 않습니다.
            </p>
          </section>

          {/* 대기함 */}
          <section className="card overflow-hidden" data-tour="cal-inbox">
            <div className="border-b border-black/[0.06] px-4 py-3">
              <h2 className="text-sm font-semibold">
                연동 대기함 {inbox.length > 0 && <span className="ml-1 rounded-full bg-brand-500 px-1.5 text-[11px] text-white">{inbox.length}</span>}
              </h2>
              <p className="text-xs text-slate-500">말머리는 있지만 맞는 프로젝트를 못 찾은 일정입니다. 프로젝트에 연결하거나 새 프로젝트로 만드세요.</p>
            </div>
            {inbox.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">대기 중인 말머리가 없습니다 👍</p>
            ) : (
              <ul className="divide-y divide-black/[0.05]">
                {inbox.map((g) => {
                  const stages = Array.from(new Set(g.events.map((e) => e.stage_name)));
                  return (
                    <li key={g.tag_norm} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">[{g.tag}]</span>
                        <span className="text-xs text-slate-500">
                          일정 {g.events.length}개 · 단계 {stages.length}개: {stages.slice(0, 5).join(", ")}
                          {stages.length > 5 ? " …" : ""}
                        </span>
                      </div>
                      {isGP ? (
                        <div className="flex flex-wrap gap-1.5">
                          <select
                            className="rounded-lg border border-black/10 px-2 py-1 text-xs"
                            value={pick[g.tag_norm] ?? ""}
                            onChange={(e) => setPick((p) => ({ ...p, [g.tag_norm]: e.target.value }))}
                          >
                            <option value="">연결할 프로젝트 선택…</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <button className="btn-primary py-1 text-xs" disabled={!pick[g.tag_norm]} onClick={() => linkTag(g.tag, pick[g.tag_norm])}>
                            연결
                          </button>
                          <button className="btn-outline py-1 text-xs" onClick={() => createProject(g.tag, g.events)}>
                            새 프로젝트로 만들기
                          </button>
                          <button className="btn-ghost py-1 text-xs text-slate-500" onClick={() => ignore(g.tag)}>
                            무시
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400">게임파트가 프로젝트에 연결하면 반영됩니다.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {ignored.length > 0 && (
              <div className="border-t border-black/[0.06] px-4 py-2 text-[11px] text-slate-500">
                무시 중:{" "}
                {ignored.map((t) => (
                  <button key={t.tag_norm} className="mr-1.5 underline-offset-2 hover:underline" onClick={() => isGP && unignore(t.tag_norm)} title={isGP ? "무시 해제" : undefined}>
                    [{t.tag}]
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 다가오는 일정 */}
          <section className="card overflow-hidden">
            <div className="border-b border-black/[0.06] px-4 py-3">
              <h2 className="text-sm font-semibold">캘린더에서 들어온 다가오는 일정</h2>
            </div>
            {upcoming.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-400">아직 반영된 일정이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-black/[0.05] text-sm">
                {upcoming.map((e) => (
                  <li key={e.key} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
                      {short(e.start_date)}
                      {e.end_date !== e.start_date ? `~${short(e.end_date)}` : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.stage_name}
                      {e.detail && <span className="text-slate-400"> · {e.detail}</span>}
                    </span>
                    {e.project_id && (
                      <Link href={`/projects/${e.project_id}${e.stage_id ? `?stage=${e.stage_id}` : ""}`} className="shrink-0 text-xs text-brand-600 hover:underline">
                        {projectById[e.project_id]?.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* 내 캘린더 */}
          <section className="card overflow-hidden" data-tour="cal-mine">
            <div className="border-b border-black/[0.06] px-4 py-3">
              <h2 className="text-sm font-semibold">내 캘린더 연결</h2>
              <p className="text-xs text-slate-500">한 번만 해두면 됩니다. 주소는 본인만 볼 수 있어요.</p>
            </div>
            {mine.length > 0 && (
              <ul className="divide-y divide-black/[0.05]">
                {mine.map((s) => (
                  <li key={s.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.last_error ? "bg-rose-500" : s.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <span className="flex-1 truncate font-medium">{s.label || "내 캘린더"}</span>
                      <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => toggle(s)}>
                        {s.enabled ? "일시 중지" : "다시 켜기"}
                      </button>
                      <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => removeSource(s.id)}>
                        연결 끊기
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      말머리 일정 {s.event_count}개 · {s.last_synced_at ? `${relativeTime(s.last_synced_at)} 동기화` : "아직 동기화 전"}
                    </p>
                    {s.last_error && <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{s.last_error}</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2 border-t border-black/[0.06] p-4">
              <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600" open={mine.length === 0}>
                <summary className="cursor-pointer font-medium text-slate-700">비공개 주소 찾는 법</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>PC에서 구글 캘린더 열기 → 오른쪽 위 ⚙️ → <b>설정</b></li>
                  <li>왼쪽 &lsquo;내 캘린더의 설정&rsquo;에서 업무 일정이 있는 캘린더 클릭</li>
                  <li>
                    아래쪽 <b>캘린더 통합</b> → <b>iCal 형식의 비공개 주소</b> 옆 복사 (공개 주소 아님)
                  </li>
                  <li>아래 칸에 붙여넣고 [연결]</li>
                </ol>
                <p className="mt-2 text-slate-500">
                  비공개 주소가 보이지 않으면 회사 관리자가 막아둔 경우입니다. 알려주시면 Apps Script 방식으로 바꿔 드릴게요.
                </p>
              </details>
              <input className="input" placeholder="이름 (예: 민기 업무 캘린더)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input
                className="input font-mono text-xs"
                placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button className="btn-primary w-full" disabled={!url.trim() || busy} onClick={addSource}>
                {busy ? "연결 중…" : "연결"}
              </button>
            </div>
          </section>

          {/* 전체 현황 */}
          <section className="card overflow-hidden">
            <div className="border-b border-black/[0.06] px-4 py-3">
              <h2 className="text-sm font-semibold">연결된 캘린더 ({all.length})</h2>
              <p className="text-xs text-slate-500">자동 동기화는 매시 정각에 실행됩니다.</p>
            </div>
            {all.length === 0 ? (
              <div className="p-4">
                <Empty>아직 연결된 캘린더가 없습니다.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-black/[0.05] text-sm">
                {all.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-4 py-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.last_error ? "bg-rose-500" : s.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {displayName(profileById[s.owner_id])}
                        {s.label && <span className="text-slate-400"> · {s.label}</span>}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {s.last_error ? <span className="text-rose-600">{s.last_error}</span> : `일정 ${s.event_count}개 · ${s.last_synced_at ? relativeTime(s.last_synced_at) : "동기화 전"}`}
                      </span>
                    </span>
                    {me?.is_admin && s.owner_id !== me.id && (
                      <button className="btn-danger px-2 py-0.5 text-[11px]" onClick={() => removeSource(s.id, displayName(profileById[s.owner_id]))}>
                        끊기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
