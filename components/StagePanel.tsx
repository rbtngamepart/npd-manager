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
import { StageNotes } from "./StageNotes";
import { StageChecklist, StageDeps, StageExternal, StageLinks } from "./StageExtras";
import { effectiveGroup, groupOptions, groupPath, stagePath } from "@/lib/groups";
import { askSave, useUnsaved } from "@/lib/unsaved";
import { extractRefs, newMentions, notifyMentions } from "@/lib/noteRefs";
import { useContextMenu } from "./ContextMenu";
import { Help, Tip } from "./Tip";
import Link from "next/link";

const SHORTCUTS = "글자 크기 Ctrl+1 보통 · 2 작게 · 3 크게 · 4 아주 크게";

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
  onCopyStage,
  onDuplicate,
  onMove,
  onAddLog,
  onUpdateLog,
  onDeleteLog,
  onHideExt,
  deletedExt = [],
  onRestoreExt,
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
  /** 단계 복사 (Ctrl+C와 같음) · 바로 아래에 복제 */
  onCopyStage?: () => void;
  onDuplicate?: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddLog: (kind: LogKind, body: string, html: string | null) => Promise<void>;
  onUpdateLog: (id: string, body: string, html: string) => Promise<void>;
  onDeleteLog: (id: string) => void;
  /** 지라·컨플루언스에서 수집된 기록 지우기 (다시 수집하지 않음) */
  onHideExt?: (ids: string[]) => void;
  /** NPD에서 지운 수집 기록 (되살리기용) */
  deletedExt?: StageLog[];
  onRestoreExt?: (ids: string[]) => void;
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
  /** 진행 기록 큰 창: 새로 쓰기 / 남긴 기록 보기·수정 */
  const [big, setBig] = useState<{ mode: "new" } | { mode: "desc" } | { mode: "log"; id: string } | null>(null);
  const asking = useRef(false);
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
    setBig(null);
  }, [stage.id]);

  const base = pick(stage);
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => JSON.stringify(f[k] ?? null) !== JSON.stringify(base[k] ?? null));
  const draftLog = v8 ? !isEmptyHtml(note) : !!note.trim();
  useUnsaved(
    "stage-panel",
    `'${stage.name}' 단계${dirty ? " 수정 내용" : ""}${dirty && (draftLog || editLog) ? ", " : ""}${draftLog ? "작성 중인 기록" : editLog ? "수정 중인 기록" : ""}`,
    dirty || draftLog || !!editLog,
    // [저장하고 나가기]: 단계 수정 저장 + 쓰던 기록 등록 + 고치던 기록 저장
    async () => {
      if (dirty) await save();
      if (draftLog) await addLog();
      if (editLog && !isEmptyHtml(editLog.html)) await onUpdateLog(editLog.id, htmlToText(editLog.html), editLog.html);
      return true;
    }
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
    if (v8) void notifyMentions({ kind: "log", stageId: stage.id, mentioned: extractRefs(html).mentions, text });
    setNote("");
    setNoteKey((k) => k + 1);
    setKind("memo");
    setBig((b) => (b?.mode === "new" ? null : b));
  }

  // 보던 기록이 지워지면 큰 창도 닫음
  useEffect(() => {
    if (big?.mode === "log" && !logs.some((x) => x.id === big.id)) setBig(null);
  }, [big, logs]);

  /**
   * 큰 창에서 고치던 기록 마무리
   *   save: 바로 저장 · ask: 바뀐 게 있으면 [저장하고 닫기/저장하지 않고 닫기/취소]
   * 끝났으면 true (취소하면 false)
   */
  async function finishEdit(how: "save" | "ask"): Promise<boolean> {
    if (!editLog) return true;
    const l = logs.find((x) => x.id === editLog.id);
    const changed = !!l && editLog.html !== (l.body_html ?? textToHtml(l.body));
    let choice: "save" | "discard" | "cancel" = how === "save" ? "save" : changed ? "cancel" : "discard";
    if (how === "ask" && changed) {
      if (asking.current) return false;
      asking.current = true;
      choice = await askSave("수정 중인 진행 기록");
      asking.current = false;
    }
    if (choice === "cancel") return false;
    if (choice === "save" && changed) {
      if (isEmptyHtml(editLog.html)) return false;
      await onUpdateLog(editLog.id, htmlToText(editLog.html), editLog.html);
      void notifyMentions({ kind: "log", stageId: stage.id, mentioned: newMentions(extractRefs(l?.body_html).mentions, extractRefs(editLog.html).mentions), text: htmlToText(editLog.html) });
    }
    setEditLog(null);
    return true;
  }

  async function closeBig() {
    if (asking.current) return;
    if (big?.mode === "log" && editLog?.id === big.id && !(await finishEdit("ask"))) return;
    setBig(null);
  }
  const closeRef = useRef(closeBig);
  closeRef.current = closeBig;

  // 큰 창: Esc로 닫기 (고치던 기록이 있으면 먼저 물어봄)
  useEffect(() => {
    if (!big) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || asking.current) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [big]);

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
  const setDescHtml = (html: string) => setF((p) => ({ ...p, description_html: html || null, description: html ? htmlToText(html) || null : null }));

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
            <Tip
              interactive
              width={290}
              title="단계 코드"
              content={
                <>
                  지라 이슈·댓글이나 컨플루언스 문서에 이 코드(또는 단계 링크)를 적어두면 NPD가 찾아서 이 단계 기록에 모읍니다.
                  <ul className="mt-1 list-disc pl-4">
                    <li>
                      <b>결정:</b> / <b>이슈:</b>로 시작하는 줄은 결정·이슈 기록으로
                    </li>
                    <li>링크를 누르면 바로 이 단계가 열려요</li>
                  </ul>
                  <Link href="/atlassian" className="mt-1.5 inline-block">
                    연동 설정·인식 테스트 →
                  </Link>
                </>
              }
            >
              <span tabIndex={0} className="cursor-help rounded bg-slate-900 px-1.5 py-0.5 font-mono font-semibold tracking-wide text-white">
                {stage.ref_code}
              </span>
            </Tip>
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
              <label className="label">
                그룹 (상위 분류)
                <Help
                  title="그룹"
                  content={
                    <>
                      단계를 묶는 폴더입니다. 그룹 안에 그룹을 계속 넣을 수 있고, 간트에서 접고 펼치며 전체 기간을 한 줄로 봅니다.
                      <br />
                      간트에서 단계 이름을 끌어 그룹·다른 단계 위에 놓아도 옮겨져요.
                    </>
                  }
                />
              </label>
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
              <label className="label">
                업무 속성
                <Help
                  title="업무 속성 (라벨)"
                  content={
                    <>
                      기획·디자인·생산처럼 <b>일의 성격</b>을 붙이는 라벨입니다. 그룹(위치)과 달리 한 단계에 여러 개 붙일 수 있어요.
                      <br />
                      간트·진행관리·기록 탭의 [업무 속성] 필터로 골라 봅니다.
                    </>
                  }
                />
              </label>
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
          연관부서
          <Help content="함께 검토·협업하는 부서입니다. 단계를 부서마다 따로 만들지 않아도 그 부서의 [부서별 일정]에 이 단계가 함께 표시돼요." />
        </label>
        <DeptPicker value={f.related_departments} onChange={(v) => set("related_departments", v)} options={departments} exclude={f.department} disabled={ro} />
        {!ro && <p className="mt-1 text-[11px] text-slate-400">찾는 부서가 없으면 관리자에게 요청하세요 (사용자 관리 › 부서)</p>}
      </div>
      {rolesReady && (f.department || f.related_departments.length > 0) && (
        <div data-tour="sp-roles">
          <label className="label">
            부서별 역할
            <Help
              title="부서별 역할"
              width={300}
              content={
                roleTypes && roleTypes.some((r) => r.description) ? (
                  <ul>
                    {roleTypes.map((r) => (
                      <li key={r.id}>
                        <b>{r.name}</b>
                        {r.description ? ` — ${r.description}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>같은 단계라도 부서마다 맡는 일이 다를 때 지정합니다. 예) 게임파트: 주관 · 운영팀: 의견 청취 · 경영진: 의결</>
                )
              }
            />
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
      <div data-tour="sp-desc">
        <div className="flex items-center">
          <label className="label">주요내용 (단계 설명)</label>
          {v8 && !ro && (
            <Tip content="큰 창에서 설명을 씁니다. 지금 쓰던 내용은 그대로 옮겨가요.">
              <button className="btn-ghost -mt-1 ml-auto px-1.5 py-0.5 text-[11px] text-slate-500" onClick={() => setBig({ mode: "desc" })}>
                ⤢ 크게 쓰기
              </button>
            </Tip>
          )}
        </div>
        {v8 && big?.mode === "desc" ? (
          <button
            className="w-full rounded-lg border border-dashed border-brand-500/40 bg-brand-500/[0.03] px-3 py-4 text-left text-xs text-slate-500"
            onClick={() => setBig({ mode: "desc" })}
          >
            큰 창에서 작성 중입니다…
          </button>
        ) : v8 ? (
          <RichEditor
            value={descHtml}
            resetKey={stage.id + (stage.updated_at ?? "")}
            disabled={ro}
            minHeight={56}
            placeholder="이 단계에서 하는 일"
            onChange={setDescHtml}
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
            <label className="label">
              예상 완료일
              <Help content="계획보다 늦어질 것 같을 때 입력하세요. 간트에 빨간 점선으로 표시되고, 연결된 뒤 단계가 있으면 함께 미룰지 물어봐요." />
            </label>
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
          <Tip
            title="자동 상태는 이렇게 정해져요"
            width={300}
            content={
              <ul>
                <li>
                  <b>완료</b> 실제 완료일 입력됨
                </li>
                <li>
                  <b>대기</b> 계획 시작 전
                </li>
                <li>
                  <b>차질</b> 계획 종료일이 지났는데 미완료
                </li>
                <li>
                  <b>주의</b> 예상 완료가 계획보다 늦음, 또는 시작일이 지났는데 실제 시작 안 함
                </li>
                <li>
                  <b>정상</b> 그 밖의 경우
                </li>
                <li className="mt-1 text-white/70">오른쪽 PM 판단을 고르면 자동 상태 대신 그 값이 최종 상태가 됩니다.</li>
              </ul>
            }
          >
            <div tabIndex={0} className="flex cursor-help items-center gap-1.5 text-xs text-slate-500">
              자동 <StatusChip status={auto} size="sm" />
            </div>
          </Tip>
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
            <Help content="체크하면 대시보드의 '지금 챙겨야 할 단계'에 올라가고, 간트 이름 옆에 파란 점이 붙습니다." />
          </label>
          <label className="flex items-center gap-1.5 text-slate-500">
            <input type="checkbox" disabled={ro} checked={f.skipped} onChange={(e) => set("skipped", e.target.checked)} />
            이번 프로젝트에서 미사용
            <Help content="이번 프로젝트에서 하지 않는 단계입니다. 간트에 흐리게 표시되고 진행률·상태 계산에서 빠져요. 템플릿 단계를 지우지 않고 남겨둘 때 씁니다." />
          </label>
        </div>
      </section>

      {deps && <StageDeps stage={stage} stages={stages} deps={deps} canEdit={canEdit} onChanged={onChanged} onOpen={onOpenStage} />}
    </div>
  );

  // ---- 진행 기록 공통 조각 ------------------------------------------------
  const kindChips = (["memo", "issue", "decision"] as LogKind[]).map((k) => (
    <button
      key={k}
      onClick={() => setKind(k)}
      className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${kind === k ? "bg-ink text-white ring-ink" : "text-slate-500 ring-black/10"}`}
    >
      {KIND[k].label}
    </button>
  ));
  const logEditable = (l: StageLog) => l.kind !== "change" && !l.source;
  const openMenu = useContextMenu();
  function logMenu(e: React.MouseEvent, l: StageLog) {
    if ((e.target as HTMLElement).closest("a")) return; // 링크는 브라우저 메뉴 그대로
    const mine = l.author_id === myId;
    openMenu(e, [
      { header: `${KIND[l.kind].label} · ${relativeTime(l.created_at)}` },
      { icon: "⤢", label: "크게 보기", run: () => setBig({ mode: "log", id: l.id }) },
      canEdit && mine && logEditable(l) && v8 && { icon: "✏️", label: "수정", run: () => startEdit(l) },
      { icon: "⧉", label: "글 복사", run: () => onCopy(l.body, "기록 내용을 복사했습니다") },
      !!l.source && canEdit && onHideExt && "sep",
      !!l.source && canEdit && onHideExt && { icon: "🗑", label: "수집 기록 지우기", danger: true, run: () => confirm("이 수집 기록을 지울까요?\n지라·컨플루언스 원문은 그대로이고, 이 기록은 다시 수집되지 않습니다.") && onHideExt([l.id]) },
      canEdit && mine && logEditable(l) && "sep",
      canEdit && mine && logEditable(l) && { icon: "🗑", label: "기록 지우기", danger: true, run: () => onDeleteLog(l.id) },
    ]);
  }
  const startEdit = (l: StageLog) => {
    setEditLog({ id: l.id, html: l.body_html ?? textToHtml(l.body) });
    setBig({ mode: "log", id: l.id });
  };
  function logHead(l: StageLog, inModal: boolean) {
    const mine = l.author_id === myId;
    const isEditing = editLog?.id === l.id;
    return (
      <div className={`flex items-center gap-1.5 text-slate-400 ${inModal ? "text-xs" : "text-[11px]"}`}>
        <span className={`rounded px-1.5 py-px ${KIND[l.kind].cls}`}>{KIND[l.kind].label}</span>
        {l.source && <span className="rounded bg-slate-900 px-1.5 py-px text-white">{l.source === "jira" ? "Jira" : "Confluence"}</span>}
        {l.source && l.ext_detached_at && (
          <Tip content="지라·컨플루언스 원문에서 이 단계 코드가 지워졌습니다. 기록은 남겨두고 더 이상 갱신하지 않아요. 코드를 다시 적으면 다시 연결됩니다.">
            <span tabIndex={0} className="cursor-help rounded bg-amber-50 px-1.5 py-px text-amber-700">연결 해제됨</span>
          </Tip>
        )}
        <span>{l.source ? "자동 수집" : l.author_id ? displayName(profileById[l.author_id]) : "시스템"}</span>
        <span>·</span>
        <span title={new Date(l.created_at).toLocaleString("ko-KR")}>
          {inModal ? new Date(l.created_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : relativeTime(l.created_at)}
        </span>
        {l.edited_at && <span title={new Date(l.edited_at).toLocaleString("ko-KR")}>(수정됨)</span>}
        {l.source && canEdit && onHideExt && (
          <span className={`ml-auto ${inModal ? "flex" : "hidden group-hover:flex"}`}>
            <button
              className="text-rose-500"
              onClick={() => {
                if (!confirm("이 수집 기록을 지울까요?\n지라·컨플루언스 원문은 그대로이고, 이 기록은 다시 수집되지 않습니다.")) return;
                onHideExt([l.id]);
              }}
            >
              삭제
            </button>
          </span>
        )}
        {canEdit && mine && logEditable(l) && !isEditing && (
          <span className={`ml-auto gap-2 ${inModal ? "flex" : "hidden group-hover:flex"}`}>
            {v8 && (
              <button className="hover:text-ink" onClick={() => startEdit(l)}>
                수정
              </button>
            )}
            <button
              className="text-rose-500"
              onClick={() => {
                onDeleteLog(l.id);
              }}
            >
              삭제
            </button>
          </span>
        )}
      </div>
    );
  }
  function logBody(l: StageLog, inModal = false) {
    return l.body_html ? (
      <RichView
        html={l.body_html}
        className={inModal ? "text-[15px]! leading-relaxed" : "mt-0.5"}
        onChange={canEdit && logEditable(l) ? (html) => onUpdateLog(l.id, htmlToText(html), html) : undefined}
      />
    ) : (
      <p className={`whitespace-pre-wrap ${inModal ? "text-[15px] leading-relaxed" : "mt-0.5"} ${l.kind === "change" ? "text-xs text-slate-500" : ""}`}>{l.body}</p>
    );
  }

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
      <StageNotes projectId={stage.project_id} stageId={stage.id} canEdit={canEdit} />
      <StageExternal logs={logs} canEdit={canEdit} onHide={onHideExt} deleted={deletedExt} onRestore={onRestoreExt} />

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
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-700">진행 기록</h3>
          {canEdit && v8 && (
            <Tip content="큰 창에서 기록을 씁니다. 지금 쓰던 내용은 그대로 옮겨가요.">
              <button className="btn-ghost ml-auto px-1.5 py-0.5 text-[11px] text-slate-500" onClick={() => setBig({ mode: "new" })} data-tour="sp-log-big">
                ⤢ 크게 쓰기
              </button>
            </Tip>
          )}
        </div>
        {canEdit && (
          <div className="space-y-2">
            {big?.mode === "new" ? (
              <button
                className="w-full rounded-lg border border-dashed border-brand-500/40 bg-brand-500/[0.03] px-3 py-4 text-left text-xs text-slate-500"
                onClick={() => setBig({ mode: "new" })}
              >
                큰 창에서 작성 중입니다…
              </button>
            ) : v8 ? (
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
            {big?.mode !== "new" && (
              <div className="flex items-center gap-2">
                {kindChips}
                <button className="btn-outline ml-auto py-1 text-xs" disabled={v8 ? isEmptyHtml(note) : !note.trim()} onClick={addLog}>
                  기록 추가
                </button>
              </div>
            )}
          </div>
        )}
        {logs.length === 0 ? (
          <p className="text-xs text-slate-400">아직 기록이 없습니다.</p>
        ) : (
          <ol className="space-y-1">
            {logs.map((l) => (
              <li
                key={l.id}
                className={`group -mx-2 cursor-pointer rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-50 ${l.ext_detached_at ? "opacity-60" : ""} ${big?.mode === "log" && big.id === l.id ? "bg-brand-500/[0.06]" : ""}`}
                onClick={(e) => {
                  // 링크·체크박스·버튼을 누른 것은 그대로 두고, 나머지는 크게 보기
                  if ((e.target as HTMLElement).closest("a, button, input, label")) return;
                  if (window.getSelection()?.toString()) return; // 글자를 드래그해 고르는 중
                  setBig({ mode: "log", id: l.id });
                }}
                title="눌러서 크게 보기 · 오른쪽 클릭 메뉴"
                onContextMenu={(e) => logMenu(e, l)}
              >
                {logHead(l, false)}
                <div className="max-h-48 overflow-hidden">{logBody(l)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

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
        {onCopyStage && (
          <Tip content="이 단계를 복사 (하위 단계·체크리스트·링크 포함). 다른 단계를 고르고 Ctrl+V 하면 그 아래에, 다른 프로젝트에서도 붙여넣을 수 있어요. 목록에서 단계를 고른 채 Ctrl+C 해도 돼요.">
            <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={onCopyStage} data-tour="sp-copy">
              ⧉ 복사
            </button>
          </Tip>
        )}
        {canEdit && onDuplicate && (
          <Tip content="이 단계를 바로 아래에 하나 더 만들기 (계획·부서·설명·체크리스트 포함, 실적·진행률은 비움)">
            <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={onDuplicate}>
              ⧉+ 복제
            </button>
          </Tip>
        )}
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
          <span className="min-w-0 truncate text-xs text-slate-400">{dirty ? "저장하지 않은 변경사항이 있습니다" : `최근 수정 ${short(stage.updated_at.slice(0, 10))}`}</span>
          <span className="ml-auto shrink-0">
            <Tip content="단계를 지웁니다. 진행 기록은 프로젝트 [기록] 탭에 남고, 하위 단계는 한 칸 위로 올라가요.">
              <button className="btn whitespace-nowrap text-rose-600 hover:bg-rose-50" onClick={onDelete}>
                단계 삭제
              </button>
            </Tip>
          </span>
          <button className="btn-ghost shrink-0 whitespace-nowrap" disabled={!dirty} onClick={() => setF(base)}>
            되돌리기
          </button>
          <button className="btn-primary shrink-0 whitespace-nowrap" disabled={!dirty || saving} onClick={save}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
      {/* 큰 창: 진행 기록 쓰기·보기·수정, 단계 설명 쓰기 */}
      {big && (() => {
        const bl = big.mode === "log" ? logs.find((x) => x.id === big.id) : undefined;
        if (big.mode === "log" && !bl) return null;
        const idx = bl ? logs.indexOf(bl) : -1;
        const editing = !!bl && editLog?.id === bl.id;
        const isDesc = big.mode === "desc";
        const nav = bl && !editing && logs.length > 1;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && closeBig()}>
            <div className="flex h-[min(860px,92vh)] w-[min(960px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-label={isDesc ? "단계 설명" : "진행 기록"}>
              <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-5 py-3">
                <span className="text-sm font-semibold">{isDesc ? "주요내용 (단계 설명)" : bl ? "진행 기록" : "진행 기록 쓰기"}</span>
                <span className="min-w-0 truncate text-xs text-slate-400">· {stage.name}</span>
                {nav && (
                  <div className="ml-auto flex items-center gap-1 text-xs text-slate-400">
                    <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={idx <= 0} onClick={() => setBig({ mode: "log", id: logs[idx - 1].id })} title="더 최근 기록">
                      ↑
                    </button>
                    <span className="tabular-nums">
                      {idx + 1}/{logs.length}
                    </span>
                    <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={idx >= logs.length - 1} onClick={() => setBig({ mode: "log", id: logs[idx + 1].id })} title="더 지난 기록">
                      ↓
                    </button>
                  </div>
                )}
                <button className={`btn-ghost px-2 ${nav ? "" : "ml-auto"}`} onClick={() => closeBig()} aria-label="닫기">
                  ✕
                </button>
              </div>

              {isDesc ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
                  <div className="min-h-0 flex-1">
                    <RichEditor
                      value={descHtml}
                      resetKey={`big-desc-${stage.id}`}
                      onChange={setDescHtml}
                      onSubmit={async () => {
                        await save();
                        setBig(null);
                      }}
                      autoFocus
                      large
                      fill
                      blocks
                      minHeight={320}
                      placeholder="이 단계에서 하는 일"
                    />
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <span className="mr-auto text-[11px] text-slate-400">{SHORTCUTS} · Ctrl+Enter 저장 · 닫아도 고친 내용은 패널에 남아요</span>
                    <button className="btn-ghost text-sm" onClick={() => setBig(null)}>
                      닫기
                    </button>
                    <button
                      className="btn-primary text-sm"
                      disabled={!dirty || saving}
                      onClick={async () => {
                        await save();
                        setBig(null);
                      }}
                    >
                      {saving ? "저장 중…" : "저장"}
                    </button>
                  </div>
                </div>
              ) : bl ? (
                <>
                  <div className="shrink-0 border-b border-black/[0.04] px-5 py-2.5">{logHead(bl, true)}</div>
                  {editing ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
                      <div className="min-h-0 flex-1">
                        <RichEditor
                          value={editLog!.html}
                          resetKey={`big-${bl.id}`}
                          onChange={(html) => setEditLog({ id: bl.id, html })}
                          onSubmit={() => finishEdit("save")}
                          autoFocus
                          large
                          fill
                          blocks
                          minHeight={320}
                        />
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-2">
                        <span className="mr-auto text-[11px] text-slate-400">{SHORTCUTS} · Ctrl+Enter 저장</span>
                        <button className="btn-ghost text-sm" onClick={() => finishEdit("ask")}>
                          취소
                        </button>
                        <button className="btn-primary text-sm" disabled={isEmptyHtml(editLog!.html)} onClick={() => finishEdit("save")}>
                          저장
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4"
                      onDoubleClick={(e) => {
                        if (!canEdit || !v8 || bl.author_id !== myId || !logEditable(bl)) return;
                        if ((e.target as HTMLElement).closest("a, button, input, label")) return;
                        startEdit(bl);
                      }}
                    >
                      {logBody(bl, true)}
                      {canEdit && v8 && bl.author_id === myId && logEditable(bl) && (
                        <p className="mt-6 text-[11px] text-slate-300">두 번 누르거나 위 [수정]을 누르면 고칠 수 있어요.</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
                  <div className="min-h-0 flex-1">
                    <RichEditor
                      value={note}
                      resetKey={`big-new-${stage.id}`}
                      onChange={setNote}
                      onSubmit={addLog}
                      autoFocus
                      large
                      fill
                      blocks
                      minHeight={320}
                      placeholder="협의 내용, 진행 메모를 남겨주세요 (Ctrl+Enter 등록)"
                    />
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {kindChips}
                    <span className="ml-2 text-[11px] text-slate-400">{SHORTCUTS} · Ctrl+Enter 등록 · 닫아도 쓰던 내용은 남아요</span>
                    <button className="btn-primary ml-auto text-sm" disabled={isEmptyHtml(note)} onClick={addLog}>
                      기록 추가
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </aside>
  );
}
