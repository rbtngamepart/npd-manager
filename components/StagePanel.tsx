"use client";

import { useEffect, useState } from "react";
import { datesToWeeks, relativeTime, short, weeksToDates } from "@/lib/dates";
import { stageAutoStatus } from "@/lib/status";
import type { LogKind, Profile, Stage, StageLog } from "@/lib/types";
import { displayName } from "./AppProvider";
import { PmPicker, StatusChip } from "./ui";
import { DeptPicker, DeptSelect } from "./DeptPicker";
import { useApp } from "./AppProvider";
import { cleanRoles } from "@/lib/departments";
import type { DeptColorFn } from "@/lib/deptColors";
import type { CalendarEvent } from "@/lib/types";

const KIND: Record<LogKind, { label: string; cls: string }> = {
  memo: { label: "메모", cls: "bg-slate-100 text-slate-600" },
  issue: { label: "이슈", cls: "bg-rose-50 text-rose-700" },
  decision: { label: "결정", cls: "bg-violet-50 text-violet-700" },
  change: { label: "변경", cls: "bg-sky-50 text-sky-700" },
};

type Form = Pick<
  Stage,
  | "name"
  | "department"
  | "related_departments"
  | "dept_roles"
  | "description"
  | "plan_start"
  | "plan_end"
  | "actual_start"
  | "expected_end"
  | "actual_end"
  | "progress"
  | "pm_status"
  | "issue"
  | "next_action"
  | "assignee"
  | "needs_check"
  | "skipped"
  | "cal_follow"
  | "cal_linked"
>;

function pick(s: Stage): Form {
  return {
    name: s.name,
    department: s.department,
    related_departments: s.related_departments ?? [],
    dept_roles: s.dept_roles ?? {},
    description: s.description,
    plan_start: s.plan_start,
    plan_end: s.plan_end,
    actual_start: s.actual_start,
    expected_end: s.expected_end,
    actual_end: s.actual_end,
    progress: s.progress,
    pm_status: s.pm_status,
    issue: s.issue,
    next_action: s.next_action,
    assignee: s.assignee,
    needs_check: s.needs_check,
    skipped: s.skipped,
    cal_follow: s.cal_follow,
    cal_linked: s.cal_linked,
  };
}

