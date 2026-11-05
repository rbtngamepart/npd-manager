"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { datesToWeeks, relativeTime, short, weeksToDates } from "@/lib/dates";
import { stageAutoStatus } from "@/lib/status";
import type { LogKind, Profile, Stage, StageCheck, StageDep, StageGroup, StageLink, StageLog } from "@/lib/types";
import { displayName } from "./AppProvider";
import { PmPicker, StatusChip } from "./ui";
import { DeptPicker, DeptSelect } from "./DeptPicker";
import { useApp } from "./AppProvider";
import { cleanRoles } from "@/lib/departments";
import type { DeptColorFn } from "@/lib/deptColors";
import type { CalendarEvent } from "@/lib/types";
import { RichEditor, RichView, htmlToText, isEmptyHtml, textToHtml } from "./RichText";
import { LabelPicker } from "./Labels";
import { StageChecklist, StageDeps, StageExternal, StageLinks } from "./StageExtras";
import { effectiveGroup, groupOptions, groupPath, stagePath } from "@/lib/groups";
import { useUnsaved } from "@/lib/unsaved";

export const KIND: Record<LogKind, { label: string; cls: string }> = {
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
  | "group_id"
  | "label_ids"
  | "description_html"
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
    group_id: s.group_id ?? null,
    label_ids: s.label_ids ?? [],
    description_html: s.description_html ?? null,
  };
}

// ---- 패널 너비 ---------------------------------------------------------
const NORMAL = 460;
const MIN = 380;

/** 간트의 '단계' 칸 오른쪽 끝 (넓게 펼쳐도 단계 이름은 보이도록) */
function wideWidth(): number {
  const vw = window.innerWidth;
  const g = document.querySelector<HTMLElement>("[data-gantt-left]");
  const edge = g ? g.getBoundingClientRect().right : 320;
  return Math.max(MIN, Math.min(vw - 40, vw - Math.max(0, edge)));
}

type WidthMode = "normal" | "wide" | number;

