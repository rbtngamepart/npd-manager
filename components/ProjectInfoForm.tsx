"use client";

// 프로젝트 정보 고치기 (이름·유형·PM·시작일·캘린더 말머리·설명)
//   [설정·권한] 탭과 '프로젝트 편집' 창이 같이 씀
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { addDays, diffDays, full, weekNumber, today as todayFn } from "@/lib/dates";
import type { Project, Stage } from "@/lib/types";
import { displayName, useApp } from "./AppProvider";
import { confirmLeave, useUnsaved } from "@/lib/unsaved";
import { Modal } from "./ui";

export function ProjectInfoForm({
  project,
  stages,
  canEdit,
  onSaved,
  onCancel,
  unsavedKey = "project-settings",
  autoFocus,
}: {
  project: Project;
  /** 시작일을 옮길 때 함께 옮길 단계 */
  stages: Stage[];
  canEdit: boolean;
  onSaved: (msg: string) => void;
  onCancel?: () => void;
  unsavedKey?: string;
  autoFocus?: boolean;
}) {
  const { profiles } = useApp();
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [start, setStart] = useState(project.start_date ?? "");
  const [pmId, setPmId] = useState(project.pm_id ?? "");
  const calReady = project.calendar_tags !== undefined; // 006 업데이트 후
  const [tags, setTags] = useState((project.calendar_tags ?? []).join(", "));
  const [shift, setShift] = useState(true);
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== project.name ||
    category !== (project.category ?? "") ||
    description !== (project.description ?? "") ||
    start !== (project.start_date ?? "") ||
    pmId !== (project.pm_id ?? "") ||
    (calReady && tags !== (project.calendar_tags ?? []).join(", "));
  useUnsaved(unsavedKey, "프로젝트 정보", canEdit && dirty, async () => {
    await save();
    return true;
  });

  const approved = (profiles ?? []).filter((p) => p.approved);
  const startChanged = (project.start_date ?? "") !== start;
  const delta = project.start_date && start ? diffDays(project.start_date, start) : 0;
  const planned = stages.filter((s) => s.plan_start || s.plan_end).length;

  async function save() {
    if (!dirty) return onSaved("바뀐 내용이 없습니다");
    setBusy(true);
    const sb = supabase();
    const { error } = await sb
      .from("projects")
      .update({
        name: name.trim() || project.name,
        category: category.trim() || null,
        description: description.trim() || null,
        start_date: start || null,
        pm_id: pmId || null,
        ...(calReady
          ? {
              calendar_tags: Array.from(
                new Set(
                  tags
                    .split(/[,\n]/)
                    .map((t) => t.replace(/^[\[【［]|[\]】］]$/g, "").trim())
                    .filter(Boolean)
                )
              ),
            }
          : {}),
      })
      .eq("id", project.id);
    if (error) {
      setBusy(false);
      return onSaved(`저장 실패: ${error.message}`);
    }
    let moved = 0;
    if (startChanged && shift && delta !== 0) {
      for (const s of stages) {
        const patch: Partial<Stage> = {};
        if (s.plan_start) patch.plan_start = addDays(s.plan_start, delta);
        if (s.plan_end) patch.plan_end = addDays(s.plan_end, delta);
        if (s.expected_end && !s.actual_end) patch.expected_end = addDays(s.expected_end, delta);
        if (Object.keys(patch).length) {
          await sb.from("stages").update(patch).eq("id", s.id);
          moved++;
        }
      }
    }
    setBusy(false);
    onSaved(moved ? `저장했습니다 · 단계 ${moved}개 일정을 ${delta > 0 ? `${delta}일 뒤로` : `${-delta}일 앞으로`} 옮겼습니다` : "저장했습니다");
  }

  const ro = !canEdit;
  return (
    <div className="space-y-3">
      <div>
        <label className="label">프로젝트명</label>
        <input className="input" disabled={ro} value={name} onChange={(e) => setName(e.target.value)} autoFocus={autoFocus} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">유형</label>
          <input className="input" disabled={ro} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예) 공모전, 직접 기획" />
        </div>
        <div>
          <label className="label">담당 PM</label>
          <select className="input" disabled={ro} value={pmId} onChange={(e) => setPmId(e.target.value)}>
            <option value="">—</option>
            {approved.map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p)}
                {p.department ? ` (${p.department})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">프로젝트 시작일 (1주차)</label>
        <input type="date" className="input" disabled={ro} value={start} onChange={(e) => setStart(e.target.value)} />
        {start && !startChanged && <p className="mt-1 text-[11px] text-slate-400">오늘은 {weekNumber(start, todayFn())}주차입니다.</p>}
        {startChanged && delta !== 0 && planned > 0 && (
          <div className="mt-2 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>
              시작일이 {full(project.start_date)} → {full(start)} ({delta > 0 ? `${delta}일 뒤로` : `${-delta}일 앞으로`}) 바뀝니다.
            </p>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
              일정이 있는 단계 {planned}개의 계획도 함께 옮기기
            </label>
            {!shift && <p className="text-amber-700">끄면 단계 날짜는 그대로이고, 주차 번호만 새 시작일 기준으로 바뀌어요.</p>}
          </div>
        )}
      </div>
      {calReady && (
        <div data-tour="ps-calendar">
          <label className="label">📅 캘린더 말머리 (여러 개는 쉼표로)</label>
          <input className="input" disabled={ro} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예) OG26, 오리지널게임" />
          <p className="mt-1 text-[11px] text-slate-400">
            구글 캘린더 일정 제목이 <code>[{(tags.split(",")[0] || "말머리").trim()}] 단계명</code> 이면 이 프로젝트 단계로 들어옵니다. 프로젝트 이름과 같은 말머리는 따로 적지 않아도 연결돼요.
          </p>
        </div>
      )}
      <div>
        <label className="label">설명</label>
        <textarea className="input min-h-24" disabled={ro} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="프로젝트 목적, 범위, 참고할 내용" />
      </div>
      {canEdit && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button className="btn-ghost" onClick={onCancel}>
              취소
            </button>
          )}
          <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 대시보드 오른쪽 클릭 · 프로젝트 제목 옆 ✏️ 에서 여는 편집 창 */
export function ProjectEditModal({
  project,
  stages,
  canEdit,
  onClose,
  onSaved,
}: {
  project: Project | null;
  stages: Stage[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const close = async () => {
    if (!(await confirmLeave(["project-edit"]))) return;
    onClose();
  };
  return (
    <Modal open={!!project} onClose={close} title={canEdit ? "프로젝트 편집" : "프로젝트 정보"} width="max-w-xl">
      {project && (
        <div data-tour="project-edit">
          <ProjectInfoForm
            key={project.id + project.updated_at}
            project={project}
            stages={stages}
            canEdit={canEdit}
            unsavedKey="project-edit"
            autoFocus={canEdit}
            onCancel={close}
            onSaved={(m) => {
              onSaved(m);
              if (!m.startsWith("저장 실패")) onClose();
            }}
          />
          <p className="mt-4 border-t border-black/[0.06] pt-3 text-[11px] text-slate-400">편집 권한·보관·삭제는 프로젝트 화면의 [설정·권한] 탭에 있어요.</p>
        </div>
      )}
    </Modal>
  );
}