export function StagePanel({
  stage,
  index,
  total,
  projectStart,
  canEdit,
  today,
  logs,
  myId,
  profileById,
  departments,
  colorOf,
  calEvents = [],
  onSave,
  onDelete,
  onMove,
  onAddLog,
  onDeleteLog,
  onClose,
}: {
  stage: Stage;
  index: number;
  total: number;
  projectStart: string | null;
  canEdit: boolean;
  today: string;
  logs: StageLog[];
  myId: string;
  profileById: Record<string, Profile>;
  departments: string[];
  colorOf?: DeptColorFn;
  /** 이 단계에 연결된 구글 캘린더 일정 */
  calEvents?: CalendarEvent[];
  onSave: (patch: Partial<Stage>) => Promise<void>;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddLog: (kind: LogKind, body: string) => Promise<void>;
  onDeleteLog: (id: string) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>(pick(stage));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<LogKind>("memo");
  const { roleTypes, roleNames } = useApp();
  const rolesReady = roleTypes !== null; // DB 업데이트(005) 전이면 역할 칸 숨김

  useEffect(() => setF(pick(stage)), [stage]);

  const base = pick(stage);
  const dirty = (Object.keys(f) as (keyof Form)[]).some(
    (k) => JSON.stringify(f[k] ?? null) !== JSON.stringify(base[k] ?? null)
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const nul = (v: string) => (v.trim() === "" ? null : v);

  const weeks = projectStart && f.plan_start && f.plan_end ? datesToWeeks(projectStart, f.plan_start, f.plan_end) : null;

  function setWeeks(startWeek: number | null, w: number | null) {
    if (!projectStart || !startWeek || !w) return;
    const d = weeksToDates(projectStart, startWeek, w);
    setF((p) => ({ ...p, plan_start: d.start, plan_end: d.end }));
  }

  async function save() {
    setSaving(true);
    const roles = cleanRoles(f.dept_roles, f.department, f.related_departments);
    const patch: Partial<Stage> = { ...f, name: f.name.trim() || stage.name };
    if (stage.cal_linked === undefined) {
      delete patch.cal_follow; // 006 업데이트 전
      delete patch.cal_linked;
    }
    if (JSON.stringify(roles) === JSON.stringify(cleanRoles(base.dept_roles, base.department, base.related_departments))) {
      delete patch.dept_roles; // 바뀌지 않았으면 보내지 않음
    } else patch.dept_roles = roles;
    await onSave(patch);
    setSaving(false);
  }

  async function addLog() {
    if (!note.trim()) return;
    await onAddLog(kind, note.trim());
    setNote("");
    setKind("memo");
  }

  function markDone() {
    setF((p) => ({ ...p, actual_end: today, progress: 100, actual_start: p.actual_start ?? p.plan_start ?? today }));
  }

  const auto = stageAutoStatus({ ...stage, ...f }, today);
  const ro = !canEdit;
  const planLocked = !!f.cal_linked && f.cal_follow !== false;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-black/10 bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3" data-tour="sp-head">
        <span className="text-xs tabular-nums text-slate-400">
          단계 {index + 1}/{total}
        </span>
        {canEdit && (
          <div className="flex">
            <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={index === 0} onClick={() => onMove(-1)} title="위로">
              ↑
            </button>
            <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={index === total - 1} onClick={() => onMove(1)} title="아래로">
              ↓
            </button>
          </div>
        )}
        <button className="btn-ghost ml-auto px-2" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          <input
            className="w-full border-0 bg-transparent p-0 text-lg font-semibold outline-none disabled:text-ink"
            value={f.name}
            disabled={ro}
            onChange={(e) => set("name", e.target.value)}
          />
          {f.cal_linked && (
            <div className={`rounded-lg px-3 py-2 text-xs ${stage.cal_missing ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`} data-tour="sp-calendar">
              <div className="flex items-center gap-2">
                <span>📅</span>
                <span className="flex-1">
                  {stage.cal_missing
                    ? "연결된 캘린더 일정이 모두 사라졌습니다. 단계가 필요 없으면 '미사용' 또는 삭제하세요."
                    : planLocked
                      ? "구글 캘린더 일정을 따릅니다. 계획 날짜는 캘린더에서 바꾸세요."
                      : "캘린더와 연결돼 있지만 계획 날짜는 NPD에서 직접 관리합니다."}
                </span>
              </div>
              {canEdit && (
                <div className="mt-1.5 flex flex-wrap gap-3">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={f.cal_follow !== false} onChange={(e) => set("cal_follow", e.target.checked)} />
                    캘린더 일정 따르기
                  </label>
                  <button
                    type="button"
                    className="underline-offset-2 opacity-70 hover:underline"
                    onClick={() => {
                      if (confirm("캘린더 연결을 끊을까요? 다음 동기화 때 같은 이름 일정이 있으면 다시 연결됩니다.\n(계속 따로 관리하려면 '캘린더 일정 따르기'만 끄세요)"))
                        setF((p) => ({ ...p, cal_linked: false }));
                    }}
                  >
                    연결 끊기
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">담당부서</label>
              <DeptSelect
                value={f.department}
                options={departments}
                disabled={ro}
                onChange={(v) =>
                  setF((p) => ({ ...p, department: v, related_departments: p.related_departments.filter((x) => x !== v) }))
                }
              />
            </div>
            <div>
              <label className="label">담당 / 협의 대상</label>
              <input className="input" disabled={ro} value={f.assignee ?? ""} onChange={(e) => set("assignee", nul(e.target.value))} />
            </div>
          </div>
          <div data-tour="sp-related">
            <label className="label">
              연관부서 <span className="font-normal text-slate-400">— 함께 검토·협업하는 부서. 그 부서의 일정에도 이 단계가 함께 표시됩니다</span>
            </label>
            <DeptPicker
              value={f.related_departments}
              onChange={(v) => set("related_departments", v)}
              options={departments}
              exclude={f.department}
              disabled={ro}
            />
            {!ro && <p className="mt-1 text-[11px] text-slate-400">찾는 부서가 없으면 관리자에게 요청하세요 (사용자 관리 › 부서)</p>}
          </div>
          {rolesReady && (f.department || f.related_departments.length > 0) && (
            <div data-tour="sp-roles">
              <label className="label">
                부서별 역할 <span className="font-normal text-slate-400">— 같은 단계라도 부서마다 맡는 일이 다를 때</span>
              </label>
              <div className="divide-y divide-black/[0.05] rounded-lg border border-black/10">
                {[f.department, ...f.related_departments].filter(Boolean).map((d, i) => {
                  const dept = d as string;
                  const c = colorOf?.(dept);
                  const val = f.dept_roles[dept] ?? "";
                  const opts = val && !roleNames.includes(val) ? [...roleNames, val] : roleNames;
                  return (
                    <div key={dept} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.solid ?? "#cbd5e1" }} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {dept}
                        <span className="ml-1 text-[11px] text-slate-400">{i === 0 && f.department ? "담당" : "연관"}</span>
                      </span>
                      <select
                        className={`rounded-md border px-1.5 py-1 text-xs ${val ? "border-black/15 bg-white font-medium" : "border-dashed border-black/15 text-slate-400"}`}
                        disabled={ro}
                        value={val}
                        title={roleTypes?.find((r) => r.name === val)?.description ?? undefined}
                        onChange={(e) =>
                          setF((p) => {
                            const next = { ...p.dept_roles };
                            if (e.target.value) next[dept] = e.target.value;
                            else delete next[dept];
                            return { ...p, dept_roles: next };
                          })
                        }
                      >
                        <option value="">역할 미지정</option>
                        {opts.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="label">주요내용 (단계 설명)</label>
            <textarea
              className="input min-h-16"
              disabled={ro}
              value={f.description ?? ""}
              onChange={(e) => set("description", nul(e.target.value))}
            />
          </div>
        </div>

        <section className="space-y-2" data-tour="sp-plan">
          <h3 className="text-xs font-semibold text-slate-700">계획</h3>
          {projectStart && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">시작 주차</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  disabled={ro || planLocked}
                  value={weeks?.startWeek ?? ""}
                  placeholder="예) 3"
                  onChange={(e) => setWeeks(Number(e.target.value) || null, weeks?.weeks ?? 1)}
                />
              </div>
              <div>
                <label className="label">기간 (주)</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  disabled={ro || planLocked}
                  value={weeks?.weeks ?? ""}
                  placeholder="예) 4"
                  onChange={(e) => setWeeks(weeks?.startWeek ?? 1, Number(e.target.value) || null)}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">계획 시작일</label>
              <input type="date" className="input" disabled={ro || planLocked} value={f.plan_start ?? ""} onChange={(e) => set("plan_start", nul(e.target.value))} />
            </div>
            <div>
              <label className="label">계획 종료일</label>
              <input type="date" className="input" disabled={ro || planLocked} value={f.plan_end ?? ""} onChange={(e) => set("plan_end", nul(e.target.value))} />
            </div>
          </div>
          {projectStart && <p className="text-[11px] text-slate-400">주차를 입력하면 날짜가 자동 계산되고, 날짜를 고치면 주차가 바뀝니다.</p>}
        </section>

        <section className="space-y-2" data-tour="sp-actual">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">실행</h3>
            {canEdit && !f.actual_end && (
              <button className="btn-ghost px-2 py-0.5 text-xs" onClick={markDone}>
                ✓ 오늘 완료 처리
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">실제 시작일</label>
              <input type="date" className="input px-1.5" disabled={ro} value={f.actual_start ?? ""} onChange={(e) => set("actual_start", nul(e.target.value))} />
            </div>
            <div>
              <label className="label">예상 완료일</label>
              <input type="date" className="input px-1.5" disabled={ro} value={f.expected_end ?? ""} onChange={(e) => set("expected_end", nul(e.target.value))} />
            </div>
            <div>
              <label className="label">실제 완료일</label>
              <input type="date" className="input px-1.5" disabled={ro} value={f.actual_end ?? ""} onChange={(e) => set("actual_end", nul(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="label">진행률 {f.progress}%</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              className="w-full accent-[var(--color-brand-500)]"
              disabled={ro}
              value={f.progress}
              onChange={(e) => set("progress", Number(e.target.value))}
            />
          </div>
        </section>

        <section className="space-y-2" data-tour="sp-pm">
          <h3 className="text-xs font-semibold text-slate-700">PM 관리</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              자동 <StatusChip status={auto} size="sm" />
            </div>
            <PmPicker value={f.pm_status} onChange={(v) => set("pm_status", v)} disabled={ro} />
          </div>
          <div>
            <label className="label">이슈 / 결정 필요사항</label>
            <textarea className="input min-h-14" disabled={ro} value={f.issue ?? ""} onChange={(e) => set("issue", nul(e.target.value))} />
          </div>
          <div>
            <label className="label">다음 액션</label>
            <textarea className="input min-h-14" disabled={ro} value={f.next_action ?? ""} onChange={(e) => set("next_action", nul(e.target.value))} />
          </div>
          <div className="flex flex-wrap gap-4 pt-1 text-sm" data-tour="sp-check">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" disabled={ro} checked={f.needs_check} onChange={(e) => set("needs_check", e.target.checked)} />
              확인 필요
            </label>
            <label className="flex items-center gap-1.5 text-slate-500">
              <input type="checkbox" disabled={ro} checked={f.skipped} onChange={(e) => set("skipped", e.target.checked)} />
              이번 프로젝트에서 미사용
            </label>
          </div>
        </section>

        {calEvents.length > 0 && (
          <section className="space-y-2 border-t border-black/[0.06] pt-4" data-tour="sp-cal-events">
            <h3 className="text-xs font-semibold text-slate-700">📅 캘린더 일정 {calEvents.filter((e) => !e.removed).length}개</h3>
            <ol className="space-y-1">
              {calEvents
                .slice()
                .sort((a, b) => a.start_date.localeCompare(b.start_date) || (a.start_at ?? "").localeCompare(b.start_at ?? ""))
                .map((e) => (
                  <li key={e.key} className={`flex items-baseline gap-2 text-xs ${e.removed ? "text-slate-300 line-through" : e.end_date < today ? "text-slate-500" : "text-ink"}`}>
                    <span className="w-24 shrink-0 tabular-nums">
                      {short(e.start_date)}
                      {e.end_date !== e.start_date ? `~${short(e.end_date)}` : ""}
                      {!e.all_day && e.start_at && (
                        <span className="ml-1 text-slate-400">
                          {new Date(e.start_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      {e.detail ?? e.stage_name}
                      {e.done && <span className="ml-1">✅</span>}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        )}

        <section className="space-y-3 border-t border-black/[0.06] pt-4" data-tour="sp-log">
          <h3 className="text-xs font-semibold text-slate-700">진행 기록</h3>
          {canEdit && (
            <div className="space-y-2">
              <textarea
                className="input min-h-16"
                placeholder="협의 내용, 진행 메모를 남겨주세요 (Ctrl+Enter 등록)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addLog();
                }}
              />
              <div className="flex items-center gap-2">
                {(["memo", "issue", "decision"] as LogKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
                      kind === k ? "bg-ink text-white ring-ink" : "text-slate-500 ring-black/10"
                    }`}
                  >
                    {KIND[k].label}
                  </button>
                ))}
                <button className="btn-outline ml-auto py-1 text-xs" disabled={!note.trim()} onClick={addLog}>
                  기록 추가
                </button>
              </div>
            </div>
          )}
          {logs.length === 0 ? (
            <p className="text-xs text-slate-400">아직 기록이 없습니다.</p>
          ) : (
            <ol className="space-y-3">
              {logs.map((l) => (
                <li key={l.id} className="group text-sm">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={`rounded px-1.5 py-px ${KIND[l.kind].cls}`}>{KIND[l.kind].label}</span>
                    <span>{l.author_id ? displayName(profileById[l.author_id]) : "시스템"}</span>
                    <span>·</span>
                    <span title={new Date(l.created_at).toLocaleString("ko-KR")}>{relativeTime(l.created_at)}</span>
                    {l.author_id === myId && l.kind !== "change" && (
                      <button className="ml-auto hidden text-rose-500 group-hover:inline" onClick={() => onDeleteLog(l.id)}>
                        삭제
                      </button>
                    )}
                  </div>
                  <p className={`mt-0.5 whitespace-pre-wrap ${l.kind === "change" ? "text-xs text-slate-500" : ""}`}>{l.body}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {canEdit && (
          <div className="border-t border-black/[0.06] pt-3">
            <button className="btn-danger -ml-3 text-xs" onClick={onDelete}>
              이 단계 삭제
            </button>
            <span className="text-[11px] text-slate-400">(진행 기록은 프로젝트에 남습니다)</span>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 border-t border-black/[0.06] bg-slate-50/80 px-5 py-3" data-tour="sp-save">
          <span className="text-xs text-slate-400">
            {dirty ? "저장하지 않은 변경사항이 있습니다" : `최근 수정 ${short(stage.updated_at.slice(0, 10))}`}
          </span>
          <button className="btn-ghost ml-auto" disabled={!dirty} onClick={() => setF(base)}>
            되돌리기
          </button>
          <button className="btn-primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </aside>
  );
}