function usePanelWidth() {
  const [mode, setModeState] = useState<WidthMode>("normal");
  const [vw, setVw] = useState(1440);
  const [wide, setWide] = useState(1100);

  useEffect(() => {
    try {
      const v = localStorage.getItem("npd-panel-w");
      if (v === "wide") setModeState("wide");
      else if (v && Number(v) >= MIN) setModeState(Number(v));
    } catch {
      /* 무시 */
    }
    const on = () => {
      setVw(window.innerWidth);
      setWide(wideWidth());
    };
    on();
    // 간트가 그려진 뒤 한 번 더
    const t = setTimeout(on, 300);
    window.addEventListener("resize", on);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", on);
    };
  }, []);

  const setMode = useCallback((m: WidthMode) => {
    setModeState(m);
    if (m === "wide") setWide(wideWidth());
    try {
      localStorage.setItem("npd-panel-w", typeof m === "number" ? String(Math.round(m)) : m);
    } catch {
      /* 무시 */
    }
  }, []);

  const raw = mode === "normal" ? NORMAL : mode === "wide" ? wide : mode;
  const width = Math.min(vw, Math.max(Math.min(MIN, vw), raw));
  return { mode, setMode, width, vw };
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
  stages,
  groups,
  checks,
  links,
  deps,
  onSave,
  onDelete,
  onMove,
  onAddLog,
  onUpdateLog,
  onDeleteLog,
  onChanged,
  onOpenStage,
  onClose,
  onCopy,
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
  /** 같은 프로젝트의 모든 단계 (선후 관계 선택용) */
  stages: Stage[];
  /** null이면 DB 업데이트(008) 전 */
  groups: StageGroup[] | null;
  checks: StageCheck[] | null;
  links: StageLink[] | null;
  deps: StageDep[] | null;
  onSave: (patch: Partial<Stage>) => Promise<void>;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddLog: (kind: LogKind, body: string, html: string | null) => Promise<void>;
  onUpdateLog: (id: string, body: string, html: string) => Promise<void>;
  onDeleteLog: (id: string) => void;
  onChanged: () => void;
  onOpenStage: (id: string) => void;
  onClose: () => void;
  onCopy: (text: string, msg: string) => void;
}) {
  const [f, setF] = useState<Form>(pick(stage));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [noteKey, setNoteKey] = useState(0);
  const [kind, setKind] = useState<LogKind>("memo");
  const [editLog, setEditLog] = useState<{ id: string; html: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; preview: string } | null>(null);
  const { roleTypes, roleNames, labels } = useApp();
  const rolesReady = roleTypes !== null; // DB 업데이트(005) 전이면 역할 칸 숨김
  const v8 = stage.ref_code !== undefined; // DB 업데이트(008) 후
  const { mode, setMode, width, vw } = usePanelWidth();
  const dragging = useRef(false);

  // 다른 곳(체크리스트·링크 추가, 다른 사람 수정 등)에서 단계를 다시 불러와도
  // 아직 저장하지 않은 내 입력은 지키고, 내가 안 건드린 칸만 새 값으로 바꿈
  const lastBase = useRef<{ id: string; base: Form } | null>(null);
  useEffect(() => {
    const next = pick(stage);
    const prev = lastBase.current;
    lastBase.current = { id: stage.id, base: next };
    if (!prev || prev.id !== stage.id) {
      setF(next);
      return;
    }
    setF((cur) => {
      const merged = { ...cur } as Record<keyof Form, unknown>;
      (Object.keys(next) as (keyof Form)[]).forEach((k) => {
        const untouched = JSON.stringify(cur[k] ?? null) === JSON.stringify(prev.base[k] ?? null);
        if (untouched) merged[k] = next[k];
      });
      return merged as Form;
    });
  }, [stage]);
  useEffect(() => setPreview(null), [stage.id]);

  // 다른 단계로 바뀌면 쓰던 기록 초안도 비움
  useEffect(() => {
    setNote("");
    setEditLog(null);
    setNoteKey((k) => k + 1);
  }, [stage.id]);

  const base = pick(stage);
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => JSON.stringify(f[k] ?? null) !== JSON.stringify(base[k] ?? null));
  const draftLog = v8 ? !isEmptyHtml(note) : !!note.trim();
  useUnsaved(
    "stage-panel",
    `'${stage.name}' 단계${dirty ? " 수정 내용" : ""}${dirty && (draftLog || editLog) ? ", " : ""}${draftLog ? "작성 중인 기록" : editLog ? "수정 중인 기록" : ""}`,
    dirty || draftLog || !!editLog
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
    if (!v8) {
      delete patch.group_id;
      delete patch.label_ids;
      delete patch.description_html;
    }
    if (JSON.stringify(roles) === JSON.stringify(cleanRoles(base.dept_roles, base.department, base.related_departments))) {
      delete patch.dept_roles; // 바뀌지 않았으면 보내지 않음
    } else patch.dept_roles = roles;
    // 바뀐 칸만 보냄
    for (const k of Object.keys(patch) as (keyof Form)[]) {
      if (k !== "name" && JSON.stringify(patch[k] ?? null) === JSON.stringify(base[k] ?? null)) delete patch[k];
    }
    if (patch.name === stage.name) delete patch.name;
    await onSave(patch);
    setSaving(false);
  }

  async function addLog() {
    const html = v8 ? note : "";
    const text = v8 ? htmlToText(note) : note.trim();
    if (v8 ? isEmptyHtml(note) : !note.trim()) return;
    await onAddLog(kind, text, v8 ? html : null);
    setNote("");
    setNoteKey((k) => k + 1);
    setKind("memo");
  }

  function markDone() {
    setF((p) => ({ ...p, actual_end: today, progress: 100, actual_start: p.actual_start ?? p.plan_start ?? today }));
  }

  // 왼쪽 테두리를 끌어서 너비 조절
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const moveFn = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.max(MIN, Math.min(window.innerWidth - 40, window.innerWidth - ev.clientX));
      setMode(w);
    };
    const up = () => {
      dragging.current = false;
      el.removeEventListener("pointermove", moveFn);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", moveFn);
    el.addEventListener("pointerup", up);
  }

  const auto = stageAutoStatus({ ...stage, ...f }, today);
  const ro = !canEdit;
  const planLocked = !!f.cal_linked && f.cal_follow !== false;
  const cols = width >= 1180 ? 3 : width >= 780 ? 2 : 1;
  const isWide = mode !== "normal";
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const descHtml = f.description_html ?? textToHtml(f.description);

  // ---- 블록 ----------------------------------------------------------
  const basics = (
    <div className="space-y-3" key="basics">
      <div className="space-y-2">
        <input
          className="w-full border-0 bg-transparent p-0 text-lg font-semibold outline-none disabled:text-ink"
          value={f.name}
          disabled={ro}
          onChange={(e) => set("name", e.target.value)}
        />
        {v8 && stage.ref_code && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-tour="sp-ref">
            <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono font-semibold tracking-wide text-white" title="지라·컨플루언스에 이 코드를 적으면 NPD가 찾아 기록에 모읍니다">
              {stage.ref_code}
            </span>
            <button className="rounded border border-black/10 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50" onClick={() => onCopy(stage.ref_code!, `${stage.ref_code} 복사했습니다`)}>
              코드 복사
            </button>
            <button
              className="rounded border border-black/10 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50"
              onClick={() => onCopy(`${siteUrl}/s/${stage.ref_code}`, "단계 링크를 복사했습니다")}
            >
              링크 복사
            </button>
          </div>
        )}
      </div>
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
      {v8 && (
        <div className="grid gap-2 sm:grid-cols-2" data-tour="sp-class">
          {groups && stage.parent_id && (
            <div>
              <label className="label">상위 단계</label>
              <div className="flex min-h-[34px] items-center gap-2 rounded-lg border border-black/10 bg-slate-50 px-2.5 py-1 text-sm">
                <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpenStage(stage.parent_id!)} title="상위 단계 열기">
                  {stagePath(stage, stages) || "—"}
                </button>
                {canEdit && (
                  <button
                    className="shrink-0 text-[11px] text-slate-500 hover:text-ink"
                    title="한 칸 위로 꺼내기"
                    onClick={() => {
                      const parent = stages.find((x) => x.id === stage.parent_id);
                      onSave({ parent_id: parent?.parent_id ?? null, group_id: parent ? effectiveGroup(parent, stages) : null });
                    }}
                  >
                    꺼내기 ↖
                  </button>
                )}
              </div>
              {groups.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-400">그룹: {groupPath(effectiveGroup(stage, stages), groups) || "없음"} (상위 단계를 따름)</p>
              )}
            </div>
          )}
          {groups && !stage.parent_id && (
            <div>
              <label className="label">그룹 (상위 분류)</label>
              <select className="input" disabled={ro} value={f.group_id ?? ""} onChange={(e) => set("group_id", e.target.value || null)}>
                <option value="">— 그룹 없음 (맨 위)</option>
                {groupOptions(groups).map((g) => (
                  <option key={g.id} value={g.id}>
                    {"  ".repeat(g.depth)}
                    {g.depth ? "└ " : ""}
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {labels && (
            <div className={groups ? "" : "sm:col-span-2"}>
              <label className="label">업무 속성</label>
              <LabelPicker value={f.label_ids ?? []} onChange={(v) => set("label_ids", v)} disabled={ro} />
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
            onChange={(v) => setF((p) => ({ ...p, department: v, related_departments: p.related_departments.filter((x) => x !== v) }))}
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
        <DeptPicker value={f.related_departments} onChange={(v) => set("related_departments", v)} options={departments} exclude={f.department} disabled={ro} />
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
        {v8 ? (
          <RichEditor
            value={descHtml}
            resetKey={stage.id + (stage.updated_at ?? "")}
            disabled={ro}
            minHeight={56}
            placeholder="이 단계에서 하는 일"
            onChange={(html) => setF((p) => ({ ...p, description_html: html || null, description: html ? htmlToText(html) || null : null }))}
          />
        ) : (
          <textarea className="input min-h-16" disabled={ro} value={f.description ?? ""} onChange={(e) => set("description", nul(e.target.value))} />
        )}
      </div>
    </div>
  );

  const schedule = (
    <div className="space-y-5" key="schedule">
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

      {deps && <StageDeps stage={stage} stages={stages} deps={deps} canEdit={canEdit} onChanged={onChanged} onOpen={onOpenStage} />}
    </div>
  );

  const records = (
    <div className="space-y-5" key="records">
      {checks && (
        <StageChecklist
          projectId={stage.project_id}
          stageId={stage.id}
          items={checks}
          canEdit={canEdit}
          myId={myId}
          profileById={profileById}
          onChanged={onChanged}
        />
      )}
      {links && <StageLinks projectId={stage.project_id} stageId={stage.id} items={links} canEdit={canEdit} onChanged={onChanged} onPreview={setPreview} />}
      <StageExternal logs={logs} />

      {calEvents.length > 0 && (
        <section className="space-y-2" data-tour="sp-cal-events">
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

      <section className="space-y-3" data-tour="sp-log">
        <h3 className="text-xs font-semibold text-slate-700">진행 기록</h3>
        {canEdit && (
          <div className="space-y-2">
            {v8 ? (
              <RichEditor
                value={note}
                resetKey={`${stage.id}-${noteKey}`}
                onChange={setNote}
                onSubmit={addLog}
                minHeight={64}
                placeholder="협의 내용, 진행 메모를 남겨주세요 (Ctrl+Enter 등록)"
              />
            ) : (
              <textarea
                className="input min-h-16"
                placeholder="협의 내용, 진행 메모를 남겨주세요 (Ctrl+Enter 등록)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addLog();
                }}
              />
            )}
            <div className="flex items-center gap-2">
              {(["memo", "issue", "decision"] as LogKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${kind === k ? "bg-ink text-white ring-ink" : "text-slate-500 ring-black/10"}`}
                >
                  {KIND[k].label}
                </button>
              ))}
              <button className="btn-outline ml-auto py-1 text-xs" disabled={v8 ? isEmptyHtml(note) : !note.trim()} onClick={addLog}>
                기록 추가
              </button>
            </div>
          </div>
        )}
        {logs.length === 0 ? (
          <p className="text-xs text-slate-400">아직 기록이 없습니다.</p>
        ) : (
          <ol className="space-y-3">
            {logs.map((l) => {
              const mine = l.author_id === myId;
              const editable = l.kind !== "change" && !l.source;
              const isEditing = editLog?.id === l.id;
              return (
                <li key={l.id} className="group text-sm">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={`rounded px-1.5 py-px ${KIND[l.kind].cls}`}>{KIND[l.kind].label}</span>
                    {l.source && <span className="rounded bg-slate-900 px-1.5 py-px text-white">{l.source === "jira" ? "Jira" : "Confluence"}</span>}
                    <span>{l.source ? "자동 수집" : l.author_id ? displayName(profileById[l.author_id]) : "시스템"}</span>
                    <span>·</span>
                    <span title={new Date(l.created_at).toLocaleString("ko-KR")}>{relativeTime(l.created_at)}</span>
                    {l.edited_at && <span title={new Date(l.edited_at).toLocaleString("ko-KR")}>(수정됨)</span>}
                    {mine && editable && !isEditing && (
                      <span className="ml-auto hidden gap-2 group-hover:flex">
                        {v8 && (
                          <button className="hover:text-ink" onClick={() => setEditLog({ id: l.id, html: l.body_html ?? textToHtml(l.body) })}>
                            수정
                          </button>
                        )}
                        <button className="text-rose-500" onClick={() => onDeleteLog(l.id)}>
                          삭제
                        </button>
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="mt-1 space-y-1.5">
                      <RichEditor value={editLog.html} resetKey={l.id} onChange={(html) => setEditLog({ id: l.id, html })} autoFocus minHeight={48} />
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost py-0.5 text-xs" onClick={() => setEditLog(null)}>
                          취소
                        </button>
                        <button
                          className="btn-primary py-0.5 text-xs"
                          disabled={isEmptyHtml(editLog.html)}
                          onClick={async () => {
                            await onUpdateLog(l.id, htmlToText(editLog.html), editLog.html);
                            setEditLog(null);
                          }}
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ) : l.body_html ? (
                    <RichView
                      html={l.body_html}
                      className="mt-0.5"
                      onChange={canEdit && editable ? (html) => onUpdateLog(l.id, htmlToText(html), html) : undefined}
                    />
                  ) : (
                    <p className={`mt-0.5 whitespace-pre-wrap ${l.kind === "change" ? "text-xs text-slate-500" : ""}`}>{l.body}</p>
                  )}
                </li>
              );
            })}
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
  );

  const columns: React.ReactNode[][] = cols === 3 ? [[basics], [schedule], [records]] : cols === 2 ? [[basics, schedule], [records]] : [[basics, schedule, records]];

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-black/10 bg-white shadow-2xl"
      style={{ width }}
      data-tour="sp-panel"
    >
      {/* 너비 조절 손잡이 */}
      {vw >= 640 && (
        <div
          className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize"
          onPointerDown={startResize}
          onDoubleClick={() => setMode(isWide ? "normal" : "wide")}
          title="끌어서 너비 조절 · 두 번 눌러 펼치기/접기"
          data-tour="sp-resize"
        >
          <div className="mx-auto h-full w-[3px] bg-transparent transition group-hover:bg-brand-500/60" />
        </div>
      )}
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
        {cols === 1 && isWide && <span className="text-[11px] text-slate-400">더 넓히면 2열로 보여요</span>}
        <button
          className="btn-ghost ml-auto px-2 py-0.5 text-xs"
          onClick={() => setMode(isWide ? "normal" : "wide")}
          title={isWide ? "기본 너비로" : "넓게 펼치기 (왼쪽 단계 목록만 남김)"}
          data-tour="sp-expand"
        >
          {isWide ? "⇥ 접기" : "⇤ 펼치기"}
        </button>
        <button className="btn-ghost px-2" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="scroll-thin h-full overflow-y-auto px-5 py-4">
          <div className="grid gap-x-8 gap-y-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {columns.map((c, i) => (
              <div key={i} className={`min-w-0 space-y-5 ${i > 0 ? "lg:border-l lg:border-black/[0.06] lg:pl-8" : ""}`}>
                {c}
              </div>
            ))}
          </div>
        </div>

        {/* 파일 미리보기 */}
        {preview && (
          <div className="absolute inset-0 z-20 flex flex-col bg-white">
            <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{preview.title}</span>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="btn-outline py-1 text-xs">
                새 창으로 열기 ↗
              </a>
              <button className="btn-ghost py-1 text-xs" onClick={() => setPreview(null)}>
                ✕ 닫기
              </button>
            </div>
            <iframe src={preview.preview} className="min-h-0 w-full flex-1 border-0 bg-slate-50" allow="autoplay; fullscreen" title={preview.title} />
            <p className="border-t border-black/[0.06] px-4 py-1.5 text-[11px] text-slate-400">
              안 보이면 파일 공유 권한을 확인하거나, 회사 구글 계정으로 로그인한 브라우저인지 확인하세요.
            </p>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 border-t border-black/[0.06] bg-slate-50/80 px-5 py-3" data-tour="sp-save">
          <span className="text-xs text-slate-400">{dirty ? "저장하지 않은 변경사항이 있습니다" : `최근 수정 ${short(stage.updated_at.slice(0, 10))}`}</span>
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
