"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { addDays, diffDays } from "@/lib/dates";
import type { Profile, Project, ProjectMember, Stage } from "@/lib/types";
import { displayName } from "./AppProvider";

export function ProjectSettings({
  project,
  stages,
  canEdit,
  isGamePart,
  profiles,
  members,
  onChanged,
  onDeleted,
  toast,
}: {
  project: Project;
  stages: Stage[];
  canEdit: boolean;
  isGamePart: boolean;
  profiles: Profile[];
  members: ProjectMember[];
  onChanged: () => void;
  onDeleted: () => void;
  toast: (m: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [start, setStart] = useState(project.start_date ?? "");
  const [pmId, setPmId] = useState(project.pm_id ?? "");
  const calReady = project.calendar_tags !== undefined; // 006 업데이트 후
  const [tags, setTags] = useState((project.calendar_tags ?? []).join(", "));
  const [shift, setShift] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState("");

  const approved = profiles.filter((p) => p.approved);
  const memberIds = new Set(members.map((m) => m.user_id));
  const candidates = approved.filter((p) => !p.is_game_part && !memberIds.has(p.id));
  const startChanged = (project.start_date ?? "") !== start;
  const delta = project.start_date && start ? diffDays(project.start_date, start) : 0;

  async function save() {
    setBusy(true);
    const sb = supabase();
    await sb
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
    if (startChanged && shift && delta !== 0) {
      for (const s of stages) {
        const patch: Partial<Stage> = {};
        if (s.plan_start) patch.plan_start = addDays(s.plan_start, delta);
        if (s.plan_end) patch.plan_end = addDays(s.plan_end, delta);
        if (s.expected_end && !s.actual_end) patch.expected_end = addDays(s.expected_end, delta);
        if (Object.keys(patch).length) await sb.from("stages").update(patch).eq("id", s.id);
      }
    }
    setBusy(false);
    toast("저장했습니다");
    onChanged();
  }

  async function toggleArchive() {
    await supabase().from("projects").update({ archived: !project.archived }).eq("id", project.id);
    toast(project.archived ? "보관을 해제했습니다" : "프로젝트를 보관했습니다");
    onChanged();
  }

  async function remove() {
    if (!confirm(`'${project.name}' 프로젝트와 모든 단계·기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await supabase().from("projects").delete().eq("id", project.id);
    onDeleted();
  }

  async function addMember() {
    if (!addId) return;
    await supabase().from("project_members").insert({ project_id: project.id, user_id: addId });
    setAddId("");
    onChanged();
  }

  async function removeMember(uid: string) {
    await supabase().from("project_members").delete().eq("project_id", project.id).eq("user_id", uid);
    onChanged();
  }

  const ro = !canEdit;

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-2">
      <section className="space-y-3" data-tour="ps-info">
        <h3 className="text-sm font-semibold">프로젝트 정보</h3>
        <div>
          <label className="label">프로젝트명</label>
          <input className="input" disabled={ro} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">유형</label>
            <input className="input" disabled={ro} value={category} onChange={(e) => setCategory(e.target.value)} />
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
          {startChanged && delta !== 0 && stages.length > 0 && (
            <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
              모든 단계 계획도 {delta > 0 ? `${delta}일 뒤로` : `${-delta}일 앞으로`} 함께 이동
            </label>
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
          <textarea className="input min-h-20" disabled={ro} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={save}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="space-y-3" data-tour="ps-members">
          <div>
            <h3 className="text-sm font-semibold">편집 권한</h3>
            <p className="text-xs text-slate-500">게임파트는 모든 프로젝트를 편집할 수 있습니다. 타부서 담당자는 여기서 추가하면 이 프로젝트만 편집할 수 있습니다.</p>
          </div>
          <ul className="divide-y divide-black/[0.05] rounded-lg border border-black/[0.07]">
            <li className="flex items-center justify-between px-3 py-2 text-sm">
              <span>게임파트 전원</span>
              <span className="text-xs text-slate-400">기본 편집</span>
            </li>
            {members.map((m) => {
              const p = profiles.find((x) => x.id === m.user_id);
              return (
                <li key={m.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {displayName(p)} <span className="text-xs text-slate-400">{p?.department ?? p?.email}</span>
                  </span>
                  {isGamePart && (
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => removeMember(m.user_id)}>
                      제외
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {isGamePart && (
            <div className="flex gap-2">
              <select className="input" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">타부서 담당자 선택…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayName(p)} {p.department ? `(${p.department})` : `(${p.email})`}
                  </option>
                ))}
              </select>
              <button className="btn-outline shrink-0" disabled={!addId} onClick={addMember}>
                편집자 추가
              </button>
            </div>
          )}
          {isGamePart && candidates.length === 0 && (
            <p className="text-xs text-slate-400">추가할 수 있는 사용자가 없습니다. 상대가 먼저 로그인하고 관리자가 승인해야 목록에 나타납니다.</p>
          )}
        </div>

        {isGamePart && (
          <div className="space-y-2 rounded-lg border border-black/[0.07] p-4" data-tour="ps-archive">
            <h3 className="text-sm font-semibold">보관 · 삭제</h3>
            <p className="text-xs text-slate-500">끝난 프로젝트는 보관하면 대시보드에서 숨겨집니다. (기록은 유지)</p>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={toggleArchive}>
                {project.archived ? "보관 해제" : "프로젝트 보관"}
              </button>
              <button className="btn-danger" onClick={remove}>
                삭제
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
