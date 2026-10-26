"use client";

import { useState } from "react";
import { relativeTime, short } from "@/lib/dates";
import { stageAutoStatus, stageFinalStatus } from "@/lib/status";
import type { Light, Stage, StageLog } from "@/lib/types";
import { StatusChip } from "./ui";
import { DeptBadges } from "./DeptPicker";
import type { DeptColorFn } from "@/lib/deptColors";

export function ProgressTable({
  stages,
  logs,
  today,
  canEdit,
  onSelect,
  onQuick,
  dept,
  colorOf,
}: {
  stages: Stage[];
  logs: StageLog[];
  today: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onQuick: (id: string, patch: Partial<Stage>) => void;
  dept?: string | string[] | null;
  colorOf?: DeptColorFn;
}) {
  const [only, setOnly] = useState<"all" | "attention" | "check">("all");

  const lastLog = (id: string) => logs.find((l) => l.stage_id === id && l.kind !== "change") ?? logs.find((l) => l.stage_id === id);

  const rows = stages.filter((s) => {
    if (only === "check") return s.needs_check;
    if (only === "attention") {
      const st = stageFinalStatus(s, today);
      return st === "red" || st === "yellow" || s.needs_check;
    }
    return true;
  });

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
        <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs" data-tour="pt-filter">
          {(
            [
              ["all", "전체"],
              ["attention", "주의·차질"],
              ["check", "확인 필요"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setOnly(k)}
              className={`rounded-md px-2.5 py-1 ${only === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-400">행을 누르면 상세 편집 · 진행 기록을 남길 수 있습니다</span>
      </div>
      <div className="scroll-thin overflow-x-auto" data-tour="pt-table">
        <table className="w-full min-w-[1150px]">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="th w-8">#</th>
              <th className="th">진행단계</th>
              <th className="th">담당 · 연관부서</th>
              <th className="th">계획</th>
              <th className="th">자동</th>
              <th className="th">PM 판단</th>
              <th className="th w-[22%]">최근 진행 기록</th>
              <th className="th">이슈 / 결정 필요</th>
              <th className="th">다음 액션</th>
              <th className="th">담당·협의</th>
              <th className="th">확인</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05]">
            {rows.map((s, ri) => {
              const log = lastLog(s.id);
              return (
                <tr
                  key={s.id}
                  className={`cursor-pointer hover:bg-slate-50/70 ${s.skipped ? "opacity-45" : ""}`}
                  onClick={() => onSelect(s.id)}
                >
                  <td className="td text-xs tabular-nums text-slate-400">{stages.indexOf(s) + 1}</td>
                  <td className="td font-medium">{s.name}</td>
                  <td className="td text-xs text-slate-600">
                    <DeptBadges owner={s.department} related={s.related_departments ?? []} highlight={dept} colorOf={colorOf} roles={s.dept_roles} />
                  </td>
                  <td className="td whitespace-nowrap text-xs tabular-nums text-slate-600">
                    {s.plan_start ? `${short(s.plan_start)}~${short(s.plan_end)}` : "—"}
                    {s.expected_end && s.plan_end && s.expected_end > s.plan_end && (
                      <div className="text-rose-600">예상 {short(s.expected_end)}</div>
                    )}
                  </td>
                  <td className="td">
                    <StatusChip status={stageAutoStatus(s, today)} size="sm" />
                  </td>
                  <td className="td" onClick={(e) => e.stopPropagation()} data-tour={ri === 0 ? "pt-quick" : undefined}>
                    <select
                      className="rounded-md border border-transparent bg-transparent py-0.5 text-xs hover:border-black/10 disabled:opacity-100"
                      value={s.pm_status ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => onQuick(s.id, { pm_status: (e.target.value || null) as Light | null })}
                    >
                      <option value="">—</option>
                      <option value="green">🟢 정상</option>
                      <option value="yellow">🟡 주의</option>
                      <option value="red">🔴 차질</option>
                    </select>
                  </td>
                  <td className="td text-xs text-slate-600">
                    {log ? (
                      <>
                        <span className="line-clamp-2">{log.body}</span>
                        <span className="text-[11px] text-slate-400">{relativeTime(log.created_at)}</span>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="td max-w-[200px] text-xs text-slate-600">
                    <span className="line-clamp-3 whitespace-pre-wrap">{s.issue ?? "—"}</span>
                  </td>
                  <td className="td max-w-[200px] text-xs text-slate-600">
                    <span className="line-clamp-3 whitespace-pre-wrap">{s.next_action ?? "—"}</span>
                  </td>
                  <td className="td text-xs text-slate-600">{s.assignee ?? "—"}</td>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={s.needs_check}
                      onChange={(e) => onQuick(s.id, { needs_check: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-400">해당하는 단계가 없습니다.</p>}
      </div>
    </div>
  );
}
