"use client";

import { useEffect, useState } from "react";
import { datesToWeeks, relativeTime, short, weeksToDates } from "@/lib/dates";
import { stageAutoStatus } from "@/lib/status";
import type { LogKind, Profile, Stage, StageLog } from "@/lib/types";
import { displayName } from "./AppProvider";
import { PmPicker, StatusChip } from "./ui";

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
>;

function pick(s: Stage): Form {
  return {
    name: s.name,
    department: s.department,
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

  useEffect(() => setF(pick(stage)), [stage]);

  const base = pick(stage);
  const dirty = (Object.keys(f) as (keyof Form)[]).some((k) => (f[k] ?? null) !== (base[k] ?? null));
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
    await onSave({ ...f, name: f.name.trim() || stage.name });
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

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-black/10 bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-3">
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">담당부서</label>
              <input className="input" disabled={ro} value={f.department ?? ""} onChange={(e) => set("department", nul(e.target.value))} />
            </div>
            <div>
              <label className="label">담당 / 협의 대상</label>
              <input className="input" disabled={ro} value={f.assignee ?? ""} onChange={(e) => set("assignee", nul(e.target.value))} />
            </div>
          </div>
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

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-700">계획</h3>
          {projectStart && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">시작 주차</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  disabled={ro}
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
                  disabled={ro}
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
              <input type="date" className="input" disabled={ro} value={f.plan_start ?? ""} onChange={(e) => set("plan_start", nul(e.target.value))} />
            </div>
            <div>
              <label className="label">계획 종료일</label>
              <input type="date" className="input" disabled={ro} value={f.plan_end ?? ""} onChange={(e) => set("plan_end", nul(e.target.value))} />
            </div>
          </div>
          {projectStart && <p className="text-[11px] text-slate-400">주차를 입력하면 날짜가 자동 계산되고, 날짜를 고치면 주차가 바뀝니다.</p>}
        </section>

        <section className="space-y-2">
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

        <section className="space-y-2">
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
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
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

        <section className="space-y-3 border-t border-black/[0.06] pt-4">
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
        <div className="flex items-center gap-2 border-t border-black/[0.06] bg-slate-50/80 px-5 py-3">
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
